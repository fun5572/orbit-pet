import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import { invoke } from "@tauri-apps/api/core";
import { currentMonitor, cursorPosition, getCurrentWindow, Window as TauriWindow } from "@tauri-apps/api/window";
import type { Point } from "./face/gaze";
import { PET_DEFAULT_SIZE, PET_WINDOW_PADDING } from "./settings";

export interface PointerFrame {
  pointer: Point;
  center: Point;
  scale: number;
  speed: number;
  velocityX: number;
  velocityY: number;
  isInsidePet: boolean;
}

export interface DesktopAdapter {
  start(onFrame: (frame: PointerFrame) => void): Promise<void>;
  startDragging(): Promise<void>;
  isPrimaryButtonPressed(): Promise<boolean | null>;
  setAutonomousOffset(offset: Point): Promise<void>;
  finishAutonomousMotion(): Promise<void>;
  cancelAutonomousMotion(): Promise<void>;
  setPetSize(size: number): Promise<void>;
  setClickThrough(clickThrough: boolean): Promise<void>;
  toggleSettings(): Promise<void>;
  destroy(): void;
}

const isTauriRuntime = (): boolean => "__TAURI_INTERNALS__" in window;
const POINTER_SAMPLE_INTERVAL_MS = 32;
const POINTER_RETRY_INTERVAL_MS = 160;
const POINTER_ERROR_LOG_INTERVAL_MS = 5_000;
const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

interface MotionBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export const createDesktopAdapter = (): DesktopAdapter => {
  const tauriWindow = isTauriRuntime() ? getCurrentWindow() : null;
  let timer: number | undefined;
  let browserPointer: Point = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  let lastPointer: Point | null = null;
  let lastSampleTime = performance.now();
  let destroyed = false;
  let clickThrough = false;
  let petSize = PET_DEFAULT_SIZE;
  let effectsWindow: TauriWindow | null = null;
  let stopMoveListener = (): void => undefined;
  let autonomousHome: PhysicalPosition | null = null;
  let autonomousScale = 1;
  let autonomousBounds: MotionBounds | null = null;
  let queuedAutonomousOffset: Point | null = null;
  let autonomousMovePromise: Promise<void> | null = null;
  let lastPointerErrorLoggedAt = Number.NEGATIVE_INFINITY;

  const onBrowserPointer = (event: PointerEvent): void => {
    browserPointer = { x: event.clientX, y: event.clientY };
  };

  const sampleTauriFrame = async (): Promise<{ pointer: PhysicalPosition; center: Point; scale: number }> => {
    if (!tauriWindow) throw new Error("Tauri window is unavailable");
    const [pointer, position, scale] = await Promise.all([
      cursorPosition(),
      tauriWindow.outerPosition(),
      tauriWindow.scaleFactor(),
    ]);
    return {
      pointer,
      center: {
        x: position.x + (window.innerWidth * scale) / 2,
        y: position.y + (window.innerHeight * scale) / 2,
      },
      scale,
    };
  };

  const syncEffectsPosition = async (): Promise<void> => {
    if (!tauriWindow) return;
    effectsWindow ??= await TauriWindow.getByLabel("effects");
    if (!effectsWindow) return;

    const [petPosition, scale] = await Promise.all([tauriWindow.outerPosition(), tauriWindow.scaleFactor()]);
    const anchorX = PET_WINDOW_PADDING / 2 + petSize * 0.5;
    const anchorY = PET_WINDOW_PADDING / 2 + petSize * 0.15;
    await effectsWindow.setPosition(
      new PhysicalPosition(
        Math.round(petPosition.x + (anchorX - 40) * scale),
        Math.round(petPosition.y + (anchorY - 250) * scale),
      ),
    );
  };

  const captureAutonomousHome = async (): Promise<void> => {
    if (!tauriWindow || autonomousHome) return;
    const [position, scale, monitor, windowSize] = await Promise.all([
      tauriWindow.outerPosition(),
      tauriWindow.scaleFactor(),
      currentMonitor(),
      tauriWindow.outerSize(),
    ]);
    autonomousHome = position;
    autonomousScale = scale;
    autonomousBounds = monitor
      ? {
          minX: monitor.position.x,
          maxX: monitor.position.x + monitor.size.width - windowSize.width,
          minY: monitor.position.y,
          maxY: monitor.position.y + monitor.size.height - windowSize.height,
        }
      : null;
  };

  const flushAutonomousMoves = async (): Promise<void> => {
    if (!tauriWindow) return;
    await captureAutonomousHome();
    while (queuedAutonomousOffset && autonomousHome) {
      const offset = queuedAutonomousOffset;
      queuedAutonomousOffset = null;
      let x = autonomousHome.x + offset.x * autonomousScale;
      let y = autonomousHome.y + offset.y * autonomousScale;
      if (autonomousBounds) {
        x = clamp(x, autonomousBounds.minX, autonomousBounds.maxX);
        y = clamp(y, autonomousBounds.minY, autonomousBounds.maxY);
      }
      await tauriWindow.setPosition(new PhysicalPosition(Math.round(x), Math.round(y)));
    }
  };

  const setAutonomousOffset = async (offset: Point): Promise<void> => {
    if (!tauriWindow) return;
    queuedAutonomousOffset = offset;
    if (!autonomousMovePromise) {
      autonomousMovePromise = flushAutonomousMoves().finally(() => {
        autonomousMovePromise = null;
      });
    }
    await autonomousMovePromise;
  };

  const finishAutonomousMotion = async (returnHome: boolean): Promise<void> => {
    queuedAutonomousOffset = null;
    if (autonomousMovePromise) await autonomousMovePromise;
    const home = autonomousHome;
    autonomousHome = null;
    autonomousBounds = null;
    if (returnHome && tauriWindow && home) await tauriWindow.setPosition(home);
  };

  const start = async (onFrame: (frame: PointerFrame) => void): Promise<void> => {
    window.addEventListener("pointermove", onBrowserPointer);
    if (tauriWindow) {
      try {
        await syncEffectsPosition();
      } catch (error) {
        console.error("Failed to position effects window during startup", error);
      }
      try {
        stopMoveListener = await tauriWindow.onMoved(() => {
          void syncEffectsPosition().catch((error: unknown) =>
            console.error("Failed to keep effects window aligned", error),
          );
        });
      } catch (error) {
        console.error("Failed to observe pet window movement", error);
      }
    }

    const tick = async (): Promise<void> => {
      if (destroyed) return;
      const now = performance.now();
      let retryAfterFailure = false;

      try {
        let pointer: Point;
        let center: Point;
        let scale = 1;

        if (tauriWindow) {
          const tauriFrame = await sampleTauriFrame();
          pointer = tauriFrame.pointer;
          center = tauriFrame.center;
          scale = tauriFrame.scale;
        } else {
          pointer = browserPointer;
          center = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
        }

        const elapsedSeconds = Math.max((now - lastSampleTime) / 1000, 1 / 120);
        const speed = lastPointer
          ? Math.hypot(pointer.x - lastPointer.x, pointer.y - lastPointer.y) / elapsedSeconds
          : 0;
        const velocityX = lastPointer ? (pointer.x - lastPointer.x) / elapsedSeconds : 0;
        const velocityY = lastPointer ? (pointer.y - lastPointer.y) / elapsedSeconds : 0;
        const distanceFromCenter = Math.hypot(pointer.x - center.x, pointer.y - center.y);

        onFrame({
          pointer,
          center,
          scale,
          speed,
          velocityX,
          velocityY,
          isInsidePet: distanceFromCenter <= petSize * 0.39 * scale,
        });

        lastPointer = pointer;
        lastSampleTime = now;
      } catch (error) {
        retryAfterFailure = true;
        if (now - lastPointerErrorLoggedAt >= POINTER_ERROR_LOG_INTERVAL_MS) {
          lastPointerErrorLoggedAt = now;
          console.error("Pointer sampling failed; Orbit Pet will retry automatically", error);
        }
      } finally {
        if (!destroyed) {
          timer = window.setTimeout(
            () => void tick(),
            retryAfterFailure ? POINTER_RETRY_INTERVAL_MS : POINTER_SAMPLE_INTERVAL_MS,
          );
        }
      }
    };

    await tick();
  };

  return {
    start,
    startDragging: async () => {
      if (tauriWindow) await tauriWindow.startDragging();
    },
    isPrimaryButtonPressed: async () => {
      if (!tauriWindow) return null;
      return invoke<boolean | null>("is_primary_mouse_button_pressed");
    },
    setAutonomousOffset,
    finishAutonomousMotion: () => finishAutonomousMotion(true),
    cancelAutonomousMotion: () => finishAutonomousMotion(false),
    setPetSize: async (size: number) => {
      petSize = size;
      if (tauriWindow) {
        const windowSize = size + PET_WINDOW_PADDING;
        await tauriWindow.setSize(new LogicalSize(windowSize, windowSize));
        await syncEffectsPosition();
      }
    },
    setClickThrough: async (nextClickThrough: boolean) => {
      if (!tauriWindow || clickThrough === nextClickThrough) return;
      clickThrough = nextClickThrough;
      await tauriWindow.setIgnoreCursorEvents(nextClickThrough);
    },
    toggleSettings: async () => {
      if (!tauriWindow) {
        window.open(`${window.location.pathname}?view=settings`, "orbit-pet-settings", "popup,width=330,height=584");
        return;
      }

      const settingsWindow = await TauriWindow.getByLabel("settings");
      if (!settingsWindow) return;
      if (await settingsWindow.isVisible()) {
        await settingsWindow.hide();
        return;
      }

      const [petPosition, scale, monitor] = await Promise.all([
        tauriWindow.outerPosition(),
        tauriWindow.scaleFactor(),
        currentMonitor(),
      ]);
      const panelWidth = 330 * scale;
      const panelHeight = 584 * scale;
      const gap = 8 * scale;
      let x = petPosition.x + (petSize + PET_WINDOW_PADDING) * scale + gap;
      let y = petPosition.y;

      if (monitor) {
        const monitorRight = monitor.position.x + monitor.size.width;
        const monitorBottom = monitor.position.y + monitor.size.height;
        if (x + panelWidth > monitorRight) x = petPosition.x - panelWidth - gap;
        x = Math.max(monitor.position.x + gap, x);
        y = Math.min(Math.max(monitor.position.y + gap, y), monitorBottom - panelHeight - gap);
      }

      await settingsWindow.setPosition(new PhysicalPosition(Math.round(x), Math.round(y)));
      await settingsWindow.show();
      await settingsWindow.setFocus();
    },
    destroy: () => {
      destroyed = true;
      queuedAutonomousOffset = null;
      autonomousHome = null;
      autonomousBounds = null;
      if (timer !== undefined) window.clearTimeout(timer);
      stopMoveListener();
      window.removeEventListener("pointermove", onBrowserPointer);
    },
  };
};

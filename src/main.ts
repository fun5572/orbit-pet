import "./style.css";
import { drainCodexHookEvents } from "./codex/bridge";
import { createCodexIndicatorView } from "./codex/indicator-view";
import { applyCodexPalette } from "./codex/palette";
import { publishCodexTaskBubblesVisibility } from "./codex/task-bubble-events";
import { mountCodexTasksView } from "./codex/tasks-view";
import {
  activeCodexTasks,
  clearCodexTasks,
  loadCodexTasks,
  publishCodexCompletion,
  publishCodexTasks,
  reduceCodexHookEvents,
  type CodexTask,
} from "./codex/task-store";
import { createDesktopAdapter, type PointerFrame } from "./desktop-adapter";
import { createBubbleView } from "./effects/bubble-view";
import { mountEffectsView } from "./effects/effects-view";
import { publishSleepState } from "./effects/sleep-events";
import { createSleepView } from "./effects/sleep-view";
import { PetActivityEngine, WAKE_EFFECT_MS } from "./face/activity";
import { PetAutoPlayEngine } from "./face/auto-play";
import { BlinkEngine } from "./face/blink";
import { calculateGazePose, type GazePose } from "./face/gaze";
import { subscribeGlobalInputs } from "./input-events";
import { createRobotView } from "./robot-view";
import { mountSettingsView } from "./settings-view";
import {
  getPetBubbleColor,
  getPetPalette,
  loadPetSettings,
  subscribePetSettings,
  type PetSettings,
} from "./settings";

const app = document.querySelector<HTMLElement>("#app");
if (!app) throw new Error("App mount point is missing");
const isTauriRuntime = (): boolean => "__TAURI_INTERNALS__" in window;
const GRAB_BUTTON_CHECK_DELAY_MS = 100;
const CODEX_POLL_INTERVAL_MS = 650;
const CODEX_CELEBRATION_MS = 950;

const mountPetView = (): void => {
  const robot = createRobotView();
  const bubbles = createBubbleView("attached");
  const sleep = createSleepView("attached");
  const codexIndicator = createCodexIndicatorView();
  const desktop = createDesktopAdapter();
  const blink = new BlinkEngine(performance.now());
  const activity = new PetActivityEngine(performance.now());
  const autoPlay = new PetAutoPlayEngine();
  const nativeRuntime = isTauriRuntime();
  const grabbedPreview = !nativeRuntime && new URLSearchParams(window.location.search).get("preview") === "grabbed";
  app.append(robot.element);
  app.append(bubbles.element);
  app.append(codexIndicator.element);
  if (!nativeRuntime) app.append(sleep.element);

  let latestFrame: PointerFrame = {
    pointer: { x: window.innerWidth / 2, y: window.innerHeight / 2 },
    center: { x: window.innerWidth / 2, y: window.innerHeight / 2 },
    scale: 1,
    speed: 0,
    velocityX: 0,
    velocityY: 0,
    isInsidePet: true,
  };
  let targetPose: GazePose = calculateGazePose(latestFrame);
  let previousRenderTime = performance.now();
  let startledUntil = 0;
  let autoWakeUntil = 0;
  let autoPlayActive = false;
  let autoPlayGroundedUntil = 0;
  let codexCelebrationUntil = 0;
  let codexTasks = loadCodexTasks();
  let codexIntegrationEnabled = false;
  let codexTasksExpanded = false;
  let petSize = loadPetSettings().size;
  let codexPollTimer: number | undefined;
  let codexPolling = false;
  let sleeping = false;
  let grabbed = grabbedPreview;
  let grabSession = 0;
  let grabStartedAt = Number.NEGATIVE_INFINITY;
  let grabButtonCheckPending = false;
  let stopInputSubscription = (): void => undefined;
  let stopSettingsSubscription = (): void => undefined;

  const setCodexTasksExpanded = (expanded: boolean): void => {
    const nextExpanded =
      expanded && codexIntegrationEnabled && activeCodexTasks(codexTasks).length > 0;
    codexTasksExpanded = nextExpanded;
    codexIndicator.setExpanded(nextExpanded);
    void publishCodexTaskBubblesVisibility(nextExpanded).catch((error: unknown) =>
      console.error("Failed to toggle Codex task bubbles", error),
    );
  };

  const renderCodexTasks = (tasks: CodexTask[]): void => {
    codexTasks = tasks;
    codexIndicator.render(codexIntegrationEnabled ? tasks : []);
    if (activeCodexTasks(tasks).length === 0) setCodexTasksExpanded(false);
  };

  const pollCodexEvents = async (): Promise<void> => {
    if (!nativeRuntime || codexPolling) return;
    codexPolling = true;
    try {
      const events = await drainCodexHookEvents();
      if (events.length === 0) return;
      if (!codexIntegrationEnabled) {
        if (codexTasks.length > 0) {
          renderCodexTasks([]);
          await clearCodexTasks();
        }
        return;
      }

      const reduction = reduceCodexHookEvents(codexTasks, events);
      if (!reduction.changed) return;
      renderCodexTasks(reduction.tasks);
      await publishCodexTasks(reduction.tasks);
      if (reduction.completed.length > 0) {
        const now = performance.now();
        activity.registerActivity(now);
        codexCelebrationUntil = now + CODEX_CELEBRATION_MS;
        setSleepingState(false);
        for (const task of reduction.completed) await publishCodexCompletion(task);
      } else if (activeCodexTasks(reduction.tasks).length > 0) {
        activity.registerActivity(performance.now());
        setSleepingState(false);
      }
    } catch (error) {
      console.error("Failed to read Codex task events", error);
    } finally {
      codexPolling = false;
    }
  };

  const setSleepingState = (nextSleeping: boolean): void => {
    if (nextSleeping === sleeping) return;
    sleeping = nextSleeping;
    sleep.setSleeping(sleeping);
    void publishSleepState(sleeping).catch((error: unknown) =>
      console.error("Failed to publish sleep state", error),
    );
  };

  const releaseGrab = (session = grabSession): void => {
    if (grabbedPreview || session !== grabSession) return;
    grabbed = false;
  };

  const reconcileGrabWithNativeButton = (now: number): void => {
    if (
      !nativeRuntime ||
      !grabbed ||
      grabButtonCheckPending ||
      now - grabStartedAt < GRAB_BUTTON_CHECK_DELAY_MS
    ) {
      return;
    }

    const session = grabSession;
    grabButtonCheckPending = true;
    void desktop
      .isPrimaryButtonPressed()
      .then((pressed) => {
        if (pressed === false) releaseGrab(session);
      })
      .catch((error: unknown) => console.error("Failed to check primary mouse button", error))
      .finally(() => {
        grabButtonCheckPending = false;
      });
  };

  const applySettings = (settings: PetSettings): void => {
    const palette = getPetPalette(settings.color);
    petSize = settings.size;
    robot.setSize(settings.size);
    robot.setColor(palette);
    robot.setVariant(settings.variant);
    bubbles.setColor(getPetBubbleColor(settings, palette));
    bubbles.setSize(settings.size);
    sleep.setColor(palette);
    sleep.setSize(settings.size);
    applyCodexPalette(codexIndicator.element, palette);
    codexIntegrationEnabled = settings.codexIntegration;
    if (!codexIntegrationEnabled) {
      setCodexTasksExpanded(false);
      if (codexTasks.length > 0) {
        renderCodexTasks([]);
        void clearCodexTasks().catch((error: unknown) => console.error("Failed to clear Codex tasks", error));
      }
    } else {
      codexIndicator.render(codexIntegrationEnabled ? codexTasks : []);
    }
    void desktop.setPetSize(settings.size).catch((error: unknown) =>
      console.error("Failed to resize pet window", error),
    );
  };
  applySettings(loadPetSettings());
  if (nativeRuntime) {
    codexPollTimer = window.setInterval(() => void pollCodexEvents(), CODEX_POLL_INTERVAL_MS);
    void pollCodexEvents();
  }
  void subscribePetSettings(applySettings).then((unlisten) => {
    stopSettingsSubscription = unlisten;
  });
  void subscribeGlobalInputs({
    onMouseDown: () => {
      const now = performance.now();
      const result = activity.registerActivity(now);
      if (!result.wokeFromSleep) startledUntil = now + 450;
      setSleepingState(false);
    },
    onMouseUp: () => {
      releaseGrab();
    },
    onKeyDown: () => {
      activity.registerActivity(performance.now());
      if (!nativeRuntime) bubbles.spawn();
      setSleepingState(false);
    },
  }).then((unlisten) => {
    stopInputSubscription = unlisten;
  });

  void desktop.start((frame) => {
    const now = performance.now();
    latestFrame = frame;
    reconcileGrabWithNativeButton(now);
    if (frame.speed > 0) activity.registerActivity(now);
    const codexActive = codexIntegrationEnabled && activeCodexTasks(codexTasks).length > 0;
    const naturallySleeping = !grabbed && !codexActive && activity.phase(now) === "sleeping";
    const playFrame = autoPlay.sample(now, naturallySleeping, grabbed);
    autoPlayActive = playFrame.active;
    if (playFrame.justStarted) autoWakeUntil = now + WAKE_EFFECT_MS;
    if (playFrame.active) {
      void desktop.setAutonomousOffset(playFrame.offset).catch((error: unknown) =>
        console.error("Failed to move pet during autonomous play", error),
      );
    } else if (playFrame.justFinished) {
      autoPlayGroundedUntil = now + 650;
      void desktop.finishAutonomousMotion().catch((error: unknown) =>
        console.error("Failed to return pet after autonomous play", error),
      );
    }

    const nextSleeping = !grabbed && !codexActive && !playFrame.active && activity.phase(now) === "sleeping";
    setSleepingState(nextSleeping);
    const gazePose = calculateGazePose({
      ...frame,
      idleForMs: playFrame.active || codexActive ? 0 : activity.idleForMs(now),
      startled: now < startledUntil,
      awakened: activity.isAwakened(now) || now < autoWakeUntil || now < codexCelebrationUntil,
      grabbed,
      dragVelocityX: frame.velocityX,
    });
    targetPose = {
      ...gazePose,
      bodyScaleX: gazePose.bodyScaleX * playFrame.bodyScaleX,
      bodyScaleY: gazePose.bodyScaleY * playFrame.bodyScaleY,
    };
    robot.setInteractive(frame.isInsidePet);
    const offsetX = frame.pointer.x - frame.center.x;
    const offsetY = frame.pointer.y - frame.center.y;
    const indicatorHitZone =
      codexIndicator.visible &&
      offsetX >= petSize * 0.08 * frame.scale &&
      offsetX <= petSize * 0.56 * frame.scale &&
      offsetY <= petSize * -0.08 * frame.scale &&
      offsetY >= petSize * -0.56 * frame.scale;
    void desktop.setClickThrough(!(frame.isInsidePet || indicatorHitZone));
  });

  const render = (now: number): void => {
    const deltaSeconds = Math.max((now - previousRenderTime) / 1000, 1 / 240);
    previousRenderTime = now;
    const canBlink = targetPose.expression !== "sleeping" && targetPose.expression !== "grabbed";
    robot.render(
      targetPose,
      blink.sample(now, canBlink),
      deltaSeconds,
      autoPlayActive || now < autoPlayGroundedUntil,
    );
    requestAnimationFrame(render);
  };
  requestAnimationFrame(render);

  robot.element.addEventListener("pointerdown", (event) => {
    if (event.button === 0 && latestFrame.isInsidePet) {
      grabSession += 1;
      grabStartedAt = performance.now();
      grabbed = true;
      activity.registerActivity(performance.now());
      setSleepingState(false);
      const interruptedAutoPlay = autoPlay.interrupt();
      void (async () => {
        if (interruptedAutoPlay) await desktop.cancelAutonomousMotion();
        await desktop.startDragging();
      })().catch((error: unknown) => console.error("Failed to start dragging pet", error));
    }
  });

  robot.element.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    void desktop.toggleSettings();
  });
  codexIndicator.element.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
  });
  codexIndicator.element.addEventListener("click", (event) => {
    event.stopPropagation();
    setCodexTasksExpanded(!codexTasksExpanded);
  });
  codexIndicator.element.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    void desktop.toggleSettings();
  });
  window.addEventListener("beforeunload", () => {
    setCodexTasksExpanded(false);
    stopInputSubscription();
    stopSettingsSubscription();
    if (codexPollTimer !== undefined) window.clearInterval(codexPollTimer);
    desktop.destroy();
  });
};

const view = new URLSearchParams(window.location.search).get("view");
if (view === "settings") {
  mountSettingsView(app);
} else if (view === "effects") {
  mountEffectsView(app);
} else if (view === "codex-tasks") {
  mountCodexTasksView(app);
} else {
  mountPetView();
}

import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface GlobalInputHandlers {
  onKeyDown?: () => void;
  onMouseDown?: () => void;
  onMouseUp?: () => void;
}

const isTauriRuntime = (): boolean => "__TAURI_INTERNALS__" in window;

export const subscribeGlobalInputs = async (handlers: GlobalInputHandlers): Promise<UnlistenFn> => {
  if (isTauriRuntime()) {
    const unlisteners: UnlistenFn[] = [];
    const onPointerUp = (): void => handlers.onMouseUp?.();
    const onPointerCancel = (): void => handlers.onMouseUp?.();
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerCancel, true);
    if (handlers.onMouseDown) {
      unlisteners.push(await listen("global-mouse-down", handlers.onMouseDown));
    }
    if (handlers.onMouseUp) {
      unlisteners.push(await listen("global-mouse-up", handlers.onMouseUp));
    }
    if (handlers.onKeyDown) {
      unlisteners.push(await listen("global-key-down", handlers.onKeyDown));
    }
    return () => {
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerCancel, true);
      unlisteners.forEach((unlisten) => unlisten());
    };
  }

  const onPointerDown = (): void => handlers.onMouseDown?.();
  const onPointerUp = (): void => handlers.onMouseUp?.();
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!event.repeat) handlers.onKeyDown?.();
  };
  window.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("pointerup", onPointerUp, true);
  window.addEventListener("keydown", onKeyDown, true);

  return () => {
    window.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("pointerup", onPointerUp, true);
    window.removeEventListener("keydown", onKeyDown, true);
  };
};

import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";

const TASK_BUBBLES_VISIBILITY_EVENT = "codex-task-bubbles-visibility";
const isTauriRuntime = (): boolean => "__TAURI_INTERNALS__" in window;

export const publishCodexTaskBubblesVisibility = async (visible: boolean): Promise<void> => {
  if (isTauriRuntime()) {
    await emit(TASK_BUBBLES_VISIBILITY_EVENT, visible);
    return;
  }
  if ("BroadcastChannel" in window) {
    const channel = new BroadcastChannel(TASK_BUBBLES_VISIBILITY_EVENT);
    channel.postMessage(visible);
    channel.close();
  }
};

export const subscribeCodexTaskBubblesVisibility = async (
  onVisibility: (visible: boolean) => void,
): Promise<UnlistenFn> => {
  if (isTauriRuntime()) {
    return listen<boolean>(TASK_BUBBLES_VISIBILITY_EVENT, (event) =>
      onVisibility(event.payload === true),
    );
  }
  const channel = "BroadcastChannel" in window
    ? new BroadcastChannel(TASK_BUBBLES_VISIBILITY_EVENT)
    : null;
  const onMessage = (event: MessageEvent<boolean>): void => onVisibility(event.data === true);
  channel?.addEventListener("message", onMessage);
  return () => {
    channel?.removeEventListener("message", onMessage);
    channel?.close();
  };
};

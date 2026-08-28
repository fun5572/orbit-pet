import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type KeyboardListenerState =
  | "starting"
  | "ready"
  | "permission-denied"
  | "failed"
  | "unavailable";

export interface KeyboardListenerStatus {
  state: KeyboardListenerState;
  message: string;
  canReauthorize: boolean;
}

const STATUS_EVENT = "keyboard-listener-status";
const isTauriRuntime = (): boolean => "__TAURI_INTERNALS__" in window;

export const getKeyboardListenerStatus = async (): Promise<KeyboardListenerStatus> => {
  if (!isTauriRuntime()) {
    return {
      state: "unavailable",
      message: "桌面版可检测全局键盘监听",
      canReauthorize: false,
    };
  }
  return invoke<KeyboardListenerStatus>("keyboard_listener_status");
};

export const resetKeyboardInputPermission = async (): Promise<KeyboardListenerStatus> => {
  if (!isTauriRuntime()) {
    throw new Error("请在 Orbit Pet 桌面版中重新授权");
  }
  return invoke<KeyboardListenerStatus>("reset_keyboard_input_permission");
};

export const subscribeKeyboardListenerStatus = (
  onStatus: (status: KeyboardListenerStatus) => void,
): Promise<UnlistenFn> => {
  if (!isTauriRuntime()) return Promise.resolve(() => undefined);
  return listen<KeyboardListenerStatus>(STATUS_EVENT, (event) => onStatus(event.payload));
};

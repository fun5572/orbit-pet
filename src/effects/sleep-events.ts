import { emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";

const SLEEP_EVENT = "pet-sleep-state";
const isTauriRuntime = (): boolean => "__TAURI_INTERNALS__" in window;

export const publishSleepState = async (sleeping: boolean): Promise<void> => {
  if (isTauriRuntime()) await emitTo("effects", SLEEP_EVENT, sleeping);
};

export const subscribeSleepState = async (onChange: (sleeping: boolean) => void): Promise<UnlistenFn> => {
  if (!isTauriRuntime()) return () => undefined;
  return listen<boolean>(SLEEP_EVENT, (event) => onChange(event.payload === true));
};

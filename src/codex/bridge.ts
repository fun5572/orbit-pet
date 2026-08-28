import { invoke } from "@tauri-apps/api/core";
import type { CodexHookEnvelope } from "./task-store";

export interface CodexBridgeInstallResult {
  installed: boolean;
  message: string;
}

const isTauriRuntime = (): boolean => "__TAURI_INTERNALS__" in window;

export const drainCodexHookEvents = async (): Promise<CodexHookEnvelope[]> => {
  if (!isTauriRuntime()) return [];
  return invoke<CodexHookEnvelope[]>("drain_codex_hook_events");
};

export const installCodexBridge = async (): Promise<CodexBridgeInstallResult> => {
  if (!isTauriRuntime()) {
    return { installed: false, message: "请在 Orbit Pet 桌面版中安装连接" };
  }
  return invoke<CodexBridgeInstallResult>("install_codex_bridge");
};

export const getCodexBridgeStatus = async (): Promise<CodexBridgeInstallResult> => {
  if (!isTauriRuntime()) {
    return { installed: false, message: "浏览器预览不接收 Codex 任务" };
  }
  return invoke<CodexBridgeInstallResult>("codex_bridge_status");
};

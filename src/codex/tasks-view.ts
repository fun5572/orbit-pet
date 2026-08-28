import { getCurrentWindow } from "@tauri-apps/api/window";
import { loadPetSettings } from "../settings";
import { loadCodexTasks, subscribeCodexTasks, type CodexTask } from "./task-store";

const isTauriRuntime = (): boolean => "__TAURI_INTERNALS__" in window;

const statusCopy = (task: CodexTask): string => {
  if (task.status === "needs-input") return "等待确认";
  if (task.status === "running") return "正在执行";
  return "已完成";
};

const relativeTime = (timestamp: number): string => {
  const elapsed = Math.max(0, Date.now() - timestamp);
  if (elapsed < 60_000) return "刚刚";
  const minutes = Math.floor(elapsed / 60_000);
  return minutes < 60 ? `${minutes} 分钟前` : `${Math.floor(minutes / 60)} 小时前`;
};

export const mountCodexTasksView = (app: HTMLElement): void => {
  document.body.classList.add("codex-tasks-mode");
  app.setAttribute("aria-label", "Codex 任务");
  app.innerHTML = `
    <section class="codex-tasks-card" aria-labelledby="codex-tasks-title">
      <header class="settings-header">
        <div>
          <p class="settings-eyebrow">ORBIT PET · CODEX</p>
          <h1 id="codex-tasks-title">当前任务</h1>
        </div>
        <button class="close-button" type="button" aria-label="关闭任务列表">×</button>
      </header>
      <div class="codex-task-summary"></div>
      <div class="codex-task-list" role="list"></div>
    </section>
  `;

  const list = app.querySelector<HTMLElement>(".codex-task-list");
  const summary = app.querySelector<HTMLElement>(".codex-task-summary");
  const closeButton = app.querySelector<HTMLButtonElement>(".close-button");
  if (!list || !summary || !closeButton) throw new Error("Codex tasks view failed to initialize");

  const render = (tasks: CodexTask[]): void => {
    const enabled = loadPetSettings().codexIntegration;
    const activeCount = tasks.filter((task) => task.status !== "completed").length;
    summary.textContent = enabled ? `${activeCount} 个进行中 · ${tasks.length - activeCount} 个最近完成` : "Codex 集成已关闭";
    if (tasks.length === 0) {
      list.innerHTML = `
        <div class="codex-empty-state">
          <span>◌</span>
          <strong>还没有 Codex 任务</strong>
          <p>开启集成并信任连接 Hook 后，任务会出现在这里。</p>
        </div>
      `;
      return;
    }

    list.replaceChildren(
      ...tasks.map((task) => {
        const item = document.createElement("article");
        item.className = "codex-task-item";
        item.dataset.status = task.status;
        item.setAttribute("role", "listitem");
        item.innerHTML = `
          <span class="codex-task-dot"></span>
          <span class="codex-task-copy">
            <strong></strong>
            <span class="codex-task-meta"></span>
          </span>
          <span class="codex-task-status"></span>
        `;
        const title = item.querySelector<HTMLElement>(".codex-task-copy strong");
        const meta = item.querySelector<HTMLElement>(".codex-task-meta");
        const status = item.querySelector<HTMLElement>(".codex-task-status");
        if (title) title.textContent = task.title;
        if (meta) meta.textContent = `${task.project} · ${relativeTime(task.updatedAt)}`;
        if (status) status.textContent = statusCopy(task);
        return item;
      }),
    );
  };

  let stopTasks = (): void => undefined;
  render(loadCodexTasks());
  void subscribeCodexTasks(render).then((unlisten) => {
    stopTasks = unlisten;
  });

  const close = async (): Promise<void> => {
    if (isTauriRuntime()) await getCurrentWindow().hide();
    else window.close();
  };
  closeButton.addEventListener("click", () => void close());
  window.addEventListener("beforeunload", () => stopTasks());
};

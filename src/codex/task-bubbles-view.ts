import { activeCodexTasks, type CodexTask } from "./task-store";

export interface CodexTaskBubblesView {
  readonly element: HTMLElement;
  render(tasks: CodexTask[]): void;
  setExpanded(expanded: boolean): void;
}

const statusCopy = (task: CodexTask): string =>
  task.status === "needs-input" ? "等待确认" : "执行中";

const stageCopy = (task: CodexTask): string => {
  if (task.stage === "running-command") return "正在执行命令";
  if (task.stage === "processing-result") return "正在处理结果";
  if (task.stage === "waiting-input") return "等待确认";
  return "正在思考";
};

export const createCodexTaskBubblesView = (): CodexTaskBubblesView => {
  const element = document.createElement("section");
  element.className = "codex-pet-task-panel";
  element.setAttribute("aria-label", "正在执行的 Codex 任务");
  element.hidden = true;

  let expanded = false;
  let activeTasks: CodexTask[] = [];

  const syncVisibility = (): void => {
    element.hidden = !expanded || activeTasks.length === 0;
  };

  const render = (tasks: CodexTask[]): void => {
    activeTasks = activeCodexTasks(tasks);
    element.dataset.density = activeTasks.length > 10
      ? "dense"
      : activeTasks.length > 4
        ? "compact"
        : "normal";
    element.replaceChildren(
      ...activeTasks.map((task, index) => {
        const bubble = document.createElement("article");
        bubble.className = "codex-pet-task-bubble";
        bubble.dataset.status = task.status;
        bubble.style.setProperty("--task-index", String(index));
        bubble.innerHTML = `
          <span class="codex-pet-task-dot" aria-hidden="true"></span>
          <span class="codex-pet-task-copy">
            <strong></strong>
            <span></span>
          </span>
          <span class="codex-pet-task-status"></span>
        `;
        const title = bubble.querySelector<HTMLElement>("strong");
        const progress = bubble.querySelector<HTMLElement>(".codex-pet-task-copy > span");
        const status = bubble.querySelector<HTMLElement>(".codex-pet-task-status");
        if (title) title.textContent = task.title;
        if (progress) progress.textContent = stageCopy(task);
        if (status) status.textContent = statusCopy(task);
        return bubble;
      }),
    );
    syncVisibility();
  };

  return {
    element,
    render,
    setExpanded: (nextExpanded) => {
      expanded = nextExpanded;
      syncVisibility();
    },
  };
};

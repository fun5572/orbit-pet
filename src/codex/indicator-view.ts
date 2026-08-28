import { activeCodexTasks, type CodexTask } from "./task-store";

export interface CodexIndicatorView {
  readonly element: HTMLButtonElement;
  readonly visible: boolean;
  render(tasks: CodexTask[]): void;
  setExpanded(expanded: boolean): void;
}

export const createCodexIndicatorView = (): CodexIndicatorView => {
  const element = document.createElement("button");
  element.className = "codex-indicator";
  element.type = "button";
  element.hidden = true;
  element.setAttribute("aria-expanded", "false");
  element.setAttribute("aria-label", "展开 Codex 任务");

  let visible = false;

  return {
    element,
    get visible() {
      return visible;
    },
    render: (tasks) => {
      const active = activeCodexTasks(tasks);
      const waiting = active.filter((task) => task.status === "needs-input");
      visible = active.length > 0;
      element.hidden = !visible;
      element.dataset.status = waiting.length > 0 ? "needs-input" : "running";
      element.textContent = waiting.length > 0 ? "!" : String(Math.min(active.length, 9));
      element.title = waiting.length > 0 ? `${waiting.length} 个 Codex 任务等待确认` : `${active.length} 个 Codex 任务进行中`;
    },
    setExpanded: (expanded) => {
      element.setAttribute("aria-expanded", String(expanded));
      element.setAttribute("aria-label", expanded ? "收起 Codex 任务" : "展开 Codex 任务");
    },
  };
};

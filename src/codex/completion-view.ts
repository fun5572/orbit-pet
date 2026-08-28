import type { CodexTask } from "./task-store";

const COMPLETION_FALLBACK_REMOVE_MS = 7_300;

export interface CodexCompletionView {
  readonly element: HTMLElement;
  show(task: CodexTask): void;
}

export const createCodexCompletionView = (): CodexCompletionView => {
  const layer = document.createElement("div");
  layer.className = "codex-completion-layer";
  layer.setAttribute("aria-hidden", "true");

  return {
    element: layer,
    show: (task) => {
      const toast = document.createElement("div");
      toast.className = "codex-completion-toast";
      toast.innerHTML = `
        <span class="codex-completion-check">✓</span>
        <span class="codex-completion-copy">
          <strong>任务完成</strong>
          <span></span>
        </span>
      `;
      const title = toast.querySelector<HTMLElement>(".codex-completion-copy span");
      if (title) title.textContent = task.title;
      layer.append(toast);
      toast.addEventListener("animationend", () => toast.remove(), { once: true });
      window.setTimeout(() => toast.remove(), COMPLETION_FALLBACK_REMOVE_MS);
      while (layer.childElementCount > 3) layer.firstElementChild?.remove();
    },
  };
};

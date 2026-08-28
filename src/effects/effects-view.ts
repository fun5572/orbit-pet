import { getCurrentWindow } from "@tauri-apps/api/window";
import { createCodexCompletionView } from "../codex/completion-view";
import { applyCodexPalette } from "../codex/palette";
import { subscribeCodexTaskBubblesVisibility } from "../codex/task-bubble-events";
import { createCodexTaskBubblesView } from "../codex/task-bubbles-view";
import {
  loadCodexTasks,
  subscribeCodexCompletions,
  subscribeCodexTasks,
} from "../codex/task-store";
import { subscribeGlobalInputs } from "../input-events";
import { getPetBubbleColor, getPetPalette, loadPetSettings, subscribePetSettings } from "../settings";
import { createBubbleView } from "./bubble-view";
import { subscribeSleepState } from "./sleep-events";
import { createSleepView } from "./sleep-view";

const isTauriRuntime = (): boolean => "__TAURI_INTERNALS__" in window;

export const mountEffectsView = (app: HTMLElement): void => {
  document.body.classList.add("effects-mode");
  app.setAttribute("aria-hidden", "true");
  const bubbles = createBubbleView("effects");
  const sleep = createSleepView("effects");
  const codexCompletion = createCodexCompletionView();
  const codexTaskBubbles = createCodexTaskBubblesView();
  app.append(bubbles.element);
  app.append(sleep.element);
  app.append(codexCompletion.element);
  app.append(codexTaskBubbles.element);
  codexTaskBubbles.render(loadCodexTasks());

  const initialSettings = loadPetSettings();
  const applySettings = (settings: typeof initialSettings): void => {
    const palette = getPetPalette(settings.color);
    bubbles.setColor(getPetBubbleColor(settings, palette));
    sleep.setColor(palette);
    sleep.setSize(settings.size);
    applyCodexPalette(app, palette);
  };
  applySettings(initialSettings);
  let stopInputs = (): void => undefined;
  let stopSettings = (): void => undefined;
  let stopSleep = (): void => undefined;
  let stopCodexCompletions = (): void => undefined;
  let stopCodexTasks = (): void => undefined;
  let stopCodexTaskBubblesVisibility = (): void => undefined;

  void subscribeGlobalInputs({ onKeyDown: bubbles.spawn }).then((unlisten) => {
    stopInputs = unlisten;
  });
  void subscribePetSettings(applySettings).then((unlisten) => {
    stopSettings = unlisten;
  });
  void subscribeSleepState(sleep.setSleeping).then((unlisten) => {
    stopSleep = unlisten;
  });
  void subscribeCodexCompletions(codexCompletion.show).then((unlisten) => {
    stopCodexCompletions = unlisten;
  });
  void subscribeCodexTasks(codexTaskBubbles.render).then((unlisten) => {
    stopCodexTasks = unlisten;
  });
  void subscribeCodexTaskBubblesVisibility(codexTaskBubbles.setExpanded).then((unlisten) => {
    stopCodexTaskBubblesVisibility = unlisten;
  });

  if (isTauriRuntime()) {
    void getCurrentWindow().setIgnoreCursorEvents(true);
  }

  window.addEventListener("beforeunload", () => {
    stopInputs();
    stopSettings();
    stopSleep();
    stopCodexCompletions();
    stopCodexTasks();
    stopCodexTaskBubblesVisibility();
  });
};

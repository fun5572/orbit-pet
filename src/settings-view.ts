import { getCurrentWindow, Window as TauriWindow } from "@tauri-apps/api/window";
import { getCodexBridgeStatus, installCodexBridge } from "./codex/bridge";
import {
  activeCodexTasks,
  loadCodexTasks,
  subscribeCodexTasks,
} from "./codex/task-store";
import {
  getKeyboardListenerStatus,
  resetKeyboardInputPermission,
  subscribeKeyboardListenerStatus,
  type KeyboardListenerStatus,
} from "./input-status";
import {
  loadPetSettings,
  PET_MAX_SIZE,
  PET_MIN_SIZE,
  PET_PALETTES,
  PET_VARIANTS,
  publishPetSettings,
  type PetColorId,
  type PetSettings,
  type PetVariant,
} from "./settings";

const isTauriRuntime = (): boolean => "__TAURI_INTERNALS__" in window;

export const mountSettingsView = (app: HTMLElement): void => {
  document.body.classList.add("settings-mode");
  app.setAttribute("aria-label", "Orbit Pet 设置");
  app.innerHTML = `
    <section class="settings-card" aria-labelledby="settings-title">
      <header class="settings-header">
        <div>
          <p class="settings-eyebrow">ORBIT PET</p>
          <h1 id="settings-title">宠物设置</h1>
        </div>
        <button class="close-button" type="button" aria-label="关闭设置">×</button>
      </header>

      <fieldset class="setting-group variant-group">
        <legend>款式</legend>
        <div class="variant-options">
          ${PET_VARIANTS.map(
            (variant) => `
              <button class="variant-option" type="button" data-variant="${variant.id}" aria-label="${variant.name}">
                <span class="variant-preview" aria-hidden="true">
                  <span class="variant-preview-eyes"></span>
                  <span class="variant-preview-bow"></span>
                </span>
                <span>${variant.name}</span>
              </button>`,
          ).join("")}
        </div>
      </fieldset>

      <div class="setting-group">
        <div class="setting-label-row">
          <label for="pet-size">大小</label>
          <output id="size-output" for="pet-size"></output>
        </div>
        <input id="pet-size" class="size-slider" type="range" min="${PET_MIN_SIZE}" max="${PET_MAX_SIZE}" step="1" />
        <div class="slider-scale" aria-hidden="true"><span>小</span><span>大</span></div>
      </div>

      <fieldset class="setting-group color-group">
        <legend>颜色</legend>
        <div class="color-options">
          ${PET_PALETTES.map(
            (palette) => `
              <button
                class="color-option"
                type="button"
                data-color="${palette.id}"
                aria-label="${palette.name}"
                title="${palette.name}"
                style="--swatch-fill: ${palette.preview}; --swatch-rim: ${palette.rim[0]}"
              >
                <span class="color-swatch" aria-hidden="true"></span>
                <span>${palette.name.slice(-1)}</span>
              </button>`,
          ).join("")}
        </div>
      </fieldset>

      <section class="setting-group codex-setting" aria-labelledby="codex-setting-title">
        <div class="codex-setting-heading">
          <div>
            <strong id="codex-setting-title">Codex 集成</strong>
            <span>任务状态与完成提醒</span>
          </div>
          <label class="toggle-switch" aria-label="开启 Codex 集成">
            <input id="codex-integration" type="checkbox" />
            <span aria-hidden="true"></span>
          </label>
        </div>
        <div class="codex-setting-actions">
          <button class="secondary-button install-codex-button" type="button">安装连接</button>
          <button
            class="secondary-button codex-tasks-button"
            type="button"
          >
            当前任务 <span class="codex-task-count">0</span>
          </button>
        </div>
        <p class="codex-bridge-status" role="status">正在检查连接…</p>
      </section>

      <footer class="settings-footer">
        <div class="keyboard-listener-row" data-state="starting">
          <span class="keyboard-listener-dot" aria-hidden="true"></span>
          <span class="keyboard-listener-message" role="status">正在检查键盘监听…</span>
          <button class="keyboard-reauthorize-button" type="button" hidden>重新授权</button>
        </div>
        <div class="settings-footer-help">左键拖动宠物 <span>·</span> 右键打开设置</div>
      </footer>
    </section>
  `;

  const slider = app.querySelector<HTMLInputElement>("#pet-size");
  const output = app.querySelector<HTMLOutputElement>("#size-output");
  const closeButton = app.querySelector<HTMLButtonElement>(".close-button");
  const codexToggle = app.querySelector<HTMLInputElement>("#codex-integration");
  const installCodexButton = app.querySelector<HTMLButtonElement>(".install-codex-button");
  const codexTasksButton = app.querySelector<HTMLButtonElement>(".codex-tasks-button");
  const codexTaskCount = app.querySelector<HTMLElement>(".codex-task-count");
  const codexBridgeStatus = app.querySelector<HTMLElement>(".codex-bridge-status");
  const keyboardListenerRow = app.querySelector<HTMLElement>(".keyboard-listener-row");
  const keyboardListenerMessage = app.querySelector<HTMLElement>(".keyboard-listener-message");
  const keyboardReauthorizeButton = app.querySelector<HTMLButtonElement>(".keyboard-reauthorize-button");
  const colorButtons = [...app.querySelectorAll<HTMLButtonElement>("[data-color]")];
  const variantButtons = [...app.querySelectorAll<HTMLButtonElement>("[data-variant]")];
  if (
    !slider ||
    !output ||
    !closeButton ||
    !codexToggle ||
    !installCodexButton ||
    !codexTasksButton ||
    !codexTaskCount ||
    !codexBridgeStatus ||
    !keyboardListenerRow ||
    !keyboardListenerMessage ||
    !keyboardReauthorizeButton ||
    colorButtons.length !== PET_PALETTES.length ||
    variantButtons.length !== PET_VARIANTS.length
  ) {
    throw new Error("Settings view failed to initialize");
  }

  let settings = loadPetSettings();

  const render = (nextSettings: PetSettings): void => {
    settings = nextSettings;
    slider.value = String(settings.size);
    codexToggle.checked = settings.codexIntegration;
    const originalPercent = Math.round((settings.size / PET_MAX_SIZE) * 100);
    const trackPercent = ((settings.size - PET_MIN_SIZE) / (PET_MAX_SIZE - PET_MIN_SIZE)) * 100;
    slider.style.setProperty("--range-progress", `${trackPercent}%`);
    output.value = `${originalPercent}%`;
    output.textContent = `${originalPercent}%`;
    for (const button of colorButtons) {
      const selected = button.dataset.color === settings.color;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    }
    for (const button of variantButtons) {
      const selected = button.dataset.variant === settings.variant;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    }
  };

  const update = (nextSettings: PetSettings): void => {
    render(nextSettings);
    void publishPetSettings(nextSettings).catch((error: unknown) => console.error("Failed to save settings", error));
  };

  slider.addEventListener("input", () => update({ ...settings, size: Number(slider.value) }));
  for (const button of colorButtons) {
    button.addEventListener("click", () => {
      const color = button.dataset.color as PetColorId | undefined;
      if (color) update({ ...settings, color });
    });
  }
  for (const button of variantButtons) {
    button.addEventListener("click", () => {
      const variant = button.dataset.variant as PetVariant | undefined;
      if (variant) update({ ...settings, variant });
    });
  }
  codexToggle.addEventListener("change", () =>
    update({ ...settings, codexIntegration: codexToggle.checked }),
  );

  let stopCodexTasks = (): void => undefined;
  const renderCodexTasks = (tasks: ReturnType<typeof loadCodexTasks>): void => {
    const activeTasks = activeCodexTasks(tasks);
    codexTaskCount.textContent = String(activeTasks.length);
  };
  renderCodexTasks(loadCodexTasks());
  void subscribeCodexTasks(renderCodexTasks).then((unlisten) => {
    stopCodexTasks = unlisten;
  });

  const renderBridgeStatus = (installed: boolean, message: string): void => {
    codexBridgeStatus.dataset.installed = String(installed);
    codexBridgeStatus.textContent = message;
    installCodexButton.textContent = installed ? "更新连接" : "安装连接";
  };
  void getCodexBridgeStatus()
    .then((status) => renderBridgeStatus(status.installed, status.message))
    .catch(() => renderBridgeStatus(false, "未找到 Codex 连接"));

  installCodexButton.addEventListener("click", () => {
    installCodexButton.disabled = true;
    codexBridgeStatus.textContent = "正在安装 Codex 连接…";
    void installCodexBridge()
      .then((result) => {
        renderBridgeStatus(result.installed, result.message);
        if (result.installed && !settings.codexIntegration) {
          update({ ...settings, codexIntegration: true });
        }
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        renderBridgeStatus(false, `安装失败：${message}`);
      })
      .finally(() => {
        installCodexButton.disabled = false;
      });
  });

  codexTasksButton.addEventListener("click", () => {
    if (!isTauriRuntime()) {
      window.open(`${window.location.pathname}?view=codex-tasks`, "orbit-pet-codex-tasks", "popup,width=340,height=420");
      return;
    }
    void TauriWindow.getByLabel("codex-tasks").then(async (tasksWindow) => {
      if (!tasksWindow) return;
      await tasksWindow.center();
      await tasksWindow.show();
      await tasksWindow.setFocus();
    });
  });

  const renderKeyboardListenerStatus = (status: KeyboardListenerStatus): void => {
    keyboardListenerRow.dataset.state = status.state;
    keyboardListenerMessage.textContent = status.message;
    keyboardReauthorizeButton.hidden =
      !status.canReauthorize || !["permission-denied", "failed"].includes(status.state);
  };
  let stopKeyboardStatus = (): void => undefined;
  void getKeyboardListenerStatus()
    .then(renderKeyboardListenerStatus)
    .catch((error: unknown) => {
      renderKeyboardListenerStatus({
        state: "failed",
        message: error instanceof Error ? error.message : String(error),
        canReauthorize: false,
      });
    });
  void subscribeKeyboardListenerStatus(renderKeyboardListenerStatus).then((unlisten) => {
    stopKeyboardStatus = unlisten;
  });

  keyboardReauthorizeButton.addEventListener("click", () => {
    keyboardReauthorizeButton.disabled = true;
    renderKeyboardListenerStatus({
      state: "starting",
      message: "正在清除旧授权…",
      canReauthorize: true,
    });
    void resetKeyboardInputPermission()
      .then(renderKeyboardListenerStatus)
      .catch((error: unknown) => {
        renderKeyboardListenerStatus({
          state: "failed",
          message: `重置失败：${error instanceof Error ? error.message : String(error)}`,
          canReauthorize: true,
        });
      })
      .finally(() => {
        keyboardReauthorizeButton.disabled = false;
      });
  });

  const hideSettings = async (): Promise<void> => {
    if (isTauriRuntime()) await getCurrentWindow().hide();
    else window.close();
  };
  closeButton.addEventListener("click", () => void hideSettings());

  if (isTauriRuntime()) {
    void getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (!focused) void hideSettings();
    });
  }

  render(settings);
  window.addEventListener("beforeunload", () => {
    stopCodexTasks();
    stopKeyboardStatus();
  });
};

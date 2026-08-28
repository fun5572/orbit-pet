import type { PetPalette } from "../settings";

export type SleepLayerMode = "attached" | "effects";

export interface SleepView {
  readonly element: HTMLElement;
  setColor(palette: PetPalette): void;
  setSize(size: number): void;
  setSleeping(sleeping: boolean): void;
}

export const createSleepView = (mode: SleepLayerMode): SleepView => {
  const layer = document.createElement("div");
  layer.className = `sleep-layer sleep-layer--${mode}`;
  layer.setAttribute("aria-hidden", "true");
  layer.hidden = true;
  layer.innerHTML = `
    <span class="sleep-text sleep-text--first">.Zzz</span>
    <span class="sleep-text sleep-text--second">.Zzz</span>
  `;

  return {
    element: layer,
    setColor: (palette: PetPalette) => {
      layer.style.setProperty("--sleep-rgb", palette.accentRgb);
    },
    setSize: (size: number) => {
      const xOffset = size * 0.22;
      const yOffset = size * 0.22;
      if (mode === "attached") {
        layer.style.setProperty("--sleep-anchor-x", `calc(50% + ${xOffset.toFixed(2)}px)`);
        layer.style.setProperty("--sleep-anchor-y", `calc(50% - ${yOffset.toFixed(2)}px)`);
      } else {
        layer.style.setProperty("--sleep-anchor-x", `${(40 + xOffset).toFixed(2)}px`);
        layer.style.setProperty("--sleep-anchor-y", `${(250 - yOffset).toFixed(2)}px`);
      }
    },
    setSleeping: (sleeping: boolean) => {
      layer.hidden = !sleeping;
    },
  };
};

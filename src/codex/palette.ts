import type { PetPalette } from "../settings";

export const applyCodexPalette = (element: HTMLElement, palette: PetPalette): void => {
  element.style.setProperty("--codex-fill-top", palette.fill[0]);
  element.style.setProperty("--codex-fill-middle", palette.fill[1]);
  element.style.setProperty("--codex-fill-bottom", palette.fill[2]);
  element.style.setProperty("--codex-rim", palette.rim[0]);
  element.style.setProperty("--codex-rim-muted", palette.rim[1]);
  element.style.setProperty("--codex-spark", palette.spark);
  element.style.setProperty("--codex-accent-rgb", palette.accentRgb);
};

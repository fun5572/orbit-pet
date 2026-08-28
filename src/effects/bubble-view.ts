import type { PetEffectColor } from "../settings";
import { createBubbleMotion } from "./bubble-motion";

export type BubbleLayerMode = "attached" | "effects";

export interface BubbleView {
  readonly element: HTMLElement;
  setColor(color: PetEffectColor): void;
  setSize(size: number): void;
  spawn(): void;
}

export const createBubbleView = (mode: BubbleLayerMode): BubbleView => {
  const layer = document.createElement("div");
  layer.className = `bubble-layer bubble-layer--${mode}`;
  layer.setAttribute("aria-hidden", "true");

  const spawn = (): void => {
    const motion = createBubbleMotion();
    const bubble = document.createElement("span");
    bubble.className = "typing-bubble";
    bubble.style.setProperty("--start-x", `${motion.startX.toFixed(2)}px`);
    bubble.style.setProperty("--start-y", `${motion.startY.toFixed(2)}px`);
    bubble.style.setProperty("--mid-x", `${motion.midX.toFixed(2)}px`);
    bubble.style.setProperty("--mid-y", `${motion.midY.toFixed(2)}px`);
    bubble.style.setProperty("--late-x", `${motion.lateX.toFixed(2)}px`);
    bubble.style.setProperty("--late-y", `${motion.lateY.toFixed(2)}px`);
    bubble.style.setProperty("--drift-x", `${motion.driftX.toFixed(2)}px`);
    bubble.style.setProperty("--rise-y", `${motion.riseY.toFixed(2)}px`);
    bubble.style.setProperty("--bubble-size", `${motion.size.toFixed(2)}px`);
    bubble.style.setProperty("--bubble-duration", `${motion.durationMs.toFixed(0)}ms`);
    layer.append(bubble);

    bubble.addEventListener("animationend", () => bubble.remove(), { once: true });
    window.setTimeout(() => bubble.remove(), motion.durationMs + 250);
    while (layer.childElementCount > 48) layer.firstElementChild?.remove();
  };

  return {
    element: layer,
    setColor: (color: PetEffectColor) => {
      layer.style.setProperty("--bubble-rgb", color.accentRgb);
      layer.style.setProperty("--bubble-spark", color.spark);
    },
    setSize: (size: number) => {
      layer.style.setProperty("--head-offset", `${(size * 0.35).toFixed(2)}px`);
    },
    spawn,
  };
};

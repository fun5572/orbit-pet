import { describe, expect, it } from "vitest";
import { createBubbleMotion } from "./bubble-motion";

describe("bubble motion", () => {
  it("always rises toward the upper right within the effects window", () => {
    for (const sample of [0, 0.25, 0.5, 0.75, 1]) {
      const motion = createBubbleMotion(() => sample);
      expect(motion.driftX).toBeGreaterThanOrEqual(34);
      expect(motion.driftX).toBeLessThanOrEqual(110);
      expect(motion.riseY).toBeLessThanOrEqual(-130);
      expect(motion.riseY).toBeGreaterThanOrEqual(-205);
      expect(motion.startY).toBeGreaterThanOrEqual(-8);
      expect(motion.startY).toBeLessThanOrEqual(2);
      expect(motion.durationMs).toBeGreaterThanOrEqual(1250);
      expect(motion.durationMs).toBeLessThanOrEqual(2100);
    }
  });

  it("keeps the whole lifecycle inside the native effects canvas", () => {
    const canvas = { width: 260, height: 280 };
    const anchor = { x: 40, y: 250 };

    for (const sample of [0, 0.25, 0.5, 0.75, 1]) {
      const motion = createBubbleMotion(() => sample);
      expect(anchor.y + motion.startY + motion.riseY).toBeGreaterThanOrEqual(0);
      expect(anchor.y + motion.startY + motion.size).toBeLessThanOrEqual(canvas.height);
      expect(anchor.x + motion.startX).toBeGreaterThanOrEqual(0);
      expect(anchor.x + motion.startX + motion.driftX + motion.size).toBeLessThanOrEqual(canvas.width);
    }
  });

  it("varies the generated path when randomness changes", () => {
    expect(createBubbleMotion(() => 0.15)).not.toEqual(createBubbleMotion(() => 0.85));
  });
});

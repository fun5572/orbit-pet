import { describe, expect, it } from "vitest";
import { BlinkEngine, blinkClosureAt } from "./blink";

describe("blink engine", () => {
  it("closes, holds, and opens the eyes over one blink", () => {
    expect(blinkClosureAt(0)).toBe(0);
    expect(blinkClosureAt(0.3)).toBe(1);
    expect(blinkClosureAt(0.4)).toBe(1);
    expect(blinkClosureAt(1)).toBe(0);
  });

  it("schedules a blink within the intended idle interval", () => {
    const engine = new BlinkEngine(1000, { next: () => 0 });

    expect(engine.sample(3399)).toBe(0);
    expect(engine.sample(3400)).toBe(0);
    expect(engine.sample(3440)).toBeGreaterThan(0);
  });

  it("does not blink while asleep and schedules a fresh blink after waking", () => {
    const engine = new BlinkEngine(1000, { next: () => 0 });

    expect(engine.sample(3400, false)).toBe(0);
    expect(engine.sample(9000, false)).toBe(0);
    expect(engine.sample(9000, true)).toBe(0);
    expect(engine.sample(11399, true)).toBe(0);
    expect(engine.sample(11400, true)).toBe(0);
    expect(engine.sample(11440, true)).toBeGreaterThan(0);
  });
});

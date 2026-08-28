import { describe, expect, it } from "vitest";
import { BORED_AFTER_MS, PetActivityEngine, SLEEP_AFTER_MS, WAKE_EFFECT_MS } from "./activity";

describe("pet activity engine", () => {
  it("moves from active to bored and then sleeping", () => {
    const activity = new PetActivityEngine(1000);

    expect(activity.phase(1000 + BORED_AFTER_MS - 1)).toBe("active");
    expect(activity.phase(1000 + BORED_AFTER_MS)).toBe("bored");
    expect(activity.phase(1000 + SLEEP_AFTER_MS)).toBe("sleeping");
  });

  it("returns bored pets to active without a wake shock", () => {
    const activity = new PetActivityEngine(0);
    const result = activity.registerActivity(BORED_AFTER_MS + 20);

    expect(result.wokeFromSleep).toBe(false);
    expect(activity.phase(BORED_AFTER_MS + 20)).toBe("active");
    expect(activity.isAwakened(BORED_AFTER_MS + 20)).toBe(false);
  });

  it("plays a short wake effect after sleeping", () => {
    const activity = new PetActivityEngine(0);
    const wakeAt = SLEEP_AFTER_MS + 20;
    const result = activity.registerActivity(wakeAt);

    expect(result.wokeFromSleep).toBe(true);
    expect(activity.phase(wakeAt)).toBe("active");
    expect(activity.isAwakened(wakeAt + WAKE_EFFECT_MS - 1)).toBe(true);
    expect(activity.isAwakened(wakeAt + WAKE_EFFECT_MS)).toBe(false);
  });
});

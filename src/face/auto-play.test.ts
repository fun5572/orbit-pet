import { describe, expect, it } from "vitest";
import {
  AUTO_PLAY_DURATION_MS,
  AUTO_PLAY_RETURN_HOP_MS,
  AUTO_PLAY_WAIT_MAX_MS,
  AUTO_PLAY_WAIT_MIN_MS,
  calculatePlayDeformation,
  calculatePlayOffset,
  calculateReturnDuration,
  calculateReturnMotion,
  PetAutoPlayEngine,
} from "./auto-play";

describe("pet auto play engine", () => {
  it("waits a random thirty to sixty seconds of uninterrupted sleep", () => {
    const earliest = new PetAutoPlayEngine(() => 0);
    expect(earliest.sample(1_000, true).phase).toBe("waiting");
    expect(earliest.sample(1_000 + AUTO_PLAY_WAIT_MIN_MS - 1, true).phase).toBe("waiting");
    expect(earliest.sample(1_000 + AUTO_PLAY_WAIT_MIN_MS, true).justStarted).toBe(true);

    const latest = new PetAutoPlayEngine(() => 1);
    latest.sample(2_000, true);
    expect(latest.sample(2_000 + AUTO_PLAY_WAIT_MAX_MS - 1, true).phase).toBe("waiting");
    expect(latest.sample(2_000 + AUTO_PLAY_WAIT_MAX_MS, true).justStarted).toBe(true);
  });

  it("cancels the waiting timer when the pet is awakened", () => {
    const engine = new PetAutoPlayEngine(() => 0);
    engine.sample(0, true);

    expect(engine.sample(30_000, false).phase).toBe("idle");
    expect(engine.sample(AUTO_PLAY_WAIT_MIN_MS, false).active).toBe(false);
  });

  it("keeps playing through normal input and then returns exactly home", () => {
    const engine = new PetAutoPlayEngine(() => 0);
    engine.sample(0, true);
    const playStartedAt = AUTO_PLAY_WAIT_MIN_MS;
    engine.sample(playStartedAt, true);

    const playing = engine.sample(playStartedAt + 2_000, false);
    expect(playing.phase).toBe("playing");
    expect(playing.active).toBe(true);
    expect(Math.hypot(playing.offset.x, playing.offset.y)).toBeGreaterThan(1);

    const returning = engine.sample(playStartedAt + AUTO_PLAY_DURATION_MS, false);
    expect(returning.phase).toBe("returning");
    const returnDuration = calculateReturnDuration(returning.offset);

    const finished = engine.sample(
      playStartedAt + AUTO_PLAY_DURATION_MS + returnDuration,
      false,
    );
    expect(finished.justFinished).toBe(true);
    expect(finished.offset).toEqual({ x: 0, y: 0 });
  });

  it("uses a bounded hopping orbit", () => {
    for (let elapsedMs = 0; elapsedMs <= AUTO_PLAY_DURATION_MS; elapsedMs += 250) {
      const offset = calculatePlayOffset(elapsedMs);
      expect(Math.abs(offset.x)).toBeLessThanOrEqual(44);
      expect(offset.y).toBeGreaterThanOrEqual(-37);
      expect(offset.y).toBeLessThanOrEqual(12);
    }
  });

  it("squashes on impact, stretches around takeoff, and preserves volume", () => {
    const oneHopMs = AUTO_PLAY_DURATION_MS / 12;
    const impact = calculatePlayDeformation(oneHopMs);
    const takeoff = calculatePlayDeformation(oneHopMs * 1.17);
    const apex = calculatePlayDeformation(oneHopMs * 1.5);

    expect(impact.bodyScaleY).toBeLessThan(1);
    expect(impact.bodyScaleX).toBeGreaterThan(1);
    expect(takeoff.bodyScaleY).toBeGreaterThan(1);
    expect(apex.bodyScaleY).toBeCloseTo(1, 4);
    expect(impact.bodyScaleX * impact.bodyScaleY).toBeCloseTo(1, 6);
    expect(takeoff.bodyScaleX * takeoff.bodyScaleY).toBeCloseTo(1, 6);
  });

  it("returns home with distance-based hops instead of a dragged interpolation", () => {
    const origin = { x: 44, y: 0 };
    const duration = calculateReturnDuration(origin);
    expect(duration).toBeGreaterThan(AUTO_PLAY_RETURN_HOP_MS);

    const firstApex = calculateReturnMotion(origin, AUTO_PLAY_RETURN_HOP_MS / 2);
    const firstLanding = calculateReturnMotion(origin, AUTO_PLAY_RETURN_HOP_MS);
    const finished = calculateReturnMotion(origin, duration);

    expect(firstApex.offset.y).toBeLessThan(-10);
    expect(firstApex.bodyScaleY).toBeCloseTo(1, 4);
    expect(firstLanding.offset.x).toBeCloseTo(22, 4);
    expect(firstLanding.offset.y).toBeCloseTo(0, 4);
    expect(firstLanding.bodyScaleY).toBeLessThan(1);
    expect(finished.offset).toEqual({ x: 0, y: 0 });
    expect(finished.bodyScaleY).toBe(1);
    expect(finished.finished).toBe(true);
  });
});

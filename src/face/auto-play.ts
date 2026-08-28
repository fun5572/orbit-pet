import type { Point } from "./gaze";

export const AUTO_PLAY_WAIT_MIN_MS = 30_000;
export const AUTO_PLAY_WAIT_MAX_MS = 60_000;
export const AUTO_PLAY_DURATION_MS = 9_000;
export const AUTO_PLAY_RETURN_HOP_DISTANCE = 24;
export const AUTO_PLAY_RETURN_HOP_MS = 520;
export const AUTO_PLAY_RETURN_SETTLE_MS = 240;

export type AutoPlayPhase = "idle" | "waiting" | "playing" | "returning";

export interface AutoPlayFrame {
  phase: AutoPlayPhase;
  offset: Point;
  bodyScaleX: number;
  bodyScaleY: number;
  active: boolean;
  justStarted: boolean;
  justFinished: boolean;
}

const ZERO_OFFSET: Point = { x: 0, y: 0 };
const NEUTRAL_DEFORMATION = { bodyScaleX: 1, bodyScaleY: 1 };

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const easeInOut = (value: number): number => {
  const progress = clamp01(value);
  return progress * progress * (3 - 2 * progress);
};

const calculateCycleDeformation = (
  cycleProgress: number,
  strength = 1,
): Pick<AutoPlayFrame, "bodyScaleX" | "bodyScaleY"> => {
  const contactDistance = Math.min(cycleProgress, 1 - cycleProgress);
  const squash = easeInOut(1 - contactDistance / 0.14);
  const takeoffStretch = easeInOut(1 - Math.abs(cycleProgress - 0.17) / 0.12);
  const landingStretch = easeInOut(1 - Math.abs(cycleProgress - 0.83) / 0.12);
  const stretch = Math.max(takeoffStretch, landingStretch);
  const bodyScaleY = 1 + (-0.14 * squash + 0.1 * stretch) * strength;

  return { bodyScaleX: 1 / bodyScaleY, bodyScaleY };
};

export const calculatePlayOffset = (elapsedMs: number): Point => {
  const progress = clamp01(elapsedMs / AUTO_PLAY_DURATION_MS);
  const entrance = easeInOut(Math.min(1, elapsedMs / 650));
  const orbitAngle = progress * Math.PI * 4.5;
  const hop = Math.abs(Math.sin(progress * Math.PI * 12));

  return {
    x: Math.sin(orbitAngle) * 44 * entrance,
    y: (Math.cos(orbitAngle) * 12 - hop * 25) * entrance,
  };
};

export const calculatePlayDeformation = (
  elapsedMs: number,
): Pick<AutoPlayFrame, "bodyScaleX" | "bodyScaleY"> => {
  const progress = clamp01(elapsedMs / AUTO_PLAY_DURATION_MS);
  const entrance = easeInOut(Math.min(1, elapsedMs / 420));
  const cycleProgress = (progress * 12) % 1;
  return calculateCycleDeformation(cycleProgress, entrance);
};

export interface ReturnMotion extends Pick<AutoPlayFrame, "offset" | "bodyScaleX" | "bodyScaleY"> {
  finished: boolean;
}

export const calculateReturnDuration = (origin: Point): number => {
  const distance = Math.hypot(origin.x, origin.y);
  const hopCount = Math.max(1, Math.ceil(distance / AUTO_PLAY_RETURN_HOP_DISTANCE));
  return hopCount * AUTO_PLAY_RETURN_HOP_MS + AUTO_PLAY_RETURN_SETTLE_MS;
};

export const calculateReturnMotion = (origin: Point, elapsedMs: number): ReturnMotion => {
  const distance = Math.hypot(origin.x, origin.y);
  const hopCount = Math.max(1, Math.ceil(distance / AUTO_PLAY_RETURN_HOP_DISTANCE));
  const travelDuration = hopCount * AUTO_PLAY_RETURN_HOP_MS;
  const totalDuration = travelDuration + AUTO_PLAY_RETURN_SETTLE_MS;

  if (elapsedMs >= totalDuration) {
    return { offset: ZERO_OFFSET, ...NEUTRAL_DEFORMATION, finished: true };
  }

  if (elapsedMs >= travelDuration) {
    const settleProgress = easeInOut((elapsedMs - travelDuration) / AUTO_PLAY_RETURN_SETTLE_MS);
    const bodyScaleY = 0.86 + 0.14 * settleProgress;
    return {
      offset: ZERO_OFFSET,
      bodyScaleX: 1 / bodyScaleY,
      bodyScaleY,
      finished: false,
    };
  }

  const travelProgress = clamp01(elapsedMs / travelDuration);
  const hopPosition = travelProgress * hopCount;
  const cycleProgress = hopPosition % 1;
  const distancePerHop = distance / hopCount;
  const hopHeight = Math.min(24, 10 + distancePerHop * 0.48);
  const deformation = calculateCycleDeformation(cycleProgress);

  return {
    offset: {
      x: origin.x * (1 - travelProgress),
      y: origin.y * (1 - travelProgress) - Math.sin(cycleProgress * Math.PI) * hopHeight,
    },
    ...deformation,
    finished: false,
  };
};

export class PetAutoPlayEngine {
  #phase: AutoPlayPhase = "idle";
  #wakeAt = 0;
  #playStartedAt = 0;
  #returnStartedAt = 0;
  #returnOrigin: Point = ZERO_OFFSET;
  readonly #random: () => number;

  constructor(random: () => number = Math.random) {
    this.#random = random;
  }

  interrupt(): boolean {
    const wasActive = this.#phase === "playing" || this.#phase === "returning";
    this.#reset();
    return wasActive;
  }

  sample(now: number, naturallySleeping: boolean, grabbed = false): AutoPlayFrame {
    if (grabbed) {
      const justFinished = this.interrupt();
      return this.#frame("idle", ZERO_OFFSET, false, false, justFinished);
    }

    if (this.#phase === "idle") {
      if (naturallySleeping) {
        const randomProgress = clamp01(this.#random());
        this.#wakeAt =
          now + AUTO_PLAY_WAIT_MIN_MS + randomProgress * (AUTO_PLAY_WAIT_MAX_MS - AUTO_PLAY_WAIT_MIN_MS);
        this.#phase = "waiting";
      }
      return this.#frame(this.#phase, ZERO_OFFSET, false, false, false);
    }

    if (this.#phase === "waiting") {
      if (!naturallySleeping) {
        this.#reset();
        return this.#frame("idle", ZERO_OFFSET, false, false, false);
      }
      if (now < this.#wakeAt) return this.#frame("waiting", ZERO_OFFSET, false, false, false);

      this.#phase = "playing";
      this.#playStartedAt = now;
      return this.#frame("playing", ZERO_OFFSET, true, true, false, NEUTRAL_DEFORMATION);
    }

    if (this.#phase === "playing") {
      const elapsedMs = now - this.#playStartedAt;
      if (elapsedMs < AUTO_PLAY_DURATION_MS) {
        return this.#frame(
          "playing",
          calculatePlayOffset(elapsedMs),
          true,
          false,
          false,
          calculatePlayDeformation(elapsedMs),
        );
      }

      this.#phase = "returning";
      this.#returnStartedAt = now;
      this.#returnOrigin = calculatePlayOffset(AUTO_PLAY_DURATION_MS);
      const returnMotion = calculateReturnMotion(this.#returnOrigin, 0);
      return this.#frame(
        "returning",
        returnMotion.offset,
        true,
        false,
        false,
        returnMotion,
      );
    }

    const returnMotion = calculateReturnMotion(this.#returnOrigin, now - this.#returnStartedAt);
    if (returnMotion.finished) {
      this.#reset();
      return this.#frame("idle", ZERO_OFFSET, false, false, true);
    }

    return this.#frame(
      "returning",
      returnMotion.offset,
      true,
      false,
      false,
      returnMotion,
    );
  }

  #reset(): void {
    this.#phase = "idle";
    this.#wakeAt = 0;
    this.#playStartedAt = 0;
    this.#returnStartedAt = 0;
    this.#returnOrigin = ZERO_OFFSET;
  }

  #frame(
    phase: AutoPlayPhase,
    offset: Point,
    active: boolean,
    justStarted: boolean,
    justFinished: boolean,
    deformation: Pick<AutoPlayFrame, "bodyScaleX" | "bodyScaleY"> = NEUTRAL_DEFORMATION,
  ): AutoPlayFrame {
    return { phase, offset, ...deformation, active, justStarted, justFinished };
  }
}

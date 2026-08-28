export interface RandomSource {
  next(): number;
}

const defaultRandom: RandomSource = {
  next: () => Math.random(),
};

export const blinkClosureAt = (progress: number): number => {
  if (progress <= 0 || progress >= 1) return 0;
  if (progress < 0.3) return progress / 0.3;
  if (progress < 0.48) return 1;
  return 1 - (progress - 0.48) / 0.52;
};

export class BlinkEngine {
  readonly #random: RandomSource;
  #nextBlinkAt: number;
  #startedAt: number | null = null;
  #paused = false;

  constructor(now: number, random: RandomSource = defaultRandom) {
    this.#random = random;
    this.#nextBlinkAt = now + this.#nextDelay();
  }

  sample(now: number, enabled = true): number {
    if (!enabled) {
      this.#paused = true;
      this.#startedAt = null;
      return 0;
    }

    if (this.#paused) {
      this.#paused = false;
      this.#nextBlinkAt = now + this.#nextDelay();
    }

    if (this.#startedAt === null && now >= this.#nextBlinkAt) {
      this.#startedAt = now;
    }

    if (this.#startedAt === null) return 0;

    const progress = (now - this.#startedAt) / 260;
    if (progress >= 1) {
      this.#startedAt = null;
      this.#nextBlinkAt = now + this.#nextDelay();
      return 0;
    }

    return blinkClosureAt(progress);
  }

  #nextDelay(): number {
    return 2400 + this.#random.next() * 3600;
  }
}

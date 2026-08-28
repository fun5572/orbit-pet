export const BORED_AFTER_MS = 6500;
export const SLEEP_AFTER_MS = 14000;
export const WAKE_EFFECT_MS = 700;

export type IdlePhase = "active" | "bored" | "sleeping";

export interface ActivityResult {
  wokeFromSleep: boolean;
}

export class PetActivityEngine {
  #lastActivityAt: number;
  #awakenedUntil = 0;

  constructor(now: number) {
    this.#lastActivityAt = now;
  }

  idleForMs(now: number): number {
    return Math.max(0, now - this.#lastActivityAt);
  }

  phase(now: number): IdlePhase {
    const idleForMs = this.idleForMs(now);
    if (idleForMs >= SLEEP_AFTER_MS) return "sleeping";
    if (idleForMs >= BORED_AFTER_MS) return "bored";
    return "active";
  }

  registerActivity(now: number): ActivityResult {
    const wokeFromSleep = this.phase(now) === "sleeping";
    this.#lastActivityAt = now;
    if (wokeFromSleep) this.#awakenedUntil = now + WAKE_EFFECT_MS;
    return { wokeFromSleep };
  }

  isAwakened(now: number): boolean {
    return now < this.#awakenedUntil;
  }
}

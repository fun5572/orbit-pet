import { BORED_AFTER_MS, SLEEP_AFTER_MS } from "./activity";

export interface Point {
  x: number;
  y: number;
}

export interface GazeInput {
  pointer: Point;
  center: Point;
  speed: number;
  idleForMs?: number;
  startled?: boolean;
  awakened?: boolean;
  grabbed?: boolean;
  dragVelocityX?: number;
}

export type Expression =
  | "cute"
  | "curious"
  | "focused"
  | "startled"
  | "awakened"
  | "grabbed"
  | "bored"
  | "sleeping";

export interface GazePose {
  expression: Expression;
  offsetX: number;
  offsetY: number;
  eyeWidth: number;
  eyeHeight: number;
  eyeGap: number;
  eyeRoundness: number;
  eyeScaleX: number;
  eyeScaleY: number;
  leftEyeScale: number;
  rightEyeScale: number;
  eyeRotation: number;
  asymmetry: number;
  excitement: number;
  bodyTilt: number;
  bodyScaleX: number;
  bodyScaleY: number;
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

export const smoothstep = (minimum: number, maximum: number, value: number): number => {
  const normalized = clamp((value - minimum) / (maximum - minimum), 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
};

export interface ExpressionInput {
  distance: number;
  directionY: number;
  idleForMs: number;
  startled: boolean;
  awakened: boolean;
  grabbed: boolean;
}

export const selectExpression = ({
  distance,
  directionY,
  idleForMs,
  startled,
  awakened,
  grabbed,
}: ExpressionInput): Expression => {
  if (grabbed) return "grabbed";
  if (awakened) return "awakened";
  if (startled) return "startled";
  if (idleForMs >= SLEEP_AFTER_MS) return "sleeping";
  if (idleForMs >= BORED_AFTER_MS) return "bored";
  if (distance <= 170) return "cute";
  if (distance >= 520 || Math.abs(directionY) >= 0.62) return "focused";
  return "curious";
};

const expressionGeometry = (
  expression: Expression,
): Pick<GazePose, "eyeWidth" | "eyeHeight" | "eyeGap" | "eyeRoundness"> => {
  switch (expression) {
    case "cute":
      return { eyeWidth: 30, eyeHeight: 30, eyeGap: 39, eyeRoundness: 1 };
    case "curious":
      return { eyeWidth: 28, eyeHeight: 33, eyeGap: 40, eyeRoundness: 1 };
    case "focused":
      return { eyeWidth: 21, eyeHeight: 44, eyeGap: 38, eyeRoundness: 1 };
    case "startled":
      return { eyeWidth: 34, eyeHeight: 34, eyeGap: 43, eyeRoundness: 1 };
    case "awakened":
      return { eyeWidth: 38, eyeHeight: 38, eyeGap: 45, eyeRoundness: 1 };
    case "grabbed":
      return { eyeWidth: 36, eyeHeight: 24, eyeGap: 44, eyeRoundness: 1 };
    case "bored":
      return { eyeWidth: 31, eyeHeight: 9, eyeGap: 39, eyeRoundness: 1 };
    case "sleeping":
      return { eyeWidth: 30, eyeHeight: 5, eyeGap: 39, eyeRoundness: 1 };
  }
};

export const calculateGazePose = ({
  pointer,
  center,
  speed,
  idleForMs = 0,
  startled = false,
  awakened = false,
  grabbed = false,
  dragVelocityX = 0,
}: GazeInput): GazePose => {
  const deltaX = pointer.x - center.x;
  const deltaY = pointer.y - center.y;
  const distance = Math.hypot(deltaX, deltaY);
  const directionX = distance > 0 ? deltaX / distance : 0;
  const directionY = distance > 0 ? deltaY / distance : 0;
  const expression = selectExpression({ distance, directionY, idleForMs, startled, awakened, grabbed });
  const geometry = expressionGeometry(expression);
  const isIdle = expression === "bored" || expression === "sleeping";
  const isGrabbed = expression === "grabbed";

  if (isGrabbed) {
    const dragEnergy = smoothstep(180, 1800, Math.abs(dragVelocityX));

    return {
      expression,
      offsetX: 0,
      offsetY: -5,
      ...geometry,
      eyeScaleX: 1,
      eyeScaleY: 1,
      leftEyeScale: 1,
      rightEyeScale: 1,
      eyeRotation: 0,
      asymmetry: 0,
      excitement: 0.12,
      bodyTilt: clamp(dragVelocityX / 92, -14, 14),
      bodyScaleX: 0.84 - dragEnergy * 0.035,
      bodyScaleY: 1.16 + dragEnergy * 0.045,
    };
  }

  const gazeDirectionX = isIdle ? 0 : directionX;
  const gazeDirectionY = isIdle ? 0 : directionY;

  const distanceEnergy = isIdle ? 0 : smoothstep(70, 780, distance);
  const speedEnergy = isIdle ? 0 : smoothstep(420, 1900, speed);
  const excitement = clamp(
    distanceEnergy * 0.5 +
      speedEnergy * 0.5 +
      (expression === "startled" ? 0.35 : 0) +
      (expression === "awakened" ? 0.55 : 0),
    0,
    1,
  );
  const travel = 8 + excitement * 13;
  const asymmetryDirection = directionX === 0 ? 1 : Math.sign(directionX);
  const sizeAsymmetry = expression === "startled" ? asymmetryDirection * 0.22 : 0;

  return {
    expression,
    offsetX: gazeDirectionX * travel,
    offsetY: gazeDirectionY * travel * 0.72,
    ...geometry,
    eyeScaleX: 1 + Math.abs(gazeDirectionX) * excitement * 0.08,
    eyeScaleY: 1 + Math.abs(gazeDirectionY) * excitement * 0.1,
    leftEyeScale: 1 + sizeAsymmetry,
    rightEyeScale: 1 - sizeAsymmetry,
    eyeRotation: gazeDirectionX * (3 + excitement * 7),
    asymmetry: expression === "startled" ? gazeDirectionX * 5 : gazeDirectionX * speedEnergy * 2,
    excitement,
    bodyTilt: gazeDirectionX * excitement * 3.5,
    bodyScaleX: expression === "awakened" ? 0.95 : 1 + Math.abs(gazeDirectionX) * excitement * 0.025,
    bodyScaleY: expression === "awakened" ? 1.08 : 1 + Math.abs(gazeDirectionY) * excitement * 0.035,
  };
};

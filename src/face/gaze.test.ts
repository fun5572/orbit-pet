import { describe, expect, it } from "vitest";
import { calculateGazePose, smoothstep } from "./gaze";

describe("gaze engine", () => {
  it("keeps the eyes centered when the pointer is centered", () => {
    const pose = calculateGazePose({
      pointer: { x: 100, y: 100 },
      center: { x: 100, y: 100 },
      speed: 0,
    });

    expect(pose.offsetX).toBe(0);
    expect(pose.offsetY).toBe(0);
    expect(pose.excitement).toBe(0);
    expect(pose.expression).toBe("cute");
    expect(pose.eyeWidth).toBe(pose.eyeHeight);
  });

  it("moves toward the pointer while keeping travel bounded", () => {
    const pose = calculateGazePose({
      pointer: { x: 2000, y: 100 },
      center: { x: 100, y: 100 },
      speed: 0,
    });

    expect(pose.offsetX).toBeGreaterThan(0);
    expect(pose.offsetX).toBeLessThanOrEqual(21);
    expect(pose.offsetY).toBe(0);
    expect(pose.expression).toBe("focused");
    expect(pose.eyeHeight).toBeGreaterThan(pose.eyeWidth);
  });

  it("keeps the distance-based eye shape during fast cursor movement", () => {
    const calm = calculateGazePose({
      pointer: { x: 420, y: 100 },
      center: { x: 100, y: 100 },
      speed: 0,
    });
    const fast = calculateGazePose({
      pointer: { x: 420, y: 100 },
      center: { x: 100, y: 100 },
      speed: 2200,
    });

    expect(fast.excitement).toBeGreaterThan(calm.excitement);
    expect(fast.expression).toBe(calm.expression);
    expect(fast.eyeWidth).toBe(calm.eyeWidth);
    expect(fast.eyeHeight).toBe(calm.eyeHeight);
    expect(fast.leftEyeScale).toBe(fast.rightEyeScale);
  });

  it("uses asymmetric round eyes only while startled", () => {
    const pose = calculateGazePose({
      pointer: { x: 420, y: 100 },
      center: { x: 100, y: 100 },
      speed: 0,
      startled: true,
    });

    expect(pose.expression).toBe("startled");
    expect(pose.eyeWidth).toBe(pose.eyeHeight);
    expect(pose.leftEyeScale).not.toBe(pose.rightEyeScale);
  });

  it("becomes bored after the pointer stays still", () => {
    const pose = calculateGazePose({
      pointer: { x: 300, y: 100 },
      center: { x: 100, y: 100 },
      speed: 0,
      idleForMs: 7000,
    });

    expect(pose.expression).toBe("bored");
    expect(pose.eyeHeight).toBeLessThan(pose.eyeWidth);
    expect(pose.offsetX).toBe(0);
    expect(pose.offsetY).toBe(0);
    expect(pose.eyeRotation).toBe(0);
    expect(pose.bodyTilt).toBe(0);
  });

  it("falls asleep after remaining bored and keeps the sleeping eyes centered", () => {
    const pose = calculateGazePose({
      pointer: { x: 900, y: 300 },
      center: { x: 100, y: 100 },
      speed: 0,
      idleForMs: 15000,
    });

    expect(pose.expression).toBe("sleeping");
    expect(pose.eyeHeight).toBeLessThan(9);
    expect(pose.offsetX).toBe(0);
    expect(pose.offsetY).toBe(0);
    expect(pose.excitement).toBe(0);
  });

  it("uses a symmetrical wide-eyed pose when awakened", () => {
    const pose = calculateGazePose({
      pointer: { x: 420, y: 100 },
      center: { x: 100, y: 100 },
      speed: 0,
      idleForMs: 15000,
      awakened: true,
    });

    expect(pose.expression).toBe("awakened");
    expect(pose.eyeWidth).toBe(pose.eyeHeight);
    expect(pose.leftEyeScale).toBe(pose.rightEyeScale);
    expect(pose.bodyScaleY).toBeGreaterThan(1);
    expect(pose.offsetX).toBeGreaterThan(0);
  });

  it("locks the innocent stretched pose while grabbed", () => {
    const pose = calculateGazePose({
      pointer: { x: 900, y: 300 },
      center: { x: 100, y: 100 },
      speed: 2200,
      idleForMs: 20000,
      startled: true,
      awakened: true,
      grabbed: true,
      dragVelocityX: 1800,
    });

    expect(pose.expression).toBe("grabbed");
    expect(pose.offsetX).toBe(0);
    expect(pose.offsetY).toBe(-5);
    expect(pose.eyeRotation).toBe(0);
    expect(pose.eyeWidth).toBeGreaterThan(pose.eyeHeight);
    expect(pose.leftEyeScale).toBe(pose.rightEyeScale);
    expect(pose.bodyScaleX).toBeLessThan(1);
    expect(pose.bodyScaleY).toBeGreaterThan(1.16);
    expect(pose.bodyTilt).toBe(14);
  });

  it("smoothstep clamps values at both ends", () => {
    expect(smoothstep(10, 20, 0)).toBe(0);
    expect(smoothstep(10, 20, 30)).toBe(1);
  });
});

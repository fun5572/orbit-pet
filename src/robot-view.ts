import type { GazePose } from "./face/gaze";
import { stepSpring, type SpringValue } from "./face/spring";
import type { PetPalette, PetVariant } from "./settings";

type AnimatedPose = Omit<GazePose, "expression">;
type AnimatedKey = keyof AnimatedPose;

const initialPose: AnimatedPose = {
  offsetX: 0,
  offsetY: 0,
  eyeWidth: 30,
  eyeHeight: 30,
  eyeGap: 39,
  eyeRoundness: 1,
  eyeScaleX: 1,
  eyeScaleY: 1,
  leftEyeScale: 1,
  rightEyeScale: 1,
  eyeRotation: 0,
  asymmetry: 0,
  excitement: 0,
  bodyTilt: 0,
  bodyScaleX: 1,
  bodyScaleY: 1,
};

const animatedKeys = Object.keys(initialPose) as AnimatedKey[];
const SETTLE_EPSILON = 0.001;

// Round to sub-pixel precision so near-identical frames produce identical
// attribute strings and can be skipped.
const round = (value: number): number => Math.round(value * 1000) / 1000;

const setAttr = (element: Element, name: string, value: string): void => {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
};

export interface RobotView {
  readonly element: HTMLElement;
  render(target: GazePose, blinkClosure: number, deltaSeconds: number, groundedMotion?: boolean): void;
  setColor(palette: PetPalette): void;
  setInteractive(interactive: boolean): void;
  setSize(size: number): void;
  setVariant(variant: PetVariant): void;
}

export const createRobotView = (): RobotView => {
  const shell = document.createElement("section");
  shell.className = "pet-shell";
  shell.setAttribute("aria-label", "可拖动的圆形机器人桌宠");
  shell.innerHTML = `
    <div class="ambient-glow" aria-hidden="true"></div>
    <svg class="robot" viewBox="0 0 200 200" role="img" aria-label="圆形机器人">
      <defs>
        <radialGradient id="orb-fill" cx="35%" cy="25%" r="80%">
          <stop data-fill-stop="0" offset="0%" stop-color="#252938" />
          <stop data-fill-stop="1" offset="54%" stop-color="#090a0f" />
          <stop data-fill-stop="2" offset="100%" stop-color="#020204" />
        </radialGradient>
        <linearGradient id="rim" x1="20%" y1="10%" x2="80%" y2="90%">
          <stop data-rim-stop="0" offset="0%" stop-color="#7e87ff" stop-opacity="0.62" />
          <stop data-rim-stop="1" offset="45%" stop-color="#3c4268" stop-opacity="0.12" />
          <stop data-rim-stop="2" offset="100%" stop-color="#8a5cff" stop-opacity="0.5" />
        </linearGradient>
        <filter id="eye-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.8" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <linearGradient id="bow-fill" x1="20%" y1="10%" x2="80%" y2="90%">
          <stop offset="0%" stop-color="#ffb2d0" />
          <stop offset="48%" stop-color="#ff6da9" />
          <stop offset="100%" stop-color="#d83f7d" />
        </linearGradient>
        <linearGradient id="tear-stream-fill" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#c9f5ff" stop-opacity="0.96" />
          <stop offset="38%" stop-color="#80dffb" stop-opacity="0.92" />
          <stop offset="100%" stop-color="#43c2ee" stop-opacity="0.84" />
        </linearGradient>
        <pattern id="tear-ripple-pattern" width="48" height="18" patternUnits="userSpaceOnUse">
          <path
            d="M-12 3 Q0 -2 12 3 T36 3 T60 3 L60 10 Q48 5 36 10 T12 10 T-12 10 Z"
            fill="#078fc8"
            fill-opacity="0.55"
          />
        </pattern>
        <filter id="bow-shadow" x="-40%" y="-40%" width="180%" height="200%">
          <feDropShadow dx="0" dy="3" stdDeviation="2.5" flood-color="#14040b" flood-opacity="0.58" />
        </filter>
        <clipPath id="face-clip"><circle cx="100" cy="100" r="66" /></clipPath>
      </defs>
      <g data-part="body">
        <circle class="rim" cx="100" cy="100" r="70" fill="url(#rim)" />
        <circle class="orb" cx="100" cy="100" r="66" fill="url(#orb-fill)" />
        <ellipse class="orb-highlight" cx="82" cy="65" rx="34" ry="16" />
        <g data-part="tears" filter="url(#eye-glow)">
          <g class="tear-streams" aria-hidden="true">
            <path class="tear-stream" data-tear-stream="left" fill="url(#tear-stream-fill)" />
            <path class="tear-stream" data-tear-stream="right" fill="url(#tear-stream-fill)" />
            <path class="tear-ripple" data-tear-ripple="left" fill="url(#tear-ripple-pattern)" />
            <path class="tear-ripple" data-tear-ripple="right" fill="url(#tear-ripple-pattern)" />
          </g>
        </g>
        <g clip-path="url(#face-clip)" data-part="eyes" filter="url(#eye-glow)">
          <path class="cry-eye" data-cry-eye="left" />
          <path class="cry-eye" data-cry-eye="right" />
          <rect data-eye="left" x="68" y="78" width="21" height="43" rx="10.5" fill="#fbfbff" />
          <rect data-eye="right" x="106" y="78" width="21" height="43" rx="10.5" fill="#fbfbff" />
        </g>
        <circle class="spark" data-part="spark" cx="151" cy="58" r="3" />
        <g class="bow" data-part="bow" filter="url(#bow-shadow)" aria-hidden="true">
          <path class="bow-tail" d="M48 51 L38 66 L51 59 Z" fill="#dc4783" />
          <path class="bow-tail" d="M56 51 L66 65 L53 59 Z" fill="#c93673" />
          <path class="bow-lobe" d="M51 46 C38 30 23 35 29 51 C34 64 44 57 52 50 Z" fill="url(#bow-fill)" />
          <path class="bow-lobe" d="M53 46 C66 29 80 34 73 51 C67 63 59 57 52 50 Z" fill="url(#bow-fill)" />
          <ellipse class="bow-knot" cx="52" cy="48" rx="7.2" ry="8" fill="#ff87b7" />
          <ellipse cx="50" cy="45" rx="2.2" ry="2.8" fill="#ffd7e6" opacity="0.72" />
        </g>
      </g>
    </svg>
  `;

  const body = shell.querySelector<SVGGElement>("[data-part='body']");
  const tears = shell.querySelector<SVGGElement>("[data-part='tears']");
  const eyes = shell.querySelector<SVGGElement>("[data-part='eyes']");
  const leftEye = shell.querySelector<SVGRectElement>("[data-eye='left']");
  const rightEye = shell.querySelector<SVGRectElement>("[data-eye='right']");
  const leftTearStream = shell.querySelector<SVGPathElement>("[data-tear-stream='left']");
  const rightTearStream = shell.querySelector<SVGPathElement>("[data-tear-stream='right']");
  const leftTearRipple = shell.querySelector<SVGPathElement>("[data-tear-ripple='left']");
  const rightTearRipple = shell.querySelector<SVGPathElement>("[data-tear-ripple='right']");
  const tearRipplePattern = shell.querySelector<SVGPatternElement>("#tear-ripple-pattern");
  const leftCryEye = shell.querySelector<SVGPathElement>("[data-cry-eye='left']");
  const rightCryEye = shell.querySelector<SVGPathElement>("[data-cry-eye='right']");
  const spark = shell.querySelector<SVGCircleElement>("[data-part='spark']");
  const fillStops = [...shell.querySelectorAll<SVGStopElement>("[data-fill-stop]")];
  const rimStops = [...shell.querySelectorAll<SVGStopElement>("[data-rim-stop]")];

  if (
    !body ||
    !tears ||
    !eyes ||
    !leftEye ||
    !rightEye ||
    !leftTearStream ||
    !rightTearStream ||
    !leftTearRipple ||
    !rightTearRipple ||
    !tearRipplePattern ||
    !leftCryEye ||
    !rightCryEye ||
    !spark ||
    fillStops.length !== 3 ||
    rimStops.length !== 3
  ) {
    throw new Error("Robot view failed to initialize");
  }

  const springs = Object.fromEntries(
    animatedKeys.map((key) => [key, { value: initialPose[key], velocity: 0 }]),
  ) as Record<AnimatedKey, SpringValue>;
  let tearRippleOffset = 0;
  let lastExpression: GazePose["expression"] | null = null;
  let lastBlinkClosure = Number.NaN;
  let lastGroundedMotion = false;
  let restingFrameDrawn = false;

  const isResting = (target: GazePose): boolean =>
    animatedKeys.every(
      (key) =>
        Math.abs(target[key] - springs[key].value) < SETTLE_EPSILON &&
        Math.abs(springs[key].velocity) < SETTLE_EPSILON,
    );

  const render = (
    target: GazePose,
    blinkClosure: number,
    deltaSeconds: number,
    groundedMotion = false,
  ): void => {
    for (const key of animatedKeys) {
      const physicalTilt =
        key === "bodyTilt" &&
        (target.expression === "grabbed" || Math.abs(springs.bodyTilt.value) > 0.2);
      const grabbedDeformation =
        target.expression === "grabbed" && (key === "bodyScaleX" || key === "bodyScaleY");
      const playDeformation =
        groundedMotion && target.expression !== "grabbed" && (key === "bodyScaleX" || key === "bodyScaleY");
      springs[key] = stepSpring(
        springs[key],
        target[key],
        Math.min(deltaSeconds, 1 / 30),
        physicalTilt ? 88 : grabbedDeformation ? 118 : playDeformation ? 260 : 185,
        physicalTilt ? 9.5 : grabbedDeformation ? 14 : playDeformation ? 18 : 19,
      );
    }

    // Skip DOM writes once the pose has settled; every write makes WebKit
    // repaint the SVG, which allocates transient memory per frame.
    const unchanged =
      target.expression !== "grabbed" &&
      target.expression === lastExpression &&
      blinkClosure === lastBlinkClosure &&
      groundedMotion === lastGroundedMotion &&
      isResting(target);
    lastExpression = target.expression;
    lastBlinkClosure = blinkClosure;
    lastGroundedMotion = groundedMotion;
    if (unchanged && restingFrameDrawn) return;
    restingFrameDrawn = unchanged;

    if (target.expression === "grabbed") {
      tearRippleOffset = (tearRippleOffset + Math.min(deltaSeconds, 1 / 30) * 30) % 18;
      tearRipplePattern.setAttribute(
        "patternTransform",
        `translate(0 ${tearRippleOffset.toFixed(3)})`,
      );
    }

    const pose = Object.fromEntries(animatedKeys.map((key) => [key, round(springs[key].value)])) as Record<
      AnimatedKey,
      number
    >;
    const blinkScale = round(Math.max(0.055, 1 - blinkClosure * 0.945));
    if (shell.dataset.expression !== target.expression) shell.dataset.expression = target.expression;

    const bodyPivotY = target.expression === "grabbed" ? 43 : groundedMotion ? 166 : 100;
    setAttr(
      body,
      "transform",
      `translate(100 ${bodyPivotY}) rotate(${pose.bodyTilt}) scale(${pose.bodyScaleX} ${pose.bodyScaleY}) translate(-100 ${-bodyPivotY})`,
    );
    const faceTransform = `translate(${pose.offsetX} ${pose.offsetY})`;
    setAttr(tears, "transform", faceTransform);
    setAttr(eyes, "transform", faceTransform);

    const baseLeftCenter = 100 - pose.eyeGap / 2;
    const baseRightCenter = 100 + pose.eyeGap / 2;
    const eyeCenterY = 99.5;
    const eyeRadius = (Math.min(pose.eyeWidth, pose.eyeHeight) * pose.eyeRoundness) / 2;
    for (const [eye, cryEye, tearStream, tearRipple, streamDirection, center, sizeScale] of [
      [leftEye, leftCryEye, leftTearStream, leftTearRipple, -1, baseLeftCenter, pose.leftEyeScale],
      [rightEye, rightCryEye, rightTearStream, rightTearRipple, 1, baseRightCenter, pose.rightEyeScale],
    ] as const) {
      const width = pose.eyeWidth * sizeScale;
      const height = pose.eyeHeight * sizeScale;
      const x = center - width / 2;
      const y = eyeCenterY - height / 2;
      const radius = Math.min(eyeRadius * sizeScale, width / 2, height / 2);
      setAttr(eye, "x", String(round(x)));
      setAttr(eye, "y", String(round(y)));
      setAttr(eye, "width", String(round(width)));
      setAttr(eye, "height", String(round(height)));
      setAttr(eye, "rx", String(round(radius)));
      // Cry eyes and tears are only visible while grabbed.
      if (target.expression !== "grabbed") continue;
      const cryHalfWidth = width * 0.48;
      const cryBaseline = eyeCenterY + 3.5;
      const cryRise = Math.max(7.5, width * 0.24);
      cryEye.setAttribute(
        "d",
        `M ${center - cryHalfWidth} ${cryBaseline} Q ${center} ${cryBaseline + cryRise * 2} ${center + cryHalfWidth} ${cryBaseline}`,
      );
      cryEye.setAttribute("stroke-width", String(Math.max(5.5, width * 0.18)));

      const streamTop = cryBaseline + cryRise * 0.78;
      const streamLength = Math.max(62, height * 2.58);
      const streamWidth = Math.max(14, width * 0.78);
      const streamTopWidth = Math.max(8, width * 0.42);
      const streamBottom = streamTop + streamLength;
      const drift = streamDirection * width * 0.13;
      const streamHalfWidth = streamWidth * 0.44;
      const edgeWave = streamWidth * 0.055;
      const upperCenter = center + drift * 0.32;
      const lowerCenter = center + drift * 0.68;
      const bottomCenter = center + drift;
      const tearPath = `M ${center - streamTopWidth / 2} ${streamTop}
         C ${center - streamHalfWidth * 0.82} ${streamTop + streamLength * 0.1}, ${upperCenter - streamHalfWidth - edgeWave} ${streamTop + streamLength * 0.22}, ${upperCenter - streamHalfWidth} ${streamTop + streamLength * 0.36}
         C ${upperCenter - streamHalfWidth + edgeWave} ${streamTop + streamLength * 0.47}, ${lowerCenter - streamHalfWidth + edgeWave} ${streamTop + streamLength * 0.57}, ${lowerCenter - streamHalfWidth} ${streamTop + streamLength * 0.68}
         C ${lowerCenter - streamHalfWidth - edgeWave} ${streamTop + streamLength * 0.79}, ${bottomCenter - streamHalfWidth * 0.92 - edgeWave} ${streamTop + streamLength * 0.89}, ${bottomCenter - streamHalfWidth * 0.88} ${streamBottom - 2}
         Q ${bottomCenter} ${streamBottom + 2.5}, ${bottomCenter + streamHalfWidth * 0.88} ${streamBottom - 2}
         C ${bottomCenter + streamHalfWidth * 0.92 + edgeWave} ${streamTop + streamLength * 0.89}, ${lowerCenter + streamHalfWidth + edgeWave} ${streamTop + streamLength * 0.79}, ${lowerCenter + streamHalfWidth} ${streamTop + streamLength * 0.68}
         C ${lowerCenter + streamHalfWidth - edgeWave} ${streamTop + streamLength * 0.57}, ${upperCenter + streamHalfWidth - edgeWave} ${streamTop + streamLength * 0.47}, ${upperCenter + streamHalfWidth} ${streamTop + streamLength * 0.36}
         C ${upperCenter + streamHalfWidth + edgeWave} ${streamTop + streamLength * 0.22}, ${center + streamHalfWidth * 0.82} ${streamTop + streamLength * 0.1}, ${center + streamTopWidth / 2} ${streamTop}
         Q ${center} ${cryBaseline + cryRise * 1.18} ${center - streamTopWidth / 2} ${streamTop}
         Z`;
      tearStream.setAttribute("d", tearPath);
      tearRipple.setAttribute("d", tearPath);
    }
    setAttr(
      leftEye,
      "transform",
      `translate(${baseLeftCenter} ${eyeCenterY}) rotate(${pose.eyeRotation - pose.asymmetry}) scale(${pose.eyeScaleX} ${pose.eyeScaleY * blinkScale}) translate(${-baseLeftCenter} ${-eyeCenterY})`,
    );
    setAttr(
      rightEye,
      "transform",
      `translate(${baseRightCenter} ${eyeCenterY}) rotate(${pose.eyeRotation + pose.asymmetry}) scale(${pose.eyeScaleX} ${pose.eyeScaleY * blinkScale}) translate(${-baseRightCenter} ${-eyeCenterY})`,
    );

    setAttr(spark, "r", String(round(2.3 + pose.excitement * 3.5)));
    setAttr(spark, "opacity", String(round(0.12 + pose.excitement * 0.88)));
    const energy = pose.excitement.toFixed(3);
    if (shell.style.getPropertyValue("--energy") !== energy) shell.style.setProperty("--energy", energy);
  };

  return {
    element: shell,
    render,
    setColor: (palette: PetPalette) => {
      fillStops.forEach((stop, index) => stop.setAttribute("stop-color", palette.fill[index]));
      rimStops.forEach((stop, index) => stop.setAttribute("stop-color", palette.rim[index]));
      shell.style.setProperty("--accent-rgb", palette.accentRgb);
      shell.style.setProperty("--spark-color", palette.spark);
      shell.dataset.color = palette.id;
    },
    setInteractive: (interactive: boolean) => shell.classList.toggle("is-interactive", interactive),
    setSize: (size: number) => shell.style.setProperty("--pet-size", `${size}px`),
    setVariant: (variant: PetVariant) => {
      shell.dataset.variant = variant;
      shell.setAttribute("aria-label", variant === "bow" ? "可拖动的蝴蝶结圆形机器人桌宠" : "可拖动的圆形机器人桌宠");
    },
  };
};

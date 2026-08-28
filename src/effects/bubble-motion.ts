export interface BubbleMotion {
  startX: number;
  startY: number;
  midX: number;
  midY: number;
  lateX: number;
  lateY: number;
  driftX: number;
  riseY: number;
  size: number;
  durationMs: number;
}

const between = (minimum: number, maximum: number, random: () => number): number =>
  minimum + (maximum - minimum) * random();

export const createBubbleMotion = (random: () => number = Math.random): BubbleMotion => {
  const driftX = between(34, 110, random);
  const riseY = between(-205, -130, random);

  return {
    startX: between(-10, 12, random),
    startY: between(-8, 2, random),
    midX: driftX * 0.4 + between(-18, 18, random),
    midY: riseY * 0.42 + between(-10, 10, random),
    lateX: driftX * 0.76 + between(-14, 14, random),
    lateY: riseY * 0.76 + between(-8, 8, random),
    driftX,
    riseY,
    size: between(7, 16, random),
    durationMs: between(1250, 2100, random),
  };
};

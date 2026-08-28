export interface SpringValue {
  value: number;
  velocity: number;
}

export const stepSpring = (
  state: SpringValue,
  target: number,
  deltaSeconds: number,
  stiffness = 185,
  damping = 19,
): SpringValue => {
  const acceleration = (target - state.value) * stiffness - state.velocity * damping;
  const velocity = state.velocity + acceleration * deltaSeconds;
  return {
    value: state.value + velocity * deltaSeconds,
    velocity,
  };
};

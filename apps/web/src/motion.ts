export const motionDurations = {
  fast: 0.16,
  base: 0.26,
  route: 0.24,
  settle: 0.72,
} as const;

export function durationFor(reducedMotion: boolean, duration: number): number {
  return reducedMotion ? 0 : duration;
}

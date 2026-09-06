/**
 * @module
 * @internal
 */
/** Limits an output value to 0–255 without rounding or changing NaN. */
export function clampOutputValue (value: number): number {
  return Math.min(255, Math.max(0, value))
}

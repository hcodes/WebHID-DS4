/**
 * @module
 * @internal
 */
export function normalizeThumbstick (input : number, deadZone = 0) {
  const rel = (input - 128) / (input < 128 ? 128 : 127)
  if (Math.abs(rel) <= deadZone) return 0
  return Math.min(1, Math.max(-1, rel))
}

export function normalizeTrigger (input : number, deadZone = 0) {
  const rel = input / 255
  if (rel <= deadZone) return 0
  return Math.min(1, Math.max(0, rel))
}

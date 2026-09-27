/** Normalize a raw HID volume byte; hardware loudness is not a linear percentage. @internal */
export function normalizeHardwareVolume (value: number): number {
  if (!Number.isFinite(value)) throw new RangeError('Hardware volume must be a finite number.')
  return Math.round(Math.min(255, Math.max(0, value)))
}

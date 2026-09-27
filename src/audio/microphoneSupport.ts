import type { DualShock4AudioConnection } from './headphoneSupport'
import { isControllerAudioLabel } from './isControllerAudioLabel'

export type DualShock4MicrophoneSupportReason =
  | 'ready' | 'controller-disconnected' | 'insecure-context' | 'api-unavailable'
  | 'v1-usb-audio-unavailable' | 'bluetooth-audio-unavailable'
  | 'selection-required' | 'capture-required' | 'permission-or-device-unavailable'
  | 'permission-denied' | 'input-unavailable' | 'enumeration-failed' | 'capture-failed'

export interface DualShock4MicrophoneSupport {
  /** True only while the selected input has a live capture track and remains enumerated.
   * Null means capture support has not been established. This does not prove audible input. */
  supported: boolean | null
  reason: DualShock4MicrophoneSupportReason
  /** Label-matched candidates plus the selected input; labels cannot prove HID identity. */
  inputs: MediaDeviceInfo[]
  connection: DualShock4AudioConnection
  /** Model-based recommendation, not proof that an OS audio input exists. */
  requiresAdapter: boolean | null
}

/** @internal */
export function microphoneApiProblem (): 'insecure-context' | 'api-unavailable' | null {
  if (typeof isSecureContext === 'undefined' || !isSecureContext) return 'insecure-context'
  if (typeof navigator === 'undefined' || typeof navigator.mediaDevices?.enumerateDevices !== 'function' ||
      typeof navigator.mediaDevices?.getUserMedia !== 'function') return 'api-unavailable'
  return null
}

/** @internal */
export function isConcreteInput (device: MediaDeviceInfo): boolean {
  return device.kind === 'audioinput' && !!device.deviceId && !['default', 'communications'].includes(device.deviceId)
}

/** Labels are discovery hints only; the user establishes the HID-to-audio association. @internal */
export function isControllerInput (device: MediaDeviceInfo): boolean {
  return isConcreteInput(device) && isControllerAudioLabel(device.label)
}

/** @internal */
export function microphoneErrorReason (error: unknown): DualShock4MicrophoneSupportReason {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return 'permission-denied'
    if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') return 'input-unavailable'
  }
  return 'capture-failed'
}

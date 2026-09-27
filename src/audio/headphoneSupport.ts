import {
  SONY_VENDOR_ID,
  DUALSHOCK4_V1_PRODUCT_ID,
  DUALSHOCK4_V2_PRODUCT_ID,
  DUALSHOCK4_WIRELESS_ADAPTER_PRODUCT_ID
} from '../consts'
import { isControllerAudioLabel } from './isControllerAudioLabel'
/** How the HID controller is connected; the Sony adapter is a distinct headphone-audio path. */
export type DualShock4AudioConnection = 'usb' | 'bluetooth' | 'sony-adapter' | 'unknown'

/** Why page audio is ready, unavailable, or still unverified. */
export type DualShock4HeadphonesSupportReason =
  | 'ready' | 'controller-disconnected' | 'insecure-context' | 'api-unavailable'
  | 'v1-usb-audio-unavailable' | 'bluetooth-audio-unavailable'
  | 'selection-required' | 'permission-or-device-unavailable'
  | 'permission-denied' | 'output-unavailable' | 'enumeration-failed' | 'routing-failed'

export interface DualShock4HeadphonesSupport {
  /** True only for an explicitly selected, successfully routed and still enumerated output.
   * Null means the available evidence cannot establish support. */
  supported: boolean | null
  reason: DualShock4HeadphonesSupportReason
  /** Label-matched candidates plus the explicitly selected output. Labels do not prove HID identity. */
  outputs: MediaDeviceInfo[]
  connection: DualShock4AudioConnection
  /** Model-based adapter recommendation. False means no adapter prerequisite is imposed by this library,
   * not proof that the OS exposes audio. Alternative drivers may provide their own audio path. */
  requiresAdapter: boolean | null
}

/** @internal */
export interface AudioControllerState {
  device?: HIDDevice
  transport: string
  disconnecting: boolean
}

/** Browser extension not yet included in all TypeScript DOM declarations. @internal */
export interface RoutedAudioContext extends AudioContext {
  setSinkId: (deviceId: string) => Promise<void>
}

/** @internal */
export function connectionInfo ({ device, transport }: AudioControllerState): Pick<DualShock4HeadphonesSupport, 'connection' | 'requiresAdapter'> {
  if (!device?.opened) return { connection: 'unknown', requiresAdapter: null }
  const sony = device.vendorId === SONY_VENDOR_ID
  if (sony && device.productId === DUALSHOCK4_WIRELESS_ADAPTER_PRODUCT_ID) return { connection: 'sony-adapter', requiresAdapter: false }
  const connection = transport === 'usb' ? 'usb' : transport === 'bt' ? 'bluetooth' : 'unknown'
  let requiresAdapter: boolean | null = null
  if (sony && device.productId === DUALSHOCK4_V2_PRODUCT_ID && connection !== 'unknown') {
    requiresAdapter = connection === 'bluetooth'
  }
  if (sony && device.productId === DUALSHOCK4_V1_PRODUCT_ID && connection !== 'unknown') requiresAdapter = true
  return { connection, requiresAdapter }
}

/** @internal */
export function audioApiProblem (): 'insecure-context' | 'api-unavailable' | null {
  if (typeof isSecureContext === 'undefined' || !isSecureContext) return 'insecure-context'
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices ||
      typeof AudioContext === 'undefined' || typeof (AudioContext.prototype as Partial<RoutedAudioContext>).setSinkId !== 'function') return 'api-unavailable'
  return null
}

/** Excludes movable system aliases, so a route cannot silently follow the default speakers. @internal */
export function isConcreteOutput (device: MediaDeviceInfo): boolean {
  return device.kind === 'audiooutput' && !!device.deviceId && !['default', 'communications'].includes(device.deviceId)
}

/** Uses the same controller-name hints as microphone discovery. @internal */
export function isControllerOutput (device: MediaDeviceInfo): boolean {
  return isConcreteOutput(device) && isControllerAudioLabel(device.label)
}

/** @internal */
export function audioErrorReason (error: unknown): DualShock4HeadphonesSupportReason {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') return 'permission-denied'
    if (error.name === 'NotFoundError') return 'output-unavailable'
  }
  return 'routing-failed'
}

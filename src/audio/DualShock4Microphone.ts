import { abortable } from '../utils/abortable'
import { normalizeHardwareVolume } from './normalizeHardwareVolume'
import { connectionInfo, type AudioControllerState } from './headphoneSupport'
import {
  isConcreteInput, isControllerInput, microphoneApiProblem, microphoneErrorReason,
  type DualShock4MicrophoneSupport, type DualShock4MicrophoneSupportReason
} from './microphoneSupport'

/** Control headset microphone hardware gain and capture an explicitly selected OS audio input.
 * The endpoint owns its capture tracks and stops them on stop/reset/controller disconnection.
 * Listen for `change`, then read {@link stream} and call {@link checkSupport} again.
 */
export class DualShock4Microphone extends EventTarget {
  private selectedId: string | null = null
  private captureStream: MediaStream | null = null
  private captureTracks: MediaStreamTrack[] = []
  private failure?: DualShock4MicrophoneSupportReason
  private operation = new AbortController()
  private mediaDevices?: MediaDevices
  private deviceChangeVersion = 0
  private requestedVolume: number | null = null
  private volumeRequests = new AbortController()

  /** @internal */
  constructor (
    private readonly getController: () => AudioControllerState,
    private readonly requestVolumeUpdate?: () => Promise<void>
  ) { super() }

  /** Last requested microphone HID gain byte (0-255), or null before configuration/after reset.
   * This is a local cache, not hardware readback or browser capture volume.
   */
  get volume (): number | null { return this.requestedVolume }

  set volume (value: number) {
    void this.setVolume(value).catch(error => console.error(error))
  }

  /** Set raw headset microphone gain independently of browser capture/permissions.
   * Finite values are clamped to 0-255 and rounded.
   * Resolves when the HID report is sent; rejects on output failure or reset.
   */
  async setVolume (value: number): Promise<void> {
    const volume = normalizeHardwareVolume(value)
    if (!this.requestVolumeUpdate) throw new DOMException('Hardware volume control requires a controller output callback.', 'NotSupportedError')
    this.requestedVolume = volume
    const signal = this.volumeRequests.signal
    return abortable(this.requestVolumeUpdate(), signal)
  }

  /** Explicitly selected concrete input, or null before selection/after invalidation. */
  get inputDeviceId (): string | null { return this.selectedId }

  /** Current capture, owned by this endpoint. Null when stopped. No recording or playback is automatic. */
  get stream (): MediaStream | null { return this.captureStream }

  /** Passive check: never requests permission or starts capture. A label match is not verification. */
  async checkSupport (): Promise<DualShock4MicrophoneSupport> {
    const controller = this.getController()
    const info = connectionInfo(controller)
    const result = (supported: boolean | null, reason: DualShock4MicrophoneSupportReason, inputs: MediaDeviceInfo[] = []): DualShock4MicrophoneSupport =>
      ({ ...info, supported, reason, inputs })
    if (!controller.device?.opened || controller.disconnecting) return result(false, 'controller-disconnected')
    const problem = microphoneApiProblem()
    if (problem) return result(false, problem)
    const signal = this.operation.signal
    let devices: MediaDeviceInfo[]
    try {
      devices = await abortable(navigator.mediaDevices.enumerateDevices(), signal)
    } catch (error) {
      if (signal.aborted) return this.checkSupport()
      return result(null, microphoneErrorReason(error) === 'permission-denied' ? 'permission-denied' : 'enumeration-failed')
    }
    if (signal.aborted) return this.checkSupport()
    const inputs = devices.filter(device => isControllerInput(device) || (isConcreteInput(device) && device.deviceId === this.selectedId))
    if (this.selectedId && !inputs.some(device => device.deviceId === this.selectedId)) {
      this.invalidate('input-unavailable')
    }
    if (this.captureStream && !this.captureTracks.some(track => track.kind === 'audio' && track.readyState === 'live')) {
      this.invalidate('input-unavailable')
    }
    if (this.captureStream) return { ...result(true, 'ready', inputs), requiresAdapter: false }
    if (this.failure) return result(null, this.failure, inputs)
    if (this.selectedId) return result(null, 'capture-required', inputs)
    if (info.requiresAdapter && info.connection === 'usb') return result(false, 'v1-usb-audio-unavailable', inputs)
    if (info.requiresAdapter && info.connection === 'bluetooth') return result(false, 'bluetooth-audio-unavailable', inputs)
    return result(null, inputs.length ? 'selection-required' : 'permission-or-device-unavailable', inputs)
  }

  /** Call from an access button. Briefly requests the browser's default microphone to reveal inputs,
   * immediately stops all temporary tracks, and returns concrete inputs for manual selection.
   * Cancels previous pending work/capture, preserving the selected input. Does not retain a stream.
   */
  async requestInput (): Promise<MediaDeviceInfo[]> {
    this.requireAvailable()
    this.cancelCapture()
    this.observeDevices()
    this.failure = undefined
    const signal = this.operation.signal
    try {
      // Cleanup belongs to the browser promise so late permission responses are also released.
      await abortable(navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
        stream.getTracks().forEach(track => track.stop())
      }), signal)
      const inputs = (await abortable(navigator.mediaDevices.enumerateDevices(), signal)).filter(isConcreteInput)
      signal.throwIfAborted()
      this.failure = inputs.length ? undefined : 'input-unavailable'
      this.changed()
      return inputs
    } catch (error) {
      this.reportFailure(error, signal)
      throw error
    }
  }

  /** Select a concrete input without capture or a permission prompt. The caller establishes identity.
   * Stops any current capture. Invalid selection clears the old input; system aliases are rejected.
   */
  async setInput (deviceId: string): Promise<void> {
    this.requireAvailable()
    this.cancelCapture()
    this.observeDevices()
    this.selectedId = null
    this.failure = undefined
    const signal = this.operation.signal
    try {
      if (!deviceId || ['default', 'communications'].includes(deviceId)) {
        throw new DOMException('Select a concrete audio input, not a system default alias.', 'NotSupportedError')
      }
      const devices = await abortable(navigator.mediaDevices.enumerateDevices(), signal)
      signal.throwIfAborted()
      if (!devices.some(device => isConcreteInput(device) && device.deviceId === deviceId)) {
        throw new DOMException('The selected microphone is unavailable or permission has not been granted.', 'NotFoundError')
      }
      this.selectedId = deviceId
      this.changed()
    } catch (error) {
      this.reportFailure(error, signal)
      throw error
    }
  }

  /** Call from a start button. Capture the selected input using an exact deviceId constraint.
   * Returns one live audio track for WebRTC, Web Audio or MediaRecorder. Replaces previous capture.
   * The endpoint owns the returned tracks: stop/reset/disconnect stops them, even if used elsewhere.
   */
  async start (): Promise<MediaStream> {
    this.requireAvailable()
    if (!this.selectedId) throw new DOMException('Select a microphone before starting capture.', 'InvalidStateError')
    this.cancelCapture()
    this.observeDevices()
    this.failure = undefined
    const signal = this.operation.signal
    const deviceId = this.selectedId
    let acquired: MediaStream | undefined
    try {
      const stream = await abortable(navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId } } }).then(stream => {
        if (signal.aborted) stream.getTracks().forEach(track => track.stop())
        else acquired = stream
        return stream
      }), signal)
      signal.throwIfAborted()
      const tracks = stream.getAudioTracks()
      if (tracks.length !== 1 || tracks[0].readyState !== 'live' || tracks[0].getSettings().deviceId !== deviceId) {
        throw new DOMException('The browser did not return a live track from the selected microphone.', 'NotReadableError')
      }
      const devices = await abortable(navigator.mediaDevices.enumerateDevices(), signal)
      signal.throwIfAborted()
      if (!devices.some(device => isConcreteInput(device) && device.deviceId === deviceId)) {
        throw new DOMException('The selected microphone was disconnected during capture setup.', 'NotFoundError')
      }
      if (tracks[0].readyState !== 'live') throw new DOMException('The microphone track ended during capture setup.', 'NotReadableError')
      this.captureStream = stream
      this.captureTracks = stream.getTracks()
      tracks[0].addEventListener('ended', this.onTrackEnded)
      this.changed()
      signal.throwIfAborted()
      return stream
    } catch (error) {
      acquired?.getTracks().forEach(track => track.stop())
      this.reportFailure(error, signal)
      throw error
    }
  }

  /** Stop owned tracks and cancel pending permission/capture/selection, preserving the selected input. */
  stop (): void {
    this.cancelCapture()
    this.failure = undefined
    this.changed()
  }

  /** Stop capture, clear input/gain cache, cancel pending work and release device listeners. */
  reset (): void {
    this.volumeRequests.abort(new DOMException('Audio volume update cancelled by reset.', 'AbortError'))
    this.volumeRequests = new AbortController()
    this.requestedVolume = null
    this.cancelCapture()
    this.selectedId = null
    this.failure = undefined
    this.deviceChangeVersion++
    this.mediaDevices?.removeEventListener('devicechange', this.onDeviceChange)
    this.mediaDevices = undefined
    this.changed()
  }

  /** Observe a new HID session without requesting permission. @internal */
  attach (): void { this.reset(); this.observeDevices() }

  private cancelCapture () {
    this.operation.abort(new DOMException('Microphone operation cancelled.', 'AbortError'))
    this.operation = new AbortController()
    this.captureStream = null
    for (const track of this.captureTracks) {
      track.removeEventListener('ended', this.onTrackEnded)
      track.stop()
    }
    this.captureTracks = []
  }

  private invalidate (reason: DualShock4MicrophoneSupportReason) {
    this.cancelCapture()
    this.selectedId = null
    this.failure = reason
    this.changed()
  }

  private readonly onTrackEnded = () => { this.invalidate('input-unavailable') }

  private observeDevices () {
    if (this.mediaDevices) return
    this.mediaDevices = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices
    this.mediaDevices?.addEventListener('devicechange', this.onDeviceChange)
  }

  private readonly onDeviceChange = () => {
    const version = ++this.deviceChangeVersion
    const signal = this.operation.signal
    const devices = this.mediaDevices
    if (!devices) return
    void devices.enumerateDevices().then(inputs => {
      if (signal.aborted || version !== this.deviceChangeVersion) return
      if (this.selectedId && !inputs.some(device => isConcreteInput(device) && device.deviceId === this.selectedId)) {
        this.invalidate('input-unavailable')
      } else this.changed()
    }).catch(() => {
      if (signal.aborted || version !== this.deviceChangeVersion) return
      this.invalidate('enumeration-failed')
    })
  }

  private reportFailure (error: unknown, signal: AbortSignal) {
    if (!signal.aborted) { this.failure = microphoneErrorReason(error); this.changed() }
  }

  private changed () { this.dispatchEvent(new Event('change')) }

  private requireAvailable () {
    const { device, disconnecting } = this.getController()
    if (!device?.opened || disconnecting) throw new DOMException('Connect the controller before using the microphone.', 'InvalidStateError')
    const problem = microphoneApiProblem()
    if (problem) throw new DOMException(`Microphone unavailable: ${problem}.`, 'NotSupportedError')
  }
}

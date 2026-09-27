import { abortable } from '../utils/abortable'
import { normalizeHardwareVolume } from './normalizeHardwareVolume'
import {
  audioApiProblem, audioErrorReason, connectionInfo, isConcreteOutput, isControllerOutput,
  type AudioControllerState, type DualShock4HeadphonesSupport, type DualShock4HeadphonesSupportReason, type RoutedAudioContext
} from './headphoneSupport'

// selectAudioOutput is not yet declared by every supported TypeScript DOM library.
type OutputMediaDevices = MediaDevices & { selectAudioOutput?: () => Promise<MediaDeviceInfo> }

/** Optional page-audio routing and playback. Listen for `change`, then call {@link checkSupport} again.
 * Browser audio labels cannot establish which HID controller owns an output. Selection is explicit.
 */
export class DualShock4Headphones extends EventTarget {
  private context?: AudioContext
  private source?: MediaStreamAudioSourceNode
  private selectedId: string | null = null
  private failure?: DualShock4HeadphonesSupportReason
  private operation = new AbortController()
  private playback = new AbortController()
  private mediaDevices?: MediaDevices
  private deviceChangeVersion = 0
  private leftVolume: number | null = null
  private rightVolume: number | null = null
  private volumeRequests = new AbortController()

  /** @internal */
  constructor (
    private readonly getController: () => AudioControllerState,
    private readonly requestVolumeUpdate?: () => Promise<void>
  ) { super() }

  /** Last requested left-channel HID volume (0-255), or null before configuration/after reset.
   * This is a local cache, not a hardware readback or acknowledgement.
   */
  get volumeLeft (): number | null { return this.leftVolume }

  set volumeLeft (value: number) {
    void this.setChannelVolume('left', value).catch(error => console.error(error))
  }

  /** Last requested right-channel HID volume (0-255), or null before configuration/after reset. */
  get volumeRight (): number | null { return this.rightVolume }

  set volumeRight (value: number) {
    void this.setChannelVolume('right', value).catch(error => console.error(error))
  }

  /** Set raw headphone HID volume bytes, independently of browser routing/playback.
   * Right defaults to left. Finite values are clamped to 0-255 and rounded.
   * Resolves when the HID report is sent; rejects on output failure or reset.
   */
  async setVolume (left: number, right = left): Promise<void> {
    const volumeLeft = normalizeHardwareVolume(left)
    const volumeRight = normalizeHardwareVolume(right)
    const update = this.requireVolumeControl()
    this.leftVolume = volumeLeft
    this.rightVolume = volumeRight
    const signal = this.volumeRequests.signal
    return abortable(update(), signal)
  }

  private async setChannelVolume (channel: 'left' | 'right', value: number): Promise<void> {
    const volume = normalizeHardwareVolume(value)
    const update = this.requireVolumeControl()
    if (channel === 'left') this.leftVolume = volume
    else this.rightVolume = volume
    const signal = this.volumeRequests.signal
    return abortable(update(), signal)
  }

  private requireVolumeControl (): () => Promise<void> {
    if (!this.requestVolumeUpdate) throw new DOMException('Hardware volume control requires a controller output callback.', 'NotSupportedError')
    return this.requestVolumeUpdate
  }

  /** Explicitly selected output, or null before successful routing/after invalidation. */
  get outputDeviceId (): string | null { return this.selectedId }

  /** Passive check: never requests permission, creates an AudioContext, or plays sound.
   * A hidden/incomplete device list yields null, not a false hardware diagnosis.
   * True establishes routing, not inserted headphones or audible sound.
   */
  async checkSupport (): Promise<DualShock4HeadphonesSupport> {
    const controller = this.getController()
    const info = connectionInfo(controller)
    const result = (supported: boolean | null, reason: DualShock4HeadphonesSupportReason, outputs: MediaDeviceInfo[] = []): DualShock4HeadphonesSupport =>
      ({ ...info, supported, reason, outputs })
    if (!controller.device?.opened || controller.disconnecting) return result(false, 'controller-disconnected')
    const problem = audioApiProblem()
    if (problem) return result(false, problem)
    const signal = this.operation.signal
    let devices: MediaDeviceInfo[]
    try {
      devices = await abortable(navigator.mediaDevices.enumerateDevices(), signal)
    } catch (error) {
      if (signal.aborted) return this.checkSupport()
      return result(null, audioErrorReason(error) === 'permission-denied' ? 'permission-denied' : 'enumeration-failed')
    }
    if (signal.aborted) return this.checkSupport()
    const outputs = devices.filter(device => isControllerOutput(device) || (isConcreteOutput(device) && device.deviceId === this.selectedId))
    if (this.selectedId) {
      if (outputs.some(device => device.deviceId === this.selectedId) && this.context?.state !== 'closed') {
        return { ...result(true, 'ready', outputs), requiresAdapter: false }
      }
      this.clearRoute()
      this.failure = 'output-unavailable'
      this.changed()
    }
    if (this.failure) return result(null, this.failure, outputs)
    if (info.requiresAdapter && info.connection === 'usb') return result(false, 'v1-usb-audio-unavailable', outputs)
    if (info.requiresAdapter && info.connection === 'bluetooth') return result(false, 'bluetooth-audio-unavailable', outputs)
    return result(null, outputs.length ? 'selection-required' : 'permission-or-device-unavailable', outputs)
  }

  /** Call from a click. Uses the native output picker when available. Otherwise requests microphone
   * permission to expose audio devices and immediately stops every capture track.
   * Returns concrete outputs for user selection; it does not start playback or select a route.
   */
  async requestOutput (): Promise<MediaDeviceInfo[]> {
    this.requireController()
    this.requireApi()
    const signal = this.operation.signal
    const devices = navigator.mediaDevices as OutputMediaDevices
    try {
      let outputs: MediaDeviceInfo[]
      if (typeof devices.selectAudioOutput === 'function') {
        outputs = [await abortable(devices.selectAudioOutput(), signal)].filter(isConcreteOutput)
      } else {
        if (typeof devices.getUserMedia !== 'function') throw new DOMException('Audio output permission is unavailable.', 'NotSupportedError')
        // Cleanup is attached to the browser promise itself, including when a disconnect aborts our wait.
        await abortable(devices.getUserMedia({ audio: true }).then(stream => {
          stream.getTracks().forEach(track => track.stop())
        }), signal)
        outputs = (await abortable(devices.enumerateDevices(), signal)).filter(isConcreteOutput)
      }
      signal.throwIfAborted()
      this.failure = outputs.length ? undefined : 'output-unavailable'
      this.changed()
      return outputs
    } catch (error) {
      if (!signal.aborted) { this.failure = audioErrorReason(error); this.changed() }
      throw error
    }
  }

  /** Explicitly associate a concrete output with this controller. The caller/user establishes identity.
   * Verifies routing without playing sound. Default/communications aliases are rejected.
   * A failed change stops the old route and leaves playback disabled.
   */
  async setOutput (deviceId: string): Promise<void> {
    this.requireController()
    this.requireApi()
    this.clearRoute()
    this.observeDevices()
    this.failure = undefined
    const signal = this.operation.signal
    let context: RoutedAudioContext | undefined
    try {
      if (!deviceId || ['default', 'communications'].includes(deviceId)) {
        throw new DOMException('Select a concrete audio output, not a system default alias.', 'NotSupportedError')
      }
      const devices = await abortable(navigator.mediaDevices.enumerateDevices(), signal)
      signal.throwIfAborted()
      if (!devices.some(device => isConcreteOutput(device) && device.deviceId === deviceId)) {
        throw new DOMException('The selected audio output is unavailable or permission has not been granted.', 'NotFoundError')
      }
      context = new AudioContext() as RoutedAudioContext
      // No source is connected before routing succeeds, so nothing can play through the default output.
      await abortable(context.setSinkId(deviceId), signal)
      signal.throwIfAborted()
      const currentDevices = await abortable(navigator.mediaDevices.enumerateDevices(), signal)
      signal.throwIfAborted()
      if (!currentDevices.some(device => isConcreteOutput(device) && device.deviceId === deviceId)) {
        throw new DOMException('The selected audio output was disconnected during routing.', 'NotFoundError')
      }
      this.context = context
      this.selectedId = deviceId
      this.changed()
    } catch (error) {
      if (context) void context.close().catch(() => {})
      if (!signal.aborted) { this.failure = audioErrorReason(error); this.changed() }
      throw error
    }
  }

  /** Route a live MediaStream to the selected headphone output, without buffering or decoding a file.
   * Supply one audio track (mono or stereo). Call from a user action for autoplay permission.
   * Resolves when connected, not when the stream ends. Replaces the previous stream.
   * The caller owns the stream and its tracks; stop/reset/disconnect never stop them.
   */
  async play (stream: MediaStream): Promise<void> {
    this.requireController()
    const context = this.requireOutput()
    this.stop()
    const signal = this.playback.signal
    try {
      this.requireAudioTrack(stream)
      // Resume immediately while user activation is still available.
      await abortable(context.resume(), signal)
      signal.throwIfAborted()
      this.requireAudioTrack(stream)
      const source = context.createMediaStreamSource(stream)
      this.source = source
      source.connect(context.destination)
    } catch (error) {
      if (!signal.aborted) this.stop()
      throw error
    }
  }

  /** Disconnect playback and cancel pending resume work, preserving the output and caller-owned tracks. */
  stop (): void {
    this.playback.abort(new DOMException('Audio playback cancelled.', 'AbortError'))
    this.playback = new AbortController()
    if (this.source) {
      this.source.disconnect()
      this.source = undefined
    }
  }

  /** Release playback, routing, pending volume promises and device listeners. A new selection is required. */
  reset (): void {
    this.volumeRequests.abort(new DOMException('Audio volume update cancelled by reset.', 'AbortError'))
    this.volumeRequests = new AbortController()
    this.leftVolume = null
    this.rightVolume = null
    this.clearRoute()
    this.failure = undefined
    this.deviceChangeVersion++
    this.mediaDevices?.removeEventListener('devicechange', this.onDeviceChange)
    this.mediaDevices = undefined
    this.changed()
  }

  /** Start observing a newly opened controller session without requesting audio permission. @internal */
  attach (): void {
    this.reset()
    this.observeDevices()
  }

  private observeDevices () {
    if (this.mediaDevices) return
    this.mediaDevices = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices
    this.mediaDevices?.addEventListener('devicechange', this.onDeviceChange)
  }

  private clearRoute () {
    this.stop()
    this.operation.abort(new DOMException('Audio output selection cancelled.', 'AbortError'))
    this.operation = new AbortController()
    this.selectedId = null
    const context = this.context
    this.context = undefined
    if (context && context.state !== 'closed') void context.close().catch(() => {})
  }

  private readonly onDeviceChange = () => {
    const version = ++this.deviceChangeVersion
    const signal = this.operation.signal
    const devices = this.mediaDevices
    if (!devices) return
    void devices.enumerateDevices().then(outputs => {
      if (signal.aborted || version !== this.deviceChangeVersion) return
      if (this.selectedId && !outputs.some(device => isConcreteOutput(device) && device.deviceId === this.selectedId)) {
        this.clearRoute()
        this.failure = 'output-unavailable'
      }
      this.changed()
    }).catch(() => {
      if (signal.aborted || version !== this.deviceChangeVersion) return
      this.clearRoute()
      this.failure = 'enumeration-failed'
      this.changed()
    })
  }

  private changed () { this.dispatchEvent(new Event('change')) }

  private requireController () {
    const { device, disconnecting } = this.getController()
    if (!device?.opened || disconnecting) throw new DOMException('Connect the controller before using audio.', 'InvalidStateError')
  }

  private requireApi () {
    const problem = audioApiProblem()
    if (problem) throw new DOMException(`Audio unavailable: ${problem}.`, 'NotSupportedError')
  }

  private requireOutput (): AudioContext {
    if (!this.context || !this.selectedId || this.context.state === 'closed') {
      throw new DOMException('Select an audio output before playing sound.', 'InvalidStateError')
    }
    return this.context
  }

  private requireAudioTrack (stream: MediaStream): void {
    const tracks = stream.getAudioTracks()
    if (tracks.length !== 1 || tracks[0].readyState !== 'live') {
      throw new DOMException('Provide a MediaStream with one live audio track (mono or stereo).', 'NotSupportedError')
    }
  }
}

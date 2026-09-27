import { readControllerFirmware } from './firmware/readFirmwareInfo'
import { authenticateController } from './authentication/authenticate'
import { DualShock4Audio } from './audio/DualShock4Audio'
import { ConnectionController, type ConnectionSession } from './controllers/ConnectionController'
import type { DualShock4EventMap, DualShock4DisconnectReason } from './events'
import { bluetoothInputReportId } from './protocol/consts'
import { createDefaultState, DualShock4Interface, type ControllerTransport } from './state'
import DualShock4Lightbar from './effects/DualShock4Lightbar'
import DualShock4Rumble from './effects/DualShock4Rumble'
import type { DualShock4FirmwareInfo } from './firmware/parseFirmwareInfo'
import { OutputController } from './controllers/OutputController'
import { detectInputInterface, getInputStateData, normalizeInputReport, isValidBluetoothInputReport, isMinimalBluetoothReport, updateControllerState } from './protocol/input'

const accessoryEvents = [
  ['headphonesConnected', 'headphonesconnect', 'headphonesdisconnect'],
  ['microphoneConnected', 'microphoneconnect', 'microphonedisconnect'],
  ['externalDeviceConnected', 'externaldeviceconnect', 'externaldevicedisconnect']
] as const

/**
 * Main class.
 */
export class DualShock4 extends EventTarget {
  override addEventListener<K extends keyof DualShock4EventMap> (type: K, callback: (this: DualShock4, event: DualShock4EventMap[K]) => void, options?: boolean | AddEventListenerOptions): void
  override addEventListener (type: string, callback: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void
  override addEventListener (type: string, callback: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void {
    super.addEventListener(type, callback, options)
  }

  override removeEventListener<K extends keyof DualShock4EventMap> (type: K, callback: (this: DualShock4, event: DualShock4EventMap[K]) => void, options?: boolean | EventListenerOptions): void
  override removeEventListener (type: string, callback: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void
  override removeEventListener (type: string, callback: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void {
    super.removeEventListener(type, callback, options)
  }

  private firmwareInfoRequest = 0
  private inputReportSequence = 0
  private accessoryStateKnown = false
  private cloneCheck?: { device: HIDDevice, session?: ConnectionSession, abort: AbortController }

  /** Internal WebHID device */
  get device (): HIDDevice | undefined { return this.connection.device }
  set device (device: HIDDevice | undefined) {
    if (device === this.device) return
    this.cancelCloneCheck()
    this.connection.device = device
    this.clearAccessoryConnections()
    if (device?.opened) this.audio.attach()
    else this.audio.reset()
    if (device) this.output.attach(device, this.connection.session?.signal)
    else this.output.clear(new DOMException('Controller disconnected.', 'AbortError'))
  }

  /** Raw contents of the last HID Report sent by the controller. */
  lastReport ?: ArrayBuffer
  /** Raw contents of the last HID Report sent to the controller. */
  lastSentReport ?: ArrayBuffer

  /** Firmware metadata reported by the connected controller, or `null` when unavailable. */
  firmwareInfo: DualShock4FirmwareInfo | null = null

  /**
   * Sony certificate and random-challenge signature check over USB or Bluetooth.
   * `false` means both signatures verified, `true` means a signature failed.
   * `null` means unknown (pending, unsupported, I/O failure or timeout).
   * Background completion emits `clonecheck` after this field is updated.
   * Copied authentic controller keys cannot be distinguished by this check.
   */
  isClone: boolean | null = null

  /**
   * Whether background authentication is running for the current controller.
   * False before starting, after completion (including an unknown result),
   * and immediately after cancellation. Already false in `clonecheck` listeners.
   */
  get isCloneChecking (): boolean {
    return Boolean(this.cloneCheck && !this.cloneCheck.abort.signal.aborted)
  }

  /** Current controller state */
  state = createDefaultState()

  /** Allows lightbar control */
  lightbar = new DualShock4Lightbar(() => this.requestOutputUpdate())
  /** Allows rumble control */
  rumble = new DualShock4Rumble(() => this.requestOutputUpdate())

  /** Hardware audio levels and optional browser headphone playback/microphone capture. */
  readonly audio: DualShock4Audio = new DualShock4Audio(() => ({
    device: this.device,
    transport: this.state.interface,
    disconnecting: this.connection.isDisconnecting
  }), () => this.requestOutputUpdate())

  private readonly output = new OutputController(
    () => ({
      transport: this.state.interface, rumble: this.rumble, lightbar: this.lightbar,
      audio: {
        headphonesLeft: this.audio.headphones.volumeLeft,
        headphonesRight: this.audio.headphones.volumeRight,
        speaker: this.audio.speaker.volume,
        microphone: this.audio.microphone.volume
      }
    }),
    raw => { this.lastSentReport = raw }
  )

  private readonly connection = new ConnectionController({
    opened: session => this.handleConnectionOpened(session),
    initialize: () => this.readFirmwareInfo(),
    input: report => this.processControllerReport(report),
    connected: device => this.emit('connect', { device }),
    cleared: (device, reason, announced) => this.handleConnectionCleared(device, reason, announced),
    prepareClose: () => this.prepareConnectionClose()
  })

  constructor () {
    super()
    if (!navigator.hid || !navigator.hid.requestDevice) {
      throw new Error('WebHID not supported by browser or not available.')
    }
  }

  /**
   * Requests access to a controller and opens its WebHID session.
   *
   * This function must be called in the context of user interaction
   * (i.e in a click event handler), otherwise it might not work.
   * Firmware reading is bounded by one second; authentication runs in the
   * background and does not delay connection or the `connect` event.
   *
   * @returns `true` when the controller is connected, or `false` when device selection is cancelled.
   */
  connect (): Promise<boolean> {
    return this.connection.connect()
  }

  /**
   * Reads DualShock 4 feature report 0xA3, updates {@link firmwareInfo}, and
   * starts background authentication without waiting for its result.
   *
   * Both USB and Bluetooth controllers use this report. The firmware request
   * times out after one second. A separate authentication exchange using
   * 0xF0/0xF2/0xF1 verifies the Sony certificate and challenge signature, with
   * a total 30-second deadline. Concurrent checks share one exchange. While
   * pending, {@link isCloneChecking} is `true` and {@link isClone} is `null`; completion updates it and emits
   * `clonecheck`. Subscribe before connecting or refreshing to observe results.
   * Unsupported, timed out, or malformed firmware reports return `null`;
   * authentication failures do not prevent compatible controllers connecting.
   */
  async readFirmwareInfo (): Promise<DualShock4FirmwareInfo | null> {
    const device = this.device
    if (!device || !device.opened) {
      throw new Error('Controller not connected. You must call .connect() first!')
    }
    if (this.connection.isDisconnecting) {
      throw new DOMException('Controller disconnecting.', 'InvalidStateError')
    }

    const request = ++this.firmwareInfoRequest
    const session = this.connection.session
    const firmwareInfo = await readControllerFirmware(device, session?.signal)
    if (
      request === this.firmwareInfoRequest && this.connection.session === session &&
      !session?.signal.aborted && device.opened && !this.connection.isDisconnecting
    ) {
      this.firmwareInfo = firmwareInfo
      this.startCloneCheck(device, session)
    }
    return firmwareInfo
  }

  private startCloneCheck (device: HIDDevice, session?: ConnectionSession) {
    if (this.cloneCheck?.device === device && this.cloneCheck.session === session) return
    this.cancelCloneCheck()
    const check = { device, session, abort: new AbortController() }
    this.cloneCheck = check
    const cancel = () => check.abort.abort(session?.signal.reason)
    session?.signal.addEventListener('abort', cancel, { once: true })
    if (session?.signal.aborted) cancel()
    const complete = (isClone: boolean | null) => {
      session?.signal.removeEventListener('abort', cancel)
      if (this.cloneCheck !== check) return
      this.cloneCheck = undefined
      if (
        this.connection.session !== session || this.device !== device ||
        check.abort.signal.aborted || !device.opened || this.connection.isDisconnecting
      ) return
      this.isClone = isClone
      this.emit('clonecheck', { device, isClone })
    }
    void authenticateController(device, check.abort.signal).then(complete, () => complete(null))
  }

  private cancelCloneCheck () {
    const check = this.cloneCheck
    this.cloneCheck = undefined
    check?.abort.abort(new DOMException('Controller authentication cancelled.', 'AbortError'))
    this.isClone = null
  }

  /**
   * Stops rumble and closes the current WebHID session without revoking device
   * permission. Pending output that is waiting for transport detection rejects
   * with an `AbortError`.
   *
   * If the browser fails to close a device that remains open, the active session
   * is restored and the error is rethrown so disconnection can be retried.
   */
  disconnect (): Promise<void> {
    return this.connection.disconnect()
  }

  private emit<K extends keyof DualShock4EventMap> (type: K, detail: DualShock4EventMap[K]['detail']) {
    return this.dispatchEvent(new CustomEvent(type, { detail }))
  }

  private handleConnectionOpened (session: ConnectionSession) {
    this.cancelCloneCheck()
    this.clearAccessoryConnections()
    this.audio.attach()
    this.state.interface = DualShock4Interface.Disconnected
    this.output.attach(session.device, session.signal)
    this.firmwareInfo = null
    this.isClone = null
  }

  private handleConnectionCleared (device: HIDDevice, reason: DualShock4DisconnectReason, announced: boolean) {
    this.cancelCloneCheck()
    this.audio.reset()
    this.firmwareInfoRequest++
    this.output.clear(new DOMException('Controller disconnected.', 'AbortError'))
    this.rumble.reset()
    this.lastReport = undefined
    this.lastSentReport = undefined
    this.firmwareInfo = null
    this.isClone = null
    this.state = createDefaultState()
    this.accessoryStateKnown = false
    if (announced) this.emit('disconnect', { device, reason })
  }

  private prepareConnectionClose () {
    this.cancelCloneCheck()
    this.audio.reset()
    const previousInterface = this.state.interface
    void this.rumble.setRumbleIntensity(0, 0).catch(() => {})
    this.output.cancelPending(new DOMException('Controller disconnected.', 'AbortError'))
    this.state.interface = DualShock4Interface.Disconnected
    return {
      pending: this.output.drain(),
      restore: () => { this.state.interface = previousInterface; this.audio.attach() }
    }
  }

  private clearAccessoryConnections () {
    this.accessoryStateKnown = false
    for (const [key] of accessoryEvents) this.state[key] = false
  }

  /** Routes validated input into state updates and transport initialization. */
  private processControllerReport (report : HIDInputReportEvent) {
    if (report.device !== this.device) return

    const data = normalizeInputReport(report.reportId, report.data, report.device.collections)
    this.lastReport = report.data.buffer.slice(report.data.byteOffset, report.data.byteOffset + report.data.byteLength) as ArrayBuffer

    if (report.reportId === bluetoothInputReportId && !isValidBluetoothInputReport(data)) return

    // Interface is unknown
    if (this.state.interface === DualShock4Interface.Disconnected) {
      const transport = detectInputInterface(report.reportId, data)
      if (!transport) return
      this.initializeTransport(transport)
    }

    const stateData = getInputStateData(report.reportId, data, this.state.interface)
    if (!stateData) return
    const session = this.connection.session
    const sequence = ++this.inputReportSequence
    const previous = accessoryEvents.map(([key]) => this.state[key])
    this.state.timestamp = report.timeStamp
    updateControllerState(this.state, stateData)
    if (isMinimalBluetoothReport(report.reportId, data)) return
    const initial = !this.accessoryStateKnown
    this.accessoryStateKnown = true
    const current = accessoryEvents.map(([key]) => this.state[key])
    for (const [index, [, connected, disconnected]] of accessoryEvents.entries()) {
      if (initial ? !current[index] : previous[index] === current[index]) continue
      // A listener may replace/disconnect the session or process a newer report.
      if (
        this.connection.session !== session || this.device !== report.device ||
        session?.signal.aborted || this.connection.isDisconnecting ||
        !report.device.opened || this.inputReportSequence !== sequence
      ) return
      this.emit(current[index] ? connected : disconnected, { device: report.device, initial })
    }
  }

  private initializeTransport (transport: ControllerTransport) {
    this.state.interface = transport
    if (transport === DualShock4Interface.USB && !this.output.hasPendingOutput) {
      // Player 1 color, unless an early output update already supplies a color.
      void this.lightbar.setColorRGB(0, 0, 64).catch(error => console.error(error))
    }
    this.output.markReady()
    if (transport === DualShock4Interface.Bluetooth) {
      void this.device?.receiveFeatureReport(0x02).catch(error => console.error(error))
    }
  }

  /**
   * Sends the local rumble, lightbar and configured hardware volumes to the controller.
   *
   * This function is called automatically in most cases. Output requested before
   * the first supported input report is combined and sent once the interface is known.
   */
  async sendLocalState (): Promise<void> {
    if (!this.device) throw new Error('Controller not connected. You must call .connect() first!')
    if (this.connection.isDisconnecting) throw new DOMException('Controller disconnecting.', 'InvalidStateError')
    return this.output.send()
  }

  private requestOutputUpdate (): Promise<void> {
    if (!this.device) throw new Error('Controller not connected. You must call .connect() first!')
    return this.sendLocalState()
  }
}

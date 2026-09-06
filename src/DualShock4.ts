import { readControllerFirmware } from './firmware/readFirmwareInfo'
import { ConnectionController, type ConnectionSession } from './controllers/ConnectionController'
import type { DualShock4EventMap, DualShock4DisconnectReason } from './events'
import { bluetoothInputReportId } from './protocol/consts'
import { createDefaultState, DualShock4Interface, type ControllerTransport } from './state'
import DualShock4Lightbar from './effects/DualShock4Lightbar'
import DualShock4Rumble from './effects/DualShock4Rumble'
import type { DualShock4FirmwareInfo } from './firmware/parseFirmwareInfo'
import { OutputController } from './controllers/OutputController'
import { detectInputInterface, getInputStateData, isMinimalBluetoothReport, isValidBluetoothInputReport, updateControllerState } from './protocol/input'

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

  /** Internal WebHID device */
  get device (): HIDDevice | undefined { return this.connection.device }
  set device (device: HIDDevice | undefined) {
    if (device === this.device) return
    this.connection.device = device
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
   * Result of the feature-report clone check, or `null` before it runs.
   * This is a compatibility heuristic, not proof of authenticity.
   */
  isClone: boolean | null = null

  /** Current controller state */
  state = createDefaultState()

  /** Allows lightbar control */
  lightbar = new DualShock4Lightbar(() => this.requestOutputUpdate())
  /** Allows rumble control */
  rumble = new DualShock4Rumble(() => this.requestOutputUpdate())

  private readonly output = new OutputController(
    () => ({ transport: this.state.interface, rumble: this.rumble, lightbar: this.lightbar }),
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
   *
   * @returns `true` when the controller is connected, or `false` when device selection is cancelled.
   */
  connect (): Promise<boolean> {
    return this.connection.connect()
  }

  /**
   * Reads DualShock 4 feature report 0xA3 and updates {@link firmwareInfo} and
   * {@link isClone}.
   *
   * Both USB and Bluetooth controllers use this report. The firmware request
   * times out after one second; the optional follow-up clone check uses a
   * shorter timeout. Unsupported, timed out, or malformed reports return
   * `null` so compatible third-party controllers can still be used.
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
    const result = await readControllerFirmware(device, session?.signal)
    if (
      request === this.firmwareInfoRequest && this.connection.session === session &&
      !session?.signal.aborted && (!result.firmwareInfo || device.opened)
    ) {
      this.firmwareInfo = result.firmwareInfo
      this.isClone = result.isClone
    }
    return result.firmwareInfo
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
    this.state.interface = DualShock4Interface.Disconnected
    this.output.attach(session.device, session.signal)
    this.firmwareInfo = null
    this.isClone = null
  }

  private handleConnectionCleared (device: HIDDevice, reason: DualShock4DisconnectReason, announced: boolean) {
    this.firmwareInfoRequest++
    this.output.clear(new DOMException('Controller disconnected.', 'AbortError'))
    this.rumble.reset()
    this.lastReport = undefined
    this.lastSentReport = undefined
    this.firmwareInfo = null
    this.isClone = null
    this.state = createDefaultState()
    if (announced) this.emit('disconnect', { device, reason })
  }

  private prepareConnectionClose () {
    const previousInterface = this.state.interface
    void this.rumble.setRumbleIntensity(0, 0).catch(() => {})
    this.output.cancelPending(new DOMException('Controller disconnected.', 'AbortError'))
    this.state.interface = DualShock4Interface.Disconnected
    return {
      pending: this.output.drain(),
      restore: () => { this.state.interface = previousInterface }
    }
  }

  /** Routes validated input into state updates and transport initialization. */
  private processControllerReport (report : HIDInputReportEvent) {
    if (report.device !== this.device) return

    const { data } = report
    this.lastReport = data.buffer as ArrayBuffer

    // Bluetooth may use a minimal report until feature report 0x02 is requested.
    if (isMinimalBluetoothReport(report.reportId, data)) {
      if (this.state.interface === DualShock4Interface.Disconnected) {
        this.initializeTransport(DualShock4Interface.Bluetooth)
      }
      return
    }

    if (report.reportId === bluetoothInputReportId && !isValidBluetoothInputReport(data)) return

    // Interface is unknown
    if (this.state.interface === DualShock4Interface.Disconnected) {
      const transport = detectInputInterface(report.reportId, data)
      if (!transport) return
      this.initializeTransport(transport)
      if (transport === DualShock4Interface.Bluetooth) return
    }

    this.state.timestamp = report.timeStamp

    const stateData = getInputStateData(report.reportId, data, this.state.interface)
    if (stateData) updateControllerState(this.state, stateData)
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
   * Sends the local rumble and lightbar state to the controller.
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

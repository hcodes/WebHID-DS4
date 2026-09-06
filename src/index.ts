import { createDefaultState, DualShock4Interface } from './state'
import DualShock4Lightbar from './lightbar'
import DualShock4Rumble from './rumble'
import {
  firmwareFeatureReportId,
  parseFirmwareInfo,
  type DualShock4FirmwareInfo
} from './firmware'
import { crc32 } from './util/crc32'
import { normalizeThumbstick, normalizeTrigger } from './util/normalize'

export type { BatteryStatus } from './state'
export type { DualShock4BoardModel, DualShock4FirmwareInfo } from './firmware'

const bluetoothInputReportId = 0x11
const bluetoothInputReportLength = 77
const bluetoothInputCrcOffset = 73
const bluetoothInputStateOffset = 2
const featureReportTimeoutMs = 1000
const cloneCheckTimeoutMs = 250
const originalControllerFeatureReportId = 0x81

function receiveFeatureReportWithTimeout (device: HIDDevice, reportId: number, timeoutMs: number): Promise<DataView> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new DOMException('Feature report request timed out.', 'TimeoutError'))
    }, timeoutMs)

    void device.receiveFeatureReport(reportId).then(
      report => {
        clearTimeout(timeout)
        resolve(report)
      },
      error => {
        clearTimeout(timeout)
        reject(error)
      }
    )
  })
}

function isValidBluetoothInputReport (data: DataView): boolean {
  if (data.byteLength !== bluetoothInputReportLength) return false

  const crcData = new Uint8Array(2 + bluetoothInputCrcOffset)
  crcData[0] = 0xA1
  crcData[1] = bluetoothInputReportId
  crcData.set(
    new Uint8Array(data.buffer, data.byteOffset, bluetoothInputCrcOffset),
    2
  )

  return crc32(crcData) === data.getUint32(bluetoothInputCrcOffset, true)
}

/**
 * Main class.
 */
export class DualShock4 {
  private resolveInterfaceReady ?: () => void
  private rejectInterfaceReady ?: (reason?: unknown) => void
  private interfaceReady !: Promise<void>
  private interfaceReadyResolved = false
  private hasPendingOutput = false
  private pendingOutput ?: Promise<void>
  private outputQueue ?: Promise<void>
  private initialization ?: Promise<boolean>
  private disconnection ?: Promise<void>
  private isDisconnecting = false
  private firmwareInfoRequest = 0

  /** Internal WebHID device */
  device ?: HIDDevice

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
  lightbar = new DualShock4Lightbar(this)
  /** Allows rumble control */
  rumble = new DualShock4Rumble(this)

  constructor () {
    if (!navigator.hid || !navigator.hid.requestDevice) {
      throw new Error('WebHID not supported by browser or not available.')
    }

    this.createInterfaceReady()
  }

  private createInterfaceReady () {
    this.interfaceReadyResolved = false
    this.interfaceReady = new Promise<void>((resolve, reject) => {
      this.resolveInterfaceReady = resolve
      this.rejectInterfaceReady = reject
    })
  }

  private resetInterfaceDetection (reason?: unknown) {
    this.state.interface = DualShock4Interface.Disconnected

    if (reason || this.interfaceReadyResolved) {
      if (reason && this.pendingOutput) {
        this.rejectInterfaceReady?.(reason)
      }
      this.pendingOutput = undefined
      this.hasPendingOutput = false
      this.createInterfaceReady()
    }
  }

  private markInterfaceReady () {
    if (this.interfaceReadyResolved) return

    this.interfaceReadyResolved = true
    this.resolveInterfaceReady?.()
  }

  private enqueueOutputReport (device: HIDDevice, reportId: number, data: Uint8Array<ArrayBuffer>): Promise<void> {
    const output = this.outputQueue
      ? this.outputQueue.then(() => device.sendReport(reportId, data))
      : device.sendReport(reportId, data)
    const queueTail = output.catch(() => {})

    this.outputQueue = queueTail
    void queueTail.then(() => {
      if (this.outputQueue === queueTail) this.outputQueue = undefined
    })

    return output
  }

  /**
   * Requests access to a controller and opens its WebHID session.
   * 
   * This function must be called in the context of user interaction
   * (i.e in a click event handler), otherwise it might not work.
   *
   * @returns `true` when the controller is connected, or `false` when device selection is cancelled.
   */
  async connect (): Promise<boolean> {
    if (this.disconnection) await this.disconnection
    if (this.device && this.device.opened) return true

    const initialization = this.initialization ??= this.initializeDevice()

    try {
      return await initialization
    } finally {
      if (this.initialization === initialization) {
        this.initialization = undefined
      }
    }
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
    if (this.isDisconnecting) {
      throw new DOMException('Controller disconnecting.', 'InvalidStateError')
    }

    const request = ++this.firmwareInfoRequest

    try {
      const report = await receiveFeatureReportWithTimeout(device, firmwareFeatureReportId, featureReportTimeoutMs)
      const firmwareInfo = parseFirmwareInfo(report)
      let isClone = true

      if (firmwareInfo) {
        try {
          await receiveFeatureReportWithTimeout(device, originalControllerFeatureReportId, cloneCheckTimeoutMs)
          isClone = false
        } catch {
          isClone = true
        }
      }

      if (
        request === this.firmwareInfoRequest &&
        this.device === device &&
        device.opened
      ) {
        this.firmwareInfo = firmwareInfo
        this.isClone = isClone
      }
      return firmwareInfo
    } catch {
      if (request === this.firmwareInfoRequest && this.device === device) {
        this.firmwareInfo = null
        this.isClone = true
      }
      return null
    }
  }

  /**
   * Stops rumble and closes the current WebHID session without revoking device
   * permission. Pending output that is waiting for transport detection rejects
   * with an `AbortError`.
   *
   * If the browser fails to close a device that remains open, the active session
   * is restored and the error is rethrown so disconnection can be retried.
   */
  async disconnect (): Promise<void> {
    const disconnection = this.disconnection ??= this.disconnectDevice()

    try {
      await disconnection
    } finally {
      if (this.disconnection === disconnection) {
        this.disconnection = undefined
      }
    }
  }

  private async disconnectDevice (): Promise<void> {
    if (this.initialization) {
      await this.initialization.catch(() => {})
    }

    const device = this.device
    if (!device) return

    const previousInterface = this.state.interface
    void this.rumble.setRumbleIntensity(0, 0).catch(() => {})
    this.isDisconnecting = true

    try {
      device.oninputreport = null
      this.resetInterfaceDetection(new DOMException('Controller disconnected.', 'AbortError'))
      if (this.outputQueue) await this.outputQueue
      if (device.opened) await device.close()

      this.clearDevice(device)
    } catch (error) {
      if (this.device === device) {
        if (device.opened) {
          this.state.interface = previousInterface
          device.oninputreport = (e : HIDInputReportEvent) => this.processControllerReport(e)
        } else {
          this.clearDevice(device)
        }
      }
      throw error
    } finally {
      this.isDisconnecting = false
    }
  }

  private clearDevice (device: HIDDevice) {
    if (this.device !== device) return

    this.device = undefined
    this.lastReport = undefined
    this.lastSentReport = undefined
    this.firmwareInfo = null
    this.isClone = null
    this.state = createDefaultState()
  }

  private async initializeDevice (): Promise<boolean> {
    const devices = await navigator.hid.requestDevice({
      // TODO: Add more compatible controllers?
      filters: [
        // Official Sony controllers and adapter
        { vendorId: 0x054C, productId: 0x0BA0 }, // Sony — DUALSHOCK 4 USB Wireless Adaptor (CUH-ZWA1)
        { vendorId: 0x054C, productId: 0x05C4 }, // Sony — DUALSHOCK 4 (CUH-ZCT1)
        { vendorId: 0x054C, productId: 0x09CC }, // Sony — DUALSHOCK 4 v2 (CUH-ZCT2)
        // Third-party accessory using Sony's vendor ID
        { vendorId: 0x054C, productId: 0x05C5 }, // Collective Minds — Strike Pack FPS Dominator (Sony VID)
        // Razer Raiju
        { vendorId: 0x1532, productId: 0x1000 }, // Razer — Raiju PS4
        { vendorId: 0x1532, productId: 0x1007 }, // Razer — Raiju Tournament Edition (USB)
        { vendorId: 0x1532, productId: 0x1004 }, // Razer — Raiju Ultimate Edition (USB)
        { vendorId: 0x1532, productId: 0x1009 }, // Razer — Raiju Ultimate Edition (Bluetooth)
        // Nacon Revolution
        { vendorId: 0x146B, productId: 0x0D01 }, // Nacon — Revolution Pro Controller
        { vendorId: 0x146B, productId: 0x0D02 }, // Nacon — Revolution Pro Controller 2
        { vendorId: 0x146B, productId: 0x0D08 }, // Nacon — Revolution Unlimited Pro Controller
        // Other third party controllers
        { vendorId: 0x0F0D, productId: 0x00EE }, // HORI — Mini Wired Gamepad for PS4
        { vendorId: 0x7545, productId: 0x0104 }, // Armor3 / Level Up — Cobra (shared VID/PID)
        { vendorId: 0x2E95, productId: 0x7725 }, // SCUF — Vantage
        { vendorId: 0x11C0, productId: 0x4001 }, // GameStop — PS4 Fun Controller
        { vendorId: 0x0C12, productId: 0x57AB }, // Multilaser — Warrior Joypad (JS083)
        { vendorId: 0x0C12, productId: 0x0E16 }, // Steelplay — Metaltech P4
        { vendorId: 0x0F0D, productId: 0x0084 } // HORI — Fighting Commander
      ]
    })

    const device = devices[0]
    if (!device) return false

    const previousDevice = this.device

    await device.open()

    if (previousDevice) previousDevice.oninputreport = null
    this.resetInterfaceDetection()
    this.device = device
    this.firmwareInfo = null
    this.isClone = null
    device.oninputreport = (e : HIDInputReportEvent) => this.processControllerReport(e)

    await this.readFirmwareInfo()

    return true
  }

  /**
   * Parses a report sent from the controller and updates the state.
   * 
   * This function is called internally by the library each time a report is received.
   * 
  * @param report - HID Report sent by the controller.
   */
  private processControllerReport (report : HIDInputReportEvent) {
    if (report.device !== this.device) return

    const { data } = report
    this.lastReport = data.buffer as ArrayBuffer

    // Bluetooth may use a minimal report until feature report 0x02 is requested.
    if (report.reportId === 0x01 && data.byteLength === 9) {
      if (this.state.interface === DualShock4Interface.Disconnected) {
        this.state.interface = DualShock4Interface.Bluetooth
        this.markInterfaceReady()
        void this.device.receiveFeatureReport(0x02)
      }
      return
    }

    if (report.reportId === bluetoothInputReportId && !isValidBluetoothInputReport(data)) return

    // Interface is unknown
    if (this.state.interface === DualShock4Interface.Disconnected) {
      if (report.reportId === 0x01 && data.byteLength === 63) {
        this.state.interface = DualShock4Interface.USB
      } else if (report.reportId === bluetoothInputReportId) {
        this.state.interface = DualShock4Interface.Bluetooth
        this.markInterfaceReady()
        void this.device.receiveFeatureReport(0x02)
        return
      } else {
        return
      }

      if (!this.hasPendingOutput) {
        // Player 1 Color
        this.lightbar.setColorRGB(0, 0, 64).catch(e => console.error(e))
      }
      this.markInterfaceReady()
    }

    this.state.timestamp = report.timeStamp

    // USB Reports
    if (this.state.interface === DualShock4Interface.USB && report.reportId === 0x01) {
      this.updateState(data)
    }
    // Bluetooth Reports
    if (this.state.interface === DualShock4Interface.Bluetooth && report.reportId === bluetoothInputReportId) {
      this.updateState(new DataView(
        data.buffer,
        data.byteOffset + bluetoothInputStateOffset,
        bluetoothInputCrcOffset - bluetoothInputStateOffset
      ))
    }
  }

  /**
   * Updates the controller state using normalized data from the last report.
   * 
   * This function is called internally by the library each time a report is received.
   * 
   * @param data - Normalized data from the HID report.
   */
  private updateState (data : DataView) {
    // Update thumbsticks
    this.state.axes.leftStickX = normalizeThumbstick(data.getUint8(0))
    this.state.axes.leftStickY = normalizeThumbstick(data.getUint8(1))
    this.state.axes.rightStickX = normalizeThumbstick(data.getUint8(2))
    this.state.axes.rightStickY = normalizeThumbstick(data.getUint8(3))

    // Update main buttons
    const buttons1 = data.getUint8(4)
    this.state.buttons.triangle = !!(buttons1 & 0x80)
    this.state.buttons.circle = !!(buttons1 & 0x40)
    this.state.buttons.cross = !!(buttons1 & 0x20)
    this.state.buttons.square = !!(buttons1 & 0x10)
    // Update D-Pad
    const dPad = buttons1 & 0x0F
    this.state.buttons.dPadUp = dPad === 7 || dPad === 0 || dPad === 1
    this.state.buttons.dPadRight = dPad === 1 || dPad === 2 || dPad === 3
    this.state.buttons.dPadDown = dPad === 3 || dPad === 4 || dPad === 5
    this.state.buttons.dPadLeft = dPad === 5 || dPad === 6 || dPad === 7
    // Update additional buttons
    const buttons2 = data.getUint8(5)
    this.state.buttons.l1 = !!(buttons2 & 0x01)
    this.state.buttons.r1 = !!(buttons2 & 0x02)
    this.state.buttons.l2 = !!(buttons2 & 0x04)
    this.state.buttons.r2 = !!(buttons2 & 0x08)
    this.state.buttons.share = !!(buttons2 & 0x10)
    this.state.buttons.options = !!(buttons2 & 0x20)
    this.state.buttons.l3 = !!(buttons2 & 0x40)
    this.state.buttons.r3 = !!(buttons2 & 0x80)
    const buttons3 = data.getUint8(6)
    this.state.buttons.playStation = !!(buttons3 & 0x01)
    this.state.buttons.touchPadClick = !!(buttons3 & 0x02)

    // Update Triggers
    this.state.axes.l2 = normalizeTrigger(data.getUint8(7))
    this.state.axes.r2 = normalizeTrigger(data.getUint8(8))

    // Update battery level
    const batteryData = data.getUint8(29)
    const batteryCapacity = batteryData & 0x0F
    const cableConnected = !!(batteryData & 0x10)
    if (!cableConnected) {
      this.state.batteryCapacity = batteryCapacity < 10 ? batteryCapacity * 10 + 5 : 100
      this.state.batteryStatus = 'discharging'
    } else if (batteryCapacity <= 10) {
      this.state.batteryCapacity = batteryCapacity < 10 ? batteryCapacity * 10 + 5 : 100
      this.state.batteryStatus = 'charging'
    } else if (batteryCapacity === 11) {
      this.state.batteryCapacity = 100
      this.state.batteryStatus = 'full'
    } else {
      this.state.batteryCapacity = null
      this.state.batteryStatus = batteryCapacity >= 14 ? 'error' : 'unknown'
    }
    
    // Update motion input
    this.state.axes.gyroX = data.getInt16(12, true)
    this.state.axes.gyroY = data.getInt16(14, true)
    this.state.axes.gyroZ = data.getInt16(16, true)
    this.state.axes.accelX = data.getInt16(18, true)
    this.state.axes.accelY = data.getInt16(20, true)
    this.state.axes.accelZ = data.getInt16(22, true)

    // Update touchpad
    this.state.touchpad.touches = []
    const touchReportSize = 9
    const firstTouchReportOffset = 33
    const maxTouchReports = Math.floor((data.byteLength - firstTouchReportOffset) / touchReportSize)
    const numTouchReports = Math.min(data.getUint8(32), maxTouchReports)

    for (let reportIndex = 0; reportIndex < numTouchReports; reportIndex++) {
      const reportOffset = firstTouchReportOffset + reportIndex * touchReportSize
      const touches = []

      for (let pointIndex = 0; pointIndex < 2; pointIndex++) {
        const pointOffset = reportOffset + 1 + pointIndex * 4
        const contact = data.getUint8(pointOffset)

        if (!(contact & 0x80)) {
          touches.push({
            touchId: contact & 0x7F,
            x: (data.getUint8(pointOffset + 2) & 0x0F) << 8 | data.getUint8(pointOffset + 1),
            y: data.getUint8(pointOffset + 3) << 4 | (data.getUint8(pointOffset + 2) & 0xF0) >> 4
          })
        }
      }

      this.state.touchpad.touches = touches
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
    if (this.isDisconnecting) throw new DOMException('Controller disconnecting.', 'InvalidStateError')

    if (this.state.interface === DualShock4Interface.Disconnected) {
      this.hasPendingOutput = true
      this.pendingOutput ??= this.interfaceReady.then(() => this.sendLocalState())
      return this.pendingOutput
    }

    this.hasPendingOutput = false

    if (this.state.interface === DualShock4Interface.USB) {
      const report = new Uint8Array(32)

      // Report ID
      report[0] = 0x05

      // Enable Rumble (0x01), Lightbar (0x02)
      report[1] = 0x01 | 0x02

      // Light rumble motor
      report[4] = this.rumble.light
      // Heavy rumble motor
      report[5] = this.rumble.heavy

      // Lightbar Red
      report[6] = this.lightbar.r
      // Lightbar Green
      report[7] = this.lightbar.g
      // Lightbar Blue
      report[8] = this.lightbar.b

      this.lastSentReport = report.buffer

      return this.enqueueOutputReport(this.device, report[0], report.slice(1))
    } else {
      const report = new Uint8Array(79)
      const crcBytes = new Uint8Array(4)
      const crcDv = new DataView(crcBytes.buffer)

      // Header
      report[0] = 0xA2
      // Report ID
      report[1] = 0x11

      // Poll Rate
      report[2] = 0x80
      // Enable rumble and lights
      report[4] = 0x01 | 0x02

      // Light rumble motor
      report[7] = this.rumble.light
      // Heavy rumble motor
      report[8] = this.rumble.heavy

      // Lightbar Red
      report[9] = this.lightbar.r
      // Lightbar Green
      report[10] = this.lightbar.g
      // Lightbar Blue
      report[11] = this.lightbar.b

      crcDv.setUint32(0, crc32(report.slice(0, 75)))
      report[75] = crcBytes[3]
      report[76] = crcBytes[2]
      report[77] = crcBytes[1]
      report[78] = crcBytes[0]
      
      this.lastSentReport = report.buffer

      return this.enqueueOutputReport(this.device, report[1], report.slice(2))
    }
  }
}

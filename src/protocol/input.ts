/**
 * @module
 * @internal
 */
import { DualShock4Interface, type DualShock4State, type ControllerTransport } from '../state'
import { bluetoothInputReportId } from './consts'
import { crc32 } from '../utils/crc32'
import { normalizeThumbstick, normalizeTrigger } from './normalize'

const basicInputReportId = 0x01
const usbInputReportLength = 63
const minimalBluetoothInputReportLength = 9
const bluetoothInputReportLength = 77
const bluetoothInputCrcOffset = 73
const bluetoothInputStateOffset = 2

export function isValidBluetoothInputReport (data: DataView): boolean {
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

/** Determines transport from a supported report; undefined means unrecognized. */
export function detectInputInterface (reportId: number, data: DataView): ControllerTransport | undefined {
  if (reportId === basicInputReportId && data.byteLength === usbInputReportLength) return DualShock4Interface.USB
  if (isMinimalBluetoothReport(reportId, data) || reportId === bluetoothInputReportId) return DualShock4Interface.Bluetooth
}

export function isMinimalBluetoothReport (reportId: number, data: DataView): boolean {
  return reportId === basicInputReportId && data.byteLength === minimalBluetoothInputReportLength
}

export function getInputStateData (reportId: number, data: DataView, transport: DualShock4Interface): DataView | undefined {
  if (transport === DualShock4Interface.USB && reportId === basicInputReportId) return data
  if (transport === DualShock4Interface.Bluetooth && reportId === bluetoothInputReportId) {
    return new DataView(data.buffer, data.byteOffset + bluetoothInputStateOffset, bluetoothInputCrcOffset - bluetoothInputStateOffset)
  }
}

/** Applies a normalized input payload to the existing state object. */
export function updateControllerState (state: DualShock4State, data: DataView) {
  updateAxes(state, data)
  updateButtons(state, data)
  updateBattery(state, data)
  updateMotion(state, data)
  updateTouchpad(state, data)
}

function updateAxes (state: DualShock4State, data: DataView) {
  // Update thumbsticks
  state.axes.leftStickX = normalizeThumbstick(data.getUint8(0))
  state.axes.leftStickY = normalizeThumbstick(data.getUint8(1))
  state.axes.rightStickX = normalizeThumbstick(data.getUint8(2))
  state.axes.rightStickY = normalizeThumbstick(data.getUint8(3))

  // Update Triggers
  state.axes.l2 = normalizeTrigger(data.getUint8(7))
  state.axes.r2 = normalizeTrigger(data.getUint8(8))
}

function updateButtons (state: DualShock4State, data: DataView) {
  // Update main buttons
  const faceButtonsAndDPad = data.getUint8(4)
  state.buttons.triangle = !!(faceButtonsAndDPad & 0x80)
  state.buttons.circle = !!(faceButtonsAndDPad & 0x40)
  state.buttons.cross = !!(faceButtonsAndDPad & 0x20)
  state.buttons.square = !!(faceButtonsAndDPad & 0x10)
  // Update D-Pad
  const dPad = faceButtonsAndDPad & 0x0F
  state.buttons.dPadUp = dPad === 7 || dPad === 0 || dPad === 1
  state.buttons.dPadRight = dPad === 1 || dPad === 2 || dPad === 3
  state.buttons.dPadDown = dPad === 3 || dPad === 4 || dPad === 5
  state.buttons.dPadLeft = dPad === 5 || dPad === 6 || dPad === 7
  // Update additional buttons
  const shoulderMenuAndStickButtons = data.getUint8(5)
  state.buttons.l1 = !!(shoulderMenuAndStickButtons & 0x01)
  state.buttons.r1 = !!(shoulderMenuAndStickButtons & 0x02)
  state.buttons.l2 = !!(shoulderMenuAndStickButtons & 0x04)
  state.buttons.r2 = !!(shoulderMenuAndStickButtons & 0x08)
  state.buttons.share = !!(shoulderMenuAndStickButtons & 0x10)
  state.buttons.options = !!(shoulderMenuAndStickButtons & 0x20)
  state.buttons.l3 = !!(shoulderMenuAndStickButtons & 0x40)
  state.buttons.r3 = !!(shoulderMenuAndStickButtons & 0x80)
  const psAndTouchpadButtons = data.getUint8(6)
  state.buttons.playStation = !!(psAndTouchpadButtons & 0x01)
  state.buttons.touchPadClick = !!(psAndTouchpadButtons & 0x02)
}

function updateBattery (state: DualShock4State, data: DataView) {
  // Update battery level
  const batteryData = data.getUint8(29)
  const batteryCapacity = batteryData & 0x0F
  const cableConnected = !!(batteryData & 0x10)
  if (!cableConnected || batteryCapacity <= 10) {
    state.batteryCapacity = batteryCapacity < 10 ? batteryCapacity * 10 + 5 : 100
    state.batteryStatus = cableConnected ? 'charging' : 'discharging'
  } else if (batteryCapacity === 11) {
    state.batteryCapacity = 100
    state.batteryStatus = 'full'
  } else {
    state.batteryCapacity = null
    state.batteryStatus = batteryCapacity >= 14 ? 'error' : 'unknown'
  }
}

function updateMotion (state: DualShock4State, data: DataView) {
  // Update motion input
  state.axes.gyroX = data.getInt16(12, true)
  state.axes.gyroY = data.getInt16(14, true)
  state.axes.gyroZ = data.getInt16(16, true)
  state.axes.accelX = data.getInt16(18, true)
  state.axes.accelY = data.getInt16(20, true)
  state.axes.accelZ = data.getInt16(22, true)
}

function updateTouchpad (state: DualShock4State, data: DataView) {
  // Update touchpad
  state.touchpad.touches = []
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

    state.touchpad.touches = touches
  }
}

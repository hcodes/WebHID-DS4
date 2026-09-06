function writeAscii (data: Uint8Array, offset: number, value: string) {
  for (let index = 0; index < value.length; index++) {
    data[offset + index] = value.charCodeAt(index)
  }
}

export function emitUsbReport (device: HIDDevice, batteryStatus: number) {
  const data = new Uint8Array(63)
  data[29] = batteryStatus

  device.oninputreport?.call(device, {
    device,
    reportId: 0x01,
    data: new DataView(data.buffer),
    timeStamp: 1
  } as HIDInputReportEvent)
}

export function createBluetoothReportData (byteOffset = 0): DataView {
  const buffer = new ArrayBuffer(byteOffset + 77 + 8)
  const data = new Uint8Array(buffer, byteOffset, 77)

  data[2] = 0xFF
  // CRC-32 for [0xA1, 0x11, ...data.slice(0, 73)], stored little-endian.
  data.set([0x12, 0x47, 0x1B, 0x51], 73)

  return new DataView(buffer, byteOffset, data.byteLength)
}

export function setTouchPoint (
  data: Uint8Array,
  frameIndex: number,
  pointIndex: number,
  touchId: number,
  x: number,
  y: number,
  active = true
) {
  const offset = 34 + frameIndex * 9 + pointIndex * 4

  data[offset] = touchId | (active ? 0 : 0x80)
  data[offset + 1] = x & 0xFF
  data[offset + 2] = (x >> 8) & 0x0F | (y & 0x0F) << 4
  data[offset + 3] = y >> 4
}

export function createFirmwareReport ({
  includesReportId,
  byteOffset = 0,
  buildDate = 'Aug  3 2013',
  buildTime = '07:01:12',
  hardwareVersion = 0xA000,
  firmwareVersion = 0x0100
}: {
  includesReportId: boolean
  byteOffset?: number
  buildDate?: string
  buildTime?: string
  hardwareVersion?: number
  firmwareVersion?: number
}): DataView {
  const reportLength = includesReportId ? 49 : 48
  const buffer = new ArrayBuffer(byteOffset + reportLength + 5)
  const data = new Uint8Array(buffer, byteOffset, reportLength)
  const payloadOffset = includesReportId ? 1 : 0

  if (includesReportId) data[0] = 0xA3
  writeAscii(data, payloadOffset, buildDate)
  writeAscii(data, payloadOffset + 16, buildTime)

  const view = new DataView(buffer, byteOffset, reportLength)
  view.setUint16(payloadOffset + 34, hardwareVersion, true)
  view.setUint16(payloadOffset + 40, firmwareVersion, true)

  return view
}

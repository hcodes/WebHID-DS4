/** @internal */
export const firmwareFeatureReportId = 0xA3

const firmwarePayloadLength = 48
const firmwareFullReportLength = firmwarePayloadLength + 1
const buildDateOffset = 0
const buildTimeOffset = 16
const buildStringLength = 16
const hardwareVersionOffset = 34
const firmwareVersionOffset = 40

/** Known DualShock 4 mainboard revisions. */
export type DualShock4BoardModel =
  | 'JDM-001'
  | 'JDM-011'
  | 'JDM-020'
  | 'JDM-030'
  | 'JDM-040'
  | 'JDM-050'
  | 'JDM-055'

/** Firmware metadata reported directly by a DualShock 4 controller. */
export interface DualShock4FirmwareInfo {
  /** Firmware build date as stored by the controller. */
  buildDate: string
  /** Firmware build time as stored by the controller. */
  buildTime: string
  /** Raw 16-bit hardware version. */
  hardwareVersion: number
  /** Raw hardware version formatted as four hexadecimal digits. */
  hardwareVersionHex: string
  /** Mainboard model derived from the hardware version, or `null` when unknown. */
  boardModel: DualShock4BoardModel | null
  /** Raw 16-bit firmware version. */
  firmwareVersion: number
  /** Raw firmware version formatted as four hexadecimal digits. */
  firmwareVersionHex: string
}

function readBuildString (data: DataView, offset: number): string | null {
  let value = ''

  for (let index = 0; index < buildStringLength; index++) {
    const byte = data.getUint8(offset + index)
    if (byte === 0) break
    if (byte < 0x20 || byte > 0x7E) return null
    value += String.fromCharCode(byte)
  }

  value = value.trim()
  return value || null
}

function toHexVersion (version: number): string {
  return `0x${version.toString(16).toUpperCase().padStart(4, '0')}`
}

function boardModelFromHardwareVersion (version: number): DualShock4BoardModel | null {
  const revision = version >> 8

  if (revision === 0x31) return 'JDM-001'
  if (revision === 0x43) return 'JDM-011'
  if (revision === 0x54) return 'JDM-030'
  if (revision >= 0x64 && revision <= 0x74) return 'JDM-040'
  if ((revision >= 0x81 && revision <= 0x83) || revision === 0x93) return 'JDM-020'
  if (revision === 0x90 || revision === 0xA0 || revision === 0xA4) return 'JDM-050'
  if (revision === 0xB0 || revision === 0xB4) return 'JDM-055'

  return null
}

/**
 * Parses feature report 0xA3 with or without the report ID byte included.
 * Returns `null` when a device supplies an unsupported or malformed report.
 *
 * @internal
 */
export function parseFirmwareInfo (data: DataView): DualShock4FirmwareInfo | null {
  let payloadOffset: number

  if (data.byteLength === firmwarePayloadLength) {
    payloadOffset = 0
  } else if (
    data.byteLength === firmwareFullReportLength &&
    data.getUint8(0) === firmwareFeatureReportId
  ) {
    payloadOffset = 1
  } else {
    return null
  }

  const buildDate = readBuildString(data, payloadOffset + buildDateOffset)
  const buildTime = readBuildString(data, payloadOffset + buildTimeOffset)
  if (!buildDate || !buildTime) return null

  const hardwareVersion = data.getUint16(payloadOffset + hardwareVersionOffset, true)
  const firmwareVersion = data.getUint16(payloadOffset + firmwareVersionOffset, true)

  return {
    buildDate,
    buildTime,
    hardwareVersion,
    hardwareVersionHex: toHexVersion(hardwareVersion),
    boardModel: boardModelFromHardwareVersion(hardwareVersion),
    firmwareVersion,
    firmwareVersionHex: toHexVersion(firmwareVersion)
  }
}

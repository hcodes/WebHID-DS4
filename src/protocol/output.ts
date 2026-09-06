/**
 * @module
 * @internal
 */
import { DualShock4Interface, type ControllerTransport } from '../state'
import { crc32 } from '../utils/crc32'

export interface OutputState {
  rumble: { light: number, heavy: number }
  lightbar: { r: number, g: number, b: number }
}

export interface OutputReport {
  reportId: number
  data: Uint8Array<ArrayBuffer>
  raw: ArrayBuffer
}

/** Builds a packet without performing device I/O. */
export function buildOutputReport (transport: ControllerTransport, state: OutputState): OutputReport {
  if (transport === DualShock4Interface.USB) {
    const report = new Uint8Array(32)

    // Report ID
    report[0] = 0x05

    // Enable Rumble (0x01), Lightbar (0x02)
    report[1] = 0x01 | 0x02

    // Light rumble motor
    report[4] = state.rumble.light
    // Heavy rumble motor
    report[5] = state.rumble.heavy

    // Lightbar Red
    report[6] = state.lightbar.r
    // Lightbar Green
    report[7] = state.lightbar.g
    // Lightbar Blue
    report[8] = state.lightbar.b

    return { reportId: report[0], data: report.slice(1), raw: report.buffer }
  } else {
    const report = new Uint8Array(79)

    // Header
    report[0] = 0xA2
    // Report ID
    report[1] = 0x11

    // Poll Rate
    report[2] = 0x80
    // Enable rumble and lights
    report[4] = 0x01 | 0x02

    // Light rumble motor
    report[7] = state.rumble.light
    // Heavy rumble motor
    report[8] = state.rumble.heavy

    // Lightbar Red
    report[9] = state.lightbar.r
    // Lightbar Green
    report[10] = state.lightbar.g
    // Lightbar Blue
    report[11] = state.lightbar.b

    new DataView(report.buffer).setUint32(75, crc32(report.subarray(0, 75)), true)

    return { reportId: report[1], data: report.slice(2), raw: report.buffer }
  }
}

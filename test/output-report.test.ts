import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOutputReport } from '../src/protocol/output'
import { DualShock4Interface } from '../src/state'

test('Bluetooth output ends with the little-endian CRC including its HID header', () => {
  const report = buildOutputReport(DualShock4Interface.Bluetooth, {
    rumble: { light: 12, heavy: 34 }, lightbar: { r: 56, g: 78, b: 90 }
  })
  // Golden CRC independently calculated with zlib for the 75-byte packet prefix.
  assert.deepEqual(Array.from(new Uint8Array(report.raw).subarray(75)), [0x53, 0x66, 0xD7, 0x20])
  assert.deepEqual(Array.from(report.data.subarray(-4)), [0x53, 0x66, 0xD7, 0x20])
})

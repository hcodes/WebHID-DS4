import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { DualShock4 } from '../src'
import { DualShock4Interface } from '../src/state'
import { buildOutputReport } from '../src/protocol/output'
import { createDevice, useHid } from './helpers/hid'
import { createBluetoothReportData } from './helpers/reports'

async function setup (t: TestContext, transport = DualShock4Interface.USB) {
  const reports: Uint8Array[] = []
  const device = createDevice({ async sendReport (_id, data) { reports.push(new Uint8Array(data)) } })
  useHid(t, async () => [device])
  const controller = new DualShock4()
  await controller.connect()
  controller.state.interface = transport
  t.after(() => controller.disconnect())
  return { controller, device, reports }
}

for (const transport of [DualShock4Interface.USB, DualShock4Interface.Bluetooth]) {
  test(`starts and stops hardware lightbar blinking over ${transport} while preserving effects`, async t => {
    const { controller, reports } = await setup(t, transport)
    const flags = transport === DualShock4Interface.USB ? 0 : 2
    const timings = transport === DualShock4Interface.USB ? 8 : 10
    assert.equal(controller.lightbar.blinkOn, null)
    assert.equal(controller.lightbar.blinkOff, null)
    await controller.lightbar.setColorRGB(12, 34, 56)
    assert.equal(reports[0][flags], 0x03)
    await controller.lightbar.setBlink(500, 250)
    assert.deepEqual([controller.lightbar.blinkOn, controller.lightbar.blinkOff], [500, 250])
    assert.equal(reports.at(-1)![flags], 0x07)
    assert.deepEqual(Array.from(reports.at(-1)!.slice(timings, timings + 2)), [50, 25])
    await controller.rumble.setRumbleIntensity(78, 90)
    await controller.lightbar.setColorRGB(45, 67, 89)
    assert.deepEqual(Array.from(reports.at(-1)!.slice(timings - 3, timings + 2)), [45, 67, 89, 50, 25])
    await controller.lightbar.stopBlink()
    assert.equal(reports.at(-1)![flags], 0x07)
    assert.deepEqual(Array.from(reports.at(-1)!.slice(timings, timings + 2)), [0, 0])
    assert.deepEqual([controller.lightbar.blinkOn, controller.lightbar.blinkOff], [0, 0])
  })
}

test('blink durations use clamped 10 ms units and reject nonfinite values atomically', async t => {
  const { controller, reports } = await setup(t)
  for (const [input, expected] of [[-1, 0], [12.5, 10], [2550, 2550], [9999, 2550]]) {
    await controller.lightbar.setBlink(input)
    assert.deepEqual([controller.lightbar.blinkOn, controller.lightbar.blinkOff], [expected, expected])
    assert.deepEqual(Array.from(reports.at(-1)!.slice(8, 10)), [expected / 10, expected / 10])
  }
  const sent = reports.length
  for (const invalid of [NaN, Infinity, -Infinity]) {
    await assert.rejects(controller.lightbar.setBlink(invalid, 50), RangeError)
    await assert.rejects(controller.lightbar.setBlink(50, invalid), RangeError)
  }
  assert.equal(reports.length, sent)
  assert.deepEqual([controller.lightbar.blinkOn, controller.lightbar.blinkOff], [2550, 2550])
})

test('early blink settings coalesce with RGB, rumble and audio until transport is detected', async t => {
  const { controller, device, reports } = await setup(t, DualShock4Interface.Disconnected)
  const blink = controller.lightbar.setBlink(300, 700)
  const color = controller.lightbar.setColorRGB(11, 22, 33)
  const rumble = controller.rumble.setRumbleIntensity(44, 55)
  const volume = controller.audio.speaker.setVolume(66)
  assert.deepEqual(reports, [])
  device.oninputreport?.call(device, {
    device, reportId: 0x11, data: createBluetoothReportData(), timeStamp: 1
  } as HIDInputReportEvent)
  await Promise.all([blink, color, rumble, volume])
  assert.equal(reports.length, 1)
  assert.equal(reports[0][2], 0x87)
  assert.deepEqual(Array.from(reports[0].slice(5, 12)), [44, 55, 11, 22, 33, 30, 70])
  assert.equal(reports[0][23], 66)
})

test('disconnect rejects a blink request waiting for transport detection', async t => {
  const { controller } = await setup(t, DualShock4Interface.Disconnected)
  const pending = controller.lightbar.setBlink(100, 200)
  const cancelled = assert.rejects(pending, { name: 'AbortError' })
  await controller.disconnect()
  await cancelled
})

test('blink methods propagate HID output failures', async t => {
  const failure = new Error('HID output failed')
  const device = createDevice({ async sendReport () { throw failure } })
  useHid(t, async () => [device])
  const controller = new DualShock4()
  await controller.connect()
  controller.state.interface = DualShock4Interface.USB
  await assert.rejects(controller.lightbar.setBlink(100, 200), error => error === failure)
  await assert.rejects(controller.lightbar.stopBlink(), error => error === failure)
  controller.state.interface = DualShock4Interface.Disconnected
  await controller.disconnect()
})

test('Bluetooth CRC includes the hardware blink flag and timings', () => {
  const report = buildOutputReport(DualShock4Interface.Bluetooth, {
    rumble: { light: 12, heavy: 34 }, lightbar: { r: 56, g: 78, b: 90, blinkOn: 500, blinkOff: 250 }
  })
  // Golden CRC independently calculated using Python zlib.
  assert.deepEqual(Array.from(report.data.subarray(-4)), [0x38, 0xD0, 0xE4, 0xFE])
})

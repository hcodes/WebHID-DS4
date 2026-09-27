import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'

import { DualShock4 } from '../src'
import { DualShock4Interface } from '../src/state'
import { buildOutputReport } from '../src/protocol/output'
import { createDevice, useHid } from './helpers/hid'
import { createBluetoothReportData } from './helpers/reports'

async function setup (t: TestContext, transport = DualShock4Interface.USB) {
  const reports: Uint8Array[] = []
  const device = createDevice({
    async sendReport (_reportId, data) { reports.push(new Uint8Array(data)) }
  })
  useHid(t, async () => [device])
  const controller = new DualShock4()
  await controller.connect()
  controller.state.interface = transport
  t.after(() => controller.disconnect())
  return { controller, device, reports }
}

test('hardware volumes stay unknown and do not enable audio updates before explicit settings', async t => {
  const { controller, reports } = await setup(t)
  assert.ok(controller.audio.speaker)
  assert.equal(controller.audio.speaker.volume, null)
  assert.equal(controller.audio.microphone.volume, null)
  assert.equal(controller.audio.headphones.volumeLeft, null)
  assert.equal(controller.audio.headphones.volumeRight, null)
  await controller.sendLocalState()
  assert.equal(reports[0][0], 0x03)
})

for (const transport of [DualShock4Interface.USB, DualShock4Interface.Bluetooth]) {
  test(`controls microphone gain over ${transport} independently of capture and speaker/headphone levels`, async t => {
    const { controller, reports } = await setup(t, transport)
    const flags = transport === DualShock4Interface.Bluetooth ? 2 : 0
    const left = transport === DualShock4Interface.Bluetooth ? 20 : 18
    assert.equal(controller.audio.microphone.volume, null)
    await controller.audio.microphone.setVolume(64)
    assert.equal(reports[0][flags], 0x43)
    assert.deepEqual(Array.from(reports[0].slice(left, left + 4)), [0, 0, 64, 0])
    assert.equal(controller.audio.microphone.volume, 64)
    assert.equal(controller.audio.microphone.stream, null)
    assert.equal(controller.audio.microphone.inputDeviceId, null)
    await controller.audio.headphones.setVolume(40, 80)
    await controller.audio.speaker.setVolume(77)
    assert.equal(reports.at(-1)![flags], 0xF3)
    assert.deepEqual(Array.from(reports.at(-1)!.slice(left, left + 4)), [40, 80, 64, 77])
    controller.audio.microphone.volume = 32
    await controller.sendLocalState()
    assert.deepEqual(Array.from(reports.at(-1)!.slice(left, left + 4)), [40, 80, 32, 77])
    controller.audio.microphone.stop()
    assert.equal(controller.audio.microphone.volume, 32)
    controller.audio.microphone.reset()
    assert.equal(controller.audio.microphone.volume, null)
    await controller.sendLocalState()
    assert.equal(reports.at(-1)![flags], 0xB3)
    assert.equal(controller.audio.speaker.volume, 77)
  })

  test(`writes and reads cached speaker and headphone volumes over ${transport} without browser audio APIs`, async t => {
    const { controller, reports } = await setup(t, transport)
    const bluetooth = transport === DualShock4Interface.Bluetooth
    const flags = bluetooth ? 2 : 0
    const left = bluetooth ? 20 : 18
    await controller.audio.headphones.setVolume(40, 80)
    assert.equal(reports[0][flags], 0x33)
    assert.deepEqual(Array.from(reports[0].slice(left, left + 4)), [40, 80, 0, 0])
    await controller.audio.speaker.setVolume(77)
    assert.equal(reports[1][flags], 0xB3)
    assert.deepEqual(Array.from(reports[1].slice(left, left + 4)), [40, 80, 0, 77])
    assert.equal(controller.audio.speaker.volume, 77)
    assert.equal(controller.audio.headphones.volumeLeft, 40)
    assert.equal(controller.audio.headphones.volumeRight, 80)

    await controller.lightbar.setColorRGB(12, 34, 56)
    await controller.rumble.setRumbleIntensity(78, 90)
    assert.deepEqual(Array.from(reports.at(-1)!.slice(left, left + 4)), [40, 80, 0, 77])
    assert.equal(reports.at(-1)![flags], 0xB3)
  })
}

test('microphone gain uses byte normalization and rejects invalid values without changing the cache', async t => {
  const { controller, reports } = await setup(t)
  for (const [input, expected] of [[-10, 0], [12.5, 13], [256, 255]]) {
    await controller.audio.microphone.setVolume(input)
    assert.equal(controller.audio.microphone.volume, expected)
    assert.equal(reports.at(-1)![20], expected)
  }
  const sent = reports.length
  for (const invalid of [NaN, Infinity, -Infinity]) {
    await assert.rejects(controller.audio.microphone.setVolume(invalid), RangeError)
  }
  assert.equal(controller.audio.microphone.volume, 255)
  assert.equal(reports.length, sent)
})

test('channel property setters enable only configured volumes and preserve the other channels', async t => {
  const { controller, reports } = await setup(t)
  controller.audio.headphones.volumeLeft = 12
  await controller.sendLocalState()
  assert.equal(reports[0][0], 0x13)
  assert.equal(reports[0][18], 12)
  assert.equal(controller.audio.headphones.volumeRight, null)
  assert.equal(controller.audio.speaker.volume, null)

  controller.audio.headphones.volumeRight = 34
  controller.audio.speaker.volume = 56
  await controller.sendLocalState()
  assert.equal(reports.at(-1)![0], 0xB3)
  assert.deepEqual(Array.from(reports.at(-1)!.slice(18, 22)), [12, 34, 0, 56])
})

test('volume values are clamped and rounded to bytes and stereo defaults to equal channels', async t => {
  const { controller, reports } = await setup(t)
  for (const { input, expected } of [
    { input: -10, expected: 0 },
    { input: 12.5, expected: 13 },
    { input: 256, expected: 255 }
  ]) {
    await controller.audio.speaker.setVolume(input)
    await controller.audio.headphones.setVolume(input)
    assert.equal(controller.audio.speaker.volume, expected)
    assert.equal(controller.audio.headphones.volumeLeft, expected)
    assert.equal(controller.audio.headphones.volumeRight, expected)
    assert.deepEqual(Array.from(reports.at(-1)!.slice(18, 22)), [expected, expected, 0, expected])
  }
})

test('invalid volume values reject without changing cached levels or sending a report', async t => {
  const { controller, reports } = await setup(t)
  await controller.audio.speaker.setVolume(11)
  await controller.audio.headphones.setVolume(22, 33)
  const sent = reports.length
  for (const invalid of [NaN, Infinity, -Infinity]) {
    await assert.rejects(controller.audio.speaker.setVolume(invalid), RangeError)
    await assert.rejects(controller.audio.headphones.setVolume(invalid, 44), RangeError)
    await assert.rejects(controller.audio.headphones.setVolume(44, invalid), RangeError)
  }
  assert.equal(reports.length, sent)
  assert.equal(controller.audio.speaker.volume, 11)
  assert.equal(controller.audio.headphones.volumeLeft, 22)
  assert.equal(controller.audio.headphones.volumeRight, 33)
})

test('coalesces early hardware volume settings with rumble and lights until Bluetooth is detected', async t => {
  const { controller, device, reports } = await setup(t, DualShock4Interface.Disconnected)
  const speaker = controller.audio.speaker.setVolume(55)
  const headphones = controller.audio.headphones.setVolume(66, 77)
  const microphone = controller.audio.microphone.setVolume(64)
  const rumble = controller.rumble.setRumbleIntensity(88, 99)
  assert.deepEqual(reports, [])
  device.oninputreport?.call(device, {
    device, reportId: 0x11, data: createBluetoothReportData(), timeStamp: 1
  } as HIDInputReportEvent)
  await Promise.all([speaker, headphones, microphone, rumble])
  assert.equal(reports.length, 1)
  assert.equal(reports[0][2], 0xF3)
  assert.deepEqual(Array.from(reports[0].slice(5, 7)), [88, 99])
  assert.deepEqual(Array.from(reports[0].slice(20, 24)), [66, 77, 64, 55])
})

test('disconnect cancels pending volume writes and clears cached settings for the next session', async t => {
  const { controller, reports } = await setup(t, DualShock4Interface.Disconnected)
  const update = controller.audio.speaker.setVolume(55)
  const microphone = controller.audio.microphone.setVolume(64)
  const cancelled = Promise.all([
    assert.rejects(update, { name: 'AbortError' }),
    assert.rejects(microphone, { name: 'AbortError' })
  ])
  await controller.disconnect()
  await cancelled
  assert.equal(controller.audio.speaker.volume, null)
  assert.equal(controller.audio.headphones.volumeLeft, null)
  assert.equal(controller.audio.headphones.volumeRight, null)
  assert.equal(controller.audio.microphone.volume, null)
  await controller.connect()
  controller.state.interface = DualShock4Interface.USB
  await controller.sendLocalState()
  assert.equal(reports.at(-1)![0], 0x03)
})

test('hardware volume methods propagate HID send failures', async t => {
  const failure = new Error('HID output failed')
  const device = createDevice({ async sendReport () { throw failure } })
  useHid(t, async () => [device])
  const controller = new DualShock4()
  await controller.connect()
  controller.state.interface = DualShock4Interface.USB
  await assert.rejects(controller.audio.speaker.setVolume(12), error => error === failure)
  await assert.rejects(controller.audio.headphones.setVolume(34), error => error === failure)
  await assert.rejects(controller.audio.microphone.setVolume(56), error => error === failure)
  // Getters describe requests, not hardware acknowledgements or readback.
  assert.equal(controller.audio.speaker.volume, 12)
  assert.equal(controller.audio.headphones.volumeLeft, 34)
  assert.equal(controller.audio.microphone.volume, 56)
  controller.audio.reset()
  assert.equal(controller.audio.speaker.volume, null)
  assert.equal(controller.audio.headphones.volumeLeft, null)
  assert.equal(controller.audio.microphone.volume, null)
  controller.state.interface = DualShock4Interface.Disconnected
  await controller.disconnect()
})

for (const action of ['reset', 'replacement'] as const) {
  test(`${action} cancels pending volume requests while preserving pending rumble`, async t => {
    const reports: Uint8Array[] = []
    const firstDevice = createDevice({ async sendReport (_id, data) { reports.push(new Uint8Array(data)) } })
    const secondDevice = createDevice({ async sendReport (_id, data) { reports.push(new Uint8Array(data)) } })
    let selection = 0
    useHid(t, async () => [selection++ === 0 ? firstDevice : secondDevice])
    const controller = new DualShock4()
    await controller.connect()
    t.after(() => controller.disconnect())
    const speaker = controller.audio.speaker.setVolume(55)
    const headphones = controller.audio.headphones.setVolume(66, 77)
    const microphone = controller.audio.microphone.setVolume(64)
    const cancelled = Promise.all([
      assert.rejects(speaker, { name: 'AbortError' }),
      assert.rejects(headphones, { name: 'AbortError' }),
      assert.rejects(microphone, { name: 'AbortError' })
    ])
    const rumble = controller.rumble.setRumbleIntensity(88, 99)
    if (action === 'reset') controller.audio.reset()
    else {
      Object.assign(firstDevice, { opened: false })
      await controller.connect()
    }
    const device = action === 'reset' ? firstDevice : secondDevice
    device.oninputreport?.call(device, {
      device, reportId: 0x11, data: createBluetoothReportData(), timeStamp: 1
    } as HIDInputReportEvent)
    await rumble
    await cancelled
    assert.equal(reports[0][2], 0x03)
    assert.deepEqual(Array.from(reports[0].slice(5, 7)), [88, 99])
    assert.equal(controller.audio.speaker.volume, null)
    assert.equal(controller.audio.headphones.volumeLeft, null)
    assert.equal(controller.audio.microphone.volume, null)
    await controller.audio.speaker.setVolume(22)
    await controller.audio.headphones.setVolume(33, 44)
    await controller.audio.microphone.setVolume(55)
    assert.deepEqual(Array.from(reports.at(-1)!.slice(20, 24)), [33, 44, 55, 22])
  })
}

test('Bluetooth CRC covers the audio volume flags and bytes', () => {
  const report = buildOutputReport(DualShock4Interface.Bluetooth, {
    rumble: { light: 12, heavy: 34 }, lightbar: { r: 56, g: 78, b: 90 },
    audio: { headphonesLeft: 40, headphonesRight: 80, speaker: 77 }
  })
  // Golden CRC independently calculated using Python zlib.
  assert.deepEqual(Array.from(report.data.subarray(-4)), [0xB7, 0xFB, 0x96, 0xCA])
})

test('Bluetooth CRC covers all audio levels including microphone gain', () => {
  const report = buildOutputReport(DualShock4Interface.Bluetooth, {
    rumble: { light: 12, heavy: 34 }, lightbar: { r: 56, g: 78, b: 90 },
    audio: { headphonesLeft: 40, headphonesRight: 80, microphone: 64, speaker: 77 }
  })
  // Golden CRC independently calculated using Python zlib.
  assert.deepEqual(Array.from(report.data.subarray(-4)), [0xF1, 0xB0, 0x7B, 0x10])
})

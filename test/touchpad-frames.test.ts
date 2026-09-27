import assert from 'node:assert/strict'
import test from 'node:test'
import { DualShock4 } from '../src'
import { DualShock4Interface } from '../src/state'
import { crc32 } from '../src/utils/crc32'
import { createDevice, useHid } from './helpers/hid'
import { setTouchPoint } from './helpers/reports'

function emit (device: HIDDevice, transport: DualShock4Interface, payload: Uint8Array) {
  const bluetooth = transport === DualShock4Interface.Bluetooth
  const length = bluetooth ? 77 : 63
  const buffer = new ArrayBuffer(length + 12)
  const bytes = new Uint8Array(buffer, 5, length)
  bytes.set(payload, bluetooth ? 2 : 0)
  if (bluetooth) {
    const prefix = new Uint8Array(75)
    prefix.set([0xA1, 0x11])
    prefix.set(bytes.subarray(0, 73), 2)
    new DataView(buffer, 5, length).setUint32(73, crc32(prefix), true)
  }
  device.oninputreport?.call(device, {
    device, reportId: bluetooth ? 0x11 : 0x01, data: new DataView(buffer, 5, length), timeStamp: 1
  } as HIDInputReportEvent)
}

for (const transport of [DualShock4Interface.USB, DualShock4Interface.Bluetooth]) {
  const capacity = transport === DualShock4Interface.USB ? 3 : 4
  test(`exposes all ${capacity} touchpad frames and wrapping counters over ${transport}`, async t => {
    const device = createDevice()
    useHid(t, async () => [device])
    const controller = new DualShock4()
    await controller.connect()
    t.after(() => controller.disconnect())
    assert.deepEqual(controller.state.touchpad.frames, [])
    assert.equal(controller.state.touchpad.frameCounter, null)
    const data = new Uint8Array(transport === DualShock4Interface.USB ? 63 : 71)
    data[32] = capacity
    const expected = []
    for (let frameIndex = 0; frameIndex < capacity; frameIndex++) {
      const frameCounter = (254 + frameIndex) & 255
      data[33 + frameIndex * 9] = frameCounter
      const active = frameIndex !== 1
      setTouchPoint(data, frameIndex, 0, 3, 100 + frameIndex, 942, active)
      setTouchPoint(data, frameIndex, 1, 7, 1919, 200 + frameIndex, active)
      expected.push({ frameCounter, touches: active ? [
        { touchId: 3, x: 100 + frameIndex, y: 942 }, { touchId: 7, x: 1919, y: 200 + frameIndex }
      ] : [] })
    }
    emit(device, transport, data)
    assert.deepEqual(controller.state.touchpad.frames, expected)
    assert.equal(controller.state.touchpad.frameCounter, expected.at(-1)!.frameCounter)
    assert.deepEqual(controller.state.touchpad.touches, expected.at(-1)!.touches)
    // The compatibility view cannot mutate the stored frame snapshot.
    controller.state.touchpad.touches[0].x = 9999
    assert.deepEqual(controller.state.touchpad.frames, expected)
    const previousFrames = controller.state.touchpad.frames
    if (transport === DualShock4Interface.Bluetooth) {
      device.oninputreport?.call(device, {
        device, reportId: 0x01, data: new DataView(new ArrayBuffer(9)), timeStamp: 2
      } as HIDInputReportEvent)
      assert.equal(controller.state.touchpad.frames, previousFrames)
      assert.equal(controller.state.touchpad.frameCounter, expected.at(-1)!.frameCounter)
    }
    data[32] = 1
    data[33] = 12
    emit(device, transport, data)
    assert.equal(controller.state.touchpad.frames.length, 1)
    assert.equal(controller.state.touchpad.frameCounter, 12)
    assert.deepEqual(previousFrames, expected)
    data[32] = 0
    emit(device, transport, data)
    assert.deepEqual(controller.state.touchpad, { touches: [], frames: [], frameCounter: null })
    data[32] = 1
    emit(device, transport, data)
    await controller.disconnect()
    assert.deepEqual(controller.state.touchpad, { touches: [], frames: [], frameCounter: null })
  })

  test(`limits an excessive ${transport} touch frame count to complete frames in the payload`, async t => {
    const device = createDevice()
    useHid(t, async () => [device])
    const controller = new DualShock4()
    await controller.connect()
    t.after(() => controller.disconnect())
    const data = new Uint8Array(transport === DualShock4Interface.USB ? 63 : 71)
    data[32] = 255
    for (let index = 0; index < capacity; index++) {
      data[33 + index * 9] = index + 10
      setTouchPoint(data, index, 0, 1, 100, 200)
      setTouchPoint(data, index, 1, 2, 0, 0, false)
    }
    emit(device, transport, data)
    assert.equal(controller.state.touchpad.frames.length, capacity)
    assert.equal(controller.state.touchpad.frameCounter, capacity + 9)
  })
}

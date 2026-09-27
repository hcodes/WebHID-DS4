import assert from 'node:assert/strict'
import test from 'node:test'
import { crc32 } from 'node:zlib'
import { DualShock4 } from '../src'
import { createDevice, loseDevice, useHid } from './helpers/hid'
import { createBluetoothReportData, emitUsbReport } from './helpers/reports'

const accessoryEvents = [
  'headphonesconnect', 'headphonesdisconnect',
  'microphoneconnect', 'microphonedisconnect',
  'externaldeviceconnect', 'externaldevicedisconnect'
] as const

function listen (controller: DualShock4, device: HIDDevice) {
  const events: string[] = []
  for (const type of accessoryEvents) {
    controller.addEventListener(type, event => {
      assert.equal(event.detail.device, device)
      const connected = type.endsWith('connect') && !type.endsWith('disconnect')
      const key = type.startsWith('headphones') ? 'headphonesConnected'
        : type.startsWith('microphone') ? 'microphoneConnected' : 'externalDeviceConnected'
      assert.equal(controller.state[key], connected)
      events.push(type)
    })
  }
  return events
}

function emitBluetooth (device: HIDDevice, status: number, corrupt = false) {
  const data = createBluetoothReportData(7)
  data.setUint8(31, status)
  const input = Uint8Array.from([0xA1, 0x11, ...new Uint8Array(data.buffer, data.byteOffset, 73)])
  data.setUint32(73, crc32(input), true)
  if (corrupt) data.setUint8(76, data.getUint8(76) ^ 1)
  device.oninputreport?.call(device, { device, reportId: 0x11, data, timeStamp: 42 } as HIDInputReportEvent)
}

for (const bluetooth of [false, true]) {
  for (const initiallyAttached of [false, true]) {
    test(`${bluetooth ? 'Bluetooth' : 'USB'} marks only initially attached accessories as initial connections (${initiallyAttached})`, async t => {
      const device = createDevice()
      useHid(t, async () => [device])
      const controller = new DualShock4()
      await controller.connect()
      const events: { type: string, initial: boolean }[] = []
      for (const type of accessoryEvents) {
        controller.addEventListener(type, event => events.push({ type, initial: event.detail.initial }))
      }
      if (bluetooth) {
        device.oninputreport?.call(device, {
          device, reportId: 0x01, data: new DataView(new ArrayBuffer(9)), timeStamp: 1
        } as HIDInputReportEvent)
      }
      const report = (status: number) => bluetooth ? emitBluetooth(device, status) : emitUsbReport(device, status)
      report(initiallyAttached ? 0xE0 : 0)
      report(initiallyAttached ? 0xE0 : 0)
      assert.deepEqual(events, initiallyAttached ? [
        { type: 'headphonesconnect', initial: true },
        { type: 'microphoneconnect', initial: true },
        { type: 'externaldeviceconnect', initial: true }
      ] : [])
      events.length = 0
      report(initiallyAttached ? 0 : 0xE0)
      assert.deepEqual(events, initiallyAttached ? [
        { type: 'headphonesdisconnect', initial: false },
        { type: 'microphonedisconnect', initial: false },
        { type: 'externaldevicedisconnect', initial: false }
      ] : [
        { type: 'headphonesconnect', initial: false },
        { type: 'microphoneconnect', initial: false },
        { type: 'externaldeviceconnect', initial: false }
      ])
    })
  }
  test(`${bluetooth ? 'Bluetooth' : 'USB'} accessory events report independent transitions once`, async t => {
    const device = createDevice()
    useHid(t, async () => [device])
    const controller = new DualShock4()
    await controller.connect()
    const events = listen(controller, device)
    const report = (status: number) => bluetooth ? emitBluetooth(device, status) : emitUsbReport(device, status)
    report(0x14) // Cable and battery changes do not produce accessory events.
    report(0x34)
    report(0x34)
    report(0x74)
    report(0xF4)
    report(0xD4)
    report(0x94)
    report(0x14)
    report(0x14)
    assert.deepEqual(events, [
      'headphonesconnect', 'microphoneconnect', 'externaldeviceconnect',
      'headphonesdisconnect', 'microphonedisconnect', 'externaldevicedisconnect'
    ])
  })
}

test('listeners see all accessory flags updated before the first simultaneous transition', async t => {
  const device = createDevice()
  useHid(t, async () => [device])
  const controller = new DualShock4()
  await controller.connect()
  const snapshots: boolean[][] = []
  controller.addEventListener('headphonesconnect', () => snapshots.push([
    controller.state.headphonesConnected, controller.state.microphoneConnected, controller.state.externalDeviceConnected
  ]))
  controller.addEventListener('headphonesdisconnect', () => snapshots.push([
    controller.state.headphonesConnected, controller.state.microphoneConnected, controller.state.externalDeviceConnected
  ]))
  emitUsbReport(device, 0xE0)
  emitUsbReport(device, 0)
  assert.deepEqual(snapshots, [[true, true, true], [false, false, false]])
})

test('late subscribers read current state and receive only future accessory events', async t => {
  const device = createDevice()
  useHid(t, async () => [device])
  const controller = new DualShock4()
  await controller.connect()
  emitUsbReport(device, 0xE0)
  const events = listen(controller, device)
  assert.deepEqual(events, [])
  assert.equal(controller.state.headphonesConnected, true)
  assert.equal(controller.state.microphoneConnected, true)
  assert.equal(controller.state.externalDeviceConnected, true)
  emitUsbReport(device, 0xE0)
  assert.deepEqual(events, [])
  emitUsbReport(device, 0)
  assert.deepEqual(events, ['headphonesdisconnect', 'microphonedisconnect', 'externaldevicedisconnect'])
})

test('basic Bluetooth reports and corrupt extended reports preserve accessories without events', async t => {
  const device = createDevice()
  useHid(t, async () => [device])
  const controller = new DualShock4()
  await controller.connect()
  const events = listen(controller, device)
  emitBluetooth(device, 0xE0)
  events.length = 0
  device.oninputreport?.call(device, {
    device, reportId: 0x01, data: new DataView(new ArrayBuffer(9)), timeStamp: 1
  } as HIDInputReportEvent)
  emitBluetooth(device, 0, true)
  assert.deepEqual(events, [])
  assert.equal(controller.state.headphonesConnected, true)
  assert.equal(controller.state.microphoneConnected, true)
  assert.equal(controller.state.externalDeviceConnected, true)
})

for (const reason of ['manual', 'device-lost'] as const) {
  test(`${reason} controller disconnect resets flags without accessory disconnect events`, async t => {
    const device = createDevice()
    useHid(t, async () => [device])
    const controller = new DualShock4()
    await controller.connect()
    const events = listen(controller, device)
    emitUsbReport(device, 0xE0)
    await new Promise<void>(resolve => setImmediate(resolve))
    events.length = 0
    const stale = device.oninputreport
    if (reason === 'manual') await controller.disconnect()
    else loseDevice(device)
    stale?.call(device, { device, reportId: 0x01, data: new DataView(new ArrayBuffer(63)), timeStamp: 1 } as HIDInputReportEvent)
    assert.deepEqual(events, [])
    assert.equal(controller.state.headphonesConnected, false)
    assert.equal(controller.state.microphoneConnected, false)
    assert.equal(controller.state.externalDeviceConnected, false)
  })
}

test('reconnection reports already attached accessories as fresh connections', async t => {
  const device = createDevice()
  useHid(t, async () => [device])
  const controller = new DualShock4()
  await controller.connect()
  const events = listen(controller, device)
  emitUsbReport(device, 0xE0)
  await controller.disconnect()
  await controller.connect()
  emitUsbReport(device, 0xE0)
  assert.deepEqual(events, [
    'headphonesconnect', 'microphoneconnect', 'externaldeviceconnect',
    'headphonesconnect', 'microphoneconnect', 'externaldeviceconnect'
  ])
})

test('a listener replacing the session suppresses remaining events from its old input report', async t => {
  const device = createDevice()
  useHid(t, async () => [device])
  const controller = new DualShock4()
  await controller.connect()
  emitUsbReport(device, 0)
  await new Promise<void>(resolve => setImmediate(resolve))
  const events: string[] = []
  controller.addEventListener('headphonesconnect', () => {
    events.push('headphonesconnect')
    controller.device = createDevice()
  })
  controller.addEventListener('microphoneconnect', () => events.push('microphoneconnect'))
  controller.addEventListener('externaldeviceconnect', () => events.push('externaldeviceconnect'))
  emitUsbReport(device, 0xE0)
  assert.deepEqual(events, ['headphonesconnect'])
})

test('device replacement clears accessory flags without synthetic disconnect events', async t => {
  const device = createDevice()
  useHid(t, async () => [device])
  const controller = new DualShock4()
  await controller.connect()
  const events = listen(controller, device)
  emitUsbReport(device, 0xE0)
  await new Promise<void>(resolve => setImmediate(resolve))
  events.length = 0
  controller.device = device
  assert.equal(controller.state.headphonesConnected, true)
  controller.device = createDevice()
  assert.equal(controller.state.headphonesConnected, false)
  assert.equal(controller.state.microphoneConnected, false)
  assert.equal(controller.state.externalDeviceConnected, false)
  assert.deepEqual(events, [])
})

test('a newer report from a listener suppresses stale transitions from the earlier report', async t => {
  const device = createDevice()
  useHid(t, async () => [device])
  const controller = new DualShock4()
  await controller.connect()
  emitUsbReport(device, 0)
  await new Promise<void>(resolve => setImmediate(resolve))
  const events = listen(controller, device)
  controller.addEventListener('headphonesconnect', () => emitUsbReport(device, 0))
  emitUsbReport(device, 0xE0)
  assert.deepEqual(events, [
    'headphonesconnect', 'headphonesdisconnect', 'microphonedisconnect', 'externaldevicedisconnect'
  ])
})

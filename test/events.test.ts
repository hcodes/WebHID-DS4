import assert from 'node:assert/strict'
import test from 'node:test'

import { DualShock4 } from '../src'
import { DualShock4Interface } from '../src/state'
import { useHid, createDevice, loseDevice } from './helpers/hid'

test('emits lifecycle events once and exposes cleared state on disconnect', async (t) => {
  const device = createDevice()
  useHid(t, async () => [device])
  const controller = new DualShock4()
  const events: string[] = []
  controller.addEventListener('connect', event => {
    assert.equal(event.detail.device, device)
    assert.equal(controller.device, device)
    events.push('connect')
  })
  controller.addEventListener('disconnect', event => {
    assert.equal(event.detail.device, device)
    assert.equal(event.detail.reason, 'manual')
    assert.equal(controller.device, undefined)
    events.push('disconnect')
  })
  await Promise.all([controller.connect(), controller.connect()])
  await controller.connect()
  await Promise.all([controller.disconnect(), controller.disconnect()])
  await controller.disconnect()
  assert.deepEqual(events, ['connect', 'disconnect'])
})

test('device loss clears state, aborts pending output, and ignores other devices', async (t) => {
  const device = createDevice()
  useHid(t, async () => [device])
  const controller = new DualShock4()
  const reasons: string[] = []
  controller.addEventListener('disconnect', event => reasons.push(event.detail.reason))
  await controller.connect()
  const pending = assert.rejects(controller.lightbar.setColorRGB(1, 2, 3), { name: 'AbortError' })
  loseDevice(createDevice())
  assert.equal(controller.device, device)
  loseDevice(device)
  loseDevice(device)
  await pending
  assert.equal(controller.device, undefined)
  assert.equal(device.oninputreport, null)
  assert.equal(controller.firmwareInfo, null)
  assert.equal(controller.state.interface, DualShock4Interface.Disconnected)
  assert.deepEqual(reasons, ['device-lost'])
  await controller.connect()
  await controller.disconnect()
  assert.deepEqual(reasons, ['device-lost', 'manual'])
})

test('concurrent connect waits for firmware and device loss aborts initialization', async (t) => {
  let started!: () => void
  const reading = new Promise<void>(resolve => { started = resolve })
  let finish!: (report: DataView) => void
  const device = createDevice({
    receiveFeatureReport () {
      started()
      return new Promise<DataView>(resolve => { finish = resolve })
    }
  })
  useHid(t, async () => [device])
  const controller = new DualShock4()
  const events: string[] = []
  controller.addEventListener('connect', () => events.push('connect'))
  controller.addEventListener('disconnect', () => events.push('disconnect'))
  const first = assert.rejects(controller.connect(), { name: 'AbortError' })
  await reading
  let settled = false
  const second = assert.rejects(controller.connect().finally(() => { settled = true }), { name: 'AbortError' })
  await Promise.resolve()
  assert.equal(settled, false)
  loseDevice(device)
  await Promise.all([first, second])
  finish(new DataView(new ArrayBuffer(0)))
  assert.deepEqual(events, [])
  assert.equal(controller.device, undefined)
})

test('close failure emits no disconnect until the session actually ends', async (t) => {
  const device = createDevice({ async close () { throw new Error('close failed') } })
  useHid(t, async () => [device])
  const controller = new DualShock4()
  let count = 0
  controller.addEventListener('disconnect', () => { count++ })
  await controller.connect()
  await assert.rejects(controller.disconnect(), /close failed/)
  assert.equal(count, 0)
  assert.equal(controller.device, device)
  loseDevice(device)
  assert.equal(count, 1)
})

test('cancellation and open failure emit no connection event', async (t) => {
  let devices: HIDDevice[] = []
  useHid(t, async () => devices)
  const controller = new DualShock4()
  let count = 0
  controller.addEventListener('connect', () => { count++ })
  assert.equal(await controller.connect(), false)
  devices = [createDevice({ async open () { throw new Error('open failed') } })]
  await assert.rejects(controller.connect(), /open failed/)
  assert.equal(count, 0)
})

test('device loss during open aborts connection without waiting for open', { timeout: 1000 }, async (t) => {
  let started!: () => void
  const opening = new Promise<void>(resolve => { started = resolve })
  let finish!: () => void
  const device = createDevice({
    open () {
      started()
      return new Promise<void>(resolve => { finish = resolve })
    }
  })
  useHid(t, async () => [device])
  const controller = new DualShock4()
  const connection = assert.rejects(controller.connect(), { name: 'AbortError' })
  await opening
  loseDevice(device)
  await connection
  finish()
  assert.equal(controller.device, undefined)
})

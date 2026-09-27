import assert from 'node:assert/strict'
import test from 'node:test'
import { DualShock4 } from '../src'
import { authenticationDevice, useTestAuthority } from './helpers/authentication'
import { deferred } from './helpers/deferred'
import { createDevice, loseDevice, useHid } from './helpers/hid'
import { createFirmwareReport } from './helpers/reports'

for (const bluetooth of [false, true]) {
  test(`${bluetooth ? 'Bluetooth' : 'USB'} connects and refreshes metadata before background authentication completes`, async t => {
    await useTestAuthority(t)
    const { device } = authenticationDevice({ bluetooth })
    const blocked = deferred<void>()
    const send = device.sendFeatureReport.bind(device)
    device.sendFeatureReport = async (id, data) => { await blocked.promise; return send(id, data) }
    useHid(t, async () => [device])
    const controller = new DualShock4()
    t.after(() => controller.disconnect())
    assert.equal(controller.isCloneChecking, false)
    const result = deferred<boolean | null>()
    controller.addEventListener('clonecheck', event => {
      assert.equal(event.detail.device, device)
      assert.equal(controller.isClone, event.detail.isClone)
      assert.equal(controller.isCloneChecking, false)
      result.resolve(event.detail.isClone)
    })
    const connection = controller.connect()
    await new Promise<void>(resolve => setImmediate(resolve))
    assert.equal(await Promise.race([connection, Promise.resolve('pending')]), true)
    assert.equal(controller.isClone, null)
    assert.equal(controller.isCloneChecking, true)
    assert.equal(controller.firmwareInfo?.boardModel, 'JDM-050')
    const refresh = controller.readFirmwareInfo()
    await new Promise<void>(resolve => setImmediate(resolve))
    assert.notEqual(await Promise.race([refresh, Promise.resolve('pending')]), 'pending')
    assert.equal(controller.isCloneChecking, true)
    blocked.resolve()
    assert.equal(await result.promise, false)
  })
}

for (const reason of ['manual', 'device-lost'] as const) {
  test(`${reason} disconnect cancels background authentication and ignores a late native response`, async t => {
    const { device, requests } = authenticationDevice()
    const blocked = deferred<void>()
    let writes = 0
    device.sendFeatureReport = async () => { writes++; await blocked.promise }
    useHid(t, async () => [device])
    const controller = new DualShock4()
    t.after(() => controller.disconnect())
    let results = 0
    controller.addEventListener('clonecheck', () => { results++ })
    const connection = controller.connect()
    await new Promise<void>(resolve => setImmediate(resolve))
    assert.equal(await Promise.race([connection, Promise.resolve('pending')]), true)
    assert.equal(writes, 1)
    assert.equal(controller.isCloneChecking, true)
    if (reason === 'manual') {
      const disconnection = controller.disconnect()
      assert.equal(controller.isCloneChecking, false)
      await disconnection
    } else {
      loseDevice(device)
      assert.equal(controller.isCloneChecking, false)
    }
    blocked.resolve()
    await new Promise<void>(resolve => setImmediate(resolve))
    assert.equal(controller.device, undefined)
    assert.equal(controller.isClone, null)
    assert.equal(controller.isCloneChecking, false)
    assert.equal(results, 0)
    assert.equal(writes, 1)
    assert.deepEqual(requests, [0xA3])
  })
}

test('a completion from a previous device cannot overwrite the replacement', async t => {
  const { device } = authenticationDevice()
  const oldWrite = deferred<void>()
  device.sendFeatureReport = () => oldWrite.promise
  let selected = device
  useHid(t, async () => [selected])
  const controller = new DualShock4()
  t.after(() => controller.disconnect())
  const connection = controller.connect()
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(await Promise.race([connection, Promise.resolve('pending')]), true)
  loseDevice(device)
  selected = createDevice({ receiveFeatureReport: async () => createFirmwareReport({ includesReportId: true }) })
  const completed: HIDDevice[] = []
  controller.addEventListener('clonecheck', event => { completed.push(event.detail.device) })
  await controller.connect()
  oldWrite.resolve()
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(controller.device, selected)
  assert.equal(controller.isClone, null)
  assert.equal(controller.isCloneChecking, false)
  assert.deepEqual(completed, [selected])
})

test('a refresh clears an old result while a new background check is pending', async t => {
  await useTestAuthority(t)
  const { device } = authenticationDevice()
  useHid(t, async () => [device])
  const controller = new DualShock4()
  t.after(() => controller.disconnect())
  const first = deferred<void>()
  controller.addEventListener('clonecheck', () => first.resolve(), { once: true })
  await controller.connect()
  await first.promise
  assert.equal(controller.isClone, false)
  assert.equal(controller.isCloneChecking, false)
  device.sendFeatureReport = () => new Promise(() => {})
  await controller.readFirmwareInfo()
  assert.equal(controller.isClone, null)
  assert.equal(controller.isCloneChecking, true)
  await controller.disconnect()
  assert.equal(controller.isCloneChecking, false)
})

test('an authentication communication failure finishes checking with an unknown result', async t => {
  const { device } = authenticationDevice()
  device.sendFeatureReport = async () => { throw new Error('Connection failed') }
  useHid(t, async () => [device])
  const controller = new DualShock4()
  t.after(() => controller.disconnect())
  const result = deferred<boolean | null>()
  controller.addEventListener('clonecheck', event => {
    assert.equal(controller.isCloneChecking, false)
    result.resolve(event.detail.isClone)
  }, { once: true })
  await controller.connect()
  assert.equal(await result.promise, null)
  assert.equal(controller.isCloneChecking, false)
})

test('a cancelled previous check cannot clear the checking flag of a replacement device', async t => {
  const { device } = authenticationDevice()
  const oldWrite = deferred<void>()
  device.sendFeatureReport = () => oldWrite.promise
  useHid(t, async () => [device])
  const controller = new DualShock4()
  t.after(() => controller.disconnect())
  await controller.connect()
  const { device: replacement } = authenticationDevice()
  Object.assign(replacement, { opened: true })
  replacement.sendFeatureReport = () => new Promise(() => {})
  controller.device = replacement
  assert.equal(controller.isCloneChecking, false)
  await controller.readFirmwareInfo()
  assert.equal(controller.isCloneChecking, true)
  oldWrite.resolve()
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(controller.isCloneChecking, true)
  await controller.disconnect()
  assert.equal(controller.isCloneChecking, false)
})

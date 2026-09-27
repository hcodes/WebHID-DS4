import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash, createPublicKey } from 'node:crypto'
import { DualShock4 } from '../src'
import { authenticationDevice, useTestAuthority } from './helpers/authentication'
import { createDevice, useHid } from './helpers/hid'
import { deferred } from './helpers/deferred'

function nextResult (controller: DualShock4): Promise<boolean | null> {
  return new Promise(resolve => controller.addEventListener('clonecheck', event => resolve(event.detail.isClone), { once: true }))
}

for (const bluetooth of [false, true]) {
  test(`${bluetooth ? 'Bluetooth' : 'USB'} verifies the certificate and random challenge with RSA-PSS`, async t => {
    await useTestAuthority(t)
    const { device, requests, challenges, writes } = authenticationDevice({ bluetooth, nested: true, paddedStatus: true })
    useHid(t, async () => [device])
    const controller = new DualShock4()
    const result = nextResult(controller)
    assert.equal(await controller.connect(), true)
    assert.equal(await result, false)
    assert.equal(controller.isClone, false)
    assert.equal(controller.firmwareInfo?.boardModel, 'JDM-050')
    assert.deepEqual(requests, [0xA3, 0xF2, ...new Array(19).fill(0xF1)])
    assert.deepEqual(writes.map(data => data[1]), [0, 1, 2, 3, 4])
    const refreshed = nextResult(controller)
    await controller.readFirmwareInfo()
    assert.equal(await refreshed, false)
    assert.equal(controller.isClone, false)
    assert.notDeepEqual(challenges[0], challenges[1])
    assert.notEqual(writes[0][0], writes[5][0])
  })
  for (const failure of ['certificate', 'challenge'] as const) {
    test(`${bluetooth ? 'Bluetooth' : 'USB'} rejects an invalid ${failure} signature`, async t => {
      await useTestAuthority(t)
      const { device } = authenticationDevice({ bluetooth, failure })
      useHid(t, async () => [device])
      const controller = new DualShock4()
      const result = nextResult(controller)
      await controller.connect()
      assert.equal(await result, true)
      assert.equal(controller.isClone, true)
    })
  }
}

test('a self-signed controller certificate cannot replace the pinned Sony authority', async t => {
  const { device } = authenticationDevice()
  useHid(t, async () => [device])
  const controller = new DualShock4()
  const result = nextResult(controller)
  await controller.connect()
  assert.equal(await result, true)
  assert.equal(controller.isClone, true)
})

test('the authority is pinned to the Sony Jedi CA fingerprint', async t => {
  const importKey = crypto.subtle.importKey.bind(crypto.subtle)
  let fingerprint: string | undefined
  t.mock.method(crypto.subtle, 'importKey', (...args: Parameters<typeof importKey>) => {
    const publicKey = createPublicKey({ key: args[1] as JsonWebKey, format: 'jwk' })
    fingerprint = createHash('sha256').update(publicKey.export({ format: 'der', type: 'spki' })).digest('hex')
    return importKey(...args)
  })
  const { device } = authenticationDevice()
  useHid(t, async () => [device])
  const controller = new DualShock4()
  const result = nextResult(controller)
  await controller.connect()
  await result
  assert.equal(fingerprint, 'e5e095e643b5688b400c757b4c44efacc2936148e5cebd6c6d410f54f1487f49')
})

test('authentication is independent of firmware metadata', async t => {
  await useTestAuthority(t)
  const { device } = authenticationDevice({ bluetooth: true, firmwareFails: true, includesReportId: false })
  useHid(t, async () => [device])
  const controller = new DualShock4()
  const result = nextResult(controller)
  await controller.connect()
  assert.equal(await result, false)
  assert.equal(controller.firmwareInfo, null)
  assert.equal(controller.isClone, false)
})

for (const failure of ['crc', 'sequence', 'page', 'truncated', 'read', 'write'] as const) {
  test(`authentication ${failure} failure leaves authenticity unknown`, async t => {
    const { device } = authenticationDevice({ failure })
    useHid(t, async () => [device])
    const controller = new DualShock4()
    const result = nextResult(controller)
    await controller.connect()
    assert.equal(await result, null)
    assert.equal(controller.isClone, null)
    assert.notEqual(controller.firmwareInfo, null)
  })
}

for (const failure of ['pending', 'write timeout'] as const) {
  test(`authentication has a total 30-second deadline (${failure})`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const { device, requests } = authenticationDevice({ failure })
    useHid(t, async () => [device])
    const controller = new DualShock4()
    const result = nextResult(controller)
    const connection = controller.connect()
    await new Promise<void>(resolve => setImmediate(resolve))
    assert.equal(await Promise.race([connection, Promise.resolve('pending')]), true)
    if (failure === 'pending') assert.equal(requests.includes(0xF2), true)
    t.mock.timers.tick(29999)
    await new Promise<void>(resolve => setImmediate(resolve))
    assert.equal(await Promise.race([result, Promise.resolve('pending')]), 'pending')
    t.mock.timers.tick(1)
    await new Promise<void>(resolve => setImmediate(resolve))
    assert.equal(await Promise.race([result, Promise.resolve('pending')]), null)
    assert.equal(controller.isClone, null)
  })
}

test('missing authentication reports are unknown rather than clone evidence', async t => {
  const device = createDevice()
  useHid(t, async () => [device])
  const controller = new DualShock4()
  await controller.connect()
  assert.equal(controller.isClone, null)
})

test('simultaneous refreshes share one authentication exchange', async t => {
  await useTestAuthority(t)
  const { device, challenges } = authenticationDevice()
  useHid(t, async () => [device])
  const controller = new DualShock4()
  const initial = nextResult(controller)
  await controller.connect()
  await initial
  const result = nextResult(controller)
  await Promise.all([controller.readFirmwareInfo(), controller.readFirmwareInfo()])
  assert.equal(await result, false)
  assert.equal(controller.isClone, false)
  assert.equal(challenges.length, 2)
})

test('a timed-out native write must settle before another challenge can start', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  await useTestAuthority(t)
  const { device, challenges } = authenticationDevice()
  const blocked = deferred<void>()
  const send = device.sendFeatureReport.bind(device)
  let writes = 0
  device.sendFeatureReport = async (id, data) => {
    if (++writes === 1) await blocked.promise
    return send(id, data)
  }
  useHid(t, async () => [device])
  const controller = new DualShock4()
  const result = nextResult(controller)
  const connection = controller.connect()
  await new Promise<void>(resolve => setImmediate(resolve))
  t.mock.timers.tick(30000)
  assert.equal(await connection, true)
  assert.equal(await result, null)
  const blockedResult = nextResult(controller)
  await controller.readFirmwareInfo()
  assert.equal(await blockedResult, null)
  assert.equal(writes, 1)
  assert.equal(controller.isClone, null)
  blocked.resolve()
  await new Promise<void>(resolve => setImmediate(resolve))
  const retried = nextResult(controller)
  await controller.readFirmwareInfo()
  assert.equal(await retried, false)
  assert.equal(controller.isClone, false)
  assert.equal(challenges.length, 1)
})

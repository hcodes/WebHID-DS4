import assert from 'node:assert/strict'
import test from 'node:test'

import { DualShock4 } from '../src'
import { deferred } from './helpers/deferred'
import { useHid, createDevice } from './helpers/hid'
import { createFirmwareReport } from './helpers/reports'

test('connect reads and exposes a report-ID-free Sony firmware report after opening', async (t) => {
  const reportIds: number[] = []
  let openedWhenRead = false
  const device = createDevice({ receiveFeatureReport: async function (reportId) {
    reportIds.push(reportId)
    openedWhenRead = this.opened
    return createFirmwareReport({ includesReportId: false, byteOffset: 7 })
  } })
  useHid(t, async () => [device])

  const controller = new DualShock4()

  assert.equal(await controller.connect(), true)
  assert.equal(openedWhenRead, true)
  assert.deepEqual(reportIds, [0xA3, 0x81])
  assert.deepEqual(controller.firmwareInfo, {
    buildDate: 'Aug  3 2013',
    buildTime: '07:01:12',
    hardwareVersion: 0xA000,
    hardwareVersionHex: '0xA000',
    boardModel: 'JDM-050',
    firmwareVersion: 0x0100,
    firmwareVersionHex: '0x0100'
  })
})

test('connect stops waiting for an unresponsive firmware report after one second', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let reportRequested = false
  const device = createDevice({ receiveFeatureReport: () => {
    reportRequested = true
    return new Promise(() => {})
  } })
  useHid(t, async () => [device])

  const controller = new DualShock4()
  const connection = controller.connect()
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(reportRequested, true)

  t.mock.timers.tick(999)
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(await Promise.race([connection, Promise.resolve('pending')]), 'pending')

  t.mock.timers.tick(1)
  await new Promise<void>(resolve => setImmediate(resolve))

  assert.equal(await Promise.race([connection, Promise.resolve('pending')]), true)
  assert.equal(controller.isClone, true)
})

test('connect accepts a full Sony firmware report that includes report ID 0xA3', async (t) => {
  const device = createDevice({ receiveFeatureReport: async () => createFirmwareReport({
    includesReportId: true,
    hardwareVersion: 0x6404,
    firmwareVersion: 0x7009
  }) })
  useHid(t, async () => [device])

  const controller = new DualShock4()

  assert.equal(await controller.connect(), true)
  assert.deepEqual(controller.firmwareInfo, {
    buildDate: 'Aug  3 2013',
    buildTime: '07:01:12',
    hardwareVersion: 0x6404,
    hardwareVersionHex: '0x6404',
    boardModel: 'JDM-040',
    firmwareVersion: 0x7009,
    firmwareVersionHex: '0x7009'
  })
})

test('firmware information maps known hardware versions to board models', async (t) => {
  const cases = [
    { hardwareVersion: 0x3100, boardModel: 'JDM-001' },
    { hardwareVersion: 0x4300, boardModel: 'JDM-011' },
    { hardwareVersion: 0x5400, boardModel: 'JDM-030' },
    { hardwareVersion: 0x6400, boardModel: 'JDM-040' },
    { hardwareVersion: 0x7400, boardModel: 'JDM-040' },
    { hardwareVersion: 0x8100, boardModel: 'JDM-020' },
    { hardwareVersion: 0x8300, boardModel: 'JDM-020' },
    { hardwareVersion: 0x9300, boardModel: 'JDM-020' },
    { hardwareVersion: 0x9000, boardModel: 'JDM-050' },
    { hardwareVersion: 0xA000, boardModel: 'JDM-050' },
    { hardwareVersion: 0xA400, boardModel: 'JDM-050' },
    { hardwareVersion: 0xB000, boardModel: 'JDM-055' },
    { hardwareVersion: 0xB400, boardModel: 'JDM-055' },
    { hardwareVersion: 0xFF00, boardModel: null }
  ] as const

  for (const { hardwareVersion, boardModel } of cases) {
    const device = createDevice({ receiveFeatureReport: async () => createFirmwareReport({
      includesReportId: false,
      hardwareVersion
    }) })
    useHid(t, async () => [device])
    const controller = new DualShock4()

    await controller.connect()

    assert.equal(
      (controller.firmwareInfo as unknown as { boardModel?: string | null })?.boardModel,
      boardModel
    )
  }
})

test('connect identifies a controller that supports report 0x81 as original', async (t) => {
  const device = createDevice({ receiveFeatureReport: async reportId => {
    if (reportId === 0xA3) return createFirmwareReport({ includesReportId: false })
    return new DataView(new ArrayBuffer(0))
  } })
  useHid(t, async () => [device])

  const controller = new DualShock4()

  assert.equal(await controller.connect(), true)
  assert.equal(
    controller.isClone,
    false
  )
})

test('connect identifies a controller that rejects report 0x81 as a clone', async (t) => {
  const device = createDevice({ receiveFeatureReport: async reportId => {
    if (reportId === 0xA3) return createFirmwareReport({ includesReportId: false })
    throw new DOMException('Feature report unavailable', 'NotSupportedError')
  } })
  useHid(t, async () => [device])

  const controller = new DualShock4()

  assert.equal(await controller.connect(), true)
  assert.equal(controller.isClone, true)
})

test('connect stops waiting for an unresponsive clone check after 250 ms', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let cloneProbeRequested = false
  const device = createDevice({ receiveFeatureReport: reportId => {
    if (reportId === 0xA3) {
      return Promise.resolve(createFirmwareReport({ includesReportId: false }))
    }
    cloneProbeRequested = true
    return new Promise(() => {})
  } })
  useHid(t, async () => [device])

  const controller = new DualShock4()
  const connection = controller.connect()
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(cloneProbeRequested, true)

  t.mock.timers.tick(249)
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(await Promise.race([connection, Promise.resolve('pending')]), 'pending')

  t.mock.timers.tick(1)
  await new Promise<void>(resolve => setImmediate(resolve))

  assert.equal(await Promise.race([connection, Promise.resolve('pending')]), true)
  assert.equal(controller.isClone, true)
  assert.notEqual(controller.firmwareInfo, null)
})

test('readFirmwareInfo refreshes the exposed firmware information', async (t) => {
  let firmwareVersion = 0x0100
  const device = createDevice({ receiveFeatureReport: async () => createFirmwareReport({
    includesReportId: false,
    firmwareVersion
  }) })
  useHid(t, async () => [device])

  const controller = new DualShock4()
  await controller.connect()
  firmwareVersion = 0x7009

  const firmwareInfo = await controller.readFirmwareInfo()

  assert.equal(firmwareInfo?.firmwareVersion, 0x7009)
  assert.equal(firmwareInfo?.firmwareVersionHex, '0x7009')
  assert.equal(controller.firmwareInfo, firmwareInfo)
})

test('an older firmware read cannot overwrite a newer refresh', async (t) => {
  const olderRefresh = deferred<DataView>()
  const newerRefresh = deferred<DataView>()
  let requestCount = 0
  const device = createDevice({ receiveFeatureReport: async reportId => {
    if (reportId === 0x81) return new DataView(new ArrayBuffer(0))
    requestCount++
    if (requestCount === 1) return createFirmwareReport({ includesReportId: false })
    return requestCount === 2 ? olderRefresh.promise : newerRefresh.promise
  } })
  useHid(t, async () => [device])

  const controller = new DualShock4()
  await controller.connect()

  const olderRead = controller.readFirmwareInfo()
  const newerRead = controller.readFirmwareInfo()
  newerRefresh.resolve(createFirmwareReport({
    includesReportId: false,
    firmwareVersion: 0x7009
  }))
  await newerRead
  olderRefresh.resolve(createFirmwareReport({
    includesReportId: false,
    firmwareVersion: 0x0100
  }))
  await olderRead

  assert.equal(controller.firmwareInfo?.firmwareVersion, 0x7009)
  assert.equal(controller.isClone, false)
})

test('an older failed firmware read cannot clear a newer refresh', async (t) => {
  const olderRefresh = deferred<DataView>()
  const newerRefresh = deferred<DataView>()
  let requestCount = 0
  const device = createDevice({ receiveFeatureReport: async reportId => {
    if (reportId === 0x81) return new DataView(new ArrayBuffer(0))
    requestCount++
    if (requestCount === 1) return createFirmwareReport({ includesReportId: false })
    return requestCount === 2 ? olderRefresh.promise : newerRefresh.promise
  } })
  useHid(t, async () => [device])

  const controller = new DualShock4()
  await controller.connect()

  const olderRead = controller.readFirmwareInfo()
  const newerRead = controller.readFirmwareInfo()
  newerRefresh.resolve(createFirmwareReport({
    includesReportId: false,
    firmwareVersion: 0x7009
  }))
  await newerRead
  olderRefresh.reject(new DOMException('Feature report unavailable', 'NotSupportedError'))
  await olderRead

  assert.equal(controller.firmwareInfo?.firmwareVersion, 0x7009)
  assert.equal(controller.isClone, false)
})

test('connect succeeds without firmware information when a clone rejects report 0xA3', async (t) => {
  const device = createDevice({ receiveFeatureReport: async () => {
    throw new DOMException('Feature report unavailable', 'NotSupportedError')
  } })
  useHid(t, async () => [device])

  const controller = new DualShock4()

  assert.equal(await controller.connect(), true)
  assert.equal(controller.firmwareInfo, null)
  assert.equal(controller.isClone, true)
})

test('malformed firmware reports are ignored without exposing misleading versions', async (t) => {
  const malformedReports = [
    new DataView(new ArrayBuffer(47)),
    new DataView(new ArrayBuffer(50)),
    new DataView(Uint8Array.from([0xA2, ...new Uint8Array(48)]).buffer),
    new DataView(new ArrayBuffer(48)),
    createFirmwareReport({ includesReportId: false })
  ]
  malformedReports[4].setUint8(0, 0x01)

  for (const report of malformedReports) {
    const device = createDevice({ receiveFeatureReport: async () => report })
    useHid(t, async () => [device])
    const controller = new DualShock4()

    assert.equal(await controller.connect(), true)
    assert.equal(controller.firmwareInfo, null)
    assert.equal(controller.isClone, true)
  }
})

test('readFirmwareInfo requires an open controller', async (t) => {
  useHid(t, async () => [])
  const controller = new DualShock4()

  await assert.rejects(
    () => controller.readFirmwareInfo(),
    /Controller not connected/
  )
})

test('disconnect clears firmware information from the previous controller', async (t) => {
  const device = createDevice({ receiveFeatureReport: async () => createFirmwareReport({ includesReportId: false }) })
  useHid(t, async () => [device])

  const controller = new DualShock4()
  await controller.connect()
  assert.notEqual(controller.firmwareInfo, null)
  assert.equal(controller.isClone, false)

  await controller.disconnect()

  assert.equal(controller.firmwareInfo, null)
  assert.equal(controller.isClone, null)
})

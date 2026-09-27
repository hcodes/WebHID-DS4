import assert from 'node:assert/strict'
import test from 'node:test'

import { DualShock4 } from '../src'
import { deferred } from './helpers/deferred'
import { useHid, createDevice } from './helpers/hid'
import { createFirmwareReport } from './helpers/reports'

const bluetoothCollection: HIDCollectionInfo = {
  usagePage: 1,
  usage: 5,
  type: 1,
  inputReports: [{ reportId: 0x01, items: [] }, { reportId: 0x11, items: [] }],
  outputReports: [{ reportId: 0x11, items: [] }],
  featureReports: [{ reportId: 0xA3, items: [] }],
  children: []
}

for (const nested of [false, true]) {
  test(`Bluetooth clone status stays unknown before input arrives (${nested ? 'nested' : 'top-level'} collection)`, async (t) => {
    const reportIds: number[] = []
    const device = createDevice({
      collections: [nested ? {
        usagePage: 1, usage: 5, type: 1, children: [bluetoothCollection]
      } : bluetoothCollection],
      async receiveFeatureReport (reportId) {
        reportIds.push(reportId)
        if (reportId === 0xA3) return createFirmwareReport({ includesReportId: true })
        throw new DOMException('USB-only report unavailable over Bluetooth', 'NotSupportedError')
      }
    })
    useHid(t, async () => [device])
    const controller = new DualShock4()

    assert.equal(await controller.connect(), true)
    assert.equal(controller.isClone, null)
    assert.equal(controller.firmwareInfo?.boardModel, 'JDM-050')
    assert.deepEqual(reportIds, [0xA3])

    assert.notEqual(await controller.readFirmwareInfo(), null)
    assert.equal(controller.isClone, null)
    assert.deepEqual(reportIds, [0xA3, 0xA3])
  })
}

for (const outcome of ['rejection', 'malformed report', 'timeout']) {
  test(`Bluetooth firmware ${outcome} is not evidence of a clone`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const device = createDevice({
      collections: [bluetoothCollection],
      async receiveFeatureReport () {
        if (outcome === 'rejection') throw new DOMException('Read failed', 'NetworkError')
        if (outcome === 'timeout') return new Promise<DataView>(() => {})
        return new DataView(new ArrayBuffer(0))
      }
    })
    useHid(t, async () => [device])
    const controller = new DualShock4()
    const connection = controller.connect()

    if (outcome === 'timeout') {
      await new Promise<void>(resolve => setImmediate(resolve))
      t.mock.timers.tick(1000)
    }

    assert.equal(await connection, true)
    assert.equal(controller.firmwareInfo, null)
    assert.equal(controller.isClone, null)
  })
}

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
  assert.deepEqual(reportIds, [0xA3])
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
  assert.equal(controller.isClone, null)
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
  const device = createDevice({ receiveFeatureReport: async () => {
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
  assert.equal(controller.isClone, null)
})

test('an older failed firmware read cannot clear a newer refresh', async (t) => {
  const olderRefresh = deferred<DataView>()
  const newerRefresh = deferred<DataView>()
  let requestCount = 0
  const device = createDevice({ receiveFeatureReport: async () => {
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
  assert.equal(controller.isClone, null)
})

test('connect succeeds without firmware information when a controller rejects report 0xA3', async (t) => {
  const device = createDevice({ receiveFeatureReport: async () => {
    throw new DOMException('Feature report unavailable', 'NotSupportedError')
  } })
  useHid(t, async () => [device])

  const controller = new DualShock4()

  assert.equal(await controller.connect(), true)
  assert.equal(controller.firmwareInfo, null)
  assert.equal(controller.isClone, null)
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
    assert.equal(controller.isClone, null)
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
  assert.equal(controller.isClone, null)

  await controller.disconnect()

  assert.equal(controller.firmwareInfo, null)
  assert.equal(controller.isClone, null)
})

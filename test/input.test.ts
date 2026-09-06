import assert from 'node:assert/strict'
import test from 'node:test'

import { DualShock4 } from '../src'
import { DualShock4Interface } from '../src/state'
import { useHid, createDevice, loseDevice } from './helpers/hid'
import { emitUsbReport, createBluetoothReportData, setTouchPoint } from './helpers/reports'

test('keeps controller state independent between instances', (t) => {
  useHid(t, async () => [])

  const firstController = new DualShock4()
  const secondController = new DualShock4()

  assert.notEqual(firstController.state, secondController.state)
  assert.notEqual(firstController.state.axes, secondController.state.axes)
  assert.notEqual(firstController.state.buttons, secondController.state.buttons)
  assert.notEqual(firstController.state.touchpad, secondController.state.touchpad)
  assert.notEqual(firstController.state.touchpad.touches, secondController.state.touchpad.touches)

  firstController.state.interface = DualShock4Interface.Bluetooth
  firstController.state.batteryCapacity = 95
  firstController.state.batteryStatus = 'discharging'
  firstController.state.axes.leftStickX = 1
  firstController.state.buttons.cross = true
  firstController.state.touchpad.touches.push({ touchId: 1, x: 100, y: 200 })

  assert.equal(secondController.state.interface, DualShock4Interface.Disconnected)
  assert.equal(secondController.state.batteryCapacity, null)
  assert.equal(secondController.state.batteryStatus, 'unknown')
  assert.equal(secondController.state.axes.leftStickX, 0)
  assert.equal(secondController.state.buttons.cross, false)
  assert.deepEqual(secondController.state.touchpad.touches, [])
})

test('parses a Bluetooth input report from its DataView byte offset', async (t) => {
  const device = createDevice()
  useHid(t, async () => [device])

  const controller = new DualShock4()
  await controller.connect()
  controller.state.interface = DualShock4Interface.Bluetooth

  device.oninputreport?.call(device, {
    device,
    reportId: 0x11,
    data: createBluetoothReportData(8),
    timeStamp: 42
  } as HIDInputReportEvent)

  assert.equal(controller.state.axes.leftStickX, 1)
  assert.equal(controller.state.timestamp, 42)
})

test('ignores Bluetooth input reports with an invalid payload length', async (t) => {
  const device = createDevice()
  useHid(t, async () => [device])

  const controller = new DualShock4()
  await controller.connect()
  controller.state.interface = DualShock4Interface.Bluetooth
  controller.state.axes.leftStickX = 0.25
  controller.state.timestamp = 7
  const validReport = createBluetoothReportData()
  const validData = new Uint8Array(
    validReport.buffer,
    validReport.byteOffset,
    validReport.byteLength
  )

  for (const byteLength of [76, 78]) {
    const data = new Uint8Array(byteLength)
    data.set(validData.subarray(0, Math.min(byteLength, validData.byteLength)))

    device.oninputreport?.call(device, {
      device,
      reportId: 0x11,
      data: new DataView(data.buffer),
      timeStamp: byteLength
    } as HIDInputReportEvent)

    assert.equal(controller.state.axes.leftStickX, 0.25, `${byteLength}-byte payload`)
    assert.equal(controller.state.timestamp, 7, `${byteLength}-byte payload`)
  }
})

test('bootstraps Bluetooth from a minimal Bluetooth report without clone detection', async (t) => {
  const featureReportRequests: number[] = []
  const device = createDevice({
    async receiveFeatureReport (reportId) {
      featureReportRequests.push(reportId)
      return new DataView(new ArrayBuffer(0))
    }
  })
  useHid(t, async () => [device])

  const controller = new DualShock4()
  await controller.connect()
  controller.isClone = false

  for (const timeStamp of [1, 2]) {
    device.oninputreport?.call(device, {
      device,
      reportId: 0x01,
      data: new DataView(new Uint8Array([0x80, 0x80, 0x80, 0x80, 0x08, 0, 0, 0, 0]).buffer),
      timeStamp
    } as HIDInputReportEvent)
  }

  assert.equal(controller.state.interface, DualShock4Interface.Bluetooth)
  assert.deepEqual(featureReportRequests, [0xA3, 0x02])
})

test('ignores a Bluetooth input report with an invalid CRC', async (t) => {
  const featureReportRequests: number[] = []
  const device = createDevice({
    async receiveFeatureReport (reportId) {
      featureReportRequests.push(reportId)
      return new DataView(new ArrayBuffer(0))
    }
  })
  useHid(t, async () => [device])

  const controller = new DualShock4()
  await controller.connect()
  const initialTimestamp = controller.state.timestamp
  const data = createBluetoothReportData()
  data.setUint8(73, data.getUint8(73) ^ 0xFF)

  device.oninputreport?.call(device, {
    device,
    reportId: 0x11,
    data,
    timeStamp: 42
  } as HIDInputReportEvent)

  assert.equal(controller.state.interface, DualShock4Interface.Disconnected)
  assert.equal(controller.state.timestamp, initialTimestamp)
  assert.deepEqual(featureReportRequests, [0xA3])

  controller.state.interface = DualShock4Interface.Bluetooth
  controller.state.axes.leftStickX = 0.25

  device.oninputreport?.call(device, {
    device,
    reportId: 0x11,
    data,
    timeStamp: 43
  } as HIDInputReportEvent)

  assert.equal(controller.state.axes.leftStickX, 0.25)
  assert.equal(controller.state.timestamp, initialTimestamp)
})

test('ignores a queued input report from a replaced device', async (t) => {
  const firstDevice = createDevice()
  const secondReportIds: number[] = []
  const secondDevice = createDevice({
    async sendReport (reportId) {
      secondReportIds.push(reportId)
    }
  })
  let requestCount = 0
  useHid(t, async () => [requestCount++ === 0 ? firstDevice : secondDevice])

  const controller = new DualShock4()
  await controller.connect()
  const staleReportHandler = firstDevice.oninputreport
  assert.ok(staleReportHandler)

  Object.assign(firstDevice, { opened: false })
  await controller.connect()
  const update = controller.rumble.setRumbleIntensity(64, 192)

  staleReportHandler.call(firstDevice, {
    device: firstDevice,
    reportId: 0x01,
    data: new DataView(new ArrayBuffer(63)),
    timeStamp: 1
  } as HIDInputReportEvent)
  await Promise.resolve()

  assert.equal(controller.state.interface, DualShock4Interface.Disconnected)
  assert.deepEqual(secondReportIds, [])

  secondDevice.oninputreport?.call(secondDevice, {
    device: secondDevice,
    reportId: 0x11,
    data: createBluetoothReportData(),
    timeStamp: 2
  } as HIDInputReportEvent)
  await update

  assert.equal(controller.state.interface, DualShock4Interface.Bluetooth)
  assert.deepEqual(secondReportIds, [0x11])
})

test('requests the Bluetooth feature report only once', async (t) => {
  const featureReportRequests: number[] = []
  const device = createDevice({
    async receiveFeatureReport (reportId) {
      featureReportRequests.push(reportId)
      return new DataView(new ArrayBuffer(0))
    }
  })
  useHid(t, async () => [device])

  const controller = new DualShock4()
  await controller.connect()

  const report = {
    device,
    reportId: 0x11,
    data: createBluetoothReportData(),
    timeStamp: 1
  } as HIDInputReportEvent

  device.oninputreport?.call(device, report)
  device.oninputreport?.call(device, report)

  assert.deepEqual(featureReportRequests, [0xA3, 0x02])
})

test('maps DualShock 4 battery data to capacity and status', async (t) => {
  const device = createDevice()
  useHid(t, async () => [device])

  const controller = new DualShock4()
  await controller.connect()
  controller.state.interface = DualShock4Interface.Disconnected

  const cases = [
    { raw: 0x00, capacity: 5, status: 'discharging' },
    { raw: 0x04, capacity: 45, status: 'discharging' },
    { raw: 0x09, capacity: 95, status: 'discharging' },
    { raw: 0x0A, capacity: 100, status: 'discharging' },
    { raw: 0x10, capacity: 5, status: 'charging' },
    { raw: 0x19, capacity: 95, status: 'charging' },
    { raw: 0x1A, capacity: 100, status: 'charging' },
    { raw: 0x1B, capacity: 100, status: 'full' },
    { raw: 0x1C, capacity: null, status: 'unknown' },
    { raw: 0x1D, capacity: null, status: 'unknown' },
    { raw: 0x1E, capacity: null, status: 'error' },
    { raw: 0x1F, capacity: null, status: 'error' }
  ]

  for (const expected of cases) {
    emitUsbReport(device, expected.raw)

    assert.equal(controller.state.batteryCapacity, expected.capacity, `raw status 0x${expected.raw.toString(16)}`)
    assert.equal(controller.state.batteryStatus, expected.status, `raw status 0x${expected.raw.toString(16)}`)
  }
})

test('reads motion sensors as signed little-endian values from the DualShock 4 report', async (t) => {
  const device = createDevice()
  useHid(t, async () => [device])

  const controller = new DualShock4()
  await controller.connect()

  const data = new Uint8Array(63)
  const view = new DataView(data.buffer)
  view.setInt16(12, -32768, true)
  view.setInt16(14, 0x1234, true)
  view.setInt16(16, -2, true)
  view.setInt16(18, 0x5678, true)
  view.setInt16(20, -12345, true)
  view.setInt16(22, 32767, true)

  device.oninputreport?.call(device, {
    device,
    reportId: 0x01,
    data: view,
    timeStamp: 1
  } as HIDInputReportEvent)

  assert.deepEqual(
    {
      gyroX: controller.state.axes.gyroX,
      gyroY: controller.state.axes.gyroY,
      gyroZ: controller.state.axes.gyroZ,
      accelX: controller.state.axes.accelX,
      accelY: controller.state.axes.accelY,
      accelZ: controller.state.axes.accelZ
    },
    {
      gyroX: -32768,
      gyroY: 0x1234,
      gyroZ: -2,
      accelX: 0x5678,
      accelY: -12345,
      accelZ: 32767
    }
  )
})

test('uses the newest touchpad frame reported by the DualShock 4', async (t) => {
  const device = createDevice()
  useHid(t, async () => [device])

  const controller = new DualShock4()
  await controller.connect()

  const data = new Uint8Array(63)
  data[32] = 3
  setTouchPoint(data, 0, 0, 1, 100, 200)
  setTouchPoint(data, 0, 1, 2, 300, 400)
  setTouchPoint(data, 1, 0, 1, 500, 600)
  setTouchPoint(data, 1, 1, 2, 700, 800)
  setTouchPoint(data, 2, 0, 1, 900, 942)
  setTouchPoint(data, 2, 1, 2, 1919, 0, false)

  device.oninputreport?.call(device, {
    device,
    reportId: 0x01,
    data: new DataView(data.buffer),
    timeStamp: 1
  } as HIDInputReportEvent)

  assert.deepEqual(controller.state.touchpad.touches, [
    { touchId: 1, x: 900, y: 942 }
  ])
})

test('clears touchpad touches when the DualShock 4 reports no touch frames', async (t) => {
  const device = createDevice()
  useHid(t, async () => [device])

  const controller = new DualShock4()
  await controller.connect()

  controller.state.touchpad.touches.push({ touchId: 7, x: 100, y: 200 })

  const data = new Uint8Array(63)
  data[32] = 0

  device.oninputreport?.call(device, {
    device,
    reportId: 0x01,
    data: new DataView(data.buffer),
    timeStamp: 1
  } as HIDInputReportEvent)

  assert.deepEqual(controller.state.touchpad.touches, [])
})

test('ignores stale input from an earlier session of the same HIDDevice', async (t) => {
  const device = createDevice()
  useHid(t, async () => [device])
  const controller = new DualShock4()
  await controller.connect()
  const stale = device.oninputreport!
  loseDevice(device)
  await controller.connect()
  stale.call(device, {
    device, reportId: 0x01, data: new DataView(new ArrayBuffer(63)), timeStamp: 5
  } as HIDInputReportEvent)
  assert.equal(controller.lastReport, undefined)
  assert.equal(controller.state.interface, DualShock4Interface.Disconnected)
  await controller.disconnect()
})

for (const format of ['minimal', 'full']) {
  test(`handles a rejected Bluetooth initialization request from a ${format} report`, async (t) => {
    const failure = new Error('Bluetooth feature report unavailable')
    const device = createDevice({
      async receiveFeatureReport (reportId) {
        if (reportId === 0x02) throw failure
        return new DataView(new ArrayBuffer(0))
      }
    })
    useHid(t, async () => [device])
    const errors: unknown[] = []
    t.mock.method(console, 'error', (error: unknown) => errors.push(error))
    const controller = new DualShock4()
    await controller.connect()
    const report = {
      device, reportId: format === 'minimal' ? 0x01 : 0x11,
      data: format === 'minimal' ? new DataView(new ArrayBuffer(9)) : createBluetoothReportData(),
      timeStamp: 1
    } as HIDInputReportEvent
    device.oninputreport?.call(device, report)
    device.oninputreport?.call(device, report)
    await new Promise<void>(resolve => setImmediate(resolve))
    assert.deepEqual(errors, [failure])
    assert.equal(controller.state.interface, DualShock4Interface.Bluetooth)
    await controller.disconnect()
  })
}

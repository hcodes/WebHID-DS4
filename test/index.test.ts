import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'

import { DualShock4 } from '../src'
import { DualShock4Interface } from '../src/state'

function useHid (t: TestContext, requestDevice: () => Promise<HIDDevice[]>) {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')

  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      hid: {
        requestDevice
      }
    }
  })

  t.after(() => {
    if (navigatorDescriptor) {
      Object.defineProperty(globalThis, 'navigator', navigatorDescriptor)
    } else {
      delete (globalThis as { navigator?: Navigator }).navigator
    }
  })
}

function createDevice (overrides: Partial<HIDDevice> = {}): HIDDevice {
  return Object.assign(new EventTarget(), {
    opened: false,
    vendorId: 0x054C,
    productId: 0x09CC,
    productName: 'Wireless Controller',
    collections: [],
    oninputreport: null,
    async open () {
      this.opened = true
    },
    async close () {},
    async forget () {},
    async sendReport () {},
    async sendFeatureReport () {},
    async receiveFeatureReport () {
      return new DataView(new ArrayBuffer(0))
    }
  }, overrides) as unknown as HIDDevice
}

function emitUsbReport (device: HIDDevice, batteryStatus: number) {
  const data = new Uint8Array(63)
  data[29] = batteryStatus

  device.oninputreport?.call(device, {
    device,
    reportId: 0x01,
    data: new DataView(data.buffer),
    timeStamp: 1
  } as HIDInputReportEvent)
}

function createBluetoothReportData (byteOffset = 0): DataView {
  const buffer = new ArrayBuffer(byteOffset + 77 + 8)
  const data = new Uint8Array(buffer, byteOffset, 77)

  data[2] = 0xFF
  // CRC-32 for [0xA1, 0x11, ...data.slice(0, 73)], stored little-endian.
  data.set([0x12, 0x47, 0x1B, 0x51], 73)

  return new DataView(buffer, byteOffset, data.byteLength)
}

function setTouchPoint (
  data: Uint8Array,
  frameIndex: number,
  pointIndex: number,
  touchId: number,
  x: number,
  y: number,
  active = true
) {
  const offset = 34 + frameIndex * 9 + pointIndex * 4

  data[offset] = touchId | (active ? 0 : 0x80)
  data[offset + 1] = x & 0xFF
  data[offset + 2] = (x >> 8) & 0x0F | (y & 0x0F) << 4
  data[offset + 3] = y >> 4
}

test('returns false when device selection is cancelled', async (t) => {
  useHid(t, async () => [])

  const controller = new DualShock4()

  assert.equal(await controller.init(), false)
  assert.equal(controller.device, undefined)
})

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

test('propagates device selection errors', async (t) => {
  const requestError = new DOMException('Permission denied', 'SecurityError')
  useHid(t, async () => {
    throw requestError
  })

  const controller = new DualShock4()

  await assert.rejects(
    () => controller.init(),
    error => error === requestError
  )
  assert.equal(controller.device, undefined)
})

test('returns true when device initialization succeeds', async (t) => {
  const device = createDevice()
  useHid(t, async () => [device])

  const controller = new DualShock4()

  assert.equal(await controller.init(), true)
  assert.equal(controller.device, device)
  assert.equal(device.opened, true)
})

test('shares one device initialization between concurrent init calls', async (t) => {
  let finishOpen!: () => void
  const openFinished = new Promise<void>((resolve) => {
    finishOpen = resolve
  })
  let openCount = 0
  const device = createDevice({
    async open () {
      openCount++
      await openFinished
      Object.assign(this, { opened: true })
    }
  })
  let requestCount = 0
  useHid(t, async () => {
    requestCount++
    return [device]
  })

  const controller = new DualShock4()
  const firstInit = controller.init()
  const secondInit = controller.init()

  await Promise.resolve()

  assert.equal(requestCount, 1)
  assert.equal(openCount, 1)

  finishOpen()
  assert.deepEqual(await Promise.all([firstInit, secondInit]), [true, true])
})

test('defers an early lightbar update until a USB input report identifies the interface', async (t) => {
  const sentReports: Array<{ reportId: number, data: Uint8Array }> = []
  const device = createDevice({
    async sendReport (reportId, data) {
      sentReports.push({ reportId, data: new Uint8Array(data) })
    }
  })
  useHid(t, async () => [device])

  const controller = new DualShock4()
  await controller.init()

  const update = controller.lightbar.setColorRGB(170, 255, 0)

  assert.deepEqual(sentReports, [])

  emitUsbReport(device, 0x10)
  await update

  assert.equal(controller.state.interface, DualShock4Interface.USB)
  assert.equal(sentReports.length, 1)
  assert.equal(sentReports[0].reportId, 0x05)
  assert.equal(sentReports[0].data.byteLength, 31)
  assert.deepEqual(
    Array.from(sentReports[0].data.slice(5, 8)),
    [170, 255, 0]
  )
})

test('sends the protocol-required 32-byte USB output report', async (t) => {
  const sentReports: Array<{ reportId: number, data: Uint8Array }> = []
  const device = createDevice({
    async sendReport (reportId, data) {
      sentReports.push({ reportId, data: new Uint8Array(data) })
    }
  })
  useHid(t, async () => [device])

  const controller = new DualShock4()
  await controller.init()
  controller.state.interface = DualShock4Interface.USB

  await controller.sendLocalState()

  assert.equal(sentReports.length, 1)
  assert.equal(sentReports[0].reportId, 0x05)
  assert.equal(sentReports[0].data.byteLength + 1, 32)
})

test('sets only rumble and lightbar valid flags in USB output reports', async (t) => {
  const sentReports: Uint8Array[] = []
  const device = createDevice({
    async sendReport (_reportId, data) {
      sentReports.push(new Uint8Array(data))
    }
  })
  useHid(t, async () => [device])

  const controller = new DualShock4()
  await controller.init()
  controller.state.interface = DualShock4Interface.USB

  await controller.sendLocalState()

  assert.equal(sentReports.length, 1)
  assert.equal(sentReports[0][0], 0x03)
})

test('sets only rumble and lightbar valid flags in Bluetooth output reports', async (t) => {
  const sentReports: Uint8Array[] = []
  const device = createDevice({
    async sendReport (_reportId, data) {
      sentReports.push(new Uint8Array(data))
    }
  })
  useHid(t, async () => [device])

  const controller = new DualShock4()
  await controller.init()
  controller.state.interface = DualShock4Interface.Bluetooth

  await controller.sendLocalState()

  assert.equal(sentReports.length, 1)
  assert.equal(sentReports[0][2], 0x03)
})

test('sends the default player-one blue when USB becomes ready without early output', async (t) => {
  const sentReports: Array<{ reportId: number, data: Uint8Array }> = []
  const device = createDevice({
    async sendReport (reportId, data) {
      sentReports.push({ reportId, data: new Uint8Array(data) })
    }
  })
  useHid(t, async () => [device])

  const controller = new DualShock4()
  await controller.init()

  emitUsbReport(device, 0x10)
  await Promise.resolve()

  assert.equal(sentReports.length, 1)
  assert.equal(sentReports[0].reportId, 0x05)
  assert.deepEqual(
    Array.from(sentReports[0].data.slice(5, 8)),
    [0, 0, 64]
  )
})

test('keeps early output pending when an unsupported input report arrives', async (t) => {
  const sentReportIds: number[] = []
  const device = createDevice({
    async sendReport (reportId) {
      sentReportIds.push(reportId)
    }
  })
  useHid(t, async () => [device])

  const controller = new DualShock4()
  await controller.init()

  const update = controller.rumble.setRumbleIntensity(64, 192)

  device.oninputreport?.call(device, {
    device,
    reportId: 0x01,
    data: new DataView(new ArrayBuffer(64)),
    timeStamp: 1
  } as HIDInputReportEvent)
  await Promise.resolve()

  assert.equal(controller.state.interface, DualShock4Interface.Disconnected)
  assert.deepEqual(sentReportIds, [])

  emitUsbReport(device, 0x10)
  await update

  assert.deepEqual(sentReportIds, [0x05])
})

test('sends an early lightbar update as Bluetooth after a valid Bluetooth input report', async (t) => {
  const sentReports: Array<{ reportId: number, data: Uint8Array }> = []
  const device = createDevice({
    async sendReport (reportId, data) {
      sentReports.push({ reportId, data: new Uint8Array(data) })
    }
  })
  useHid(t, async () => [device])

  const controller = new DualShock4()
  await controller.init()

  const update = controller.lightbar.setColorRGB(170, 255, 0)

  device.oninputreport?.call(device, {
    device,
    reportId: 0x11,
    data: createBluetoothReportData(),
    timeStamp: 1
  } as HIDInputReportEvent)
  await Promise.resolve()

  assert.equal(controller.state.interface, DualShock4Interface.Bluetooth)
  assert.equal(sentReports.length, 1)
  assert.equal(sentReports[0].reportId, 0x11)
  assert.equal(sentReports[0].data.byteLength, 77)
  assert.deepEqual(
    Array.from(sentReports[0].data.slice(7, 10)),
    [170, 255, 0]
  )
  await update
})

test('parses a Bluetooth input report from its DataView byte offset', async (t) => {
  const device = createDevice()
  useHid(t, async () => [device])

  const controller = new DualShock4()
  await controller.init()
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
  await controller.init()
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

test('ignores a Bluetooth input report with an invalid CRC', async (t) => {
  let featureReportRequests = 0
  const device = createDevice({
    async receiveFeatureReport () {
      featureReportRequests++
      return new DataView(new ArrayBuffer(0))
    }
  })
  useHid(t, async () => [device])

  const controller = new DualShock4()
  await controller.init()
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
  assert.equal(featureReportRequests, 0)

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

test('coalesces early output updates into one report with the latest state', async (t) => {
  const sentReports: Uint8Array[] = []
  const device = createDevice({
    async sendReport (_reportId, data) {
      sentReports.push(new Uint8Array(data))
    }
  })
  useHid(t, async () => [device])

  const controller = new DualShock4()
  await controller.init()

  const obsoleteColorUpdate = controller.lightbar.setColorRGB(255, 0, 0)
  const colorUpdate = controller.lightbar.setColorRGB(10, 20, 30)
  const rumbleUpdate = controller.rumble.setRumbleIntensity(64, 192)

  assert.deepEqual(sentReports, [])

  emitUsbReport(device, 0x10)
  await Promise.all([obsoleteColorUpdate, colorUpdate, rumbleUpdate])

  assert.equal(sentReports.length, 1)
  assert.deepEqual(
    Array.from(sentReports[0].slice(3, 8)),
    [64, 192, 10, 20, 30]
  )
})

test('keeps an early output promise pending until the device send completes', async (t) => {
  let finishSend!: () => void
  const sendFinished = new Promise<void>((resolve) => {
    finishSend = resolve
  })
  let sendStarted = false
  const device = createDevice({
    async sendReport () {
      sendStarted = true
      await sendFinished
    }
  })
  useHid(t, async () => [device])

  const controller = new DualShock4()
  await controller.init()

  let updateSettled = false
  const update = controller.lightbar.setColorRGB(10, 20, 30).then(() => {
    updateSettled = true
  })

  emitUsbReport(device, 0x10)
  await new Promise<void>((resolve) => setImmediate(resolve))

  assert.equal(sendStarted, true)
  assert.equal(updateSettled, false)

  finishSend()
  await update

  assert.equal(updateSettled, true)
})

test('rejects every coalesced update when the deferred device send fails', async (t) => {
  const sendError = new Error('Output failed')
  const device = createDevice({
    async sendReport () {
      throw sendError
    }
  })
  useHid(t, async () => [device])

  const controller = new DualShock4()
  await controller.init()

  const colorUpdate = controller.lightbar.setColorRGB(10, 20, 30)
  const rumbleUpdate = controller.rumble.setRumbleIntensity(64, 192)
  const colorFailure = assert.rejects(colorUpdate, error => error === sendError)
  const rumbleFailure = assert.rejects(rumbleUpdate, error => error === sendError)

  emitUsbReport(device, 0x10)

  await Promise.all([colorFailure, rumbleFailure])
})

test('waits for transport detection again when initialization selects another device', async (t) => {
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
  await controller.init()
  emitUsbReport(firstDevice, 0x10)

  Object.assign(firstDevice, { opened: false })
  await controller.init()

  const update = controller.rumble.setRumbleIntensity(64, 192)

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
  await controller.init()
  const staleReportHandler = firstDevice.oninputreport
  assert.ok(staleReportHandler)

  Object.assign(firstDevice, { opened: false })
  await controller.init()
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

test('carries pending output into the replacement device readiness cycle', async (t) => {
  const firstReportIds: number[] = []
  const firstDevice = createDevice({
    async sendReport (reportId) {
      firstReportIds.push(reportId)
    }
  })
  const secondReports: Array<{ reportId: number, data: Uint8Array }> = []
  const secondDevice = createDevice({
    async sendReport (reportId, data) {
      secondReports.push({ reportId, data: new Uint8Array(data) })
    }
  })
  let requestCount = 0
  useHid(t, async () => [requestCount++ === 0 ? firstDevice : secondDevice])

  const controller = new DualShock4()
  await controller.init()
  const update = controller.lightbar.setColorRGB(10, 20, 30)

  Object.assign(firstDevice, { opened: false })
  await controller.init()

  emitUsbReport(secondDevice, 0x10)
  await Promise.resolve()

  assert.deepEqual(firstReportIds, [])
  assert.equal(secondReports.length, 1)
  assert.equal(secondReports[0].reportId, 0x05)
  assert.deepEqual(
    Array.from(secondReports[0].data.slice(5, 8)),
    [10, 20, 30]
  )
  await update
})

test('returns true when the controller is already initialized', async (t) => {
  useHid(t, async () => {
    throw new Error('Device selection should not be requested')
  })

  const controller = new DualShock4()
  controller.device = createDevice({ opened: true })

  assert.equal(await controller.init(), true)
})

test('does not retain the selected device when opening fails', async (t) => {
  const openError = new Error('Failed to open device')
  const device = createDevice({
    async open () {
      throw openError
    }
  })
  useHid(t, async () => [device])

  const controller = new DualShock4()

  await assert.rejects(
    () => controller.init(),
    error => error === openError
  )
  assert.equal(controller.device, undefined)
})

test('requests the Bluetooth feature report only once', async (t) => {
  let featureReportRequests = 0
  const device = createDevice({
    async receiveFeatureReport (reportId) {
      assert.equal(reportId, 0x02)
      featureReportRequests++
      return new DataView(new ArrayBuffer(0))
    }
  })
  useHid(t, async () => [device])

  const controller = new DualShock4()
  await controller.init()

  const report = {
    device,
    reportId: 0x11,
    data: createBluetoothReportData(),
    timeStamp: 1
  } as HIDInputReportEvent

  device.oninputreport?.call(device, report)
  device.oninputreport?.call(device, report)

  assert.equal(featureReportRequests, 1)
})

test('maps DualShock 4 battery data to capacity and status', async (t) => {
  const device = createDevice()
  useHid(t, async () => [device])

  const controller = new DualShock4()
  await controller.init()
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
  await controller.init()

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
  await controller.init()

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
  await controller.init()

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

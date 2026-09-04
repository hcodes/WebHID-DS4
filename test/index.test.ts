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
    data: new DataView(new ArrayBuffer(77)),
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

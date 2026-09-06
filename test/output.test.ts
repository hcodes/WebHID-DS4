import assert from 'node:assert/strict'
import test from 'node:test'

import { DualShock4 } from '../src'
import { DualShock4Interface } from '../src/state'
import { useHid, createDevice, loseDevice } from './helpers/hid'
import { emitUsbReport, createBluetoothReportData } from './helpers/reports'

test('defers an early lightbar update until a USB input report identifies the interface', async (t) => {
  const sentReports: Array<{ reportId: number, data: Uint8Array }> = []
  const device = createDevice({
    async sendReport (reportId, data) {
      sentReports.push({ reportId, data: new Uint8Array(data) })
    }
  })
  useHid(t, async () => [device])

  const controller = new DualShock4()
  await controller.connect()

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
  await controller.connect()
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
  await controller.connect()
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
  await controller.connect()
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
  await controller.connect()

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
  await controller.connect()

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
  await controller.connect()

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

test('coalesces early output updates into one report with the latest state', async (t) => {
  const sentReports: Uint8Array[] = []
  const device = createDevice({
    async sendReport (_reportId, data) {
      sentReports.push(new Uint8Array(data))
    }
  })
  useHid(t, async () => [device])

  const controller = new DualShock4()
  await controller.connect()

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
  await controller.connect()

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
  await controller.connect()

  const colorUpdate = controller.lightbar.setColorRGB(10, 20, 30)
  const rumbleUpdate = controller.rumble.setRumbleIntensity(64, 192)
  const colorFailure = assert.rejects(colorUpdate, error => error === sendError)
  const rumbleFailure = assert.rejects(rumbleUpdate, error => error === sendError)

  emitUsbReport(device, 0x10)

  await Promise.all([colorFailure, rumbleFailure])
})

test('sends output reports sequentially with state captured at request time', async (t) => {
  let finishFirstSend!: () => void
  const firstSendFinished = new Promise<void>((resolve) => {
    finishFirstSend = resolve
  })
  const sentReports: Uint8Array[] = []
  const device = createDevice({
    async sendReport (_reportId, data) {
      sentReports.push(new Uint8Array(data))
      if (sentReports.length === 1) await firstSendFinished
    }
  })
  useHid(t, async () => [device])

  const controller = new DualShock4()
  await controller.connect()
  controller.state.interface = DualShock4Interface.USB

  const colorUpdate = controller.lightbar.setColorRGB(10, 20, 30)

  assert.equal(sentReports.length, 1)

  const rumbleUpdate = controller.rumble.setRumbleIntensity(64, 192)

  await new Promise<void>((resolve) => setImmediate(resolve))

  assert.equal(sentReports.length, 1)
  assert.deepEqual(
    Array.from(sentReports[0].slice(3, 8)),
    [0, 0, 10, 20, 30]
  )

  finishFirstSend()
  await Promise.all([colorUpdate, rumbleUpdate])

  assert.equal(sentReports.length, 2)
  assert.deepEqual(
    Array.from(sentReports[1].slice(3, 8)),
    [64, 192, 10, 20, 30]
  )
})

test('continues sending queued output after an earlier send fails', async (t) => {
  const sendError = new Error('First output failed')
  let failFirstSend!: () => void
  const firstSendFailed = new Promise<void>((_resolve, reject) => {
    failFirstSend = () => reject(sendError)
  })
  const sentReports: Uint8Array[] = []
  const device = createDevice({
    async sendReport (_reportId, data) {
      sentReports.push(new Uint8Array(data))
      if (sentReports.length === 1) await firstSendFailed
    }
  })
  useHid(t, async () => [device])

  const controller = new DualShock4()
  await controller.connect()
  controller.state.interface = DualShock4Interface.USB

  const colorUpdate = controller.lightbar.setColorRGB(10, 20, 30)
  const colorFailure = assert.rejects(colorUpdate, error => error === sendError)
  const rumbleUpdate = controller.rumble.setRumbleIntensity(64, 192)

  await new Promise<void>((resolve) => setImmediate(resolve))

  assert.equal(sentReports.length, 1)

  failFirstSend()
  await Promise.all([colorFailure, rumbleUpdate])

  assert.equal(sentReports.length, 2)
  assert.deepEqual(
    Array.from(sentReports[1].slice(3, 8)),
    [64, 192, 10, 20, 30]
  )
})

test('reports asynchronous output failures from property setters', async (t) => {
  const lightbarError = new Error('Lightbar output failed')
  const rumbleError = new Error('Rumble output failed')
  const errors = [lightbarError, rumbleError]
  const device = createDevice({
    async sendReport () {
      throw errors.shift()
    }
  })
  useHid(t, async () => [device])

  const loggedErrors: unknown[] = []
  const originalConsoleError = console.error
  console.error = (error) => loggedErrors.push(error)
  t.after(() => {
    console.error = originalConsoleError
  })

  const controller = new DualShock4()
  await controller.connect()
  controller.state.interface = DualShock4Interface.USB

  controller.lightbar.r = 10
  controller.rumble.light = 20

  await new Promise<void>((resolve) => setImmediate(resolve))

  assert.deepEqual(loggedErrors, [lightbarError, rumbleError])
})

test('waits for transport detection again when connect selects another device', async (t) => {
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
  emitUsbReport(firstDevice, 0x10)

  Object.assign(firstDevice, { opened: false })
  await controller.connect()

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
  await controller.connect()
  const update = controller.lightbar.setColorRGB(10, 20, 30)

  Object.assign(firstDevice, { opened: false })
  await controller.connect()

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

test('loss cancels queued writes and allows a fresh session before an old write settles', async (t) => {
  let finish!: () => void
  let block = false
  let writes = 0
  const device = createDevice({
    async sendReport () {
      writes++
      if (block) await new Promise<void>(resolve => { finish = resolve })
    }
  })
  useHid(t, async () => [device])
  const controller = new DualShock4()
  await controller.connect()
  emitUsbReport(device, 0x10)
  await controller.lightbar.setColorRGB(1, 2, 3)
  block = true
  const first = assert.rejects(controller.lightbar.setColorRGB(4, 5, 6), { name: 'AbortError' })
  // Let the first queued write enter sendReport before disconnecting.
  await new Promise<void>(resolve => setImmediate(resolve))
  const second = assert.rejects(controller.lightbar.setColorRGB(7, 8, 9), { name: 'AbortError' })
  const disconnect = controller.disconnect()
  loseDevice(device)
  await Promise.all([first, second, disconnect])
  const before = writes
  block = false
  await controller.connect()
  emitUsbReport(device, 0x10)
  await controller.lightbar.setColorRGB(10, 11, 12)
  assert.equal(writes, before + 2)
  finish()
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(writes, before + 2)
  await controller.disconnect()
})

test('reassigning the current device preserves the output queue', async (t) => {
  let release!: () => void
  let writes = 0
  const device = createDevice({
    async sendReport () {
      writes++
      if (writes === 1) await new Promise<void>(resolve => { release = resolve })
    }
  })
  useHid(t, async () => [device])
  const controller = new DualShock4()
  await controller.connect()
  controller.state.interface = DualShock4Interface.USB
  const first = controller.lightbar.setColorRGB(1, 2, 3)
  controller.device = device
  const second = controller.lightbar.setColorRGB(4, 5, 6)
  assert.equal(writes, 1)
  release()
  await Promise.all([first, second])
  assert.equal(writes, 2)
  await controller.disconnect()
})

test('lightbar and rumble retain the public sendLocalState override', async (t) => {
  useHid(t, async () => [])
  let updates = 0
  class CustomController extends DualShock4 {
    override async sendLocalState () { updates++ }
  }
  const controller = new CustomController()
  controller.device = createDevice({ opened: true })
  controller.state.interface = DualShock4Interface.USB
  await controller.lightbar.setColorRGB(1, 2, 3)
  await controller.rumble.setRumbleIntensity(4, 5)
  assert.equal(updates, 2)
  await controller.disconnect()
})

test('property updates during disconnect report errors asynchronously', async (t) => {
  let started!: () => void
  const closing = new Promise<void>(resolve => { started = resolve })
  let finish!: () => void
  const device = createDevice({
    async close () {
      started()
      await new Promise<void>(resolve => { finish = resolve })
      Object.assign(this, { opened: false })
    }
  })
  useHid(t, async () => [device])
  const controller = new DualShock4()
  await controller.connect()
  controller.state.interface = DualShock4Interface.USB
  const errors: unknown[] = []
  t.mock.method(console, 'error', (error: unknown) => errors.push(error))
  const disconnect = controller.disconnect()
  await closing
  assert.doesNotThrow(() => { controller.rumble.light = 1 })
  assert.doesNotThrow(() => { controller.lightbar.r = 2 })
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(errors.length, 2)
  for (const error of errors) assert.equal((error as DOMException).name, 'InvalidStateError')
  finish()
  await disconnect
})

test('loss immediately after transport detection cancels the coalesced update', async (t) => {
  let writes = 0
  const device = createDevice({ async sendReport () { writes++ } })
  useHid(t, async () => [device])
  const controller = new DualShock4()
  await controller.connect()
  const first = assert.rejects(controller.lightbar.setColorRGB(1, 2, 3), { name: 'AbortError' })
  const second = assert.rejects(controller.rumble.setRumbleIntensity(4, 5), { name: 'AbortError' })
  emitUsbReport(device, 0x10)
  loseDevice(device)
  await Promise.all([first, second])
  assert.equal(writes, 0)
})

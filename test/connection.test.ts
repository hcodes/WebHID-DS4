import assert from 'node:assert/strict'
import test from 'node:test'

import { DualShock4 } from '../src'
import { DualShock4Interface } from '../src/state'
import { useHid, createDevice } from './helpers/hid'
import { emitUsbReport } from './helpers/reports'

test('connect returns false when device selection is cancelled', async (t) => {
  useHid(t, async () => [])

  const controller = new DualShock4()

  assert.equal(await controller.connect(), false)
  assert.equal(controller.device, undefined)
})

test('propagates device selection errors', async (t) => {
  const requestError = new DOMException('Permission denied', 'SecurityError')
  useHid(t, async () => {
    throw requestError
  })

  const controller = new DualShock4()

  await assert.rejects(
    () => controller.connect(),
    error => error === requestError
  )
  assert.equal(controller.device, undefined)
})

test('returns true when the device connection succeeds', async (t) => {
  const device = createDevice()
  useHid(t, async () => [device])

  const controller = new DualShock4()

  assert.equal(await controller.connect(), true)
  assert.equal(controller.device, device)
  assert.equal(device.opened, true)
})

test('disconnect closes the HID session and clears controller state', async (t) => {
  let closeCount = 0
  let forgetCount = 0
  const device = createDevice({
    async close () {
      closeCount++
      Object.assign(this, { opened: false })
    },
    async forget () {
      forgetCount++
    }
  })
  useHid(t, async () => [device])

  const controller = new DualShock4()
  await controller.connect()
  emitUsbReport(device, 0x05)

  assert.equal(controller.state.interface, DualShock4Interface.USB)
  assert.notEqual(controller.lastReport, undefined)

  await controller.disconnect()

  assert.equal(closeCount, 1)
  assert.equal(forgetCount, 0)
  assert.equal(device.oninputreport, null)
  assert.equal(controller.device, undefined)
  assert.equal(controller.lastReport, undefined)
  assert.equal(controller.lastSentReport, undefined)
  assert.equal(controller.state.interface, DualShock4Interface.Disconnected)
  assert.equal(controller.state.batteryCapacity, null)
  assert.equal(controller.state.batteryStatus, 'unknown')
})

test('shares one disconnection between concurrent disconnect calls', async (t) => {
  let finishClose!: () => void
  const closeFinished = new Promise<void>((resolve) => {
    finishClose = resolve
  })
  let closeCount = 0
  const device = createDevice({
    async close () {
      closeCount++
      await closeFinished
      Object.assign(this, { opened: false })
    }
  })
  useHid(t, async () => [device])

  const controller = new DualShock4()
  await controller.connect()

  const firstDisconnect = controller.disconnect()
  const secondDisconnect = controller.disconnect()

  await Promise.resolve()
  assert.equal(closeCount, 1)

  finishClose()
  await Promise.all([firstDisconnect, secondDisconnect])
  assert.equal(controller.device, undefined)
})

test('connect waits for disconnection before selecting another device', async (t) => {
  let finishClose!: () => void
  const closeFinished = new Promise<void>((resolve) => {
    finishClose = resolve
  })
  const firstDevice = createDevice({
    async close () {
      await closeFinished
      Object.assign(this, { opened: false })
    }
  })
  const secondDevice = createDevice()
  let requestCount = 0
  useHid(t, async () => [requestCount++ === 0 ? firstDevice : secondDevice])

  const controller = new DualShock4()
  await controller.connect()

  const disconnection = controller.disconnect()
  const reconnection = controller.connect()

  await Promise.resolve()
  assert.equal(requestCount, 1)

  finishClose()
  await disconnection

  assert.equal(await reconnection, true)
  assert.equal(requestCount, 2)
  assert.equal(controller.device, secondDevice)
})

test('disconnect waits for an in-flight connection and then closes it', async (t) => {
  let finishOpen!: () => void
  const openFinished = new Promise<void>((resolve) => {
    finishOpen = resolve
  })
  let closeCount = 0
  const device = createDevice({
    async open () {
      await openFinished
      Object.assign(this, { opened: true })
    },
    async close () {
      closeCount++
      Object.assign(this, { opened: false })
    }
  })
  useHid(t, async () => [device])

  const controller = new DualShock4()
  const connection = controller.connect()
  const disconnection = controller.disconnect()

  finishOpen()

  assert.equal(await connection, true)
  await disconnection
  assert.equal(closeCount, 1)
  assert.equal(controller.device, undefined)
})

test('disconnect aborts output waiting for transport detection', async (t) => {
  const device = createDevice()
  useHid(t, async () => [device])

  const controller = new DualShock4()
  await controller.connect()

  const update = controller.rumble.setRumbleIntensity(64, 192)
  await controller.disconnect()

  const result = await Promise.race([
    update.then(
      () => 'resolved',
      error => error instanceof DOMException ? error.name : 'unexpected-error'
    ),
    new Promise<string>((resolve) => setImmediate(() => resolve('pending')))
  ])

  assert.equal(result, 'AbortError')
})

test('disconnect stops rumble before closing an identified device', async (t) => {
  const events: string[] = []
  const device = createDevice({
    async close () {
      events.push('close')
      Object.assign(this, { opened: false })
    },
    async sendReport (_reportId, data) {
      const report = new Uint8Array(data)
      events.push(`rumble:${report[3]},${report[4]}`)
    }
  })
  useHid(t, async () => [device])

  const controller = new DualShock4()
  await controller.connect()
  emitUsbReport(device, 0x10)
  await controller.rumble.setRumbleIntensity(64, 192)
  events.length = 0

  await controller.disconnect()

  assert.deepEqual(events, ['rumble:0,0', 'close'])
  assert.equal(controller.rumble.light, 0)
  assert.equal(controller.rumble.heavy, 0)
})

test('restores an open controller when closing the HID session fails', async (t) => {
  const closeError = new Error('Failed to close device')
  let closeCount = 0
  const device = createDevice({
    async close () {
      closeCount++
      if (closeCount === 1) throw closeError
      Object.assign(this, { opened: false })
    }
  })
  let requestCount = 0
  useHid(t, async () => {
    requestCount++
    return [device]
  })

  const controller = new DualShock4()
  await controller.connect()
  emitUsbReport(device, 0x10)

  await assert.rejects(
    () => controller.disconnect(),
    error => error === closeError
  )

  assert.equal(controller.device, device)
  assert.equal(device.opened, true)
  assert.notEqual(device.oninputreport, null)
  assert.equal(controller.state.interface, DualShock4Interface.USB)
  assert.equal(await controller.connect(), true)
  assert.equal(requestCount, 1)

  await controller.disconnect()
  assert.equal(closeCount, 2)
  assert.equal(controller.device, undefined)
})

test('shares one device connection between concurrent connect calls', async (t) => {
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
  const firstConnection = controller.connect()
  const secondConnection = controller.connect()

  await Promise.resolve()

  assert.equal(requestCount, 1)
  assert.equal(openCount, 1)

  finishOpen()
  assert.deepEqual(await Promise.all([firstConnection, secondConnection]), [true, true])
})

test('returns true when the controller is already connected', async (t) => {
  useHid(t, async () => {
    throw new Error('Device selection should not be requested')
  })

  const controller = new DualShock4()
  controller.device = createDevice({ opened: true })

  assert.equal(await controller.connect(), true)
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
    () => controller.connect(),
    error => error === openError
  )
  assert.equal(controller.device, undefined)
})

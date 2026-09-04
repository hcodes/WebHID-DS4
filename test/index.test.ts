import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'

import { DualShock4 } from '../src'

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

test('returns false when device selection is cancelled', async (t) => {
  useHid(t, async () => [])

  const controller = new DualShock4()

  assert.equal(await controller.init(), false)
  assert.equal(controller.device, undefined)
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

import type { TestContext } from 'node:test'

export function useHid (t: TestContext, requestDevice: () => Promise<HIDDevice[]>) {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')

  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      hid: Object.assign(new EventTarget(), { requestDevice })
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

export function createDevice (overrides: Partial<HIDDevice> = {}): HIDDevice {
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
    async close () {
      this.opened = false
    },
    async forget () {},
    async sendReport () {},
    async sendFeatureReport () {},
    async receiveFeatureReport () {
      return new DataView(new ArrayBuffer(0))
    }
  }, overrides) as unknown as HIDDevice
}

export function loseDevice (device: HIDDevice) {
  Object.assign(device, { opened: false })
  navigator.hid.dispatchEvent(Object.assign(new Event('disconnect'), { device }))
}

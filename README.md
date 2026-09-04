# @hcodes/webhid-ps4

[![npm version](https://img.shields.io/npm/v/@hcodes/webhid-ps4.svg)](https://www.npmjs.com/package/@hcodes/webhid-ps4)
[![npm downloads](https://img.shields.io/npm/dm/@hcodes/webhid-ps4.svg)](https://www.npmjs.com/package/@hcodes/webhid-ps4)
[![npm package size](https://img.shields.io/npm/unpacked-size/@hcodes/webhid-ps4.svg)](https://www.npmjs.com/package/@hcodes/webhid-ps4)
[![fork of webhid-ds4@1.0.5](https://img.shields.io/badge/fork%20of-webhid--ds4%401.0.5-CB3837?logo=npm)](https://www.npmjs.com/package/webhid-ds4)

A maintained fork of `webhid-ds4` and a high-level, ESM-first browser API for
Sony DualShock 4 controllers, built on the experimental
[WebHID API](https://developer.mozilla.org/docs/Web/API/WebHID_API). It provides
controller input, motion and touchpad data, battery information, lightbar
control, and rumble over USB and Bluetooth.

> [!NOTE]
> The `@hcodes/webhid-ps4` package has not been published to npm yet. The badges
> and npm links will become active after its first release. This README
> documents the current `master` branch, based on upstream `webhid-ds4` 1.0.5.

## Requirements

- A desktop browser with WebHID support. The project targets the latest Chrome;
  check the current [browser compatibility table](https://developer.mozilla.org/docs/Web/API/WebHID_API#browser_compatibility)
  before using the library in production. WebHID is not currently available in
  Firefox, Safari, or Chrome for Android.
- A [secure context](https://developer.mozilla.org/docs/Web/Security/Secure_Contexts),
  such as HTTPS or localhost.
- A user action, such as a click or tap, to open the initial device picker.

## Features

- USB and Bluetooth input
- Buttons, D-pad, and normalized analog sticks and triggers
- Raw signed gyroscope and accelerometer data
- Up to two simultaneous touchpad contacts
- Battery capacity and charging status
- RGB and HSL lightbar control
- Light and heavy rumble motors
- Bundled TypeScript declarations

## Installation

```sh
npm install @hcodes/webhid-ps4
```

The current source and the next major release are distributed as an ES module:

```js
import { DualShock4 } from '@hcodes/webhid-ps4'
```

## Quick start

Add a connect button and an element for displaying the controller state:

```html
<button id="connectButton" type="button">Connect controller</button>
<pre id="controllerState"></pre>
```

Then request the controller from the button handler. `connect()` resolves to
`false` when the device picker is cancelled and rejects when access or opening
the selected device fails.

```js
import { DualShock4 } from '@hcodes/webhid-ps4'

const connectButton = document.querySelector('#connectButton')
const stateOutput = document.querySelector('#controllerState')

if (!connectButton || !stateOutput) {
  throw new Error('The controller UI is missing')
}

if (!navigator.hid || typeof navigator.hid.requestDevice !== 'function') {
  connectButton.disabled = true
  stateOutput.textContent = 'WebHID is not available in this browser or context.'
} else {
  connectButton.addEventListener('click', async () => {
    try {
      const controller = new DualShock4()

      if (!(await controller.connect())) return

      function renderState () {
        const { axes, buttons, batteryCapacity, batteryStatus } = controller.state

        stateOutput.textContent = JSON.stringify({
          leftStick: [axes.leftStickX, axes.leftStickY],
          rightStick: [axes.rightStickX, axes.rightStickY],
          crossPressed: buttons.cross,
          batteryCapacity,
          batteryStatus
        }, null, 2)

        requestAnimationFrame(renderState)
      }

      renderState()
    } catch (error) {
      console.error('Could not connect the DualShock 4 controller:', error)
    }
  })
}
```

The `state` object is updated when the library receives a supported controller
input report. Its main properties are:

| Property | Description |
| --- | --- |
| `interface` | `none`, `usb`, or `bt`; detected after the first supported input report |
| `batteryCapacity` | Estimated capacity from 0 to 100, or `null` when unavailable |
| `batteryStatus` | `discharging`, `charging`, `full`, `error`, or `unknown` |
| `axes` | Normalized sticks and triggers plus raw motion sensor values |
| `buttons` | Face, shoulder, D-pad, stick, PS, and touchpad buttons |
| `touchpad.touches` | Current touch contacts and their coordinates |
| `timestamp` | Timestamp of the most recent input report |

The asynchronous lightbar and rumble methods can be called immediately after
`connect()` succeeds. Until the first supported input report identifies USB or
Bluetooth, output is deferred. Multiple early updates are combined, and their
promises resolve after the latest lightbar and rumble state is sent using the
correct report format:

```js
await controller.lightbar.setColorRGB(170, 255, 0)

// Alternatively, use HSL values in the 0-1 range.
await controller.lightbar.setColorHSL(0.22, 1, 0.5)

await controller.rumble.setRumbleIntensity(64, 192)
```

Close the WebHID session when the controller is no longer needed. The method
is safe to call more than once and does not revoke the browser's permission to
use the device:

```js
await controller.disconnect()
```

A successful disconnection stops rumble, clears the current controller state,
and rejects output still waiting for transport detection with an `AbortError`.
If the browser fails to close a device that remains open, the active session is
restored and `disconnect()` rejects so it can be retried. The same `DualShock4`
instance can be connected again later.

## Recognized devices

The device picker currently recognizes these vendor and product IDs:

| Vendor | Product ID | Device / model |
| --- | --- | --- |
| Sony (`0x054C`) | `0x05C4` | DUALSHOCK 4 (`CUH-ZCT1`) |
| Sony (`0x054C`) | `0x09CC` | DUALSHOCK 4 v2 (`CUH-ZCT2`) |
| Sony (`0x054C`) | `0x0BA0` | DUALSHOCK 4 USB Wireless Adaptor (`CUH-ZWA1`) |
| Sony VID (`0x054C`) | `0x05C5` | Strike Pack FPS Dominator (no CUH model) |
| Razer (`0x1532`) | `0x1000`, `0x1007`, `0x1004`, `0x1009` | Raiju family |
| Nacon (`0x146B`) | `0x0D01`, `0x0D02`, `0x0D08` | Revolution family |
| Other third-party devices | `0x0F0D:0x00EE`, `0x7545:0x0104`, `0x2E95:0x7725`, `0x11C0:0x4001`, `0x0C12:0x57AB`, `0x0C12:0x0E16`, `0x0F0D:0x0084` | Compatibility IDs |

An ID in this list means that the browser picker allows the device to be
selected; it does not guarantee full report compatibility. The upstream
project was hardware-tested with a CUH-ZCT2U. Other revisions and third-party
controllers may behave differently, so hardware verification reports are
welcome.

## Known limitations

- The library does not yet expose high-level connection or disconnection
  events. Applications can use WebHID's native
  [`connect`](https://developer.mozilla.org/docs/Web/API/HID/connect_event) and
  [`disconnect`](https://developer.mozilla.org/docs/Web/API/HID/disconnect_event)
  events directly.
- A new `DualShock4` instance always opens the device picker. Previously
  granted devices can be discovered directly with
  [`navigator.hid.getDevices()`](https://developer.mozilla.org/docs/Web/API/HID/getDevices).
- Controller behavior may vary by operating system, firmware, connection type,
  and hardware revision.

## Changes since 1.0.5

The current source includes these breaking changes compared with the published
1.0.5 release:

- The CommonJS build has been removed. Use the ESM import shown above.
- `init()` has been replaced by `connect()`; use `disconnect()` to close the
  WebHID session when finished.
- `state.battery` has been replaced by `state.batteryCapacity`, which can be
  `null` when the controller reports an error or unknown value.
- `state.charging` has been replaced by `state.batteryStatus`. The exported
  `BatteryStatus` type distinguishes charging, discharging, full, error, and
  unknown states.

See the [changelog](./CHANGELOG.md) for the complete list of changes.

## Development

CI uses Node.js 26 and npm.

```sh
npm ci
npm test
npm run build
npm run build-docs
```

- `npm run build` creates the ESM bundle and TypeScript declarations in `dist`.
- `npm run build-docs` creates the demo and API reference in `dist-pages`.

## Links

- [Live demo](https://hcodes.github.io/WebHID-DS4/)
- [API reference](https://hcodes.github.io/WebHID-DS4/api/)
- [npm package](https://www.npmjs.com/package/@hcodes/webhid-ps4)
- [Changelog](./CHANGELOG.md)
- [MIT License](./LICENSE)

## Credits

Originally created by [TheBITLINK](https://github.com/TheBITLINK) as
[`webhid-ds4`](https://github.com/TheBITLINK/WebHID-DS4). This fork is
maintained by [hcodes](https://github.com/hcodes).

# @hcodes/webhid-ds4

[![npm version](https://img.shields.io/npm/v/@hcodes/webhid-ds4.svg)](https://www.npmjs.com/package/@hcodes/webhid-ds4)
[![npm downloads](https://img.shields.io/npm/dm/@hcodes/webhid-ds4.svg)](https://www.npmjs.com/package/@hcodes/webhid-ds4)
[![npm package size](https://img.shields.io/npm/unpacked-size/@hcodes/webhid-ds4.svg)](https://www.npmjs.com/package/@hcodes/webhid-ds4)

A maintained fork of `webhid-ds4` and a high-level, ESM-first browser API for
Sony DualShock 4 controllers, built on the experimental
[WebHID API](https://developer.mozilla.org/docs/Web/API/WebHID_API). It provides
controller input, motion and touchpad data, battery information, lightbar
control, and rumble over USB and Bluetooth.

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
- Up to two simultaneous touchpad contacts, with all frames and counters from the latest input report
- Battery capacity and charging status
- Firmware build, raw hardware/firmware versions, known board model, and clone check
- RGB and HSL lightbar control and hardware blinking
- Light and heavy rumble motors
- Optional headphone audio: support detection, explicit audio output selection, and live MediaStream playback
- Optional headset microphone: explicit input selection, live MediaStream capture, and automatic track cleanup
- Hardware volume control for the mono speaker, independent left/right headphone channels and headset microphone gain over HID
- Bundled TypeScript declarations

## Installation

```sh
npm install @hcodes/webhid-ds4
```

```js
import { DualShock4 } from '@hcodes/webhid-ds4'
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
import { DualShock4 } from '@hcodes/webhid-ds4'

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

After a successful connection, `firmwareInfo` contains metadata read from the
controller's feature report `0xA3`:

```js
if (await controller.connect()) {
  console.log(controller.firmwareInfo)
  // {
  //   buildDate: 'Aug  3 2013',
  //   buildTime: '07:01:12',
  //   hardwareVersion: 0xA000,
  //   hardwareVersionHex: '0xA000',
  //   boardModel: 'JDM-050',
  //   firmwareVersion: 0x0100,
  //   firmwareVersionHex: '0x0100'
  // }
  console.log(controller.isClone) // false for a controller that supports report 0x81
}
```

The same report is supported over USB and Bluetooth. Firmware and clone-check
feature reports time out after one second, so compatible controllers that do
not implement them cannot block `connect()`. Call
`await controller.readFirmwareInfo()` to refresh it. The method returns the
updated object, or `null` when a third-party controller does not implement the
report or returns malformed data. Reading firmware information therefore does
not prevent an otherwise compatible controller from connecting.

Hardware and firmware versions are raw 16-bit values supplied by the
controller. The hexadecimal properties preserve the four-digit notation used
by low-level controller tools and drivers. They are deliberately not converted
to semantic versions: Sony does not publish a DualShock 4 controller-firmware
release catalog that establishes such a mapping.

The `state` object is updated when the library receives a supported controller
input report. Its main properties are:

| Property | Description |
| --- | --- |
| `interface` | `none`, `usb`, or `bt`; detected after the first supported input report |
| `batteryCapacity` | Estimated capacity from 0 to 100, or `null` when unavailable |
| `batteryStatus` | `discharging`, `charging`, `full`, `error`, or `unknown` |
| `cableConnected` | Whether the controller reports a cable connected, independently of USB/Bluetooth transport |
| `externalDeviceConnected` | Whether the controller reports a device connected to its EXT accessory port |
| `headphonesConnected` | Whether the controller reports headphones connected to its 3.5 mm jack |
| `microphoneConnected` | Whether the controller reports a microphone connected to its 3.5 mm jack |
| `axes` | Normalized sticks and triggers plus raw motion sensor values |
| `buttons` | Face, shoulder, D-pad, stick, PS, and touchpad buttons |
| `touchpad.touches` | Current touch contacts and their coordinates |
| `touchpad.frames` | All touch frames from the most recent full input report, in reported order |
| `touchpad.frameCounter` | Raw counter of that report's last touch frame, 0-255, or `null` when no frames are available |
| `sensorTimestamp` | Raw controller sensor timestamp, 0-65535, or `null` before a full input report |
| `reportCounter` | Raw input report counter, 0-63, or `null` before the first input report |
| `timestamp` | Browser event timestamp of the most recent input report, in milliseconds |

`cableConnected`, `externalDeviceConnected`, `headphonesConnected` and
`microphoneConnected` are booleans
read from full USB and Bluetooth HID input reports. All default to `false` and
reset to `false` when the controller disconnects. Basic Bluetooth reports contain
no cable or accessory status and preserve the last values. The headphone and microphone
flags describe the controller's jack detection; browser audio routing, permissions
and capture are checked separately through `controller.audio.headphones` and
`controller.audio.microphone`.

`externalDeviceConnected` exposes the raw EXT flag from the controller's
[input status byte](https://www.psdevwiki.com/ps4/DS4-USB#Data_Format).
It does not identify the accessory or indicate an audio device connected to the OS.

`sensorTimestamp` preserves the controller's raw 16-bit timer and wraps from
65535 to 0; it is not converted to milliseconds. `reportCounter` preserves the
6-bit counter and wraps from 63 to 0. Both reset to `null` on disconnect.
Basic Bluetooth reports update `reportCounter` but preserve the last
`sensorTimestamp`, since they contain no sensor data.

Each `touchpad.frames` entry has `{ frameCounter, touches }`, including frames
with no active contacts. USB reports contain up to three frames and Bluetooth
reports up to four, as described in the [Linux DualShock 4 report structs](https://github.com/torvalds/linux/blob/master/drivers/hid/hid-playstation.c).
The array is replaced by each full report; it is not accumulated gesture history.
Counters are raw 8-bit values and wrap from 255 to 0; frames are not reordered or
deduplicated. `touchpad.touches` remains the active contacts from the last frame,
with an independent copy so changes to it do not modify stored frames.
When a full report has no frames, both arrays are empty and `frameCounter` is
`null`. Basic Bluetooth reports preserve these fields; disconnect resets them.

```js
for (const { frameCounter, touches } of controller.state.touchpad.frames) {
  console.log(frameCounter, touches)
}
```

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

Hardware lightbar blinking runs in the controller without JavaScript timers:

```js
await controller.lightbar.setBlink(500, 250) // 500 ms bright, 250 ms dark.
await controller.lightbar.setBlink(300) // Equal bright/dark intervals.
console.log(controller.lightbar.blinkOn, controller.lightbar.blinkOff) // 300, 300
await controller.lightbar.stopBlink() // Steady illumination; RGB is preserved.
```

Intervals are milliseconds, clamped to 0-2550 and rounded down to 10 ms units,
matching the [Linux DualShock 4 blink implementation](https://github.com/torvalds/linux/blob/master/drivers/hid/hid-playstation.c).
`NaN` and infinities are rejected without changing either interval. `stopBlink()`
sends both intervals as zero with the blink update flag set. These methods share
the ordered output queue with color, rumble and configured audio levels, including
deferred writes before USB/Bluetooth detection. They reject on send failure or
disconnect. No blink flag is sent until an explicit blink/stop request.
`blinkOn`/`blinkOff` are read-only cached requested intervals, initially `null`;
they do not read hardware state. Configured intervals remain in subsequent output
reports and across reconnection until changed; changing color preserves them.

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

### Connection events

Each `DualShock4` instance is an `EventTarget` with typed `connect` and
`disconnect` events. Subscribe before calling `connect()`:

```ts
controller.addEventListener('connect', ({ detail }) => {
  console.log('Connected:', detail.device.productName)
  console.log('Firmware:', controller.firmwareInfo)
})

controller.addEventListener('disconnect', ({ detail }) => {
  console.log('Disconnected:', detail.device.productName, detail.reason)
  // reason is 'manual' or 'device-lost'; controller state is already cleared.
})
```

- `connect` fires once after the session opens and firmware detection finishes,
  including when firmware information is unavailable. It does not wait for the
  first input report to identify USB or Bluetooth.
- `disconnect` fires once when an established session ends through `disconnect()`
  (`manual`) or WebHID reports device loss (`device-lost`). The event retains the
  previous `HIDDevice` in `detail.device`, while `controller.device` is cleared.
- Cancelled selection, failed initialization, and repeated calls on an already
  connected or disconnected controller do not produce extra events. Losing the
  device during initialization rejects `connect()` with `AbortError`, without
  emitting either event.
- A failed `close()` that leaves the device open does not emit `disconnect`.
  Device loss aborts pending output with `AbortError`; late operations and input
  reports from that session cannot update a new session.

Use `removeEventListener()`, `{ once: true }`, or `{ signal }` to manage
subscriptions. Reconnection remains explicit via `connect()`; native WebHID
`connect` events do not automatically open a controller session.


## Hardware audio volume

`controller.audio.speaker` controls the built-in mono speaker's hardware volume.
`controller.audio.headphones` controls the left and right headphone volume bytes,
as well as the browser playback API described below. Volume control uses WebHID
and requires no browser audio output selection or microphone permission.
`controller.audio.microphone.volume` controls the headset microphone's hardware
input gain, independently of browser capture.

```js
await controller.connect()

await controller.audio.speaker.setVolume(60)
await controller.audio.headphones.setVolume(67) // Same value for both channels.
await controller.audio.headphones.setVolume(50, 70) // Independent left/right levels.
await controller.audio.microphone.setVolume(64) // Headset microphone hardware gain.

console.log(controller.audio.speaker.volume) // 60
console.log(controller.audio.headphones.volumeLeft) // 50
console.log(controller.audio.headphones.volumeRight) // 70
console.log(controller.audio.microphone.volume) // 64

// Property setters send updates asynchronously, like lightbar/rumble setters.
controller.audio.speaker.volume = 40
controller.audio.headphones.volumeLeft = 55
controller.audio.headphones.volumeRight = 65
controller.audio.microphone.volume = 32
```

Values are raw HID bytes from 0 to 255, not percentages or a calibrated loudness
scale. Finite values are clamped to this range and rounded to the nearest integer;
`NaN` and infinities are rejected. Prefer `await setVolume(...)` to handle output
failures; property setters report asynchronous failures through `console.error`.
Updates requested after `connect()` but before transport detection are combined
with pending rumble/lightbar updates and sent once USB or Bluetooth is identified.

**Volume getters return the last values requested by this library.** The
documented HID reports do not provide a confirmed volume readback. Getters return
`null` before configuration and after endpoint reset or controller disconnect.
They do not detect changes made by the OS or another application and remain at
the requested values if sending fails. An unset channel is omitted from the HID
update flags, so configuring one channel does not mute another. Resetting the
cache does not mute hardware or restore its previous volume.
Reset or a new controller session rejects pending volume requests with
`AbortError`; unrelated pending rumble/lightbar updates are preserved.
Stopping microphone capture preserves its configured hardware gain; resetting
the microphone clears the gain cache as well as capture resources.

These controls are optional. Leave them unset when system audio settings provide
the desired controls. Once configured, cached levels are included in subsequent
HID output reports and may overwrite changes made by the OS or another app.

Volume bytes and individual channel flags follow the [DS4 Bluetooth report
layout](https://www.psdevwiki.com/ps4/DS4-BT#HID_OUTPUT_reports) and the
[DS4Windows volume flag mapping](https://gist.github.com/Ryochan7/d18a5c2413bfbc41c6efb620786ef363).
Audio routing flags are not changed; microphone gain is updated only when
explicitly configured. A successful HID send
does not confirm audible playback or hardware acceptance. Built-in speaker audio
streaming is not implemented, and volume writes do not enable an OS audio device
over ordinary Bluetooth. The headphone playback requirements below still apply.

## Headphone audio

`controller.audio.headphones` controls stereo playback through the controller's
3.5 mm headphone jack. The `DualShock4Headphones` class is a separate endpoint
inside `DualShock4Audio`; `controller.audio.speaker` exposes mono-speaker volume,
while built-in speaker audio streaming is not implemented.

Headphone audio uses an OS audio output through Web Audio, independently of HID
rumble/lightbar reports. It plays audio supplied by this page; it does not capture
system audio or change the system default output. No audio permission is requested
by `connect()` or `checkSupport()`.

### Check support

After connecting the controller:

```js
const headphones = controller.audio.headphones
const support = await headphones.checkSupport()
console.log(support.supported, support.reason, support.connection)
console.log(support.outputs, support.requiresAdapter)
```

| Field | Meaning |
| --- | --- |
| `supported` | `true`: a concrete output was explicitly selected, routed successfully and is still enumerated; `false`: the browser/session or standard hardware connection cannot provide this path; `null`: more information, permission or selection is needed |
| `reason` | Machine-readable diagnostic listed below |
| `outputs` | Label-matched candidates, plus the selected output; never proof of association with this HID controller |
| `connection` | `usb`, `bluetooth`, `sony-adapter`, or `unknown` before transport detection |
| `requiresAdapter` | Model-based recommendation: `true` for the standard v1 path and v2 over ordinary Bluetooth; `false` for v2 over USB, the Sony adapter or successful explicit routing; `null` for unknown hardware/transport. `false` does not prove that an audio output exists |

Common reasons are `selection-required`, `permission-or-device-unavailable`,
`permission-denied`, `output-unavailable`, `v1-usb-audio-unavailable`,
`bluetooth-audio-unavailable`, `insecure-context`, `api-unavailable`,
`controller-disconnected`, `enumeration-failed`, `routing-failed`, and `ready`.
Only `supported === true` enables playback. A permission failure does not prove
that the hardware lacks audio support. An empty or incomplete device list stays
unknown because the browser can hide devices and labels before permission.

The expected name is **Wireless Controller**, or **DUALSHOCK®4 USB Wireless Adaptor**
when using the Sony adapter. Headphones and microphones share the same
case-insensitive name check, including OS prefixes/suffixes and the adapter name
without `®` (`DUALSHOCK 4 USB Wireless Adaptor`). DualSense and multiple DS4 controllers
can have the same name. Browser media devices do not expose USB VID/PID or a
reliable HID-to-audio mapping, so the user must choose the correct headphone
output. A custom-labelled output can also be selected explicitly, including one
provided by an external driver.

### Permission, selection and playback

Use separate UI actions to grant access, select an output, and play sound:

```js
// Within an access button's click handler:
const outputs = await headphones.requestOutput()
// Populate a chooser with outputs: display label, use deviceId as the value.

// Within the chooser's change handler, using the user's selected value:
await headphones.setOutput(selectedDeviceId)
console.log((await headphones.checkSupport()).supported) // true if routed

// Within a play button click handler, pass a live MediaStream:
// e.g. a WebRTC stream, or a Web Audio MediaStreamDestination.stream.
await headphones.play(stream)

headphones.stop()
```

Handle rejections from these async methods in the application's UI. The demo
includes complete controls, error handling, and its own live oscillator test
stream passed to `play()`. The bundled `example.mp3` plays through a media element
connected to a MediaStreamDestination without reading the whole file into an
ArrayBuffer. Test-tone generation and media-source management belong to the demo.
The demo automatically routes a single matching controller output on connection,
after output access is granted, or when Check support is pressed. Multiple matches
require manual selection, and an existing selection is preserved.
The demo lists only controller-matched outputs. If none are visible, it hides the
selector and displays connection guidance.

- `requestOutput()` must be called from a user action. If supported, it opens
  `selectAudioOutput()` and returns the chosen concrete output as an array.
  Otherwise it requests `getUserMedia({ audio: true })`, stops every capture track
  immediately, and returns all visible concrete audio outputs for manual choice.
  It does not record or retain microphone audio. A native picker refusal does not
  trigger a second microphone permission prompt.
- `enumerateDevices()` itself does not require a click, but its list is subject
  to permissions. The native picker grants the selected device; the microphone
  fallback exposes the broader device list. OS-disabled or browser-blocked
  devices may still be absent.
- `setOutput(deviceId)` verifies routing with `AudioContext.setSinkId()` without
  playing sound. Empty, `default`, and `communications` IDs are rejected to avoid
  following a changing system default. A failed routing/selection attempt clears
  the old route. HID functionality remains available.
- `play(MediaStream)` connects a live stream to the selected headphone output
  using `createMediaStreamSource()`, replacing the previous source. It resolves
  when the stream is connected, not when it ends. Supply exactly one live audio
  track, which may carry mono or stereo audio. Mix multiple tracks upstream using
  Web Audio if needed. The library never accumulates or decodes an entire file.
  Call from a click to satisfy autoplay restrictions. A producer AudioContext may
  also need to be resumed by the application.
- `stop()` disconnects the source and cancels pending resume, preserving the
  route. The caller owns the MediaStream and its tracks: `stop()`, `reset()`,
  output changes and controller disconnection never call `track.stop()`. Stop
  upstream playback/capture separately when the application no longer needs it. `reset()` disconnects playback, clears routing and releases device listeners;
  the endpoint can be used again after an explicit selection.
- On controller disconnection or removal of the selected audio device, playback
  stops and the route is cleared. Pending work cannot revive an old session. A
  disconnect attempt also clears audio when HID closing fails; select the output
  again after such a failure. There is no automatic fallback to default speakers.

Listen for endpoint changes and recheck support rather than caching it forever:

```js
headphones.addEventListener('change', async () => {
  const support = await headphones.checkSupport()
  // Refresh status and disable playback unless support.supported === true.
})
```

`change` also fires after routing/permission changes and reset. A successful
check proves that the browser accepted the route, not that headphones are
inserted, unmuted or audible. Use the demo stereo test for physical confirmation.

### PC hardware limitations

| Controller / connection | Standard headphone audio path |
| --- | --- |
| DS4 v1, CUH-ZCT1, USB cable (`054C:05C4`) | No USB Audio Class interface; use the Sony wireless adapter |
| DS4 v2, CUH-ZCT2, USB cable (`054C:09CC`) | USB headphone audio, provided the OS exposes and enables the output |
| DS4 v1, ordinary Bluetooth | Standard PC connection does not expose headphone audio; the library recommends the Sony adapter |
| DS4 v2, CUH-ZCT2, Bluetooth (`054C:09CC`) | No headphone audio over standard Bluetooth; use the Sony USB wireless receiver or a USB cable |
| Sony DUALSHOCK®4 USB Wireless Adaptor, CUH-ZWA1 (`054C:0BA0`) | Wireless headphone audio through the adapter's OS audio output |
| Third-party controllers, bridges and virtual devices | Unknown until the user selects and verifies an actual output |

The required “stick” for the standard v1 PC path is the **Sony DUALSHOCK®4 USB
Wireless Adaptor CUH-ZWA1**, not an ordinary Bluetooth dongle. Its HID ID is
already recognized by this library. Adapter recognition alone does not prove
that audio is enabled or that the headphones are attached.

For v2, USB returns `requiresAdapter: false`. Ordinary Bluetooth returns
`supported: false`, `reason: 'bluetooth-audio-unavailable'` and
`requiresAdapter: true`, just as for v1. Wireless headphone audio needs the Sony
CUH-ZWA1 USB receiver; an ordinary Bluetooth dongle is not a substitute. A v2
controller can alternatively use a USB cable. The demo does not automatically
select a label-matched output when this unsupported transport is detected.

This is a limitation of the standard audio path, not a claim that Bluetooth
audio is technically impossible. Native experimental streamers and custom
drivers can implement a separate transport; this library does not implement
that protocol. Explicit selection of a working OS output overrides the standard
hardware hint.

Sources: [Sony adapter announcement](https://blog.playstation.com/2016/08/23/playstation-now-coming-to-pc-dualshock-4-usb-wireless-adaptor-unveiled/),
[Sony Bluetooth limitations](https://www.playstation.com/en-us/support/hardware/ps4-pair-dualshock-4-wireless-with-pc-or-mac/),
[v1/v2 USB hardware probes](https://github.com/hifihedgehog/HIDMaestro/blob/master/README.md),
[experimental DS4 Bluetooth audio](https://github.com/nefarius/DS4AudioStreamer).
The device-discovery approach follows [dualsense-ts/audio.ts](https://github.com/nsfm/dualsense-ts/blob/main/src/audio.ts);
browser routing and permissions follow [Chrome's Web Audio guidance](https://developer.chrome.com/blog/audiocontext-setsinkid)
and the [Audio Output Devices specification](https://w3c.github.io/mediacapture-output/).

The endpoint requires HTTPS/localhost and a browser with `AudioContext.setSinkId`
(Chrome 110+ introduced it; feature detection is performed at runtime). Embedded
pages may also need `speaker-selection` and `microphone` Permissions Policy
allowances from their parent. To verify the hardware, use the demo's left/right
test and confirm that each tone is audible in the corresponding headphone.

## Headset microphone

`controller.audio.microphone` captures the microphone of a headset plugged into
the controller's 3.5 mm jack. It uses the OS audio input through
`getUserMedia()`, independently of WebHID and headphone playback. No microphone
permission is requested by controller connection or passive support checks.

Use separate UI actions to grant access, select an input and start capture:

```js
const microphone = controller.audio.microphone

// Passive check: no permission prompt or capture.
const support = await microphone.checkSupport()
console.log(support.supported, support.reason, support.inputs)

// In an access button click handler; populate a chooser with the returned inputs.
const inputs = await microphone.requestInput()

// In the chooser's change handler, using the user's selected concrete deviceId.
await microphone.setInput(selectedDeviceId)

// In a start button click handler. Handle errors from every async method in your UI.
const stream = await microphone.start()
// Use stream with WebRTC, Web Audio, or MediaRecorder as needed.

// Stops the capture tracks and cancels pending work; keeps the selected input.
microphone.stop()
// Also clears selection and releases device listeners.
microphone.reset()
```

Look for **Wireless Controller** or **DUALSHOCK®4 USB Wireless Adaptor** in the input
labels (case-insensitive, including OS labels such as `Microphone (Wireless Controller)`
or `Microphone (DUALSHOCK®4 USB Wireless Adaptor)`). The demo lists only these
microphone inputs and hides the selector when none are visible.
Labels are only discovery hints: the browser cannot reliably associate a media
input with a specific HID controller. Select and test the correct input,
especially with multiple controllers. `requestInput()` returns all concrete
audio inputs, including custom-labelled devices; `checkSupport().inputs` lists
controller label matches plus the selected input. Empty, `default` and
`communications` IDs are rejected. `start()` uses an exact `deviceId` constraint
and verifies the returned track's device ID, so it cannot silently fall back to
the laptop microphone.

- `requestInput()` briefly captures the browser's default microphone to reveal
  device names and immediately stops every temporary track, including late
  permission responses after cancellation. It never selects an input or retains
  the temporary stream. It stops any previous endpoint capture.
- `setInput()` only selects a visible input; it does not request permission or
  capture. Changing selection stops previous capture. A failed selection clears
  the old input. Custom inputs can be selected explicitly to use alternative drivers.
- `start()` returns a live `MediaStream` with one audio track, replacing previous
  capture. The library does not record, upload or play it. `microphone.stream`
  exposes the active stream, or `null` after cleanup. Browser audio processing
  defaults apply; applications can use the track's `applyConstraints()` if needed.
- **The microphone endpoint owns the tracks it acquires.** `stop()`, `reset()`,
  changing inputs and controller disconnection call `track.stop()`, even if that
  stream is being consumed elsewhere. Stop application-created clones separately.
  Removal of the selected audio input or an `ended` event also clears capture.
  Calling `stop()` cancels pending selection, permission and capture requests;
  the browser permission dialog itself may remain open, but a late stream is stopped.
- The endpoint emits `change` after selection, capture, stop, reset, permission
  results and audio device changes. Read `microphone.stream` and call
  `checkSupport()` again to refresh the UI. If an application directly calls
  `track.stop()`, which does not emit `ended`, a subsequent support check detects
  the stopped track; prefer `microphone.stop()` for immediate notification.

Support uses the same `connection` and `requiresAdapter` hardware hints as
headphones. `supported: true` means the selected input has live capture and is
still enumerated; it does not prove that the headset is inserted, unmuted or
producing audible sound. A selected but stopped microphone returns
`supported: null`, `reason: 'capture-required'`. Other reasons include
`selection-required`, `permission-or-device-unavailable`, `permission-denied`,
`input-unavailable`, `enumeration-failed`, `capture-failed`, `insecure-context`,
`api-unavailable`, `controller-disconnected`, `v1-usb-audio-unavailable` and
`bluetooth-audio-unavailable`. Permission failures remain unknown rather than
claiming unsupported hardware.

The standard PC connection requires the OS to expose a headset audio input:
use USB with DS4 v2, or the Sony DUALSHOCK®4 USB Wireless Adaptor (CUH-ZWA1) with v1/v2. Ordinary
Bluetooth does not expose the headset audio jack; DS4 v1 does not provide the
USB Audio Class path. A successfully captured explicit input overrides these
hardware hints, as with headphone routing. See the hardware sources above and
the [Media Capture and Streams specification](https://w3c.github.io/mediacapture-main/)
for device selection and capture behavior.

Microphone capture requires HTTPS/localhost, `getUserMedia()` and
`enumerateDevices()`; it does **not** require `AudioContext.setSinkId()`. Embedded
pages may need a `microphone` Permissions Policy allowance. The demo additionally
uses Web Audio for its level meter: allow access, select the controller input,
press **Start microphone**, speak into the headset, then press **Stop microphone**.
The meter does not play your voice back or save a recording.

## Recognized devices

The device picker currently recognizes these vendor and product IDs:

| Vendor | Product ID | Device / model |
| --- | --- | --- |
| Sony (`0x054C`) | `0x05C4` | DUALSHOCK 4 (`CUH-ZCT1`) |
| Sony (`0x054C`) | `0x09CC` | DUALSHOCK 4 v2 (`CUH-ZCT2`) |
| Sony (`0x054C`) | `0x0BA0` | DUALSHOCK®4 USB Wireless Adaptor (`CUH-ZWA1`) |
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

- A new `DualShock4` instance always opens the device picker. Previously
  granted devices can be discovered directly with
  [`navigator.hid.getDevices()`](https://developer.mozilla.org/docs/Web/API/HID/getDevices).
- Controller behavior may vary by operating system, firmware, connection type,
  and hardware revision.
- `firmwareInfo` can identify the raw version and known board model reported by
  a controller, but it cannot determine whether that version is a latest Sony
  release. `isClone` is based on feature-report compatibility and is not
  cryptographic proof that a controller is genuine.

## Development

```sh
npm ci
npm run lint
npm test
npm run build
npm run build-docs
```

- `npm run build` creates the ESM bundle and TypeScript declarations in `dist`.
- `npm run lint` checks TypeScript, JavaScript, and Vue files with ESLint.
  Use `npm run lint:fix` to apply automatic fixes.
- `npm run build-docs` creates the demo and API reference in `dist-pages`.

## Links

- [Live demo](https://checkdevice.online/en/gamepad/dualshock-4)
- [API reference](https://hcodes.github.io/WebHID-DS4/api/)
- [npm package](https://www.npmjs.com/package/@hcodes/webhid-ds4)
- [Changelog](./CHANGELOG.md)
- [MIT License](./LICENSE)

## Credits

Originally created by [TheBITLINK](https://github.com/TheBITLINK) as
[`webhid-ds4`](https://github.com/TheBITLINK/WebHID-DS4). This fork is
maintained by [hcodes](https://github.com/hcodes).

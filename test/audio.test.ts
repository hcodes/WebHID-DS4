import { DUALSHOCK4_V1_PRODUCT_ID, DUALSHOCK4_V2_PRODUCT_ID, DUALSHOCK4_WIRELESS_ADAPTER_PRODUCT_ID } from '../src/consts'
import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { DualShock4 } from '../src'
import { DualShock4Interface } from '../src/state'
import { createDevice, loseDevice, useHid } from './helpers/hid'
import { mediaDevice, TestAudioContext, audioStream, TestStream, useAudio } from './helpers/audio'

async function setup (t: TestContext, productId = DUALSHOCK4_V2_PRODUCT_ID) {
  const device = createDevice({ productId })
  useHid(t, async () => [device])
  const environment = useAudio(t)
  const controller = new DualShock4()
  await controller.connect()
  controller.state.interface = DualShock4Interface.USB
  t.after(() => controller.audio?.reset())
  return { controller, device, environment }
}

test('headphone playback has a distinct namespace reserved separately from the future built-in speaker', async t => {
  const { controller } = await setup(t)
  assert.ok(controller.audio.headphones)
  assert.equal(typeof controller.audio.headphones.checkSupport, 'function')
})

test('audio is optional: connection works without browser audio APIs', async t => {
  const { controller } = await setup(t)
  Reflect.deleteProperty(globalThis, 'AudioContext')
  assert.ok(controller.audio, 'controller exposes an optional audio module')
  const result = await controller.audio.headphones.checkSupport()
  assert.equal(result.supported, false)
  assert.equal(result.reason, 'api-unavailable')
  assert.ok(controller.device?.opened)
})

test('passive detection never requests permission or treats a label match as verified support', async t => {
  const { controller, environment } = await setup(t)
  assert.ok(controller.audio)
  const result = await controller.audio.headphones.checkSupport()
  assert.equal(result.supported, null)
  assert.equal(result.reason, 'selection-required')
  assert.equal(result.outputs[0].deviceId, 'ds4')
  assert.equal(environment.permissionRequests, 0)
  assert.equal(TestAudioContext.instances.length, 0)
})

test('Sony adapter headphone outputs are discovered by their OS labels', async t => {
  const { controller, environment } = await setup(t, DUALSHOCK4_WIRELESS_ADAPTER_PRODUCT_ID)
  environment.setDevices([
    mediaDevice('adapter', 'DUALSHOCK®4 USB Wireless Adaptor'),
    mediaDevice('adapter-2', 'Speakers (dualshock®4 usb wireless adaptor)'),
    mediaDevice('adapter-input', 'DUALSHOCK®4 USB Wireless Adaptor', 'audioinput'),
    mediaDevice('default', 'DUALSHOCK®4 USB Wireless Adaptor'),
    mediaDevice('laptop', 'Built-in Speakers')
  ])
  const support = await controller.audio.headphones.checkSupport()
  assert.deepEqual(support.outputs.map(device => device.deviceId), ['adapter', 'adapter-2'])
  assert.equal(support.connection, 'sony-adapter')
})

test('hidden or absent outputs mean unknown, not unsupported hardware', async t => {
  const { controller, environment } = await setup(t)
  assert.ok(controller.audio)
  for (const devices of [[], [mediaDevice('default', '')], [mediaDevice('speakers', 'Speakers')]]) {
    environment.setDevices(devices)
    const result = await controller.audio.headphones.checkSupport()
    assert.equal(result.supported, null)
    assert.equal(result.reason, 'permission-or-device-unavailable')
  }
})

test('model and transport hints distinguish v1 USB, ordinary Bluetooth and Sony adapter', async t => {
  const { controller, device } = await setup(t, DUALSHOCK4_V1_PRODUCT_ID)
  assert.ok(controller.audio)
  let result = await controller.audio.headphones.checkSupport()
  assert.equal(result.supported, false)
  assert.equal(result.reason, 'v1-usb-audio-unavailable')
  assert.equal(result.requiresAdapter, true)
  controller.state.interface = DualShock4Interface.Bluetooth
  result = await controller.audio.headphones.checkSupport()
  assert.equal(result.reason, 'bluetooth-audio-unavailable')
  Object.assign(device, { productId: DUALSHOCK4_WIRELESS_ADAPTER_PRODUCT_ID })
  result = await controller.audio.headphones.checkSupport()
  assert.equal(result.connection, 'sony-adapter')
  assert.equal(result.requiresAdapter, false)
  assert.equal(result.supported, null)
})

test('v2 distinguishes USB audio, unsupported standard Bluetooth audio and unknown transport', async t => {
  const { controller } = await setup(t, DUALSHOCK4_V2_PRODUCT_ID)
  for (const [transport, requiresAdapter, supported, reason] of [
    [DualShock4Interface.USB, false, null, 'selection-required'],
    [DualShock4Interface.Bluetooth, true, false, 'bluetooth-audio-unavailable'],
    [DualShock4Interface.Disconnected, null, null, 'selection-required']
  ] as const) {
    controller.state.interface = transport
    const result = await controller.audio.headphones.checkSupport()
    assert.equal(result.requiresAdapter, requiresAdapter)
    assert.equal(result.supported, supported)
    assert.equal(result.reason, reason)
  }
  controller.state.interface = DualShock4Interface.Bluetooth
  await controller.audio.headphones.setOutput('ds4')
  const result = await controller.audio.headphones.checkSupport()
  assert.equal(result.connection, 'bluetooth')
  assert.equal(result.supported, true)
})

test('v2 Bluetooth without an audio output recommends the Sony wireless receiver', async t => {
  const { controller, environment } = await setup(t, DUALSHOCK4_V2_PRODUCT_ID)
  controller.state.interface = DualShock4Interface.Bluetooth
  environment.setDevices([])
  const result = await controller.audio.headphones.checkSupport()
  assert.equal(result.requiresAdapter, true)
  assert.equal(result.supported, false)
  assert.equal(result.reason, 'bluetooth-audio-unavailable')
})

test('explicit successful routing verifies even a custom-labelled output; default aliases are rejected', async t => {
  const { controller, environment } = await setup(t)
  environment.setDevices([mediaDevice('custom', 'User headset')])
  assert.ok(controller.audio)
  for (const id of ['', 'default', 'communications']) {
    await assert.rejects(controller.audio.headphones.setOutput(id), { name: 'NotSupportedError' })
  }
  await controller.audio.headphones.setOutput('custom')
  assert.equal(controller.audio.headphones.outputDeviceId, 'custom')
  assert.equal((await controller.audio.headphones.checkSupport()).supported, true)
  assert.equal(TestAudioContext.instances.at(-1)?.sinkId, 'custom')
})

test('permission fallback stops microphone tracks and returns all concrete outputs for manual selection', async t => {
  const { controller, environment } = await setup(t)
  environment.setDevices([mediaDevice(), mediaDevice('mic', 'Microphone', 'audioinput'), mediaDevice('default')])
  assert.ok(controller.audio)
  const outputs = await controller.audio.headphones.requestOutput()
  assert.deepEqual(outputs.map(output => output.deviceId), ['ds4'])
  assert.equal(environment.permissionRequests, 1)
  assert.equal(environment.stoppedTracks, 1)
  assert.equal(controller.audio.headphones.outputDeviceId, null)
})

test('native picker avoids microphone access and still requires explicit routing', async t => {
  const { controller, environment } = await setup(t)
  Object.assign(environment.mediaDevices, { async selectAudioOutput () { return mediaDevice() } })
  assert.ok(controller.audio)
  assert.equal((await controller.audio.headphones.requestOutput())[0].deviceId, 'ds4')
  assert.equal(environment.permissionRequests, 0)
  assert.equal(controller.audio.headphones.outputDeviceId, null)
})

test('denied permission is reported separately and does not break HID', async t => {
  const { controller, environment } = await setup(t)
  environment.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError') }
  assert.ok(controller.audio)
  await assert.rejects(controller.audio.headphones.requestOutput(), { name: 'NotAllowedError' })
  assert.equal((await controller.audio.headphones.checkSupport()).reason, 'permission-denied')
  assert.ok(controller.device?.opened)
})

test('routing failure releases context and never enables playback on default speakers', async t => {
  const { controller } = await setup(t)
  TestAudioContext.route = async () => { throw new DOMException('Denied', 'NotAllowedError') }
  assert.ok(controller.audio)
  await assert.rejects(controller.audio.headphones.setOutput('ds4'), { name: 'NotAllowedError' })
  assert.equal(controller.audio.headphones.outputDeviceId, null)
  assert.equal(TestAudioContext.instances.at(-1)?.state, 'closed')
  await assert.rejects(controller.audio.headphones.play(audioStream()), { name: 'InvalidStateError' })
})

test('playback uses the selected route and stop cancels the current source', async t => {
  const { controller } = await setup(t)
  assert.ok(controller.audio)
  await controller.audio.headphones.setOutput('ds4')
  await controller.audio.headphones.play(audioStream())
  const context = TestAudioContext.instances.at(-1)!
  assert.equal(context.state, 'running')
  assert.equal(context.sources[0].connected, true)
  controller.audio.headphones.stop()
  assert.equal(context.sources[0].connected, false)
  assert.equal(context.sources[0].connected, false)
  assert.equal((await controller.audio.headphones.checkSupport()).supported, true)
})

test('stop during resume prevents a pending stream from connecting later', async t => {
  const { controller } = await setup(t)
  await controller.audio.headphones.setOutput('ds4')
  const context = TestAudioContext.instances.at(-1)!
  let finish!: () => void
  context.resume = () => new Promise<void>(resolve => { finish = resolve })
  const playing = assert.rejects(controller.audio.headphones.play(audioStream()), { name: 'AbortError' })
  controller.audio.headphones.stop()
  await playing
  finish()
  await new Promise(resolve => setImmediate(resolve))
  assert.ok(context.sources.every(source => !source.connected))
})

test('device loss aborts pending routing and cannot restore output after reconnection', async t => {
  const { controller, device } = await setup(t)
  let finish!: () => void
  let started!: () => void
  const routing = new Promise<void>(resolve => { started = resolve })
  TestAudioContext.route = () => { started(); return new Promise(resolve => { finish = resolve }) }
  assert.ok(controller.audio)
  const pending = assert.rejects(controller.audio.headphones.setOutput('ds4'), { name: 'AbortError' })
  await routing
  loseDevice(device)
  await controller.connect()
  finish()
  await pending
  assert.equal(controller.audio.headphones.outputDeviceId, null)
  assert.equal(TestAudioContext.instances[0].state, 'closed')
})

test('disconnect stops playing audio and clears verified support', async t => {
  const { controller } = await setup(t)
  assert.ok(controller.audio)
  await controller.audio.headphones.setOutput('ds4')
  await controller.audio.headphones.play(audioStream())
  const context = TestAudioContext.instances.at(-1)!
  await controller.disconnect()
  assert.equal(context.sources[0].connected, false)
  assert.equal(context.state, 'closed')
  assert.equal(controller.audio.headphones.outputDeviceId, null)
  assert.equal((await controller.audio.headphones.checkSupport()).reason, 'controller-disconnected')
})

test('audio device removal clears the route and emits change without selecting another output', async t => {
  const { controller, environment } = await setup(t)
  assert.ok(controller.audio)
  await controller.audio.headphones.setOutput('ds4')
  const changed = new Promise<void>(resolve => controller.audio.headphones.addEventListener('change', () => resolve(), { once: true }))
  environment.changeDevices([mediaDevice('speakers', 'Speakers')])
  await changed
  assert.equal(controller.audio.headphones.outputDeviceId, null)
  assert.notEqual((await controller.audio.headphones.checkSupport()).supported, true)
})

test('a rejected default-output change stops existing playback instead of retaining a misleading ready state', async t => {
  const { controller } = await setup(t)
  await controller.audio.headphones.setOutput('ds4')
  await controller.audio.headphones.play(audioStream())
  const context = TestAudioContext.instances.at(-1)!
  await assert.rejects(controller.audio.headphones.setOutput('default'), { name: 'NotSupportedError' })
  assert.equal(controller.audio.headphones.outputDeviceId, null)
  assert.equal(context.sources[0].connected, false)
  assert.equal(context.state, 'closed')
})

test('audio can be selected again after reset and still observes removal', async t => {
  const { controller, environment } = await setup(t)
  await controller.audio.headphones.setOutput('ds4')
  controller.audio.headphones.reset()
  await controller.audio.headphones.setOutput('ds4')
  environment.changeDevices([])
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(controller.audio.headphones.outputDeviceId, null)
})

test('an output disappearing while routing is pending cannot become ready', async t => {
  const { controller, environment } = await setup(t)
  let started!: () => void
  let finish!: () => void
  const routing = new Promise<void>(resolve => { started = resolve })
  TestAudioContext.route = () => { started(); return new Promise(resolve => { finish = resolve }) }
  const pending = assert.rejects(controller.audio.headphones.setOutput('ds4'), { name: 'NotFoundError' })
  await routing
  environment.changeDevices([])
  finish()
  await pending
  assert.equal(controller.audio.headphones.outputDeviceId, null)
})

test('late microphone permission after disconnect stops capture without restoring state', async t => {
  const { controller, device, environment } = await setup(t)
  let finish!: (stream: { getTracks: () => { stop: () => void }[] }) => void
  let stopped = false
  environment.mediaDevices.getUserMedia = () => new Promise(resolve => { finish = resolve })
  const requesting = assert.rejects(controller.audio.headphones.requestOutput(), { name: 'AbortError' })
  loseDevice(device)
  await requesting
  finish({ getTracks: () => [{ stop () { stopped = true } }] })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(stopped, true)
  assert.equal(controller.audio.headphones.outputDeviceId, null)
})

test('a newer output selection wins even when an older routing operation resolves later', async t => {
  const { controller, environment } = await setup(t)
  environment.setDevices([mediaDevice('first'), mediaDevice('second')])
  let started!: () => void
  let finish!: () => void
  const routing = new Promise<void>(resolve => { started = resolve })
  TestAudioContext.route = id => {
    if (id === 'second') return Promise.resolve()
    started()
    return new Promise(resolve => { finish = resolve })
  }
  const first = assert.rejects(controller.audio.headphones.setOutput('first'), { name: 'AbortError' })
  await routing
  await controller.audio.headphones.setOutput('second')
  finish()
  await first
  assert.equal(controller.audio.headphones.outputDeviceId, 'second')
  assert.equal((await controller.audio.headphones.checkSupport()).supported, true)
  assert.equal(TestAudioContext.instances[0].state, 'closed')
})

test('known hardware hints do not prevent selecting a virtual output supplied by an external driver', async t => {
  const { controller, environment } = await setup(t, DUALSHOCK4_V1_PRODUCT_ID)
  controller.state.interface = DualShock4Interface.Bluetooth
  environment.setDevices([mediaDevice('bridge', 'Virtual Headset')])
  assert.equal((await controller.audio.headphones.checkSupport()).supported, false)
  await controller.audio.headphones.setOutput('bridge')
  const result = await controller.audio.headphones.checkSupport()
  assert.equal(result.supported, true)
  assert.equal(result.requiresAdapter, false)
})

test('insecure pages and missing routing methods are diagnosed without requesting access', async t => {
  const { controller, environment } = await setup(t)
  Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: false })
  assert.equal((await controller.audio.headphones.checkSupport()).reason, 'insecure-context')
  Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: true })
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: class {} })
  assert.equal((await controller.audio.headphones.checkSupport()).reason, 'api-unavailable')
  assert.equal(environment.permissionRequests, 0)
})

test('identically named controller outputs remain separate candidates until explicit selection', async t => {
  const { controller, environment } = await setup(t)
  environment.setDevices([mediaDevice('one'), mediaDevice('two'), mediaDevice('default')])
  const result = await controller.audio.headphones.checkSupport()
  assert.equal(result.supported, null)
  assert.deepEqual(result.outputs.map(device => device.deviceId), ['one', 'two'])
})

test('live stream is routed without decoding or copying and tracks remain owned by the caller', async t => {
  const { controller } = await setup(t)
  await controller.audio.headphones.setOutput('ds4')
  const stream = audioStream()
  const context = TestAudioContext.instances.at(-1)!
  await controller.audio.headphones.play(stream)
  assert.equal(context.sources[0].mediaStream, stream)
  assert.equal(context.sources[0].connected, true)
  controller.audio.headphones.stop()
  assert.equal(stream.getAudioTracks()[0].readyState, 'live')
  await controller.audio.headphones.play(stream)
  await controller.disconnect()
  assert.equal(stream.getAudioTracks()[0].readyState, 'live')
  assert.equal((stream as unknown as TestStream).tracks[0].stopCalls, 0)
})

test('replacing a stream disconnects the old source while preserving both upstream streams', async t => {
  const { controller } = await setup(t)
  await controller.audio.headphones.setOutput('ds4')
  const first = audioStream()
  const second = audioStream()
  await controller.audio.headphones.play(first)
  await controller.audio.headphones.play(second)
  const context = TestAudioContext.instances.at(-1)!
  assert.equal(context.sources[0].connected, false)
  assert.equal(context.sources[1].connected, true)
  assert.equal(first.getAudioTracks()[0].readyState, 'live')
  assert.equal(second.getAudioTracks()[0].readyState, 'live')
})

test('a stream with no live audio track is rejected without creating a playback source', async t => {
  const { controller } = await setup(t)
  await controller.audio.headphones.setOutput('ds4')
  const empty = new TestStream([]) as unknown as MediaStream
  const ended = audioStream()
  ended.getAudioTracks()[0].stop()
  for (const stream of [empty, ended]) {
    await assert.rejects(controller.audio.headphones.play(stream), { name: 'NotSupportedError' })
  }
  assert.equal(TestAudioContext.instances.at(-1)!.sources.length, 0)
})

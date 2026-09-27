import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { DualShock4 } from '../src'
import { DualShock4Interface } from '../src/state'
import { DUALSHOCK4_V1_PRODUCT_ID, DUALSHOCK4_WIRELESS_ADAPTER_PRODUCT_ID } from '../src/consts'
import { createDevice, loseDevice, useHid } from './helpers/hid'
import { mediaDevice, TestAudioContext, TestStream, TestTrack, useAudio } from './helpers/audio'
import { deferred } from './helpers/deferred'

const input = (id = 'ds4-mic', label = 'Wireless Controller') => mediaDevice(id, label, 'audioinput')
const tick = () => new Promise(resolve => setImmediate(resolve))

class CaptureTrack extends TestTrack {
  constructor (readonly deviceId = 'ds4-mic') { super() }
  getSettings () { return { deviceId: this.deviceId } }
}

function capture (id = 'ds4-mic') {
  return new TestStream([new CaptureTrack(id)]) as unknown as MediaStream
}

async function setup (t: TestContext) {
  const device = createDevice()
  useHid(t, async () => [device])
  const environment = useAudio(t, [input(), mediaDevice()])
  const controller = new DualShock4()
  await controller.connect()
  controller.state.interface = DualShock4Interface.USB
  const microphone = controller.audio.microphone
  t.after(() => controller.audio.reset())
  const requests: MediaStreamConstraints[] = []
  const streams: MediaStream[] = []
  Object.assign(environment.mediaDevices, {
    async getUserMedia (constraints: MediaStreamConstraints) {
      requests.push(constraints)
      const audio = constraints.audio as MediaTrackConstraints
      const id = typeof audio.deviceId === 'object' ? audio.deviceId.exact as string : undefined
      const stream = capture(id)
      streams.push(stream)
      return stream
    }
  })
  return { controller, microphone, device, environment, requests, streams }
}

test('microphone checks are passive and independent of output routing APIs', async t => {
  const { microphone, requests } = await setup(t)
  assert.ok(microphone, 'controller exposes a microphone endpoint')
  Reflect.deleteProperty(globalThis, 'AudioContext')
  const support = await microphone.checkSupport()
  assert.equal(support.supported, null)
  assert.equal(support.reason, 'selection-required')
  assert.deepEqual(support.inputs.map(device => device.deviceId), ['ds4-mic'])
  assert.equal(requests.length, 0)
  assert.equal(TestAudioContext.instances.length, 0)
})

test('permission discovery stops temporary capture and returns all concrete inputs without selecting', async t => {
  const { microphone, environment, requests, streams } = await setup(t)
  environment.setDevices([input(), input('laptop', 'Built-in mic'), input('default'), input('communications'), mediaDevice()])
  assert.deepEqual((await microphone.requestInput()).map(device => device.deviceId), ['ds4-mic', 'laptop'])
  assert.deepEqual(requests, [{ audio: true }])
  assert.equal(streams[0].getTracks()[0].readyState, 'ended')
  assert.equal(microphone.inputDeviceId, null)
  assert.equal(microphone.stream, null)
})

test('selection does not capture; start requests exactly the selected input and stop releases it', async t => {
  const { microphone, requests } = await setup(t)
  await microphone.setInput('ds4-mic')
  assert.equal(requests.length, 0)
  assert.equal((await microphone.checkSupport()).reason, 'capture-required')
  const stream = await microphone.start()
  assert.deepEqual(requests, [{ audio: { deviceId: { exact: 'ds4-mic' } } }])
  assert.equal(microphone.stream, stream)
  assert.equal((await microphone.checkSupport()).supported, true)
  microphone.stop()
  assert.equal(stream.getTracks()[0].readyState, 'ended')
  assert.equal(microphone.stream, null)
  assert.equal(microphone.inputDeviceId, 'ds4-mic')
  assert.equal((await microphone.checkSupport()).reason, 'capture-required')
})

test('invalid or missing selection never falls back to the default microphone', async t => {
  const { microphone, requests } = await setup(t)
  await assert.rejects(microphone.start(), { name: 'InvalidStateError' })
  for (const id of ['', 'default', 'communications']) {
    await assert.rejects(microphone.setInput(id), { name: 'NotSupportedError' })
  }
  await assert.rejects(microphone.setInput('missing'), { name: 'NotFoundError' })
  assert.equal(requests.length, 0)
})

test('failed selection stops previous capture and clears the selection', async t => {
  const { microphone } = await setup(t)
  await microphone.setInput('ds4-mic')
  const stream = await microphone.start()
  await assert.rejects(microphone.setInput('missing'), { name: 'NotFoundError' })
  assert.equal(stream.getTracks()[0].readyState, 'ended')
  assert.equal(microphone.stream, null)
  assert.equal(microphone.inputDeviceId, null)
})

test('hidden inputs remain unknown and model hints allow explicitly verified custom inputs', async t => {
  const { microphone, controller, device, environment } = await setup(t)
  environment.setDevices([])
  assert.equal((await microphone.checkSupport()).reason, 'permission-or-device-unavailable')
  assert.equal((await microphone.checkSupport()).supported, null)
  Object.assign(device, { productId: DUALSHOCK4_V1_PRODUCT_ID })
  assert.equal((await microphone.checkSupport()).reason, 'v1-usb-audio-unavailable')
  controller.state.interface = DualShock4Interface.Bluetooth
  assert.equal((await microphone.checkSupport()).reason, 'bluetooth-audio-unavailable')
  Object.assign(device, { productId: DUALSHOCK4_WIRELESS_ADAPTER_PRODUCT_ID })
  assert.equal((await microphone.checkSupport()).connection, 'sony-adapter')
  assert.equal((await microphone.checkSupport()).requiresAdapter, false)
  environment.setDevices([input('custom', 'Custom driver')])
  await microphone.setInput('custom')
  await microphone.start()
  const support = await microphone.checkSupport()
  assert.equal(support.supported, true)
  assert.deepEqual(support.inputs.map(device => device.deviceId), ['custom'])
})

test('permission and capture errors are distinguished and leave HID connected', async t => {
  const { microphone, environment, controller } = await setup(t)
  await microphone.setInput('ds4-mic')
  for (const [name, reason] of [
    ['NotAllowedError', 'permission-denied'], ['NotFoundError', 'input-unavailable'],
    ['OverconstrainedError', 'input-unavailable'], ['NotReadableError', 'capture-failed']
  ]) {
    environment.mediaDevices.getUserMedia = async () => { throw new DOMException('Cannot capture', name) }
    await assert.rejects(microphone.start(), { name })
    assert.equal((await microphone.checkSupport()).reason, reason)
    assert.equal(microphone.stream, null)
    assert.equal(controller.device?.opened, true)
  }
})

test('a wrong-device or ended stream is rejected and every acquired track is stopped', async t => {
  const { microphone, environment } = await setup(t)
  await microphone.setInput('ds4-mic')
  for (const stream of [capture('laptop'), capture()]) {
    if (stream.getTracks()[0].getSettings().deviceId === 'ds4-mic') stream.getTracks()[0].stop()
    Object.assign(environment.mediaDevices, { async getUserMedia () { return stream } })
    await assert.rejects(microphone.start(), { name: 'NotReadableError' })
    assert.equal(stream.getTracks()[0].readyState, 'ended')
    assert.equal(microphone.stream, null)
  }
})

test('manual disconnect and device loss stop owned microphone tracks', async t => {
  const { microphone, controller, device } = await setup(t)
  await microphone.setInput('ds4-mic')
  const first = await microphone.start()
  await controller.disconnect()
  assert.equal(first.getTracks()[0].readyState, 'ended')
  assert.equal(microphone.inputDeviceId, null)
  await controller.connect()
  await microphone.setInput('ds4-mic')
  const second = await microphone.start()
  loseDevice(device)
  assert.equal(second.getTracks()[0].readyState, 'ended')
  assert.equal((await microphone.checkSupport()).reason, 'controller-disconnected')
})

test('failed HID close also stops capture, and permission is never requested by reconnect', async t => {
  const { microphone, controller, device, requests } = await setup(t)
  await microphone.setInput('ds4-mic')
  const stream = await microphone.start()
  device.close = async () => { throw new Error('Close failed') }
  await assert.rejects(controller.disconnect(), /Close failed/)
  assert.equal(stream.getTracks()[0].readyState, 'ended')
  assert.equal(microphone.inputDeviceId, null)
  assert.equal(requests.length, 1)
})

test('late permission responses are stopped after reset without reviving capture', async t => {
  const { microphone, environment } = await setup(t)
  for (const action of ['requestInput', 'start'] as const) {
    await microphone.setInput('ds4-mic')
    const pending = deferred<MediaStream>()
    Object.assign(environment.mediaDevices, { getUserMedia: () => pending.promise })
    const request = microphone[action]()
    const rejected = assert.rejects(request, { name: 'AbortError' })
    microphone.reset()
    await rejected
    const stream = capture()
    pending.resolve(stream)
    await tick()
    assert.equal(stream.getTracks()[0].readyState, 'ended')
    assert.equal(microphone.stream, null)
    assert.equal(microphone.inputDeviceId, null)
  }
})

test('a newer start cancels the previous request and owns only the new stream', async t => {
  const { microphone, environment } = await setup(t)
  await microphone.setInput('ds4-mic')
  const pending = deferred<MediaStream>()
  Object.assign(environment.mediaDevices, { getUserMedia: () => pending.promise })
  const first = microphone.start()
  const rejected = assert.rejects(first, { name: 'AbortError' })
  const secondStream = capture()
  Object.assign(environment.mediaDevices, { async getUserMedia () { return secondStream } })
  assert.equal(await microphone.start(), secondStream)
  await rejected
  const firstStream = capture()
  pending.resolve(firstStream)
  await tick()
  assert.equal(firstStream.getTracks()[0].readyState, 'ended')
  assert.equal(microphone.stream, secondStream)
  assert.equal(secondStream.getTracks()[0].readyState, 'live')
})

test('audio input removal and track ended events clear capture and notify consumers', async t => {
  const { microphone, environment } = await setup(t)
  let changes = 0
  microphone.addEventListener('change', () => changes++)
  await microphone.setInput('ds4-mic')
  const first = await microphone.start()
  environment.changeDevices([mediaDevice()])
  await tick()
  assert.equal(first.getTracks()[0].readyState, 'ended')
  assert.equal(microphone.inputDeviceId, null)
  environment.setDevices([input()])
  await microphone.setInput('ds4-mic')
  const second = await microphone.start()
  const before = changes
  second.getTracks()[0].stop()
  second.getTracks()[0].dispatchEvent(new Event('ended'))
  assert.equal(microphone.stream, null)
  assert.ok(changes > before)
  assert.equal((await microphone.checkSupport()).reason, 'input-unavailable')
})

test('microphone stop leaves independently playing headphones connected', async t => {
  const { microphone, controller } = await setup(t)
  await controller.audio.headphones.setOutput('ds4')
  await controller.audio.headphones.play(new TestStream() as unknown as MediaStream)
  await microphone.setInput('ds4-mic')
  await microphone.start()
  microphone.stop()
  assert.equal((await controller.audio.headphones.checkSupport()).supported, true)
  assert.equal(TestAudioContext.instances[0].sources[0].connected, true)
})

test('insecure contexts and missing capture APIs do not request microphone permission', async t => {
  const { microphone, requests, environment } = await setup(t)
  Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: false })
  assert.equal((await microphone.checkSupport()).reason, 'insecure-context')
  await assert.rejects(microphone.requestInput(), { name: 'NotSupportedError' })
  Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: true })
  Reflect.deleteProperty(environment.mediaDevices, 'getUserMedia')
  assert.equal((await microphone.checkSupport()).reason, 'api-unavailable')
  await assert.rejects(microphone.setInput('ds4-mic'), { name: 'NotSupportedError' })
  assert.equal(requests.length, 0)
})

test('stop during post-capture enumeration releases the acquired stream without waiting for enumeration', async t => {
  const { microphone, environment, streams } = await setup(t)
  await microphone.setInput('ds4-mic')
  const enumeration = deferred<MediaDeviceInfo[]>()
  environment.mediaDevices.enumerateDevices = () => enumeration.promise
  const request = microphone.start()
  const rejected = assert.rejects(request, { name: 'AbortError' })
  await tick()
  assert.equal(streams.length, 1)
  microphone.stop()
  await rejected
  assert.equal(streams[0].getTracks()[0].readyState, 'ended')
  assert.equal(microphone.stream, null)
  enumeration.resolve([input()])
})

test('input disappearing during acquisition cannot become ready', async t => {
  const { microphone, environment, streams } = await setup(t)
  await microphone.setInput('ds4-mic')
  environment.setDevices([])
  await assert.rejects(microphone.start(), { name: 'NotFoundError' })
  assert.equal(streams[0].getTracks()[0].readyState, 'ended')
  assert.equal(microphone.stream, null)
})

test('a stale device-change result cannot stop capture started after reset', async t => {
  const { microphone, environment } = await setup(t)
  await microphone.setInput('ds4-mic')
  await microphone.start()
  const enumeration = deferred<MediaDeviceInfo[]>()
  const enumerateDevices = environment.mediaDevices.enumerateDevices
  environment.mediaDevices.enumerateDevices = () => enumeration.promise
  environment.mediaDevices.dispatchEvent(new Event('devicechange'))
  microphone.reset()
  environment.mediaDevices.enumerateDevices = enumerateDevices
  await microphone.setInput('ds4-mic')
  const stream = await microphone.start()
  enumeration.resolve([])
  await tick()
  assert.equal(microphone.stream, stream)
  assert.equal(stream.getTracks()[0].readyState, 'live')
})

test('device enumeration failure stops capture and reports an unknown support state', async t => {
  const { microphone, environment } = await setup(t)
  await microphone.setInput('ds4-mic')
  const stream = await microphone.start()
  const enumerateDevices = environment.mediaDevices.enumerateDevices
  environment.mediaDevices.enumerateDevices = async () => { throw new Error('Enumeration failed') }
  environment.mediaDevices.dispatchEvent(new Event('devicechange'))
  await tick()
  assert.equal(stream.getTracks()[0].readyState, 'ended')
  assert.equal(microphone.inputDeviceId, null)
  environment.mediaDevices.enumerateDevices = enumerateDevices
  const support = await microphone.checkSupport()
  assert.equal(support.supported, null)
  assert.equal(support.reason, 'enumeration-failed')
})

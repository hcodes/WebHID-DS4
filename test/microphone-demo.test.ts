import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { parse } from '@vue/compiler-sfc'
import { createRenderer } from 'vue'
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript'
import { DualShock4Microphone } from '../src'
import { createDevice, useHid } from './helpers/hid'
import { mediaDevice, TestAudioContext, TestStream, useAudio } from './helpers/audio'
import { deferred } from './helpers/deferred'

// Exercise the real SFC setup and Vue lifecycle without a DOM. The built demo is also
// smoke-tested in a browser; here only the native media APIs and renderer host are faked.
const componentUrl = new URL('../demo/MicrophoneControls.vue', import.meta.url)
const script = parse(readFileSync(componentUrl, 'utf8')).descriptor.script!.content
const compiled = transpileModule(script, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText
const module = { exports: {} }
new Function('require', 'module', 'exports', compiled)(createRequire(componentUrl), module, module.exports)
const component = (module.exports as { default: object }).default
const renderer = createRenderer({
  insert () {}, remove () {}, patchProp () {}, setText () {}, setElementText () {},
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  parentNode: () => null, nextSibling: () => null
})
const tick = () => new Promise(resolve => setImmediate(resolve))

async function setup (t: TestContext) {
  let unmount = () => {}
  // Node runs after hooks in registration order; unmount before restoring browser globals.
  t.after(() => unmount())
  const device = createDevice({ opened: true })
  useHid(t, async () => [device])
  const environment = useAudio(t, [
    mediaDevice('ds4-mic', 'Wireless Controller', 'audioinput'),
    mediaDevice('ds4-mic-2', 'Microphone (wireless controller)', 'audioinput'),
    mediaDevice('adapter-mic', 'DUALSHOCK®4 USB Wireless Adaptor', 'audioinput'),
    mediaDevice('adapter-mic-2', 'Microphone (dualshock®4 usb wireless adaptor)', 'audioinput'),
    mediaDevice('laptop', 'Built-in Microphone', 'audioinput'),
    mediaDevice('custom-mic', 'Renamed headset microphone', 'audioinput'),
    mediaDevice('other', 'DualShock custom input', 'audioinput'),
    mediaDevice('default', 'Wireless Controller', 'audioinput'),
    mediaDevice('output', 'Wireless Controller', 'audiooutput')
  ])
  class MeterContext extends TestAudioContext {
    createAnalyser () {
      return { fftSize: 1024, getFloatTimeDomainData (samples: Float32Array) { samples.fill(0.25) } }
    }
  }
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: MeterContext })
  for (const key of ['requestAnimationFrame', 'cancelAnimationFrame']) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { configurable: true, value: () => 1 })
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, key, previous)
      else Reflect.deleteProperty(globalThis, key)
    })
  }
  const microphone = new DualShock4Microphone(() => ({ device, transport: 'usb', disconnecting: false }))
  microphone.attach()
  const app = renderer.createApp({ ...component, render: () => null }, { microphone })
  const view = app.mount({}) as unknown as {
    inputs: MediaDeviceInfo[]
    selected: string
    capturing: boolean
    level: number
    error: string
    start: () => Promise<void>
    selectInput: () => Promise<void>
    stop: () => void
  }
  unmount = () => app.unmount()
  await tick()
  return { microphone, environment, view }
}

test('demo only lists Wireless Controller and Sony adapter microphones, including OS labels', async t => {
  const { microphone, view } = await setup(t)
  assert.deepEqual(view.inputs.map(input => input.deviceId), ['ds4-mic', 'ds4-mic-2', 'adapter-mic', 'adapter-mic-2'])
  view.selected = 'ds4-mic'
  await view.selectInput()
  assert.equal(microphone.inputDeviceId, 'ds4-mic')
})

test('demo hides unrelated inputs after device changes even if one was explicitly selected through the API', async t => {
  const { microphone, environment, view } = await setup(t)
  await microphone.setInput('custom-mic')
  environment.changeDevices([mediaDevice('custom-mic', 'Renamed headset microphone', 'audioinput')])
  await tick()
  assert.deepEqual(view.inputs, [])
  assert.equal(view.selected, '')
})

test('devicechange during capture startup preserves the meter and stopping releases capture', async t => {
  const { microphone, environment, view } = await setup(t)
  await microphone.setInput('ds4-mic')
  const pending = deferred<MediaStream>()
  Object.assign(environment.mediaDevices, { getUserMedia: () => pending.promise })
  const starting = view.start()
  environment.mediaDevices.dispatchEvent(new Event('devicechange'))
  await tick()
  const stream = new TestStream()
  Object.assign(stream.tracks[0], { getSettings: () => ({ deviceId: 'ds4-mic' }) })
  pending.resolve(stream as unknown as MediaStream)
  await starting
  assert.equal(view.error, '')
  assert.equal(view.capturing, true)
  assert.equal(view.level, 0.25)
  assert.equal(TestAudioContext.instances[0].state, 'running')
  assert.equal(TestAudioContext.instances[0].sources[0].connected, true)
  view.stop()
  assert.equal(stream.tracks[0].readyState, 'ended')
  assert.equal(TestAudioContext.instances[0].state, 'closed')
  assert.equal(view.level, 0)
})

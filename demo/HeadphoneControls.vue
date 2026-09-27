<template>
  <section class="audio-controls" aria-label="Headphone audio">
    <h4>Headphone audio</h4>
    <p role="status">{{ supportMessage }}</p>
    <p v-if="support?.requiresAdapter">
      Use the Sony DUALSHOCK®4 USB Wireless Adaptor (CUH-ZWA1) for wireless headphone audio on PC.
      An ordinary Bluetooth dongle does not replace this receiver. DualShock 4 v2 also supports wired USB audio.
    </p>
    <p>
      Plug headphones into the controller and look for <b>Wireless Controller</b>
      or <b>DUALSHOCK®4 USB Wireless Adaptor</b>.
      If several controllers share this name, select an output and use the left/right test to identify it.
    </p>
    <button type="button" :disabled="busy || unavailable" @click="requestOutput">Allow audio output access</button>
    <button type="button" :disabled="busy" @click="checkSupport">{{ checking ? 'Checking…' : 'Check support' }}</button>
    <p role="status" aria-atomic="true">{{ checkResult }}</p>
    <p class="audio-hint">
      The browser opens an output picker when available. Otherwise it asks for microphone access to
      reveal the output list; capture stops immediately and no recording is saved.
    </p>
    <template v-if="outputs.length">
      <label>
        Audio output
        <select v-model="selected" :disabled="busy" @change="selectOutput">
          <option disabled value="">Select an output</option>
          <option v-for="(output, index) in outputs" :key="output.deviceId" :value="output.deviceId">
            {{ index + 1 }}. {{ output.label || 'Unnamed output' }}
          </option>
        </select>
      </label>
    </template>
    <p v-else-if="support && !unavailable" role="status">
      DualShock audio output not found. Allow audio output access and check the connection:
      use a USB cable for DualShock 4 v2 or the Sony DUALSHOCK®4 USB Wireless Adaptor (CUH-ZWA1).
    </p>
    <div class="audio-actions">
      <button type="button" :disabled="busy || !ready" @click="testHeadphones">Test left, then right</button>
      <button type="button" :disabled="busy || !ready" @click="playExample">Play example.mp3</button>
      <button type="button" :disabled="!playing" @click="stop">Stop audio</button>
    </div>
    <p class="audio-hint">Playback uses the selected output; it does not change system audio.</p>
    <p v-if="error" role="alert">{{ error }}</p>
  </section>
</template>

<script>
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, toRaw } from 'vue'
import { createHeadphoneMediaStream, createHeadphoneTestStream } from './headphoneDemoStreams'
import exampleAudioUrl from 'url:./example.mp3'
import { isControllerOutput } from '../src/audio/headphoneSupport'

const exampleUrl = new URL(exampleAudioUrl, document.baseURI)

const messages = {
  ready: 'Output ready. Use the stereo test to confirm sound in your headphones.',
  'controller-disconnected': 'Connect the controller to use headphone audio.',
  'insecure-context': 'Audio output selection requires HTTPS or localhost.',
  'api-unavailable': 'This browser does not support the required audio output APIs.',
  'v1-usb-audio-unavailable': 'DualShock 4 v1 does not expose headphone audio over a USB cable.',
  'bluetooth-audio-unavailable': 'Standard Bluetooth does not expose headphone audio on DualShock 4 v1 or v2. Use the Sony DUALSHOCK®4 USB Wireless Adaptor (CUH-ZWA1), or a USB cable for v2.',
  'selection-required': 'A possible controller output was found. Select it to verify routing.',
  'permission-or-device-unavailable': 'No controller output is visible yet. Allow access and check the connection.',
  'permission-denied': 'Audio device access was denied or blocked. Check this site’s browser permissions.',
  'output-unavailable': 'The selected output is unavailable. Check the connection and select an output again.',
  'enumeration-failed': 'The browser could not list audio devices. Try checking support again.',
  'routing-failed': 'The browser could not use this output. Select it again or check the system sound settings.'
}

export default {
  name: 'HeadphoneControls',
  props: { headphones: { type: Object, required: true } },
  setup (props) {
    // Native Web Audio/EventTarget objects must not be called through Vue's deep proxy.
    const headphones = toRaw(props.headphones)
    const support = shallowRef(null)
    const outputs = shallowRef([])
    const selected = ref('')
    const busy = ref(false)
    const playing = ref(false)
    const checking = ref(false)
    const checkResult = ref('')
    const error = ref('')
    let refreshVersion = 0
    let disposed = false
    let activeStream = null

    function stop () {
      headphones.stop()
      activeStream?.stop()
      activeStream = null
      playing.value = false
    }

    async function playDemoStream (createStream) {
      stop()
      const producer = createStream(cause => {
        if (activeStream !== producer) return
        error.value = cause.message
        stop()
      })
      activeStream = producer
      void producer.finished.then(() => {
        if (activeStream === producer) stop()
      })
      try {
        await Promise.all([headphones.play(producer.stream), producer.start()])
        if (activeStream === producer) playing.value = true
      } catch (cause) {
        if (activeStream === producer) stop()
        throw cause
      }
    }

    async function refresh (selectController = false) {
      const version = ++refreshVersion
      const next = await headphones.checkSupport()
      const availableOutputs = next.outputs.filter(isControllerOutput)
      if (disposed || version !== refreshVersion) return
      support.value = next
      if (next.supported !== true) stop()
      selected.value = headphones.outputDeviceId || ''
      outputs.value = availableOutputs
      if (selectController && next.supported !== false && !headphones.outputDeviceId) {
        if (availableOutputs.length === 1) {
          await headphones.setOutput(availableOutputs[0].deviceId)
          await refresh()
        }
      }
    }

    async function run (operation) {
      busy.value = true
      error.value = ''
      try { await operation() } catch (cause) {
        if (cause.name !== 'AbortError') error.value = cause.message || String(cause)
      } finally {
        busy.value = false
        if (!disposed) await refresh()
      }
    }

    async function checkSupport () {
      if (busy.value) return
      busy.value = true
      checking.value = true
      checkResult.value = ''
      error.value = ''
      try {
        await refresh(true)
        if (!disposed) {
          const result = support.value?.supported === true
            ? 'Audio output ready.'
            : support.value?.supported === false ? 'Audio unavailable.' : 'Support not confirmed.'
          const reason = messages[support.value?.reason] || 'Check the controller connection and audio output.'
          checkResult.value = `${result} ${reason} Checked at ${new Date().toLocaleTimeString()}. Visible DualShock audio outputs: ${outputs.value.length}.`
        }
      } catch (cause) {
        if (!disposed) error.value = cause.message || String(cause)
      } finally {
        checking.value = false
        busy.value = false
      }
    }

    const onChange = () => { void refresh() }
    onMounted(() => { headphones.addEventListener('change', onChange); void run(() => refresh(true)) })
    onBeforeUnmount(() => {
      disposed = true
      headphones.removeEventListener('change', onChange)
      stop()
      headphones.reset()
    })

    return {
      support, outputs, selected, busy, playing, checking, checkResult, error, checkSupport,
      ready: computed(() => support.value?.supported === true),
      unavailable: computed(() => ['controller-disconnected', 'insecure-context', 'api-unavailable'].includes(support.value?.reason)),
      supportMessage: computed(() => messages[support.value?.reason] || 'Checking audio support…'),
      requestOutput: () => run(async () => {
        await headphones.requestOutput()
        await refresh(true)
      }),
      selectOutput: () => run(() => { stop(); return headphones.setOutput(selected.value) }),
      testHeadphones: () => run(() => playDemoStream(createHeadphoneTestStream)),
      stop,
      playExample: () => run(() => playDemoStream(onError => createHeadphoneMediaStream(exampleUrl, onError)))
    }
  }
}
</script>

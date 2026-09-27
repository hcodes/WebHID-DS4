<template>
  <section class="audio-controls" aria-label="Headset microphone">
    <h4>Headset microphone</h4>
    <p role="status">{{ supportMessage }}</p>
    <p>
      Plug a headset with a microphone into the controller’s 3.5 mm jack.
      Select its <b>Wireless Controller</b> or <b>DUALSHOCK®4 USB Wireless Adaptor</b> input,
      then start the microphone and speak to check the level.
      If several controllers have the same name, test them individually.
    </p>
    <p class="audio-hint">
      The headset microphone is available with a USB cable on DualShock 4 v2,
      or with the Sony DUALSHOCK®4 USB Wireless Adaptor (CUH-ZWA1) on v1/v2,
      provided the system exposes its audio input. An ordinary Bluetooth dongle does not support the headset microphone.
    </p>
    <button type="button" :disabled="busy || unavailable" @click="requestInput">Allow microphone access</button>
    <button type="button" :disabled="busy" @click="checkSupport">Check microphone support</button>
    <p class="audio-hint">
      Allow access briefly opens the browser’s default microphone to reveal device names, then stops it.
      Start microphone captures only the input you select. No recording is saved or sent, and your voice is not played back.
    </p>
    <label v-if="inputs.length">
      Microphone input
      <select v-model="selected" :disabled="busy || unavailable" @change="selectInput">
        <option disabled value="">Select a microphone</option>
        <option v-for="(input, index) in inputs" :key="input.deviceId" :value="input.deviceId">
          {{ index + 1 }}. {{ input.label || 'Unnamed input' }}
        </option>
      </select>
    </label>
    <p v-else-if="support && !unavailable" role="status">
      No controller microphone is visible. Allow microphone access and check the headset, controller connection and system input settings.
    </p>
    <div class="audio-actions">
      <button type="button" :disabled="busy || unavailable || !selected || capturing" @click="start">Start microphone</button>
      <button type="button" :disabled="!busy && !capturing" @click="stop">Stop microphone</button>
    </div>
    <label>
      Input level
      <meter min="0" max="1" :value="level" aria-label="Microphone input level" />
      {{ Math.round(level * 100) }}%
    </label>
    <p role="status">{{ capturing ? 'Microphone is active. Speak into the headset.' : 'Microphone is stopped.' }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
  </section>
</template>

<script>
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, toRaw } from 'vue'
import { isControllerInput } from '../src/audio/microphoneSupport'

const messages = {
  ready: 'Microphone capture is active. The level meter helps confirm the headset input.',
  'controller-disconnected': 'Connect the controller to use its headset microphone.',
  'insecure-context': 'Microphone access requires HTTPS or localhost.',
  'api-unavailable': 'This browser does not support microphone capture.',
  'v1-usb-audio-unavailable': 'DualShock 4 v1 does not expose headset audio through a USB cable.',
  'bluetooth-audio-unavailable': 'Standard Bluetooth does not expose the DualShock 4 headset microphone.',
  'selection-required': 'Select the controller microphone before starting capture.',
  'capture-required': 'Input selected. Start the microphone to verify capture.',
  'permission-or-device-unavailable': 'No controller microphone is visible yet. Allow access and check the connection.',
  'permission-denied': 'Microphone access was denied or blocked. Check this site’s browser permissions.',
  'input-unavailable': 'The microphone is unavailable or has ended. Check the connection and select an input again.',
  'enumeration-failed': 'The browser could not list microphones. Try checking support again.',
  'capture-failed': 'Capture failed. Check system input settings and whether another application is using the microphone.'
}

export default {
  name: 'MicrophoneControls',
  props: { microphone: { type: Object, required: true } },
  setup (props) {
    const microphone = toRaw(props.microphone)
    const support = shallowRef(null)
    const inputs = shallowRef([])
    const selected = ref('')
    const busy = ref(false)
    const capturing = ref(false)
    const level = ref(0)
    const error = ref('')
    let disposed = false
    let refreshVersion = 0
    let actionVersion = 0
    let context = null
    let source = null
    let animation = 0

    function releaseMeter () {
      cancelAnimationFrame(animation)
      animation = 0
      source?.disconnect()
      source = null
      if (context) void context.close().catch(() => {})
      context = null
      level.value = 0
    }

    async function refresh () {
      const version = ++refreshVersion
      const next = await microphone.checkSupport()
      if (disposed || version !== refreshVersion) return
      support.value = next
      inputs.value = next.inputs.filter(isControllerInput)
      selected.value = inputs.value.some(input => input.deviceId === microphone.inputDeviceId)
        ? microphone.inputDeviceId : ''
      capturing.value = !!microphone.stream
      if (!capturing.value && !busy.value) releaseMeter()
    }

    async function run (operation) {
      const version = ++actionVersion
      busy.value = true
      error.value = ''
      try { await operation() } catch (cause) {
        if (!disposed && version === actionVersion && cause.name !== 'AbortError') error.value = cause.message || String(cause)
      } finally {
        if (!disposed && version === actionVersion) {
          busy.value = false
          await refresh()
        }
      }
    }

    function stop () {
      actionVersion++
      busy.value = false
      microphone.stop()
      capturing.value = false
      releaseMeter()
    }

    async function startMeter () {
      releaseMeter()
      if (typeof AudioContext === 'undefined') throw new Error('This browser cannot display a live microphone level.')
      const activeContext = new AudioContext()
      context = activeContext
      try {
        // Start both browser operations directly from the click, preserving user activation.
        const [stream] = await Promise.all([microphone.start(), activeContext.resume()])
        if (disposed || context !== activeContext || microphone.stream !== stream) return
        source = activeContext.createMediaStreamSource(stream)
        const analyser = activeContext.createAnalyser()
        analyser.fftSize = 1024
        source.connect(analyser)
        // The analyser has no connection to destination: there is no microphone feedback.
        const samples = new Float32Array(analyser.fftSize)
        const update = () => {
          if (disposed || context !== activeContext || microphone.stream !== stream) { releaseMeter(); return }
          analyser.getFloatTimeDomainData(samples)
          const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length)
          level.value = Math.min(1, rms)
          animation = requestAnimationFrame(update)
        }
        update()
      } catch (cause) {
        if (context === activeContext) { microphone.stop(); releaseMeter() }
        throw cause
      }
    }

    const onChange = () => {
      capturing.value = !!microphone.stream
      if (!capturing.value && !busy.value) releaseMeter()
      void refresh()
    }
    onMounted(() => { microphone.addEventListener('change', onChange); void refresh() })
    onBeforeUnmount(() => {
      disposed = true
      actionVersion++
      microphone.removeEventListener('change', onChange)
      microphone.reset()
      releaseMeter()
    })

    return {
      support, inputs, selected, busy, capturing, level, error, stop,
      supportMessage: computed(() => messages[support.value?.reason] || 'Checking microphone support…'),
      unavailable: computed(() => ['controller-disconnected', 'insecure-context', 'api-unavailable'].includes(support.value?.reason)),
      requestInput: () => run(() => { releaseMeter(); return microphone.requestInput() }),
      selectInput: () => run(() => { releaseMeter(); return microphone.setInput(selected.value) }),
      checkSupport: () => run(refresh),
      start: () => run(startMeter)
    }
  }
}
</script>

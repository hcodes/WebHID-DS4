<template>
  <div>
    <div v-for="(controller, i) in controllers" :key="i">
      <h2>
        Controller #{{i}} ({{controller.state.interface.toUpperCase()}},
        Battery: {{controller.state.batteryCapacity === null ? 'unknown' : `${controller.state.batteryCapacity}%`}}
        [{{controller.state.batteryStatus}}])
      </h2>
      <div class="params">
        <h4>Lightbar Color</h4>
        <label>R: </label><input type="range" min="0" max="255" v-model="controller.lightbar.r"> ({{controller.lightbar.r}})<br>
        <label>G: </label><input type="range" min="0" max="255" v-model="controller.lightbar.g"> ({{controller.lightbar.g}})<br>
        <label>B: </label><input type="range" min="0" max="255" v-model="controller.lightbar.b"> ({{controller.lightbar.b}})
        <h4>Rumble</h4>
        <label>Weak: </label><input type="range" min="0" max="255" v-model="controller.rumble.light">  ({{controller.rumble.light}})<br>
        <label>Strong: </label><input type="range" min="0" max="255" v-model="controller.rumble.heavy">  ({{controller.rumble.heavy}})
      </div>
      <div class="buttons">
        <h3>Buttons</h3>
        <div class="btn" v-for="(button, btnKey) in controller.state.buttons" :key="btnKey" :style="{ opacity: button ? 1 : 0.5 }">
          <b class="name">{{btnKey}}</b><br>
          {{button ? '1.00' : '0.00'}}
        </div>
      </div>
      <div class="analogs">
        <h3>Analogs</h3>
        <div class="analog" v-for="(analog, anaKey) in controller.state.axes" :key="anaKey" :style="{ opacity: 0.5 + Math.min(0.5, Math.abs(analog) * .5) }">
          <b class="name">{{anaKey}}</b><br>
          {{analog.toFixed(2)}}
        </div>
      </div>
      <div class="touchpad">
        <h3>Touchpad</h3>
        <div v-if="!controller.state.touchpad.touches.length">
          No touches detected.
        </div>
        <div v-else v-for="touch in controller.state.touchpad.touches" :key="touch.touchId">
          <b>Touch #{{touch.touchId}}:</b> {{touch.x}}, {{touch.y}}
        </div>
      </div>
    </div>
    <br><br>
    <button v-if="hidSupported" @click="addController">Connect Controller</button>
    <div v-else>
      WebHID is not available in this browser or page context.<br>
      Use a supported desktop Chromium browser over HTTPS or localhost, and
      <a href="https://developer.mozilla.org/docs/Web/API/WebHID_API#browser_compatibility">check current browser compatibility</a>.
    </div>
  </div>
</template>
<script>
import { DualShock4 } from '../src'

export default {
  data () {
    return {
      controllers: []
    }
  },
  methods: {
    async addController () {
      const controller = new DualShock4()
      if (await controller.connect()) {
        this.controllers.push(controller)
      }
    }
  },
  computed: {
    hidSupported () {
      return !!(window.navigator.hid && window.navigator.hid.requestDevice)
    }
  }
}
</script>

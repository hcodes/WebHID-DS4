import { clampOutputValue } from './clampOutputValue'
/**
 * Stores and manages the rumble state.
 */
export default class DualShock4Rumble {
  /** @ignore */
  constructor (private readonly requestUpdate: () => Promise<void>) {}
  
  /** @ignore */
  private lightIntensity = 0
  /** @ignore */
  private heavyIntensity = 0

  /**
   * Sends rumble data to the controller.
   * @ignore
   */
  updateRumble () {
    return this.requestUpdate()
  }

  /** Light Rumble Intensity (0-255) */
  get light () {
    return this.lightIntensity
  }

  set light (value : number) {
    this.lightIntensity = clampOutputValue(value)
    void this.updateRumble().catch(error => console.error(error))
  }

  /** Heavy Rumble Intensity (0-255) */
  get heavy () {
    return this.heavyIntensity
  }

  set heavy (value : number) {
    this.heavyIntensity = clampOutputValue(value)
    void this.updateRumble().catch(error => console.error(error))
  }

  /** Clears local motor values without sending a report. @internal */
  reset () {
    this.lightIntensity = 0
    this.heavyIntensity = 0
  }

  /**
   * Set the rumble intensity
   * @param light - Light rumble intensity (0-255)
   * @param heavy - Heavy rumble intensity (0-255)
   */
  async setRumbleIntensity (light : number, heavy : number) {
    this.lightIntensity = clampOutputValue(light)
    this.heavyIntensity = clampOutputValue(heavy)
    return this.updateRumble()
  }
}

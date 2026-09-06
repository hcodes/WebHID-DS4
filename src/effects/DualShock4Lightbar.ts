import { clampOutputValue } from './clampOutputValue'
import { hslToRgb } from '../utils/hslToRgb'

/**
 * Stores and manages the lightbar state.
 */
export default class DualShock4Lightbar {
  /** @ignore */
  constructor (private readonly requestUpdate: () => Promise<void>) {}
  
  /** @ignore */
  private redIntensity = 0
  /** @ignore */
  private greenIntensity = 0
  /** @ignore */
  private blueIntensity = 0

  /**
   * Send Lightbar data to the controller.
   * @ignore
   */
  updateLightbar () {
    return this.requestUpdate()
  }

  /** Red Color Intensity (0-255) */
  get r () {
    return this.redIntensity
  }

  set r (value : number) {
    this.redIntensity = clampOutputValue(value)
    void this.updateLightbar().catch(error => console.error(error))
  }

  /** Green Color Intensity (0-255) */
  get g () {
    return this.greenIntensity
  }

  set g (value : number) {
    this.greenIntensity = clampOutputValue(value)
    void this.updateLightbar().catch(error => console.error(error))
  }

  /** Blue Color Intensity (0-255) */
  get b () {
    return this.blueIntensity
  }

  set b (value : number) {
    this.blueIntensity = clampOutputValue(value)
    void this.updateLightbar().catch(error => console.error(error))
  }

  /**
   * Sets the lightbar color (RGB)
   * @param r - Red color intensity (0-255)
   * @param g - Green color intensity (0-255)
   * @param b - Blue color intensity (0-255)
   */
  async setColorRGB (r : number, g : number, b : number) {
    this.redIntensity = clampOutputValue(r)
    this.greenIntensity = clampOutputValue(g)
    this.blueIntensity = clampOutputValue(b)
    return this.updateLightbar()
  }

  /**
   * Sets the lightbar color (HSL)
   * @param h - Hue
   * @param s - Saturation
   * @param l - Lightness
   */
  async setColorHSL (h : number, s : number, l : number) {
    const color = hslToRgb(h, s, l)
    return this.setColorRGB(color.r, color.g, color.b)
  }
}

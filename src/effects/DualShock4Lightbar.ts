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
  private blinkOnDuration: number | null = null
  private blinkOffDuration: number | null = null

  /** Last requested bright interval in milliseconds, or null before blink configuration. */
  get blinkOn (): number | null { return this.blinkOnDuration }

  /** Last requested dark interval in milliseconds, or null before blink configuration. */
  get blinkOff (): number | null { return this.blinkOffDuration }

  /** Configure controller-driven blinking without JavaScript timers.
   * Finite durations are clamped to 0-2550 ms and rounded down to 10 ms units.
   * Off defaults to on. Use stopBlink() for steady illumination.
   * Resolves when the HID report is sent; rejects on failure or disconnect.
   */
  async setBlink (onMs: number, offMs = onMs): Promise<void> {
    const on = normalizeBlinkDuration(onMs)
    const off = normalizeBlinkDuration(offMs)
    this.blinkOnDuration = on
    this.blinkOffDuration = off
    return this.updateLightbar()
  }

  /** Disable hardware blinking while preserving the RGB color. */
  stopBlink (): Promise<void> { return this.setBlink(0, 0) }

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

function normalizeBlinkDuration (value: number): number {
  if (!Number.isFinite(value)) throw new RangeError('Blink duration must be a finite number.')
  return Math.floor(Math.min(2550, Math.max(0, value)) / 10) * 10
}

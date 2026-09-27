import { abortable } from '../utils/abortable'
import { normalizeHardwareVolume } from './normalizeHardwareVolume'

/** Hardware volume of the built-in mono speaker. Audio streaming is not implemented. */
export class DualShock4Speaker {
  private requestedVolume: number | null = null
  private volumeRequests = new AbortController()

  /** @internal */
  constructor (private readonly requestUpdate?: () => Promise<void>) {}

  /** Last requested raw HID volume (0-255), or null before configuration/after reset.
   * This is a local cache, not a hardware readback or acknowledgement.
   */
  get volume (): number | null { return this.requestedVolume }

  set volume (value: number) {
    void this.setVolume(value).catch(error => console.error(error))
  }

  /** Set a raw HID volume byte. Finite values are clamped to 0-255 and rounded.
   * Resolves when the HID report is sent; rejects on output failure or reset.
   */
  async setVolume (value: number): Promise<void> {
    const volume = normalizeHardwareVolume(value)
    if (!this.requestUpdate) throw new DOMException('Hardware volume control requires a controller output callback.', 'NotSupportedError')
    this.requestedVolume = volume
    const signal = this.volumeRequests.signal
    return abortable(this.requestUpdate(), signal)
  }

  /** Cancel pending volume promises and forget the cache without restoring hardware. @internal */
  reset (): void {
    this.volumeRequests.abort(new DOMException('Audio volume update cancelled by reset.', 'AbortError'))
    this.volumeRequests = new AbortController()
    this.requestedVolume = null
  }
}

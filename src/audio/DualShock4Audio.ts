import { DualShock4Headphones } from './DualShock4Headphones'
import { DualShock4Microphone } from './DualShock4Microphone'
import type { AudioControllerState } from './headphoneSupport'

/** Controller audio endpoints. Headphone playback is independent of the built-in mono speaker.
 * The built-in speaker is not implemented; its future API can live alongside {@link headphones}.
 */
export class DualShock4Audio {
  /** Stereo headphones connected to the controller's 3.5 mm jack. */
  readonly headphones: DualShock4Headphones
  /** Microphone of a headset connected to the controller's 3.5 mm jack. */
  readonly microphone: DualShock4Microphone

  /** @internal */
  constructor (getController: () => AudioControllerState) {
    this.headphones = new DualShock4Headphones(getController)
    this.microphone = new DualShock4Microphone(getController)
  }

  /** Observe audio endpoints for a new HID session without requesting permissions. @internal */
  attach (): void { this.headphones.attach(); this.microphone.attach() }

  /** Release all controller audio resources. */
  reset (): void { this.headphones.reset(); this.microphone.reset() }
}

import { DualShock4Headphones } from './DualShock4Headphones'
import { DualShock4Microphone } from './DualShock4Microphone'
import { DualShock4Speaker } from './DualShock4Speaker'
import type { AudioControllerState } from './headphoneSupport'

/** Controller audio endpoints. Headphone playback is independent of the built-in mono speaker.
 * Speaker volume uses HID; built-in speaker audio streaming is not implemented.
 */
export class DualShock4Audio {
  /** Hardware volume of the built-in mono speaker. */
  readonly speaker: DualShock4Speaker
  /** Stereo headphones connected to the controller's 3.5 mm jack. */
  readonly headphones: DualShock4Headphones
  /** Microphone of a headset connected to the controller's 3.5 mm jack. */
  readonly microphone: DualShock4Microphone

  /** @internal */
  constructor (getController: () => AudioControllerState, requestOutputUpdate?: () => Promise<void>) {
    this.speaker = new DualShock4Speaker(requestOutputUpdate)
    this.headphones = new DualShock4Headphones(getController, requestOutputUpdate)
    this.microphone = new DualShock4Microphone(getController, requestOutputUpdate)
  }

  /** Observe audio endpoints for a new HID session without requesting permissions. @internal */
  attach (): void { this.speaker.reset(); this.headphones.attach(); this.microphone.attach() }

  /** Release all controller audio resources. */
  reset (): void { this.speaker.reset(); this.headphones.reset(); this.microphone.reset() }
}

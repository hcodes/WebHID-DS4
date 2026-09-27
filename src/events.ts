/** Why a controller session ended. */
export type DualShock4DisconnectReason = 'manual' | 'device-lost'

/** Hardware accessory status supplied by a valid full controller input report. */
export interface DualShock4AccessoryEventDetail {
  device: HIDDevice
  /** True for an attachment reported by this session's first full input report. */
  initial: boolean
}

/** Events emitted by a DualShock4 session. */
export interface DualShock4EventMap {
  connect: CustomEvent<{ device: HIDDevice }>
  disconnect: CustomEvent<{ device: HIDDevice, reason: DualShock4DisconnectReason }>
  /** Background authentication completed; null means authenticity is unknown. */
  clonecheck: CustomEvent<{ device: HIDDevice, isClone: boolean | null }>
  /** The controller reported an initially attached accessory or a changed flag. */
  headphonesconnect: CustomEvent<DualShock4AccessoryEventDetail>
  headphonesdisconnect: CustomEvent<DualShock4AccessoryEventDetail>
  microphoneconnect: CustomEvent<DualShock4AccessoryEventDetail>
  microphonedisconnect: CustomEvent<DualShock4AccessoryEventDetail>
  externaldeviceconnect: CustomEvent<DualShock4AccessoryEventDetail>
  externaldevicedisconnect: CustomEvent<DualShock4AccessoryEventDetail>
}

/** Why a controller session ended. */
export type DualShock4DisconnectReason = 'manual' | 'device-lost'

/** Events emitted by a DualShock4 session. */
export interface DualShock4EventMap {
  connect: CustomEvent<{ device: HIDDevice }>
  disconnect: CustomEvent<{ device: HIDDevice, reason: DualShock4DisconnectReason }>
}

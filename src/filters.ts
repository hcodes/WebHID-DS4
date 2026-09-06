/**
 * @module
 * @internal
 */
/** Supported controller vendor/product pairs for the WebHID chooser. */
export const controllerFilters: HIDDeviceFilter[] = [
  // Official Sony controllers and adapter
  { vendorId: 0x054C, productId: 0x0BA0 }, // Sony — DUALSHOCK 4 USB Wireless Adaptor (CUH-ZWA1)
  { vendorId: 0x054C, productId: 0x05C4 }, // Sony — DUALSHOCK 4 (CUH-ZCT1)
  { vendorId: 0x054C, productId: 0x09CC }, // Sony — DUALSHOCK 4 v2 (CUH-ZCT2)
  // Third-party accessory using Sony's vendor ID
  { vendorId: 0x054C, productId: 0x05C5 }, // Collective Minds — Strike Pack FPS Dominator (Sony VID)
  // Razer Raiju
  { vendorId: 0x1532, productId: 0x1000 }, // Razer — Raiju PS4
  { vendorId: 0x1532, productId: 0x1007 }, // Razer — Raiju Tournament Edition (USB)
  { vendorId: 0x1532, productId: 0x1004 }, // Razer — Raiju Ultimate Edition (USB)
  { vendorId: 0x1532, productId: 0x1009 }, // Razer — Raiju Ultimate Edition (Bluetooth)
  // Nacon Revolution
  { vendorId: 0x146B, productId: 0x0D01 }, // Nacon — Revolution Pro Controller
  { vendorId: 0x146B, productId: 0x0D02 }, // Nacon — Revolution Pro Controller 2
  { vendorId: 0x146B, productId: 0x0D08 }, // Nacon — Revolution Unlimited Pro Controller
  // Other third party controllers
  { vendorId: 0x0F0D, productId: 0x00EE }, // HORI — Mini Wired Gamepad for PS4
  { vendorId: 0x7545, productId: 0x0104 }, // Armor3 / Level Up — Cobra (shared VID/PID)
  { vendorId: 0x2E95, productId: 0x7725 }, // SCUF — Vantage
  { vendorId: 0x11C0, productId: 0x4001 }, // GameStop — PS4 Fun Controller
  { vendorId: 0x0C12, productId: 0x57AB }, // Multilaser — Warrior Joypad (JS083)
  { vendorId: 0x0C12, productId: 0x0E16 }, // Steelplay — Metaltech P4
  { vendorId: 0x0F0D, productId: 0x0084 } // HORI — Fighting Commander
]

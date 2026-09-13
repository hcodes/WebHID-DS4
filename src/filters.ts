/**
 * @module
 * @internal
 */
import {
  SONY_VENDOR_ID,
  RAZER_VENDOR_ID,
  NACON_VENDOR_ID,
  HORI_VENDOR_ID,
  ARMOR3_LEVEL_UP_VENDOR_ID,
  SCUF_VENDOR_ID,
  GAMESTOP_VENDOR_ID,
  MULTILASER_STEELPLAY_VENDOR_ID,
  DUALSHOCK4_V1_PRODUCT_ID,
  DUALSHOCK4_V2_PRODUCT_ID,
  DUALSHOCK4_WIRELESS_ADAPTER_PRODUCT_ID,
  STRIKE_PACK_FPS_DOMINATOR_PRODUCT_ID,
  RAZER_RAIJU_PS4_PRODUCT_ID,
  RAZER_RAIJU_TOURNAMENT_USB_PRODUCT_ID,
  RAZER_RAIJU_ULTIMATE_USB_PRODUCT_ID,
  RAZER_RAIJU_ULTIMATE_BLUETOOTH_PRODUCT_ID,
  NACON_REVOLUTION_PRO_PRODUCT_ID,
  NACON_REVOLUTION_PRO_2_PRODUCT_ID,
  NACON_REVOLUTION_UNLIMITED_PRO_PRODUCT_ID,
  HORI_MINI_WIRED_GAMEPAD_PRODUCT_ID,
  HORI_FIGHTING_COMMANDER_PRODUCT_ID,
  ARMOR3_LEVEL_UP_COBRA_PRODUCT_ID,
  SCUF_VANTAGE_PRODUCT_ID,
  GAMESTOP_PS4_FUN_CONTROLLER_PRODUCT_ID,
  MULTILASER_WARRIOR_JOYPAD_PRODUCT_ID,
  STEELPLAY_METALTECH_P4_PRODUCT_ID
} from './consts'

/** Supported controller vendor/product pairs for the WebHID chooser. */
export const controllerFilters: HIDDeviceFilter[] = [
  // Official Sony controllers and adapter
  { vendorId: SONY_VENDOR_ID, productId: DUALSHOCK4_WIRELESS_ADAPTER_PRODUCT_ID }, // Sony — DUALSHOCK 4 USB Wireless Adaptor (CUH-ZWA1)
  { vendorId: SONY_VENDOR_ID, productId: DUALSHOCK4_V1_PRODUCT_ID }, // Sony — DUALSHOCK 4 (CUH-ZCT1)
  { vendorId: SONY_VENDOR_ID, productId: DUALSHOCK4_V2_PRODUCT_ID }, // Sony — DUALSHOCK 4 v2 (CUH-ZCT2)
  // Third-party accessory using Sony's vendor ID
  { vendorId: SONY_VENDOR_ID, productId: STRIKE_PACK_FPS_DOMINATOR_PRODUCT_ID }, // Collective Minds — Strike Pack FPS Dominator (Sony VID)
  // Razer Raiju
  { vendorId: RAZER_VENDOR_ID, productId: RAZER_RAIJU_PS4_PRODUCT_ID }, // Razer — Raiju PS4
  { vendorId: RAZER_VENDOR_ID, productId: RAZER_RAIJU_TOURNAMENT_USB_PRODUCT_ID }, // Razer — Raiju Tournament Edition (USB)
  { vendorId: RAZER_VENDOR_ID, productId: RAZER_RAIJU_ULTIMATE_USB_PRODUCT_ID }, // Razer — Raiju Ultimate Edition (USB)
  { vendorId: RAZER_VENDOR_ID, productId: RAZER_RAIJU_ULTIMATE_BLUETOOTH_PRODUCT_ID }, // Razer — Raiju Ultimate Edition (Bluetooth)
  // Nacon Revolution
  { vendorId: NACON_VENDOR_ID, productId: NACON_REVOLUTION_PRO_PRODUCT_ID }, // Nacon — Revolution Pro Controller
  { vendorId: NACON_VENDOR_ID, productId: NACON_REVOLUTION_PRO_2_PRODUCT_ID }, // Nacon — Revolution Pro Controller 2
  { vendorId: NACON_VENDOR_ID, productId: NACON_REVOLUTION_UNLIMITED_PRO_PRODUCT_ID }, // Nacon — Revolution Unlimited Pro Controller
  // Other third party controllers
  { vendorId: HORI_VENDOR_ID, productId: HORI_MINI_WIRED_GAMEPAD_PRODUCT_ID }, // HORI — Mini Wired Gamepad for PS4
  { vendorId: ARMOR3_LEVEL_UP_VENDOR_ID, productId: ARMOR3_LEVEL_UP_COBRA_PRODUCT_ID }, // Armor3 / Level Up — Cobra (shared VID/PID)
  { vendorId: SCUF_VENDOR_ID, productId: SCUF_VANTAGE_PRODUCT_ID }, // SCUF — Vantage
  { vendorId: GAMESTOP_VENDOR_ID, productId: GAMESTOP_PS4_FUN_CONTROLLER_PRODUCT_ID }, // GameStop — PS4 Fun Controller
  { vendorId: MULTILASER_STEELPLAY_VENDOR_ID, productId: MULTILASER_WARRIOR_JOYPAD_PRODUCT_ID }, // Multilaser — Warrior Joypad (JS083)
  { vendorId: MULTILASER_STEELPLAY_VENDOR_ID, productId: STEELPLAY_METALTECH_P4_PRODUCT_ID }, // Steelplay — Metaltech P4
  { vendorId: HORI_VENDOR_ID, productId: HORI_FIGHTING_COMMANDER_PRODUCT_ID } // HORI — Fighting Commander
]

/**
 * Shared USB/HID vendor identifiers for supported controllers and accessories.
 * @module
 * @internal
 */

/**
 * Sony vendor identifier (VID) reported by HID devices.
 * Use together with a product ID to identify a controller model or adapter;
 * the vendor ID alone does not distinguish devices or establish audio support.
 */
export const SONY_VENDOR_ID = 0x054C

/**
 * Vendor identifier (VID) used by the Razer Raiju controller family.
 * Pair with the model and transport-specific Raiju product ID.
 */
export const RAZER_VENDOR_ID = 0x1532

/**
 * Vendor identifier (VID) used by the Nacon Revolution controller family.
 * Pair with a Revolution product ID to distinguish supported models.
 */
export const NACON_VENDOR_ID = 0x146B

/**
 * Vendor identifier (VID) used by the supported HORI controllers.
 * Shared by the Mini Wired Gamepad and Fighting Commander entries.
 */
export const HORI_VENDOR_ID = 0x0F0D

/**
 * Vendor identifier (VID) shared by the Armor3 / Level Up Cobra entries.
 * The shared VID/PID pair does not distinguish the retail branding.
 */
export const ARMOR3_LEVEL_UP_VENDOR_ID = 0x7545

/**
 * Vendor identifier (VID) used by the SCUF Vantage controller entry.
 * Pair with SCUF_VANTAGE_PRODUCT_ID in the WebHID device filter.
 */
export const SCUF_VENDOR_ID = 0x2E95

/**
 * Vendor identifier (VID) used by the GameStop PS4 Fun Controller entry.
 * Pair with GAMESTOP_PS4_FUN_CONTROLLER_PRODUCT_ID in the WebHID filter.
 */
export const GAMESTOP_VENDOR_ID = 0x11C0

/**
 * Vendor identifier (VID) shared by the Multilaser and Steelplay entries.
 * Their distinct product IDs identify Warrior Joypad and Metaltech P4.
 */
export const MULTILASER_STEELPLAY_VENDOR_ID = 0x0C12

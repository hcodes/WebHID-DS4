/**
 * USB/HID product identifiers paired with RAZER_VENDOR_ID from vendorIds.ts.
 * Grouped by vendor ID, including accessories that share it.
 * @module
 * @internal
 */

/**
 * Product identifier (PID) of the Razer Raiju PS4 controller.
 * Pair with RAZER_VENDOR_ID; other Raiju editions have separate product IDs.
 */
export const RAZER_RAIJU_PS4_PRODUCT_ID = 0x1000

/**
 * Product identifier (PID) of the Razer Raiju Tournament Edition over USB.
 * Pair with RAZER_VENDOR_ID for this model and connection type.
 */
export const RAZER_RAIJU_TOURNAMENT_USB_PRODUCT_ID = 0x1007

/**
 * Product identifier (PID) of the Razer Raiju Ultimate Edition over USB.
 * Pair with RAZER_VENDOR_ID; its Bluetooth connection uses a separate PID.
 */
export const RAZER_RAIJU_ULTIMATE_USB_PRODUCT_ID = 0x1004

/**
 * Product identifier (PID) of the Razer Raiju Ultimate Edition over Bluetooth.
 * Pair with RAZER_VENDOR_ID; its USB connection uses a separate PID.
 */
export const RAZER_RAIJU_ULTIMATE_BLUETOOTH_PRODUCT_ID = 0x1009

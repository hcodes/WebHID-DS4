/**
 * USB/HID product identifiers paired with SONY_VENDOR_ID from vendorIds.ts.
 * Grouped by vendor ID, including accessories that share it.
 * @module
 * @internal
 */

/**
 * Product identifier (PID) of the first-generation DualShock 4 (CUH-ZCT1).
 * Paired with SONY_VENDOR_ID in controller filters and model-specific
 * headphone support checks, including the v1 adapter recommendation.
 */
export const DUALSHOCK4_V1_PRODUCT_ID = 0x05C4

/**
 * Product identifier (PID) of the second-generation DualShock 4 (CUH-ZCT2).
 * Paired with SONY_VENDOR_ID to distinguish v2 from v1. This model supports
 * the USB audio path; standard wireless headphone audio needs the Sony adapter.
 */
export const DUALSHOCK4_V2_PRODUCT_ID = 0x09CC

/**
 * Product identifier (PID) of the DUALSHOCK 4 USB Wireless Adaptor (CUH-ZWA1).
 * Identifies the adapter exposed to the host, rather than the paired controller
 * revision. Paired with SONY_VENDOR_ID to recognize the Sony adapter connection.
 */
export const DUALSHOCK4_WIRELESS_ADAPTER_PRODUCT_ID = 0x0BA0

/**
 * Product identifier (PID) of the Collective Minds Strike Pack FPS Dominator.
 * This accessory uses SONY_VENDOR_ID despite its third-party branding.
 */
export const STRIKE_PACK_FPS_DOMINATOR_PRODUCT_ID = 0x05C5

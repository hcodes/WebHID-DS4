/**
 * USB/HID product identifiers paired with NACON_VENDOR_ID from vendorIds.ts.
 * Grouped by vendor ID, including accessories that share it.
 * @module
 * @internal
 */

/**
 * Product identifier (PID) of the Nacon Revolution Pro Controller.
 * Pair with NACON_VENDOR_ID to distinguish it from later Revolution models.
 */
export const NACON_REVOLUTION_PRO_PRODUCT_ID = 0x0D01

/**
 * Product identifier (PID) of the Nacon Revolution Pro Controller 2.
 * Pair with NACON_VENDOR_ID to distinguish this second-generation model.
 */
export const NACON_REVOLUTION_PRO_2_PRODUCT_ID = 0x0D02

/**
 * Product identifier (PID) of the Nacon Revolution Unlimited Pro Controller.
 * Pair with NACON_VENDOR_ID in the supported-controller filter.
 */
export const NACON_REVOLUTION_UNLIMITED_PRO_PRODUCT_ID = 0x0D08

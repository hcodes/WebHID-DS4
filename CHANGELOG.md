# Changelog

All notable changes made in this fork after the upstream `1.0.5` release are documented in this file.

## [2.1.0]

### Added

- Added typed `connect` and `disconnect` events on each `DualShock4` instance, including `manual` and `device-lost` disconnect reasons.
- Added automatic session cleanup and pending-operation cancellation on WebHID device loss, with protection against stale reports after reconnection.
- Added ESLint checks for TypeScript, JavaScript, and Vue files, with `lint` and `lint:fix` commands and linting in CI.

### Changed

- Moved the `DualShock4` implementation into its own module and kept `index.ts` as the public export entry point, preserving root package imports.
- Grouped source modules into `controllers`, `effects`, `firmware`, `protocol`, and `utils`; kept shared constants in domain-specific `consts.ts` files and implementation-only constants beside their usage.
- Separated connection lifecycle, output scheduling, input/output report handling, and firmware reads from the public `DualShock4` class. Lightbar and rumble constructors accept a single output callback.
- Simplified lifecycle callbacks and added typed event dispatch, checking event names and payloads against the same map used by listeners.
- Unified USB/Bluetooth transport initialization, simplified pending output, and centralized feature-report timeouts and cancellation cleanup.
- Split input-state decoding into focused functions, removed duplicate battery and report-detection logic, and separated input normalization from output-value clamping.
- Aligned class filenames with their class names and replaced abbreviated private effect fields with descriptive intensity names.
- Organized controller integration tests by connection, events, input, and output with shared WebHID fixtures and deferred-promise helpers.
- Reduced the optional `isClone` feature-report check timeout from one second to 250 ms so unresponsive controllers finish connecting sooner; the firmware information request still uses a one-second timeout.

### Fixed

- Handled rejected Bluetooth initialization feature reports without unhandled promise rejections.
- Preserved `AbortError` for coalesced output cancelled immediately after transport detection.

## [2.0.1]

### Fixed

- Initialized Bluetooth from the minimal `0x01` input report used before full `0x11` reports are enabled, restoring cold-start compatibility with third-party controllers.

## [2.0.0]

### Breaking Changes

- Removed the CommonJS build; the package is now distributed as ESM only.
- Removed `DualShock4.init()`. Use `DualShock4.connect()` instead.
- Removed `DualShock4State.battery`. Use `batteryCapacity` instead; unlike the old field, it can be `null` when the controller reports an error or an unknown value.
- Removed `DualShock4State.charging`. Use `batteryStatus === 'charging'` instead, or handle all `BatteryStatus` values when charging, full, error, and unknown states need to be distinguished.

### Added

- Added automated tests for controller connection, CRC-32 calculation, and input normalization.
- Added GitHub Actions workflows for running tests and deploying the demo and API documentation to GitHub Pages.
- Added npm version, monthly downloads, unpacked size, and upstream fork badges to the README.
- Added a browser-native CRC-32 implementation, removing the runtime dependency on `crc` and Node.js `Buffer` polyfills.
- Added `batteryCapacity` and `batteryStatus` to controller state, along with the exported `BatteryStatus` type for distinguishing charging, discharging, full, error, and unknown states.
- Added `DualShock4.disconnect()` for stopping rumble, closing the WebHID session, and resetting controller state without revoking device permission.
- Added `firmwareInfo` and `readFirmwareInfo()` for reading DualShock 4 feature report `0xA3` over USB or Bluetooth and exposing its build strings, raw 16-bit hardware and firmware versions, and known board model.
- Added a one-second timeout for controller information reports and the `isClone` feature-report compatibility check.
- Added the fork maintainer's copyright notice while preserving the original MIT license attribution.

### Changed

- Renamed the package to `@hcodes/webhid-ds4`, updated repository and demo links, and configured the scoped package for public npm publishing.
- Reworked the README to document current WebHID requirements, the v2 API, supported controller model identifiers, package usage, and fork attribution.
- Updated the test and GitHub Pages workflows to use Node.js 26.
- Modernized the development toolchain from Yarn, Rollup, Parcel 1, Vue 2, and TypeScript 3 to npm, Rolldown, Parcel 2, Vue 3, and TypeScript 6.
- Updated the demo to use the Vue 3 application API and native ES modules.
- Limited the published npm package to the generated `dist` files and added an automatic build before packaging.
- Moved generated demo and API documentation out of version control; they are now built into `dist-pages` during deployment.

### Fixed

- Serialized controller output reports and handled asynchronous property-setter failures, preventing reordered HID updates and unhandled promise rejections.
- Corrected Bluetooth input parsing to honor `DataView.byteOffset` and reject reports with invalid lengths or CRC-32 checksums before updating controller state.
- Corrected DualShock 4 output reports to use protocol-compliant 32-byte USB packets and avoid setting reserved valid-flag bits over USB and Bluetooth, improving compatibility with third-party controllers.
- Deferred and combined output updates made before the first supported input report, preventing Bluetooth-formatted reports from being sent to USB controllers before their interface is known.
- Corrected DualShock 4 gyroscope and accelerometer decoding to use the proper report offsets, signed values, and little-endian byte order.
- Corrected DualShock 4 touchpad parsing to honor `num_touch_reports`, process every reported frame, and expose the active contacts from the newest frame.
- Ensured each `DualShock4` instance has independent state, preventing interface, battery, input, button, and touchpad data from leaking between controllers.
- Shipped `@types/w3c-web-hid` as a package dependency so consumers can resolve the `HIDDevice` type used by the generated declarations.
- Made `DualShock4.connect()` return `false` when device selection is cancelled and `true` after a successful or previously completed connection.
- Prevented a controller from retaining a selected device when opening that device fails.
- Corrected thumbstick normalization so both endpoints map to the full `-1` to `1` range.
- Corrected trigger dead-zone handling so values inside the dead zone normalize to zero.
- Corrected DualShock 4 battery capacity calculation to match the driver-compatible 10% ranges and report unavailable capacity as `null` for error or unknown states.

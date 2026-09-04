# Changelog

All notable changes made in this fork after the upstream `1.0.5` release are documented in this file.

## [2.0.0]

### Breaking Changes

- Removed the CommonJS build; the package is now distributed as ESM only.
- Removed `DualShock4State.battery`. Use `batteryCapacity` instead; unlike the old field, it can be `null` when the controller reports an error or an unknown value.
- Removed `DualShock4State.charging`. Use `batteryStatus === 'charging'` instead, or handle all `BatteryStatus` values when charging, full, error, and unknown states need to be distinguished.

### Added

- Added automated tests for controller initialization, CRC-32 calculation, and input normalization.
- Added GitHub Actions workflows for running tests and deploying the demo and API documentation to GitHub Pages.
- Added a browser-native CRC-32 implementation, removing the runtime dependency on `crc` and Node.js `Buffer` polyfills.
- Added `batteryCapacity` and `batteryStatus` to controller state, along with the exported `BatteryStatus` type for distinguishing charging, discharging, full, error, and unknown states.

### Changed

- Updated the test and GitHub Pages workflows to use Node.js 26.
- Modernized the development toolchain from Yarn, Rollup, Parcel 1, Vue 2, and TypeScript 3 to npm, Rolldown, Parcel 2, Vue 3, and TypeScript 6.
- Updated the demo to use the Vue 3 application API and native ES modules.
- Limited the published npm package to the generated `dist` files and added an automatic build before packaging.
- Moved generated demo and API documentation out of version control; they are now built into `dist-pages` during deployment.

### Fixed

- Corrected DualShock 4 gyroscope and accelerometer decoding to use the proper report offsets, signed values, and little-endian byte order.
- Ensured each `DualShock4` instance has independent state, preventing interface, battery, input, button, and touchpad data from leaking between controllers.
- Shipped `@types/w3c-web-hid` as a package dependency so consumers can resolve the `HIDDevice` type used by the generated declarations.
- Made `DualShock4.init()` return `false` when device selection is cancelled and `true` after successful or previously completed initialization.
- Prevented a controller from retaining a selected device when opening that device fails.
- Corrected thumbstick normalization so both endpoints map to the full `-1` to `1` range.
- Corrected trigger dead-zone handling so values inside the dead zone normalize to zero.
- Corrected DualShock 4 battery capacity calculation to match the driver-compatible 10% ranges and report unavailable capacity as `null` for error or unknown states.

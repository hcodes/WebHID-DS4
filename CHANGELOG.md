# Changelog

All notable changes made in this fork after the upstream `1.0.5` release are documented in this file.

## [Unreleased]

### Added

- Added automated tests for controller initialization, CRC-32 calculation, and input normalization.
- Added GitHub Actions workflows for running tests and deploying the demo and API documentation to GitHub Pages.
- Added a browser-native CRC-32 implementation, removing the runtime dependency on `crc` and Node.js `Buffer` polyfills.

### Changed

- Modernized the development toolchain from Yarn, Rollup, Parcel 1, Vue 2, and TypeScript 3 to npm, Rolldown, Parcel 2, Vue 3, and TypeScript 6.
- Updated the demo to use the Vue 3 application API and native ES modules.
- Limited the published npm package to the generated `dist` files and added an automatic build before packaging.
- Moved generated demo and API documentation out of version control; they are now built into `dist-pages` during deployment.

### Fixed

- Shipped `@types/w3c-web-hid` as a package dependency so consumers can resolve the `HIDDevice` type used by the generated declarations.
- Made `DualShock4.init()` return `false` when device selection is cancelled and `true` after successful or previously completed initialization.
- Prevented a controller from retaining a selected device when opening that device fails.
- Corrected thumbstick normalization so both endpoints map to the full `-1` to `1` range.
- Corrected trigger dead-zone handling so values inside the dead zone normalize to zero.

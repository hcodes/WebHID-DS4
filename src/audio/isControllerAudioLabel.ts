/** Shared discovery hints for headset inputs and outputs; labels do not prove HID identity. @internal */
export function isControllerAudioLabel (label: string): boolean {
  const name = label.toLowerCase()
  return name.includes('wireless controller') ||
    name.includes('dualshock®4 usb wireless adaptor') ||
    name.includes('dualshock 4 usb wireless adaptor')
}

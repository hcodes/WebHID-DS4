import assert from 'node:assert/strict'
import test from 'node:test'
import { isControllerInput } from '../src/audio/microphoneSupport'
import { isControllerOutput } from '../src/audio/headphoneSupport'
import { mediaDevice } from './helpers/audio'

test('microphone and headphone discovery use the same explicit controller names', () => {
  for (const [label, expected] of [
    ['Wireless Controller', true],
    ['Microphone (wireless controller)', true],
    ['DUALSHOCK®4 USB Wireless Adaptor', true],
    ['Speakers (dualshock®4 usb wireless adaptor)', true],
    ['DUALSHOCK 4 USB Wireless Adaptor', true],
    ['Built-in Microphone', false],
    ['DualShock custom input', false],
    ['Dual Shock', false],
    ['CUH-ZWA1', false],
    ['', false]
  ] as const) {
    assert.equal(isControllerInput(mediaDevice('mic', label, 'audioinput')), expected, `input: ${label}`)
    assert.equal(isControllerOutput(mediaDevice('out', label, 'audiooutput')), expected, `output: ${label}`)
  }
})

test('matching labels still require a concrete device of the correct kind', () => {
  for (const [matches, kind, wrongKind] of [
    [isControllerInput, 'audioinput', 'audiooutput'],
    [isControllerOutput, 'audiooutput', 'audioinput']
  ] as const) {
    for (const id of ['', 'default', 'communications']) {
      assert.equal(matches(mediaDevice(id, 'DUALSHOCK®4 USB Wireless Adaptor', kind)), false)
    }
    assert.equal(matches(mediaDevice('ds4', 'Wireless Controller', wrongKind)), false)
  }
})

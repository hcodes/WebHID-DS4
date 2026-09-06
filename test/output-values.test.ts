import assert from 'node:assert/strict'
import test from 'node:test'
import DualShock4Lightbar from '../src/effects/DualShock4Lightbar'
import DualShock4Rumble from '../src/effects/DualShock4Rumble'

const cases = [
  { input: -Infinity, expected: 0 },
  { input: -1, expected: 0 },
  { input: -0, expected: 0 },
  { input: 0, expected: 0 },
  { input: 12.5, expected: 12.5 },
  { input: 255, expected: 255 },
  { input: 256, expected: 255 },
  { input: Infinity, expected: 255 },
  { input: NaN, expected: NaN }
]

test('lightbar clamps properties and batch updates without rounding or replacing NaN', async () => {
  const lightbar = new DualShock4Lightbar(async () => {})
  for (const { input, expected } of cases) {
    lightbar.r = input
    lightbar.g = input
    lightbar.b = input
    assert.deepEqual([lightbar.r, lightbar.g, lightbar.b], [expected, expected, expected])
    await lightbar.setColorRGB(1, 2, 3)
    await lightbar.setColorRGB(input, input, input)
    assert.deepEqual([lightbar.r, lightbar.g, lightbar.b], [expected, expected, expected])
  }
})

test('rumble clamps properties and batch updates without rounding or replacing NaN', async () => {
  const rumble = new DualShock4Rumble(async () => {})
  for (const { input, expected } of cases) {
    rumble.light = input
    rumble.heavy = input
    assert.deepEqual([rumble.light, rumble.heavy], [expected, expected])
    await rumble.setRumbleIntensity(1, 2)
    await rumble.setRumbleIntensity(input, input)
    assert.deepEqual([rumble.light, rumble.heavy], [expected, expected])
  }
})

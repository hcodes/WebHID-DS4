import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeThumbstick, normalizeTrigger } from '../src/util/normalize'

test('normalizes both thumbstick endpoints to full scale', () => {
  assert.equal(normalizeThumbstick(0), -1)
  assert.equal(normalizeThumbstick(255), 1)
})

test('normalizes trigger values inside the dead zone to zero', () => {
  const deadZone = 25 / 255

  assert.equal(normalizeTrigger(0, deadZone), 0)
  assert.equal(normalizeTrigger(25, deadZone), 0)
})

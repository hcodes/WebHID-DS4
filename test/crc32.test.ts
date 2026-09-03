import assert from 'node:assert/strict'
import test from 'node:test'

import { crc32 } from '../src/util/crc32'

test('returns zero for an empty buffer', () => {
  assert.equal(crc32(new Uint8Array()), 0)
})

test('calculates the standard CRC-32 check value', () => {
  const input = new TextEncoder().encode('123456789')

  assert.equal(crc32(input), 0xCBF43926)
})

test('calculates CRC-32 for arbitrary binary bytes', () => {
  const input = new Uint8Array([0x00, 0x01, 0x02, 0xFF])

  assert.equal(crc32(input), 0x3FB23824)
})

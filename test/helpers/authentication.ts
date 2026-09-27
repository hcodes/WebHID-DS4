import assert from 'node:assert/strict'
import { crc32 } from 'node:zlib'
import type { TestContext } from 'node:test'
import { createDevice } from './hid'
import { createFirmwareReport } from './reports'

const algorithm = { name: 'RSA-PSS', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }
const signatures = { name: 'RSA-PSS', saltLength: 32 }
const keys = Promise.all([
  crypto.subtle.generateKey(algorithm, true, ['sign', 'verify']),
  crypto.subtle.generateKey(algorithm, true, ['sign', 'verify'])
])

/** Replace only the trust anchor for synthetic certificates, keeping RSA verification real. */
export async function useTestAuthority (t: TestContext) {
  const [authority] = await keys
  const importKey = crypto.subtle.importKey.bind(crypto.subtle)
  t.mock.method(crypto.subtle, 'importKey', (...args: Parameters<typeof importKey>) => {
    const jwk = args[1] as JsonWebKey
    if (jwk.n?.startsWith('jtf55KpcxdIx')) return Promise.resolve(authority.publicKey)
    return importKey(...args)
  })
}

export function authenticationDevice (options: {
  bluetooth?: boolean
  nested?: boolean
  includesReportId?: boolean
  paddedStatus?: boolean
  failure?: 'certificate' | 'challenge' | 'crc' | 'sequence' | 'page' | 'truncated' | 'read' | 'write' | 'pending' | 'write timeout'
  firmwareFails?: boolean
} = {}) {
  const requests: number[] = []
  const challenges: Uint8Array[] = []
  const writes: Uint8Array[] = []
  let sequence = 0
  let nonce = new Uint8Array(256)
  let response = new Uint8Array(1040)
  let page = 0
  const collection: HIDCollectionInfo = {
    usagePage: 1, usage: 5, type: 1,
    inputReports: [{ reportId: options.bluetooth ? 0x11 : 0x01, items: [] }],
    featureReports: [0xA3, 0xF0, 0xF1, 0xF2].map(reportId => ({ reportId, items: [] })),
    children: []
  }
  function checksum (report: Uint8Array, sending = false) {
    const data = options.bluetooth ? Uint8Array.from([sending ? 0x53 : 0xA3, ...report]) : report
    return crc32(data)
  }
  function received (reportId: number, payload: Uint8Array) {
    const full = Uint8Array.from([reportId, ...payload])
    new DataView(full.buffer).setUint32(full.length - 4, checksum(full.subarray(0, -4)), true)
    if (options.failure === 'crc') full[full.length - 1] ^= 1
    // Windows returns the maximum feature-report size, including shorter F2 reports.
    const data = options.paddedStatus && reportId === 0xF2
      ? Uint8Array.from([...full, ...new Uint8Array(48)])
      : options.includesReportId === false ? full.subarray(1) : full
    const offset = 7
    const buffer = new Uint8Array(data.length + offset)
    buffer.set(data, offset)
    return new DataView(buffer.buffer, offset, data.length)
  }
  const device = createDevice({
    collections: [options.nested ? { usagePage: 1, usage: 5, type: 1, children: [collection] } : collection],
    async sendFeatureReport (reportId, data) {
      if (options.failure === 'write') throw new DOMException('Write failed', 'NetworkError')
      if (options.failure === 'write timeout') return new Promise<void>(() => {})
      assert.equal(reportId, 0xF0)
      const payload = new Uint8Array(ArrayBuffer.isView(data) ? data.buffer : data,
        ArrayBuffer.isView(data) ? data.byteOffset : 0, ArrayBuffer.isView(data) ? data.byteLength : data.byteLength)
      assert.equal(payload.length, 63)
      const full = Uint8Array.from([reportId, ...payload])
      assert.equal(new DataView(full.buffer).getUint32(60, true), checksum(full.subarray(0, 60), true))
      writes.push(payload.slice())
      if (payload[1] === 0) { nonce = new Uint8Array(256); page = 0; sequence = payload[0] }
      assert.equal(payload[0], sequence)
      const start = payload[1] * 56
      nonce.set(payload.subarray(3, 3 + Math.min(56, 256 - start)), start)
      if (payload[1] === 4) {
        assert.deepEqual(payload.subarray(35, 59), new Uint8Array(24))
        challenges.push(nonce.slice())
        if (options.failure === 'pending') return
        const [authority, controller] = await keys
        const jwk = await crypto.subtle.exportKey('jwk', controller.publicKey)
        response = new Uint8Array(1040)
        response.set(new Uint8Array(await crypto.subtle.sign(signatures, controller.privateKey, nonce)), 0)
        response.fill(0x42, 256, 272)
        response.set(Buffer.from(jwk.n!, 'base64url'), 272)
        const exponent = Buffer.from(jwk.e!, 'base64url')
        response.set(exponent, 784 - exponent.length)
        response.set(new Uint8Array(await crypto.subtle.sign(signatures, authority.privateKey, response.slice(256, 784))), 784)
        if (options.failure === 'challenge') response[0] ^= 1
        if (options.failure === 'certificate') response[784] ^= 1
      }
    },
    async receiveFeatureReport (reportId) {
      requests.push(reportId)
      if (reportId === 0xA3) {
        if (options.firmwareFails) throw new DOMException('Firmware unavailable', 'NetworkError')
        return createFirmwareReport({ includesReportId: true })
      }
      if (options.failure === 'read') throw new DOMException('Read failed', 'NetworkError')
      if (options.failure === 'truncated') return new DataView(new ArrayBuffer(3))
      const payload = new Uint8Array(reportId === 0xF2 ? 15 : 63)
      payload[0] = options.failure === 'sequence' ? (sequence + 1) & 0xFF : sequence
      if (reportId === 0xF2) {
        payload[1] = options.failure === 'pending' ? 0x10 : 0
      } else {
        assert.equal(reportId, 0xF1)
        payload[1] = options.failure === 'page' ? 1 : page
        payload.set(response.subarray(page * 56, Math.min((page + 1) * 56, 1040)), 3)
        page++
      }
      return received(reportId, payload)
    }
  })
  return { device, requests, challenges, writes }
}

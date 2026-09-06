import assert from 'node:assert/strict'
import { getEventListeners } from 'node:events'
import test from 'node:test'
import { receiveFeatureReport } from '../src/firmware/receiveFeatureReport'

function deviceWith (read: () => Promise<DataView>): HIDDevice {
  return { receiveFeatureReport: read } as HIDDevice
}

test('an already cancelled feature request never starts browser I/O', async () => {
  const abort = new AbortController()
  abort.abort()
  let reads = 0
  const device = deviceWith(async () => { reads++; return new DataView(new ArrayBuffer(0)) })
  await assert.rejects(receiveFeatureReport(device, 0xA3, { timeoutMs: 1000, signal: abort.signal }), { name: 'AbortError' })
  assert.equal(reads, 0)
  assert.equal(getEventListeners(abort.signal, 'abort').length, 0)
})

test('aborting a feature request clears its timeout immediately', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const clear = t.mock.method(globalThis, 'clearTimeout')
  const abort = new AbortController()
  let rejectBrowser!: (error: unknown) => void
  const device = deviceWith(() => new Promise<DataView>((_, reject) => { rejectBrowser = reject }))
  const result = assert.rejects(receiveFeatureReport(device, 0xA3, { timeoutMs: 1000, signal: abort.signal }), { name: 'AbortError' })
  abort.abort()
  await result
  assert.equal(clear.mock.callCount(), 1)
  assert.equal(getEventListeners(abort.signal, 'abort').length, 0)
  rejectBrowser(new Error('Late browser failure'))
})

for (const outcome of ['success', 'failure', 'timeout', 'throw']) {
  test(`feature request releases resources on ${outcome}`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const clear = t.mock.method(globalThis, 'clearTimeout')
    const abort = new AbortController()
    const report = new DataView(new ArrayBuffer(4))
    const error = new Error('Browser failed')
    const device = deviceWith(() => {
      if (outcome === 'throw') throw error
      if (outcome === 'failure') return Promise.reject(error)
      if (outcome === 'timeout') return new Promise(() => {})
      return Promise.resolve(report)
    })
    const request = receiveFeatureReport(device, 0xA3, { timeoutMs: 250, signal: abort.signal })
    if (outcome === 'success') {
      assert.equal(await request, report)
    } else {
      const rejected = assert.rejects(request, outcome === 'timeout' ? { name: 'TimeoutError' } : error)
      if (outcome === 'timeout') t.mock.timers.tick(250)
      await rejected
    }
    await new Promise<void>(resolve => setImmediate(resolve))
    assert.equal(clear.mock.callCount(), 1)
    assert.equal(getEventListeners(abort.signal, 'abort').length, 0)
  })
}

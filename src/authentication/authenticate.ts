/**
 * @module
 * @internal
 */
import { abortable } from '../utils/abortable'
import { verifyAuthenticationResponse } from './verifyResponse'
import { authenticationTransport, authenticationReport, challengePage, pageLength, challengeReportId, responseReportId, statusReportId } from './reports'

// The captured PS4 Bluetooth authentication exchange takes about 30 seconds.
// https://www.psdevwiki.com/ps4/DS4-BT#HID_features_reports
const authenticationTimeoutMs = 30000
const readinessPollMs = 100

interface Authentication {
  signal?: AbortSignal
  result: Promise<boolean | null>
  finished: boolean
  pending: number
}
const active = new WeakMap<HIDDevice, Authentication>()
const sequences = new WeakMap<HIDDevice, number>()

function pause (signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted()
    const abort = () => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, readinessPollMs)
    signal.addEventListener('abort', abort, { once: true })
  })
}

/** Returns isClone: false for valid proofs, true for bad signatures, null on I/O failure. */
export function authenticateController (device: HIDDevice, signal?: AbortSignal): Promise<boolean | null> {
  const transport = authenticationTransport(device)
  if (signal?.aborted || !transport.supported || !globalThis.crypto?.subtle) return Promise.resolve(null)
  const previous = active.get(device)
  if (previous) {
    return previous.signal === signal && !previous.finished ? previous.result : Promise.resolve(null)
  }
  const task: Authentication = { signal, result: Promise.resolve(null), finished: false, pending: 0 }
  active.set(device, task)
  const release = () => {
    if (task.finished && task.pending === 0 && active.get(device) === task) active.delete(device)
  }
  const abort = new AbortController()
  const cancel = () => abort.abort(signal?.reason)
  signal?.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(() => abort.abort(new DOMException('Authentication timed out.', 'TimeoutError')), authenticationTimeoutMs)

  // A native WebHID operation cannot be cancelled. Keep the device reserved
  // until it settles, even if our deadline/cancellation has already returned.
  const io = async <T>(operation: () => Promise<T>): Promise<T> => {
    abort.signal.throwIfAborted()
    const pending = operation()
    task.pending++
    void pending.then(() => { task.pending--; release() }, () => { task.pending--; release() })
    return abortable(pending, abort.signal)
  }
  const run = async (): Promise<boolean> => {
    const sequence = ((sequences.get(device) ?? 0) % 255) + 1
    sequences.set(device, sequence)
    const challenge = crypto.getRandomValues(new Uint8Array(256))
    for (let page = 0; page < 5; page++) {
      await io(() => device.sendFeatureReport(challengeReportId, challengePage(challenge, sequence, page, transport.bluetooth)))
    }
    while (true) {
      const report = authenticationReport(await io(() => device.receiveFeatureReport(statusReportId)), statusReportId, transport.bluetooth)
      if (report[1] !== sequence) throw new Error('Unexpected authentication sequence.')
      if (report[2] === 0) break
      if (report[2] !== 0x10 && report[2] !== 0x01) throw new Error('Invalid authentication status.')
      await pause(abort.signal)
    }
    const response = new Uint8Array(1040)
    for (let page = 0; page < 19; page++) {
      const report = authenticationReport(await io(() => device.receiveFeatureReport(responseReportId)), responseReportId, transport.bluetooth)
      if (report[1] !== sequence || report[2] !== page || report[3] !== 0) throw new Error('Unexpected authentication response page.')
      response.set(report.subarray(4, 4 + Math.min(pageLength, response.length - page * pageLength)), page * pageLength)
    }
    abort.signal.throwIfAborted()
    return !await abortable(verifyAuthenticationResponse(challenge, response), abort.signal)
  }
  task.result = run().catch(() => null).finally(() => {
    task.finished = true
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
    release()
  })
  return task.result
}

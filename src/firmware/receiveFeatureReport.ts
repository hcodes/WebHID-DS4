/**
 * @module
 * @internal
 */
/** Reads one feature report and releases timeout/abort resources on every exit. */
export function receiveFeatureReport (
  device: HIDDevice,
  reportId: number,
  { timeoutMs, signal }: { timeoutMs: number, signal?: AbortSignal }
): Promise<DataView> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted()
    let settled = false
    const complete = (action: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
      action()
    }
    const fail = (error: unknown) => complete(() => reject(error))
    const abort = () => fail(signal?.reason)
    const timeout = setTimeout(() => {
      fail(new DOMException('Feature report request timed out.', 'TimeoutError'))
    }, timeoutMs)
    signal?.addEventListener('abort', abort, { once: true })
    try {
      void device.receiveFeatureReport(reportId).then(
        report => complete(() => resolve(report)),
        fail
      )
    } catch (error) {
      fail(error)
    }
  })
}

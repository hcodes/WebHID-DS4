/**
 * @module
 * @internal
 */
import { abortable } from '../utils/abortable'
import { DualShock4Interface } from '../state'
import { buildOutputReport, type OutputState } from '../protocol/output'

interface OutputSnapshot extends OutputState {
  transport: DualShock4Interface
}

interface PendingUpdate {
  resolve: () => void
  reject: (reason: unknown) => void
}

/** Owns readiness, coalescing and ordered writes; queued writes capture their target. */
export class OutputController {
  private target?: { device: HIDDevice, signal?: AbortSignal }
  private pending?: PendingUpdate[]
  private queue?: Promise<void>

  constructor (
    private readonly snapshot: () => OutputSnapshot,
    private readonly onReport: (raw: ArrayBuffer) => void
  ) {}

  get hasPendingOutput (): boolean {
    return this.pending !== undefined
  }

  attach (device: HIDDevice, signal?: AbortSignal) {
    this.target = { device, signal }
    this.queue = undefined
    // Pending updates deliberately survive replacement before detection.
  }

  clear (reason: unknown) {
    this.cancelPending(reason)
    this.target = undefined
    this.queue = undefined
  }

  drain (): Promise<void> | undefined {
    return this.queue
  }

  cancelPending (reason: unknown) {
    const pending = this.pending
    this.pending = undefined
    pending?.forEach(update => update.reject(reason))
  }

  markReady () {
    const pending = this.pending
    if (!pending) return
    // Snapshot output after the input handler and synchronous updates finish.
    queueMicrotask(() => {
      if (this.pending !== pending) return
      this.pending = undefined
      void this.send().then(
        () => pending.forEach(update => update.resolve()),
        error => pending.forEach(update => update.reject(error))
      )
    })
  }

  private enqueueOutputReport (device: HIDDevice, reportId: number, data: Uint8Array<ArrayBuffer>): Promise<void> {
    const signal = this.target?.signal
    const send = () => {
      signal?.throwIfAborted()
      return device.sendReport(reportId, data)
    }
    const operation = this.queue ? this.queue.then(send) : send()
    const output = signal ? abortable(operation, signal) : operation
    const queueTail = output.catch(() => {})

    this.queue = queueTail
    void queueTail.then(() => {
      if (this.queue === queueTail) this.queue = undefined
    })

    return output
  }

  async send (): Promise<void> {
    const target = this.target
    if (!target) throw new Error('Controller not connected. You must call .connect() first!')
    target.signal?.throwIfAborted()
    const state = this.snapshot()
    if (state.transport === DualShock4Interface.Disconnected) {
      return new Promise<void>((resolve, reject) => {
        this.pending ??= []
        this.pending.push({ resolve, reject })
      })
    }

    const report = buildOutputReport(state.transport, state)
    this.onReport(report.raw)
    return this.enqueueOutputReport(target.device, report.reportId, report.data)
  }
}

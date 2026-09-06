/**
 * @module
 * @internal
 */
import { abortable } from '../utils/abortable'
import { controllerFilters } from '../filters'
import type { DualShock4DisconnectReason } from '../events'

/** A read-only session handle; only ConnectionController can cancel or transition it. */
export interface ConnectionSession {
  readonly device: HIDDevice
  readonly signal: AbortSignal
}

interface ActiveSession extends ConnectionSession {
  readonly abort: AbortController
  phase: 'initializing' | 'connected' | 'disconnecting'
  announced: boolean
  removeDisconnectListener?: () => void
}

interface ConnectionHooks {
  opened: (session: ConnectionSession) => void
  initialize: () => Promise<unknown>
  input: (report: HIDInputReportEvent) => void
  connected: (device: HIDDevice) => void
  cleared: (device: HIDDevice, reason: DualShock4DisconnectReason, announced: boolean) => void
  prepareClose: () => { pending?: Promise<void>, restore: () => void }
}

/** Owns a WebHID session and serializes lifecycle transitions. */
export class ConnectionController {
  private currentSession?: ActiveSession
  private initialization?: Promise<boolean>
  private disconnection?: Promise<void>

  constructor (private readonly hooks: ConnectionHooks) {}

  get session (): ConnectionSession | undefined {
    return this.currentSession
  }

  get device (): HIDDevice | undefined {
    return this.currentSession?.device
  }

  // Retain the writable public device property for existing callers.
  set device (device: HIDDevice | undefined) {
    if (this.device === device) return
    this.releaseSession()
    this.currentSession = device ? this.createSession(device) : undefined
  }

  get isDisconnecting (): boolean {
    return this.currentSession?.phase === 'disconnecting'
  }

  async connect (): Promise<boolean> {
    if (this.disconnection) await this.disconnection
    if (!this.initialization && this.device?.opened) return true
    const initialization = this.initialization ??= this.initializeDevice()
    try {
      return await initialization
    } finally {
      if (this.initialization === initialization) this.initialization = undefined
    }
  }

  async disconnect (): Promise<void> {
    const disconnection = this.disconnection ??= this.disconnectDevice()
    try {
      await disconnection
    } finally {
      if (this.disconnection === disconnection) this.disconnection = undefined
    }
  }

  private createSession (device: HIDDevice): ActiveSession {
    const abort = new AbortController()
    return { device, abort, signal: abort.signal, phase: 'initializing', announced: false }
  }

  private releaseSession () {
    const session = this.currentSession
    if (!session) return
    session.device.oninputreport = null
    session.removeDisconnectListener?.()
    session.abort.abort(new DOMException('Controller disconnected.', 'AbortError'))
    this.currentSession = undefined
  }

  private bindInput (session: ActiveSession) {
    session.device.oninputreport = report => {
      if (this.currentSession === session) this.hooks.input(report)
    }
  }

  private clearSession (session: ActiveSession, reason: DualShock4DisconnectReason = 'manual') {
    if (this.currentSession !== session) return
    this.releaseSession()
    this.hooks.cleared(session.device, reason, session.announced)
  }

  private async initializeDevice (): Promise<boolean> {
    const devices = await navigator.hid.requestDevice({ filters: controllerFilters })
    const device = devices[0]
    if (!device) return false

    const session = this.createSession(device)
    const hid = navigator.hid
    const onDisconnect = (event: HIDConnectionEvent) => {
      if (event.device !== device) return
      if (this.currentSession === session) {
        this.clearSession(session, 'device-lost')
      } else {
        session.abort.abort(new DOMException('Controller disconnected during initialization.', 'AbortError'))
      }
    }
    hid.addEventListener('disconnect', onDisconnect)
    session.removeDisconnectListener = () => hid.removeEventListener('disconnect', onDisconnect)
    try {
      await abortable(device.open(), session.abort.signal)
      session.abort.signal.throwIfAborted()
    } catch (error) {
      session.removeDisconnectListener()
      throw error
    }

    this.releaseSession()
    this.currentSession = session
    this.hooks.opened(session)
    this.bindInput(session)
    await this.hooks.initialize()
    session.abort.signal.throwIfAborted()
    if (!device.opened) {
      this.clearSession(session, 'device-lost')
      throw new DOMException('Controller disconnected during initialization.', 'AbortError')
    }
    session.phase = 'connected'
    session.announced = true
    this.hooks.connected(device)
    return true
  }

  private async disconnectDevice (): Promise<void> {
    if (this.initialization) await this.initialization.catch(() => {})
    const session = this.currentSession
    if (!session) return
    const { device } = session
    const closing = this.hooks.prepareClose()
    session.phase = 'disconnecting'
    device.oninputreport = null
    try {
      if (closing.pending) await closing.pending
      if (this.currentSession !== session) return
      if (device.opened) await abortable(device.close(), session.abort.signal)
      this.clearSession(session)
    } catch (error) {
      if (session.abort.signal.aborted) return
      if (this.currentSession === session) {
        if (device.opened) {
          closing.restore()
          this.bindInput(session)
        } else {
          this.clearSession(session)
        }
      }
      throw error
    } finally {
      if (this.currentSession === session) session.phase = 'connected'
    }
  }
}

import type { TestContext } from 'node:test'

export function mediaDevice (deviceId = 'ds4', label = 'Wireless Controller', kind = 'audiooutput'): MediaDeviceInfo {
  return { deviceId, label, kind, groupId: deviceId, toJSON () { return {} } } as MediaDeviceInfo
}

export class TestTrack extends EventTarget {
  readonly kind = 'audio'
  readyState = 'live'
  stopCalls = 0
  stop () { this.stopCalls++; this.readyState = 'ended' }
}

export class TestStream {
  constructor (readonly tracks = [new TestTrack()]) {}
  getAudioTracks () { return this.tracks }
  getTracks () { return this.tracks }
}

export function audioStream (): MediaStream {
  return new TestStream() as unknown as MediaStream
}

export class TestSource {
  connected = false
  constructor (readonly mediaStream: MediaStream) {}
  connect () { this.connected = true }
  disconnect () { this.connected = false }
}

export class TestAudioContext {
  static instances: TestAudioContext[] = []
  static route: (id: string) => Promise<void> = async () => {}
  state = 'suspended'
  sinkId = ''
  sampleRate = 48000
  destination = {}
  sources: TestSource[] = []
  constructor () { TestAudioContext.instances.push(this) }
  async setSinkId (id: string) { await TestAudioContext.route(id); this.sinkId = id }
  async close () { this.state = 'closed' }
  async resume () { this.state = 'running' }
  createMediaStreamSource (stream: MediaStream) {
    const source = new TestSource(stream)
    this.sources.push(source)
    return source
  }
}

export function useAudio (t: TestContext, initialDevices = [mediaDevice()]) {
  let devices = initialDevices
  let permissionRequests = 0
  let stoppedTracks = 0
  TestAudioContext.instances = []
  TestAudioContext.route = async () => {}
  for (const [key, value] of Object.entries({ isSecureContext: true, AudioContext: TestAudioContext, MediaStream: TestStream })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { configurable: true, value })
    t.after(() => {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    })
  }
  const mediaDevices = Object.assign(new EventTarget(), {
    async enumerateDevices () { return devices },
    async getUserMedia () {
      permissionRequests++
      return { getTracks: () => [{ stop () { stoppedTracks++ } }] }
    }
  })
  Object.assign(navigator, { mediaDevices })
  return {
    mediaDevices,
    get permissionRequests () { return permissionRequests },
    get stoppedTracks () { return stoppedTracks },
    setDevices (next: MediaDeviceInfo[]) { devices = next },
    changeDevices (next: MediaDeviceInfo[]) {
      devices = next
      mediaDevices.dispatchEvent(new Event('devicechange'))
    }
  }
}

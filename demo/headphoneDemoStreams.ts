import { abortable } from '../src/utils/abortable'

/** A demo-owned producer. The headphone library only consumes its stream. */
export interface HeadphoneDemoStream {
  readonly stream: MediaStream
  /** Resolves when playback ends, fails, or is stopped; never rejects. */
  readonly finished: Promise<void>
  start: () => Promise<void>
  stop: () => void
}

interface Producer {
  start: () => void | Promise<void>
  stop: () => void
}

function createDemoStream (
  build: (context: AudioContext, destination: MediaStreamAudioDestinationNode, finish: () => void, fail: (error: Error) => void) => Producer,
  onError?: (error: Error) => void
): HeadphoneDemoStream {
  const context = new AudioContext()
  const destination = context.createMediaStreamDestination()
  const lifetime = new AbortController()
  let producer: Producer | undefined
  let started = false
  let finishPlayback!: () => void
  const finished = new Promise<void>(resolve => { finishPlayback = resolve })
  const close = (reason: unknown = new DOMException('Demo playback stopped.', 'AbortError')) => {
    if (lifetime.signal.aborted) return
    lifetime.abort(reason)
    producer?.stop()
    destination.stream.getTracks().forEach(track => track.stop())
    destination.disconnect()
    void context.close().catch(() => {})
    finishPlayback()
  }
  const stop = () => close()
  const fail = (error: Error) => {
    if (lifetime.signal.aborted) return
    close(error)
    onError?.(error)
  }
  try { producer = build(context, destination, stop, fail) } catch (error) { close(error); throw error }
  return {
    stream: destination.stream,
    finished,
    stop,
    async start () {
      lifetime.signal.throwIfAborted()
      if (started) throw new DOMException('Create a new demo stream to play again.', 'InvalidStateError')
      started = true
      try {
        await abortable(Promise.all([
          context.resume(),
          Promise.resolve().then(() => { lifetime.signal.throwIfAborted(); return producer!.start() })
        ]), lifetime.signal)
      } catch (error) { close(error); throw error }
    }
  }
}

/** Oscillators generate the stereo test in real time; no PCM buffer is precomputed. */
export function createHeadphoneTestStream (): HeadphoneDemoStream {
  return createDemoStream((context, destination, finish) => {
    const merger = context.createChannelMerger(2)
    merger.connect(destination)
    const oscillators = [context.createOscillator(), context.createOscillator()]
    const gains = [context.createGain(), context.createGain()]
    let ended = 0
    oscillators.forEach((oscillator, channel) => {
      oscillator.frequency.value = channel ? 660 : 440
      gains[channel].gain.value = 0
      oscillator.connect(gains[channel])
      gains[channel].connect(merger, 0, channel)
      oscillator.onended = () => { if (++ended === 2) finish() }
    })
    return {
      start () {
        oscillators.forEach((oscillator, channel) => {
          const start = context.currentTime + 0.05 + channel * 0.6
          const gain = gains[channel].gain
          gain.setValueAtTime(0, start)
          gain.linearRampToValueAtTime(0.1, start + 0.01)
          gain.setValueAtTime(0.1, start + 0.39)
          gain.linearRampToValueAtTime(0, start + 0.4)
          oscillator.start(start)
          oscillator.stop(start + 0.4)
        })
      },
      stop () {
        oscillators.forEach(oscillator => {
          oscillator.onended = null
          try { oscillator.stop() } catch { /* Not started yet, or already stopped. */ }
          oscillator.disconnect()
        })
        gains.forEach(gain => gain.disconnect())
        merger.disconnect()
      }
    }
  })
}

/** Stream an asset URL through a media element without loading the whole file into memory. */
export function createHeadphoneMediaStream (media: URL, onError?: (error: Error) => void): HeadphoneDemoStream {
  return createDemoStream((context, destination, finish, fail) => {
    const element = new Audio()
    const source = context.createMediaElementSource(element)
    source.connect(destination) // Never connect this producer to the default speakers.
    element.src = media.href
    element.preload = 'metadata'
    element.onended = finish
    element.onerror = () => fail(new Error(`Audio file could not be played: ${element.error?.message || 'unsupported format or decoding error'}`))
    return {
      start: () => element.play(),
      stop () {
        element.onended = null
        element.onerror = null
        element.pause()
        element.removeAttribute('src')
        element.load()
        source.disconnect()
      }
    }
  }, onError)
}

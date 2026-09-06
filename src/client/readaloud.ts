/**
 * The read-aloud playback controller: walks a lesson's sentence queue over a
 * synthesizer engine, falling back to the browser's speechSynthesis the
 * moment the Edge synthesis path fails (offline, endpoint gone, 5xx). Plain
 * TypeScript with injected engines so the fallback decision is unit-testable
 * without audio hardware.
 * @module dsh-plugin-lookatstudy/client/readaloud
 */

/** One speakable backend: Edge-over-dashboard-audio, or window.speechSynthesis. */
export interface SpeechEngine {
  /** Speak one sentence; resolves when playback finishes, rejects on failure. */
  speak(text: string): Promise<void>
  pause(): void
  resume(): void
  /** Hard-stop; the controller also drops its queue on stop(). */
  cancel(): void
}

export type ReadAloudEngineName = 'edge' | 'system'
export type ReadAloudState = 'idle' | 'speaking' | 'paused'

export interface ReadAloudStatus {
  index: number
  total: number
  engine: ReadAloudEngineName | null
  state: ReadAloudState
  /** Set once the primary engine failed and the system voice took over. */
  degraded: boolean
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms) })

export class ReadAloudController {
  private index = 0
  private stopped = false
  private paused = false
  private engine: ReadAloudEngineName | null = null
  private degraded = false
  private run: Promise<void> | null = null

  constructor(
    private readonly sentences: readonly string[],
    private readonly primary: SpeechEngine,
    private readonly fallback: SpeechEngine,
    private readonly notify?: (status: ReadAloudStatus) => void,
  ) {}

  private emit(state: ReadAloudState): void {
    this.notify?.({ index: this.index, total: this.sentences.length, engine: this.engine, state, degraded: this.degraded })
  }

  /** Speak the whole queue; the returned promise settles when done or stopped. */
  start(): Promise<void> {
    if (this.run !== null) return this.run
    this.stopped = false
    this.run = (async () => {
      this.engine = 'edge'
      this.emit('speaking')
      while (!this.stopped && this.index < this.sentences.length) {
        const text = this.sentences[this.index]!
        try {
          await this.speakOn(text)
        } catch {
          if (this.stopped) return
          if (this.engine === 'edge') {
            // The one-way ratchet: Edge fails → system voice finishes the lesson.
            this.degraded = true
            this.engine = 'system'
            this.emit('speaking')
            try {
              await this.speakOn(text)
            } catch {
              this.emit('idle')
              return // even the system voice is gone (no voices installed); give up honestly
            }
          } else {
            this.emit('idle')
            return
          }
        }
        if (this.stopped) return
        this.index += 1
        this.emit('speaking')
      }
      this.emit('idle')
    })()
    return this.run
  }

  private async speakOn(text: string): Promise<void> {
    const impl = this.engine === 'system' ? this.fallback : this.primary
    await impl.speak(text)
    // A pause pressed mid-utterance holds the QUEUE too, not just the audio —
    // otherwise a long pause races on to the next sentence.
    while (this.paused && !this.stopped) await sleep(120)
  }

  pause(): void {
    if (this.stopped || this.paused) return
    this.paused = true
    ;(this.engine === 'system' ? this.fallback : this.primary).pause()
    this.emit('paused')
  }

  resume(): void {
    if (!this.paused) return
    this.paused = false
    ;(this.engine === 'system' ? this.fallback : this.primary).resume()
    this.emit('speaking')
  }

  /** Stop everything; the controller is single-use — build a fresh one to replay. */
  stop(): void {
    this.stopped = true
    this.paused = false
    this.primary.cancel()
    this.fallback.cancel()
    this.emit('idle')
  }

  get status(): ReadAloudStatus {
    return { index: this.index, total: this.sentences.length, engine: this.engine, state: this.stopped ? 'idle' : this.paused ? 'paused' : 'speaking', degraded: this.degraded }
  }
}

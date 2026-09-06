/**
 * The read-aloud controller: sentence queue walking, the one-way Edge →
 * speechSynthesis degradation ratchet, and stop/pause semantics — all over
 * fake engines (no audio hardware).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { ReadAloudController, type ReadAloudStatus, type SpeechEngine } from '../src/client/readaloud.ts'

function fakeEngine(behavior: { failFrom?: string } = {}): { engine: SpeechEngine; spoken: string[] } {
  const spoken: string[] = []
  return {
    spoken,
    engine: {
      speak(text: string): Promise<void> {
        if (behavior.failFrom !== undefined && text === behavior.failFrom) return Promise.reject(new Error('synthesis down'))
        spoken.push(text)
        return Promise.resolve()
      },
      pause(): void {},
      resume(): void {},
      cancel(): void {},
    },
  }
}

test('the controller walks every sentence over the primary engine', async () => {
  const primary = fakeEngine()
  const fallback = fakeEngine()
  const seen: ReadAloudStatus[] = []
  const ctl = new ReadAloudController(['一。', '二。', '三。'], primary.engine, fallback.engine, s => seen.push(s))
  await ctl.start()
  assert.deepEqual(primary.spoken, ['一。', '二。', '三。'])
  assert.deepEqual(fallback.spoken, [], 'the fallback never speaks when Edge works')
  assert.equal(seen.at(-1)?.state, 'idle', 'the run ends idle')
  assert.equal(seen.at(-1)?.engine, 'edge')
})

test('an Edge failure ratchets to the system voice for the REST of the lesson', async () => {
  const primary = fakeEngine({ failFrom: '二。' })
  const fallback = fakeEngine()
  const seen: ReadAloudStatus[] = []
  const ctl = new ReadAloudController(['一。', '二。', '三。'], primary.engine, fallback.engine, s => seen.push(s))
  await ctl.start()
  assert.deepEqual(primary.spoken, ['一。'], 'Edge speaks only until its first failure')
  assert.deepEqual(fallback.spoken, ['二。', '三。'], 'the system voice finishes the queue')
  assert.ok(seen.some(s => s.degraded && s.engine === 'system'), 'the degradation is reported')
})

test('total failure of both engines ends the run honestly instead of hanging', async () => {
  const primary = fakeEngine({ failFrom: '一。' })
  const fallback = fakeEngine({ failFrom: '一。' })
  const seen: ReadAloudStatus[] = []
  const ctl = new ReadAloudController(['一。', '二。'], primary.engine, fallback.engine, s => seen.push(s))
  await ctl.start()
  assert.deepEqual(seen.at(-1), { index: 0, total: 2, engine: 'system', state: 'idle', degraded: true })
})

test('stop abandons the queue and cancels both engines', async () => {
  const primary = fakeEngine()
  const fallback = fakeEngine()
  let gate: ((v: void) => void) | undefined
  const slow = { ...primary.engine, speak: (text: string) => new Promise<void>(resolve => { gate = resolve; primary.spoken.push(text) }) }
  const ctl = new ReadAloudController(['一。', '二。'], slow, fallback.engine)
  const run = ctl.start()
  ctl.stop()
  gate?.()
  await run
  assert.deepEqual(primary.spoken, ['一。'], 'only the in-flight sentence ran')
  assert.deepEqual(fallback.spoken, [])
  assert.equal(ctl.status.state, 'idle')
  assert.equal(ctl.status.index, 0, 'a stopped controller does not advance')
})

test('pause holds the queue between sentences; resume releases it', async () => {
  const primary = fakeEngine()
  const fallback = fakeEngine()
  const ctl = new ReadAloudController(['一。', '二。'], primary.engine, fallback.engine)
  const run = ctl.start()
  ctl.pause()
  await new Promise(resolve => { setTimeout(resolve, 200) })
  assert.equal(primary.spoken.length, 1, 'the next sentence is held while paused')
  assert.equal(ctl.status.state, 'paused')
  ctl.resume()
  await run
  assert.deepEqual(primary.spoken, ['一。', '二。'])
})

test('the controller prewarms the NEXT sentence on the active engine when it supports it', async () => {
  const warmed: string[] = []
  const spoken: string[] = []
  const primary: SpeechEngine = {
    speak: (text: string) => { spoken.push(text); return Promise.resolve() },
    pause: () => {},
    resume: () => {},
    cancel: () => {},
    prewarm: (text: string) => { warmed.push(text) },
  }
  const fallback = fakeEngine()
  const ctl = new ReadAloudController(['一。', '二。', '三。'], primary, fallback.engine)
  await ctl.start()
  assert.deepEqual(spoken, ['一。', '二。', '三。'])
  assert.deepEqual(warmed, ['二。', '三。'], 'each play warms its successor; the last sentence has none')
})

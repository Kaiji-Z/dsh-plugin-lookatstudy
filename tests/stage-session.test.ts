import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  STAGE_SOURCE, acquireStageReference, mainSelectionOf, stageSession, stagingMode, unstageSession,
  type StageReference, type StageSessionsFace,
} from '../src/client/stage-session.ts'

interface Recorder {
  face: StageSessionsFace
  opened: string[]
  retained: Array<{ id: string; source: string }>
  released: string[]
}

function recorder(): Recorder {
  const opened: string[] = []
  const retained: Array<{ id: string; source: string }> = []
  const released: string[] = []
  const face = {
    open: (id: string): void => { opened.push(id) },
    // reads `this` — a detached extraction (retain.call(undefined)) must throw
    // here, mirroring the host service's own `this.closed` read (alpha-probe catch)
    retain(this: unknown, id: string, options: { source: string }): StageReference {
      if (this === undefined || this === null) throw new TypeError('detached retain call')
      retained.push({ id, source: options.source })
      return { sessionId: id, release: () => { released.push(id) } }
    },
  }
  return { face, opened, retained, released }
}

test('stagingMode picks retain when the host exposes it (retain wins over both)', () => {
  assert.equal(stagingMode(recorder().face), 'retain')
  assert.equal(stagingMode({}), 'open')
  assert.equal(stagingMode({ open: (id: string) => {} }), 'open')
})

test('stageSession retains under the plugin source and swaps references without a gap', () => {
  unstageSession()
  const r = recorder()
  stageSession(r.face, 'a')
  stageSession(r.face, 'b')
  assert.deepEqual(r.retained, [
    { id: 'a', source: STAGE_SOURCE },
    { id: 'b', source: STAGE_SOURCE },
  ])
  // the previous reference releases only AFTER the new one is held
  assert.deepEqual(r.released, ['a'])
  // the discipline: never the view owner's navigation label
  assert.notEqual(STAGE_SOURCE, 'mainView')
  unstageSession()
  assert.deepEqual(r.released, ['a', 'b'])
})

test('stageSession is a same-id no-op on the retain path', () => {
  unstageSession()
  const r = recorder()
  stageSession(r.face, 'a')
  stageSession(r.face, 'a')
  assert.equal(r.retained.length, 1)
  unstageSession()
})

test('a refused retain keeps the previous reference held', () => {
  unstageSession()
  const r = recorder()
  stageSession(r.face, 'a')
  const refusing: StageSessionsFace = { ...r.face, retain: () => { throw new Error('disposed') } }
  assert.throws(() => { stageSession(refusing, 'b') })
  assert.deepEqual(r.released, []) // 'a' stays observed
  unstageSession()
})

test('stageSession on rc hosts forwards to open (idempotence is the host side)', () => {
  const r = recorder()
  const rc: StageSessionsFace = { open: r.face.open }
  stageSession(rc, 'a')
  stageSession(rc, 'a')
  assert.deepEqual(r.opened, ['a', 'a'])
  assert.deepEqual(r.retained, [])
})

test('acquireStageReference: rc no-op closer, alpha closer releases exactly once', () => {
  const rc = acquireStageReference({ open: () => {} }, 'a')
  assert.notEqual(rc, undefined)
  rc!()
  rc!() // idempotent
  const r = recorder()
  const close = acquireStageReference(r.face, 'a')
  assert.notEqual(close, undefined)
  close!()
  close!()
  assert.deepEqual(r.released, ['a'])
  const refusing: StageSessionsFace = { retain: () => { throw new Error('refused') } }
  assert.equal(acquireStageReference(refusing, 'a'), undefined)
})

test('mainSelectionOf reads the view owner label the way ui-workspace does', () => {
  assert.equal(mainSelectionOf({ x: { retainedBy: { mainView: 1 } }, y: { retainedBy: { lookatstudy: 3 } } }), 'x')
  assert.equal(mainSelectionOf({ x: { retainedBy: { mainView: 0 } } }), undefined)
  assert.equal(mainSelectionOf({ x: {} }), undefined) // rc snapshots carry no retainedBy
  assert.equal(mainSelectionOf(undefined), undefined)
})

test('structural: all staging goes through stage-session — no direct .sessions.open( calls', () => {
  const panel = readFileSync(new URL('../src/client/panel.tsx', import.meta.url), 'utf8')
  assert.equal(/\.sessions\.open\(/.test(panel), false, 'panel.tsx must stage through stageSession')
  const shell = readFileSync(new URL('../src/client/shell-entry.ts', import.meta.url), 'utf8')
  assert.equal(/\.sessions\.open\(/.test(shell), false, 'shell-entry.ts must not call open directly')
  const faces = readFileSync(new URL('../src/client/faces.ts', import.meta.url), 'utf8')
  assert.equal(/open\?\(sessionId: string\): void/.test(faces), true, 'faces declares the optional rc open')
  assert.equal(/retain\?\(sessionId: string, options: \{ source: string \}\)/.test(faces), true, 'faces declares the optional alpha retain')
})

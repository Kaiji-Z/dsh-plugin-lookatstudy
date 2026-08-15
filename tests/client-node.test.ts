/**
 * The study tab's client logic: the pure transcript fold (user/assistant text
 * extraction, tool chips, streaming partial) and the shared poll store's
 * lifecycle and write actions, both runnable under plain node:test.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { transcriptRows } from '../src/client/views.tsx'
import type { ConversationNode } from '@deepseek-ai/dsh-client-runtime/client'
import { studyStore, type StudyState } from '../src/client/data.ts'

/** Synthesize one finalized conversation node (durable shapes, cast at the boundary). */
function node(shape: Record<string, unknown>): ConversationNode {
  return shape as never
}

test('transcriptRows folds user and assistant text in order', () => {
  const rows = transcriptRows([
    node({ kind: 'user', seq: 1, time: 0, content: [{ type: 'text', text: '什么是梯度下降?' }], source: {} }),
    node({ kind: 'assistant', seq: 2, time: 0, turn: 1, step: 1, blocks: [
      { kind: 'reasoning', text: 'thinking...' },
      { kind: 'text', text: '梯度下降是...' },
      { kind: 'text', text: '第二段' },
      { kind: 'tool-call', callId: 'c1', name: 'study_lesson', argsRaw: '{}' },
    ] }),
  ], null)
  assert.deepEqual(rows.map(r => [r.role, r.key]), [['user', 'u1'], ['assistant', 'a2']])
  assert.equal(rows[0]!.text, '什么是梯度下降?')
  assert.equal(rows[1]!.text, '梯度下降是...\n\n第二段', 'assistant text blocks join with a blank line; reasoning excluded')
})

test('transcriptRows condenses tool results to chips, skips noise, and appends the partial', () => {
  const rows = transcriptRows([
    node({ kind: 'assistant', seq: 2, time: 0, turn: 1, step: 1, blocks: [{ kind: 'tool-call', callId: 'c1', name: 'study_record_answer', argsRaw: '{}' }] }),
    node({ kind: 'tool-result', seq: 3, time: 0, callId: 'c1', call: { name: 'study_record_answer', argsRaw: '{}' }, content: [], isError: false, subCalls: [] }),
    node({ kind: 'tool-result', seq: 4, time: 0, callId: 'c2', call: null, content: [], isError: false, subCalls: [] }),
    node({ kind: 'command', seq: 5, time: 0, commandId: 'x', name: 'goal', args: null, outcome: null }),
    node({ kind: 'turn-error', seq: 6, time: 0, turn: 1, step: 2, message: 'provider down' }),
    node({ kind: 'user', seq: 7, time: 0, content: [{ type: 'image', attachment: {} }], source: {} }),
  ], { turn: 1, step: 3, blocks: [{ kind: 'text', text: '正在打字…' }] })
  assert.deepEqual(rows.map(r => [r.role, r.text]), [
    ['tool', 'study_record_answer'],
    ['tool', 'c2'],
    ['error', 'provider down'],
    ['streaming', '正在打字…'],
  ], 'image-only user rows skip; the partial lands last')
})

/** Minimal server payload the poll path accepts. */
function statePayload(mode: StudyState['mode']): StudyState {
  return {
    mode,
    courses: [],
    focusLessonId: null,
    lesson: null,
    dueCount: 0,
    due: [],
    pendingProposals: [],
    memory: { global: null, lesson: null, pattern: null },
  }
}

test('the shared store polls once per cycle and posts write actions to the host routes', async () => {
  const originalFetch = globalThis.fetch
  const calls: Array<{ url: string; method: string; body: string | null }> = []
  let polls = 0
  let currentMode: StudyState['mode'] = 'guide'
  globalThis.fetch = (async (url: unknown, init?: { method?: string; body?: string }) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body ?? null })
    if ((init?.method ?? 'GET') === 'GET') {
      polls += 1
      return new Response(JSON.stringify(statePayload(currentMode)), { status: 200 })
    }
    currentMode = (JSON.parse(init?.body ?? '{}') as { mode?: StudyState['mode'] }).mode ?? currentMode
    return new Response(JSON.stringify({ ok: true, mode: currentMode }), { status: 200 })
  }) as typeof fetch
  const settle = (): Promise<void> => new Promise(resolve => { setTimeout(resolve, 5) })
  let unsubscribe: (() => void) | undefined
  try {
    let pushes = 0
    unsubscribe = studyStore.subscribe(() => { pushes += 1 })
    assert.equal(polls, 1, 'first subscription fires one immediate poll')
    await settle()
    assert.equal(studyStore.getSnapshot()?.mode, 'guide')

    await studyStore.setMode('practice')
    await settle()
    assert.deepEqual(
      calls.find(c => c.method === 'POST'),
      { url: '/lookatstudy/api/mode', method: 'POST', body: JSON.stringify({ mode: 'practice' }) },
      'mode switch posts to the host route',
    )
    assert.equal(studyStore.getSnapshot()?.mode, 'practice', 'refresh after write adopts the new snapshot')
    assert.ok(pushes >= 2, 'subscribers were notified across poll cycles')
    unsubscribe()
    unsubscribe = undefined
    const callsAfterUnsubscribe = calls.length
    await new Promise(resolve => { setTimeout(resolve, 20) })
    assert.equal(calls.length, callsAfterUnsubscribe, 'unsubscribing the last listener stops the poller')
  } finally {
    unsubscribe?.()
    globalThis.fetch = originalFetch
  }
})

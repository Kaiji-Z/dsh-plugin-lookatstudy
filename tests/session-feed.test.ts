/**
 * The panel tutor's chat stream fold: durable user/assistant events become
 * rows, tool traffic stays out, live text deltas accumulate per attempt.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { feedRows, type FeedEntry, type FeedWindow } from '../src/client/session-feed.ts'

function entry(event: Record<string, unknown>): FeedEntry {
  return { type: 'event', event: event as never }
}

function transient(event: Record<string, unknown>): FeedEntry {
  return { type: 'transient', event: event as never }
}

function win(entries: FeedEntry[]): FeedWindow {
  return { entries, hasMore: false }
}

test('feedRows folds user and assistant message events in order', () => {
  const rows = feedRows(win([
    entry({ type: 'user/message', seq: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '什么是梯度下降?' }] } }),
    entry({ type: 'tool/call', seq: 2, data: {} }),
    entry({ type: 'assistant/message', seq: 3, data: { message: { content: [{ kind: 'text', text: '梯度下降是...' }] } } }),
  ]))
  assert.deepEqual(rows.map(r => [r.role, r.key]), [['user', 'u1'], ['assistant', 'a3']])
  assert.equal(rows[1]!.text, '梯度下降是...')
})

test('feedRows skips tool traffic entirely', () => {
  const rows = feedRows(win([
    entry({ type: 'tool/call', seq: 1, data: {} }),
    entry({ type: 'tool/result', seq: 2, data: {} }),
    entry({ type: 'step/end', seq: 3, data: {} }),
  ]))
  assert.deepEqual(rows, [], 'the study view never mirrors tool traffic')
})

test('live text-deltas accumulate into one streaming row for the latest attempt', () => {
  const rows = feedRows(win([
    entry({ type: 'user/message', seq: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '讲讲逆梯度' }] } }),
    transient({ type: 'assistant/live-chunk', seq: 2, data: { attemptId: 'att1', chunk: { type: 'text-delta', text: '逆梯度' } } }),
    transient({ type: 'assistant/live-chunk', seq: 3, data: { attemptId: 'att1', chunk: { type: 'text-delta', text: '就是梯度' } } }),
    transient({ type: 'assistant/live-chunk', seq: 4, data: { attemptId: 'att1', chunk: { type: 'text-delta', text: '下降的反向。' } } }),
  ]))
  assert.deepEqual(rows.map(r => r.role), ['user', 'streaming'])
  assert.equal(rows[1]!.text, '逆梯度就是梯度下降的反向。')
  assert.equal(rows[1]!.key, 'streaming')
})

test('a settled assistant message replaces the streaming row', () => {
  const rows = feedRows(win([
    transient({ type: 'assistant/live-chunk', seq: 1, data: { attemptId: 'att1', chunk: { type: 'text-delta', text: '正在打字' } } }),
    entry({ type: 'assistant/message', seq: 2, data: { message: { content: [{ kind: 'text', text: '完整回答' }] } } }),
  ]))
  assert.deepEqual(rows.map(r => [r.role, r.text]), [['assistant', '完整回答']], 'no stale streaming row after settlement')
})

test('feedRows tolerates undefined windows, empty entries, and non-text chunks', () => {
  assert.deepEqual(feedRows(undefined), [])
  assert.deepEqual(feedRows(win([])), [])
  const rows = feedRows(win([
    transient({ type: 'assistant/live-chunk', seq: 1, data: { attemptId: 'a', chunk: { type: 'reasoning-delta', text: 'thinking' } } }),
  ]))
  assert.deepEqual(rows, [], 'reasoning deltas do not surface as streaming text')
})

test('only learner-sourced user messages render; machinery kinds never do', () => {
  // Live 0.14.0 catch: the host logs runtime-context snapshots (source.kind
  // 'plugin'), <system-reminder> injections ('agent-instructions'), and tool
  // results as user/message events — machinery, not turns. The whitelist is
  // source.kind 'user', exactly what face.prompt submits.
  const rows = feedRows(win([
    entry({ type: 'user/message', seq: 1, data: { source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt' }, content: [{ type: 'text', text: 'Current runtime context. This snapshot supersedes…' }] } }),
    entry({ type: 'user/message', seq: 2, data: { source: { kind: 'agent-instructions', changes: [] }, content: [{ type: 'text', text: '<system-reminder>…' }] } }),
    entry({ type: 'user/message', seq: 3, data: { source: { kind: 'tool', callId: 'c1' }, content: [] } }),
    entry({ type: 'user/message', seq: 4, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '真正的学习者提问' }] } }),
  ]))
  assert.deepEqual(rows.map(r => [r.role, r.text]), [['user', '真正的学习者提问']])
})

/**
 * The panel tutor's chat stream fold: durable user/assistant events become
 * rows, tool calls ride as three-state chips and reasoning as collapsible
 * rows (C14), live text deltas accumulate per attempt.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { feedRows, feedLastSeq, feedTurnActive, type FeedEntry, type FeedWindow } from '../src/client/session-feed.ts'

function entry(event: Record<string, unknown>): FeedEntry {
  return { type: 'event', event: event as never }
}

function transient(event: Record<string, unknown>): FeedEntry {
  return { type: 'transient', event: event as never }
}

function win(entries: FeedEntry[]): FeedWindow {
  return { entries, hasMore: false }
}

test('feedRows folds user, tool chips, and assistant message events in order', () => {
  const rows = feedRows(win([
    entry({ type: 'user/message', seq: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '什么是梯度下降?' }] } }),
    entry({ type: 'tool/call', seq: 2, data: { callId: 'c1', tool: { name: 'study_view' } } }),
    entry({ type: 'assistant/message', seq: 3, data: { message: { content: [{ kind: 'text', text: '梯度下降是...' }] } } }),
  ]))
  assert.deepEqual(rows.map(r => [r.role, r.key]), [['user', 'u1'], ['tool', 'tc1'], ['assistant', 'a3']])
  assert.equal(rows[1]!.text, 'study_view')
  assert.equal(rows[1]!.toolState, 'loading')
  assert.equal(rows[2]!.text, '梯度下降是...')
})

test('tool chips settle done/error on their result; orphans and steps stay out (C14)', () => {
  const settled = feedRows(win([
    entry({ type: 'tool/call', seq: 1, data: { callId: 'c1', tool: { name: 'search' } } }),
    entry({ type: 'tool/call', seq: 2, data: { callId: 'c2', tool: { name: 'record' } } }),
    entry({ type: 'tool/result', seq: 3, data: { callId: 'c1' } }),
    entry({ type: 'tool/result', seq: 4, data: { callId: 'c2', error: { message: 'boom' } } }),
    entry({ type: 'tool/result', seq: 5, data: { callId: 'orphan' } }),
    entry({ type: 'step/end', seq: 6, data: {} }),
  ]))
  assert.deepEqual(settled.map(r => [r.key, r.toolState]), [['tc1', 'done'], ['tc2', 'error']],
    'the three-state chip settles by callId; orphan results and steps never render rows')
})

test('tool chips settle off the LIVE host result shape: callId inside data.message, isError (0.18 live catch)', () => {
  const rows = feedRows(win([
    entry({ type: 'tool/call', seq: 1, data: { turn: 1, step: 0, callId: 'live-1', name: 'study_view', arguments: '{}' } }),
    entry({ type: 'tool/result', seq: 2, data: { turn: 1, step: 1, message: { source: { kind: 'tool', callId: 'live-1' }, content: [{ type: 'tool-result', toolCallId: 'live-1', content: [] }] } } }),
    entry({ type: 'tool/call', seq: 3, data: { turn: 2, step: 0, callId: 'live-2', name: 'study_quiz', arguments: '{}' } }),
    entry({ type: 'tool/result', seq: 4, data: { turn: 2, step: 1, message: { source: { kind: 'tool', callId: 'live-2' }, content: [], isError: true } } }),
  ]))
  assert.deepEqual(rows.map(r => [r.key, r.text, r.toolState]),
    [['tlive-1', 'study_view', 'done'], ['tlive-2', 'study_quiz', 'error']],
    'the journal wire shape (result wraps a message with source.kind tool) settles by message.source.callId and reads isError')
})

test('reasoning blocks fold into a collapsible row ahead of the text (C14)', () => {
  const rows = feedRows(win([
    entry({ type: 'assistant/message', seq: 1, data: { message: { content: [
      { kind: 'reasoning', text: '先想清楚梯度方向' },
      { kind: 'text', text: '答案是逆梯度。' },
    ] } } }),
  ]))
  assert.deepEqual(rows.map(r => [r.role, r.text]), [['reasoning', '先想清楚梯度方向'], ['assistant', '答案是逆梯度。']])
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

test('feedTurnActive reads the turn lifecycle — the stop twin rides it, not the prompt promise (C2)', () => {
  // full turn: start -> work -> end = idle
  assert.equal(feedTurnActive(win([
    entry({ type: 'turn/start', seq: 1, data: {} }),
    entry({ type: 'user/message', seq: 2, data: { source: { kind: 'user' }, content: [] } }),
    entry({ type: 'assistant/message', seq: 3, data: {} }),
    entry({ type: 'turn/end', seq: 4, data: {} }),
  ])), false)
  // mid-turn: step/end does NOT close a turn (journal-verified)
  assert.equal(feedTurnActive(win([
    entry({ type: 'turn/start', seq: 1, data: {} }),
    entry({ type: 'step/end', seq: 2, data: {} }),
    entry({ type: 'step/start', seq: 3, data: {} }),
    entry({ type: 'tool/call', seq: 4, data: { callId: 'c1', name: 'x' } }),
  ])), true)
  // truncated window: the turn/start slid out, live chunks still prove active
  assert.equal(feedTurnActive(win([
    transient({ type: 'assistant/live-chunk', seq: 1, data: { attemptId: 'a', chunk: { type: 'text-delta', text: 'x' } } }),
  ])), true)
  // nothing bound / empty window
  assert.equal(feedTurnActive(undefined), false)
  assert.equal(feedTurnActive(win([])), false)
})

test('the stop watermark disarms the host cancel wedge-open turn (C2 live catch)', () => {
  const window = win([
    entry({ type: 'turn/start', seq: 1, data: {} }),
    entry({ type: 'user/message', seq: 2, data: { source: { kind: 'user' }, content: [] } }),
    entry({ type: 'assistant/attempt', seq: 3, data: {} }),
    entry({ type: 'step/end', seq: 4, data: {} }),
    // cancel: attempt + step/end journal, turn/end NEVER comes — turn reads open
  ])
  assert.equal(feedTurnActive(window), true, 'pre-stop: the fold honestly reads the open turn')
  assert.equal(feedLastSeq(window), 4)
  assert.equal(feedTurnActive(window, 4), false, 'post-stop watermark: the wedge-open turn no longer reads busy')
  // a fresh turn past the watermark re-arms
  const next = win([...window.entries,
    entry({ type: 'turn/start', seq: 5, data: {} }),
    entry({ type: 'step/start', seq: 6, data: {} }),
  ])
  assert.equal(feedTurnActive(next, 4), true)
  assert.equal(feedLastSeq(next), 6)
  assert.equal(feedTurnActive(win([]), 3), false)
  assert.equal(feedLastSeq(undefined), 0)
})

// ——— D4: in-stream artifact hydration + the sediment backlog ———

import { hydrateArtifactRows, sedimentBacklog, type ArtifactLike } from '../src/client/session-feed.ts'

function quizArtifact(id: string, title: string, count: number): ArtifactLike {
  return { id, artifactType: 'quiz', title, data: { questions: Array.from({ length: count }, () => ({ prompt: 'p', options: ['a', 'b'], answer: 0, explanation: 'e' })) } }
}

test('D4: a settled study_generate_quiz result keeps its rendered text and hydrates onto the matching artifact', () => {
  const rows = feedRows(win([
    entry({ type: 'user/message', seq: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '来张练习卡' }] } }),
    entry({ type: 'tool/call', seq: 2, data: { callId: 'q1', tool: { name: 'study_generate_quiz' } } }),
    entry({ type: 'tool/result', seq: 3, data: { message: { source: { kind: 'tool', callId: 'q1' }, content: [{ type: 'tool-result', toolCallId: 'q1', content: [{ type: 'text', text: 'Practice card (3 questions): 梯度下降练习' }] }] } } }),
  ]))
  assert.equal(rows[1]!.resultText, 'Practice card (3 questions): 梯度下降练习', 'the render text survives the fold (the payload join key)')
  const artifacts = [quizArtifact('quiz-aaa', '其他卡', 2), quizArtifact('quiz-bbb', '梯度下降练习', 3)]
  const hydrated = hydrateArtifactRows(rows, artifacts)
  assert.deepEqual(hydrated.map(r => r.role), ['user', 'artifact'])
  assert.equal(hydrated[1]!.artifactId, 'quiz-bbb', 'title + question count join (not the latest-of-type fallback)')
  assert.equal(hydrated[1]!.artifactType, 'quiz')
})

test('D4: hydration falls back to the latest unclaimed artifact of the type and never double-claims', () => {
  const mk = (id: string): FeedEntry[] => ([
    entry({ type: 'tool/call', seq: 1, data: { callId: id, tool: { name: 'study_pose_guess' } } }),
    entry({ type: 'tool/result', seq: 2, data: { message: { source: { kind: 'tool', callId: id }, content: [{ type: 'tool-result', toolCallId: id, content: [{ type: 'text', text: `Guess posed: prompt-${id}` }] }] } } }),
  ])
  const rows = feedRows(win([...mk('g1'), ...mk('g2')]))
  const artifacts: ArtifactLike[] = [
    { id: 'guess-1', artifactType: 'guess', title: 'guess', data: { prompt: 'other' } },
    { id: 'guess-2', artifactType: 'guess', title: 'guess', data: { prompt: 'prompt-g2' } },
  ]
  const hydrated = hydrateArtifactRows(rows, artifacts)
  assert.deepEqual(hydrated.map(r => [r.role, r.artifactId]), [['artifact', 'guess-2'], ['artifact', 'guess-1']],
    'g1 has no prompt match → latest-unclaimed fallback takes guess-2; g2 then falls to guess-1; one artifact per row')
})

test('D4: unmatched, loading, failed, and non-artifact rows keep their chip', () => {
  const rows = feedRows(win([
    entry({ type: 'tool/call', seq: 1, data: { callId: 'loading', tool: { name: 'study_generate_quiz' } } }),
    entry({ type: 'tool/call', seq: 2, data: { callId: 'failed', tool: { name: 'study_generate_quiz' } } }),
    entry({ type: 'tool/result', seq: 3, data: { message: { source: { kind: 'tool', callId: 'failed' }, content: [], isError: true } } }),
    entry({ type: 'tool/call', seq: 4, data: { callId: 'plain', tool: { name: 'study_lesson' } } }),
    entry({ type: 'tool/result', seq: 5, data: { message: { source: { kind: 'tool', callId: 'plain' }, content: [{ type: 'tool-result', toolCallId: 'plain', content: [{ type: 'text', text: 'lesson' }] }] } } }),
    entry({ type: 'tool/call', seq: 6, data: { callId: 'lagging', tool: { name: 'study_compare_table' } } }),
    entry({ type: 'tool/result', seq: 7, data: { message: { source: { kind: 'tool', callId: 'lagging' }, content: [{ type: 'tool-result', toolCallId: 'lagging', content: [{ type: 'text', text: 'Compare table: X (2 rows)' }] }] } } }),
  ]))
  const hydrated = hydrateArtifactRows(rows, []) // empty artifacts = the state poll lagging
  assert.deepEqual(hydrated.map(r => [r.role, r.toolState]),
    [['tool', 'loading'], ['tool', 'error'], ['tool', 'done'], ['tool', 'done']],
    'no artifacts → every chip stands in (hydration re-runs when the poll lands)')
  assert.equal(hydrated[1]!.resultText, undefined, 'failed results carry no render text')
  assert.equal(hydrated[2]!.resultText, 'lesson')
})

test('D4: the sediment backlog drops inline-rendered artifacts and orders unseen first (stable)', () => {
  const a1 = quizArtifact('quiz-1', '一', 2)
  const a2 = quizArtifact('quiz-2', '二', 2)
  const a3 = { id: 'cmp-1', artifactType: 'compare_table', title: '对比', data: {} } as ArtifactLike
  const backlog = sedimentBacklog([a1, a2, a3], new Set(['quiz-2']), ['cmp-1'])
  assert.deepEqual(backlog.map(a => a.id), ['cmp-1', 'quiz-1'],
    'inline quiz-2 drops out; unseen cmp-1 sorts ahead of seen quiz-1')
  assert.deepEqual(sedimentBacklog([a1], new Set(), []).map(a => a.id), ['quiz-1'])
})

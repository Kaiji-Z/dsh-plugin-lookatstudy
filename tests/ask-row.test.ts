/** The ask_user_question panel answer UI (0.23.0): the fold turns the host's
 * pending clarifying question into an ANSWERABLE row — options parsed from
 * the tool call's JSON-string arguments (live journal shape, verified
 * 2026-09-14), answered when the structured result lands OR a later learner
 * row appears in the window (history case). Red-proven on the baseline (the
 * exports did not exist). */
import test from 'node:test'
import assert from 'node:assert/strict'
import { feedRows, parseAskArguments, type FeedWindow } from '../src/client/session-feed.ts'

const ARGS = JSON.stringify({
  questions: [{
    header: '下一步',
    id: 'js_vs_course',
    multi_select: true,
    options: [
      { description: '我用通用知识讲清楚，然后回到课程。', label: '快速讲一下区别 (Recommended)' },
      { description: '帮你导入一份系统的 JavaScript 课程。', label: '导入 JS 教程系统学' },
    ],
  }],
})

const win = (events: unknown[]): FeedWindow => ({
  entries: events.map((data, i) => ({ type: 'event', event: { type: data instanceof Object && 't' in (data as object) ? (data as { t: string }).t : 'tool/call', seq: i, data } as never })),
})

test('parseAskArguments: the live journal shape (JSON string) parses into questions and options', () => {
  const parsed = parseAskArguments(ARGS, 'call_1')
  assert.equal(parsed.callId, 'call_1')
  assert.equal(parsed.questions.length, 1)
  const q = parsed.questions[0]!
  assert.equal(q.id, 'js_vs_course')
  assert.equal(q.header, '下一步')
  assert.equal(q.multiSelect, true)
  assert.equal(q.options.length, 2)
  assert.equal(q.options[0]!.label, '快速讲一下区别 (Recommended)')
  assert.equal(q.options[1]!.description.includes('课程'), true)
})

test('parseAskArguments: junk degrades to an empty row, never throws', () => {
  assert.deepEqual(parseAskArguments(undefined, 'c').questions, [])
  assert.deepEqual(parseAskArguments('not json', 'c').questions, [])
  assert.deepEqual(parseAskArguments('{"questions":{}}', 'c').questions, [])
  assert.deepEqual(parseAskArguments('{"questions":[{"id":1}]}', 'c').questions[0]?.options ?? [], [], 'a junk question keeps a row with no options (free-text arm)')
})

test('feedRows: an ask_user_question call folds into an unanswered ask row with options', () => {
  const rows = feedRows(win([{ t: 'tool/call', callId: 'call_1', name: 'ask_user_question', arguments: ARGS }]))
  assert.equal(rows.length, 1)
  const r = rows[0]!
  assert.equal(r.role, 'ask')
  assert.equal(r.ask?.answered, false)
  assert.equal(r.ask?.questions[0]?.options.length, 2)
  assert.equal(r.key, 'tcall_1')
})

test('feedRows: the structured result settles the ask row as answered', () => {
  const rows = feedRows(win([
    { t: 'tool/call', callId: 'call_1', name: 'ask_user_question', arguments: ARGS },
    { t: 'tool/result', message: { source: { callId: 'call_1' }, content: [{ type: 'text', text: '{"answers":[]}' }] } },
  ]))
  assert.equal(rows[0]!.role, 'ask')
  assert.equal(rows[0]!.ask?.answered, true, 'the result landing marks the ask answered')
  assert.equal(rows[0]!.toolState, 'done')
})

test('feedRows: a later learner row marks an ask answered even without its result (history window)', () => {
  const rows = feedRows(win([
    { t: 'tool/call', callId: 'call_1', name: 'ask_user_question', arguments: ARGS },
    { t: 'user/message', source: { kind: 'user' }, content: [{ type: 'text', text: '快速讲一下区别 (Recommended)' }] },
  ]))
  assert.equal(rows[0]!.ask?.answered, true)
  assert.equal(rows[1]!.role, 'user')
})

test('feedRows: other tool calls keep the plain chip arm', () => {
  const rows = feedRows(win([{ t: 'tool/call', callId: 'call_2', name: 'study_lesson' }]))
  assert.equal(rows[0]!.role, 'tool')
  assert.equal(rows[0]!.text, 'study_lesson')
})

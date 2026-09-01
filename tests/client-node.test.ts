/**
 * The study tab's client logic: the pure transcript fold (user/assistant text
 * extraction, tool chips, streaming partial) and the shared poll store's
 * lifecycle and write actions, both runnable under plain node:test.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { pickPane, quizOptions, sectionDefaultOpen, statusTitle, transcriptRows } from '../src/client/views.tsx'
import type { ConversationNode } from '@deepseek-ai/dsh-client-runtime/client'
import { studyStore, type StudyState } from '../src/client/data.ts'
import { STUDY_CSS } from '../src/client/styles.ts'

test('pickPane keeps only valid pane ids and defaults to the tutor', () => {
  assert.equal(pickPane('rail'), 'rail')
  assert.equal(pickPane('tutor'), 'tutor')
  assert.equal(pickPane('bb'), 'bb')
  assert.equal(pickPane(null), 'tutor', 'nothing stored falls back to 导师')
  assert.equal(pickPane('sidebar'), 'tutor', 'unknown stored values fall back')
  assert.equal(pickPane(''), 'tutor')
})

test('statusTitle explains every course-tree glyph state', () => {
  assert.match(statusTitle('exam', 'locked'), /章节测验/)
  assert.match(statusTitle('study', 'mastered'), /已毕业/)
  assert.match(statusTitle('study', 'in_progress'), /学习中/)
  assert.match(statusTitle('study', 'available'), /可开始/)
  assert.match(statusTitle('study', 'locked'), /未解锁/)
})

test('sectionDefaultOpen keeps only the frontier and focus sections expanded', () => {
  const sec = (lessons: ReadonlyArray<{ kind: string; status: string; focus?: boolean }>) =>
    sectionDefaultOpen({ lessons: lessons.map(l => ({ ...l, focus: l.focus ?? false })) })
  // All mastered + locked (a finished or far-ahead chapter) collapses.
  assert.equal(sec([
    { kind: 'study', status: 'mastered' },
    { kind: 'study', status: 'locked' },
  ]), false, 'mastered+locked collapses')
  // Any available / in-progress study lesson keeps the section open.
  assert.equal(sec([
    { kind: 'study', status: 'mastered' },
    { kind: 'study', status: 'in_progress' },
  ]), true, 'frontier stays open')
  assert.equal(sec([{ kind: 'study', status: 'available' }]), true)
  // The focus lesson pins its section open even when fully mastered.
  assert.equal(sec([{ kind: 'study', status: 'mastered', focus: true }]), true, 'focus pins open')
  // Exam nodes are gated in the UI and never force a section open.
  assert.equal(sec([
    { kind: 'study', status: 'mastered' },
    { kind: 'exam', status: 'available' },
  ]), false, 'exam does not force open')
  // Empty sections (defensive; imports drop them) collapse.
  assert.equal(sec([]), false)
})

test('quizOptions extracts the last consecutive A–D block and rejects noise', () => {
  const question = '下面哪个是正确的?\n\nA. 梯度下降\nB. 反向传播\nC. 卷积\nD. 池化'
  assert.deepEqual(quizOptions(question), [
    { letter: 'A', text: '梯度下降' },
    { letter: 'B', text: '反向传播' },
    { letter: 'C', text: '卷积' },
    { letter: 'D', text: '池化' },
  ])
  // second quiz in one reply wins (the pending question)
  assert.equal(quizOptions(`${question}\n答错了,再来:\nA. 选项一\nB. 选项二`).length, 2)
  // lone letters, non-consecutive runs, and single options do not count
  assert.deepEqual(quizOptions('A. 只有一个'), [])
  assert.deepEqual(quizOptions('B. 从B开始\nC. 不连续'), [])
  assert.deepEqual(quizOptions('普通列表:\n- A. 不是选项'), [])
})

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

test('transcriptRows skips tool results, skips noise, and appends the partial', () => {
  const rows = transcriptRows([
    node({ kind: 'assistant', seq: 2, time: 0, turn: 1, step: 1, blocks: [{ kind: 'tool-call', callId: 'c1', name: 'study_record_answer', argsRaw: '{}' }] }),
    node({ kind: 'tool-result', seq: 3, time: 0, callId: 'c1', call: { name: 'study_record_answer', argsRaw: '{}' }, content: [], isError: false, subCalls: [] }),
    node({ kind: 'tool-result', seq: 4, time: 0, callId: 'c2', call: null, content: [], isError: false, subCalls: [] }),
    node({ kind: 'command', seq: 5, time: 0, commandId: 'x', name: 'goal', args: null, outcome: null }),
    node({ kind: 'turn-error', seq: 6, time: 0, turn: 1, step: 2, message: 'provider down' }),
    node({ kind: 'user', seq: 7, time: 0, content: [{ type: 'image', attachment: {} }], source: {} }),
  ], { turn: 1, step: 3, blocks: [{ kind: 'text', text: '正在打字…' }] })
  assert.deepEqual(rows.map(r => [r.role, r.text]), [
    ['error', 'provider down'],
    ['streaming', '正在打字…'],
  ], 'tool results skip entirely (host toolviews own them); image-only user rows skip; the partial lands last')
})

test('a text-less partial shows the thinking row instead of dead air', () => {
  const thinking = transcriptRows([], { turn: 1, step: 1, blocks: [
    { kind: 'reasoning', text: '先看这一课的概念…' },
    { kind: 'tool-call', callId: 'c1', name: 'study_lesson', argsRaw: '{}' },
  ] })
  assert.deepEqual(thinking.map(r => [r.role, r.text]), [['thinking', '导师思考中…']], 'reasoning/tool-only phases surface a thinking indicator')
  const streaming = transcriptRows([], { turn: 1, step: 2, blocks: [
    { kind: 'reasoning', text: '想好了' },
    { kind: 'text', text: '我们开始' },
  ] })
  assert.deepEqual(streaming.map(r => r.role), ['streaming'], 'once text arrives the streaming row replaces thinking')
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

test('the stylesheet keeps the width-adaptation contract (tutor proportional, blackboard floor, content guards)', () => {
  // Tripwires for the width bugs seen live (2026-08-23): the tutor column's
  // fixed 780px starved the blackboard to its 230px floor on 1256px-wide
  // containers, and mermaid/KaTeX artifacts could stretch the column.
  assert.match(STUDY_CSS, /\.lks-col-tutor\{[^}]*42cqi/, 'the tutor column is capped at 42% of the tab container')
  assert.match(STUDY_CSS, /\.lks-col-tutor\{[^}]*min-width:360px/, 'the tutor column keeps a readable floor')
  assert.match(STUDY_CSS, /\.lks-col-bb\{[^}]*min-width:320px/, 'the blackboard keeps a 320px floor (was 230)')
  assert.match(STUDY_CSS, /\[data-composer-card\]\.lks-composer-follow\{[^}]*--lks-composer-follow-width/,
    'the docked composer card tracks the tutor column live width')
  assert.match(STUDY_CSS, /\.lks-prose svg\{max-width:100%;height:auto\}/, 'SVGs (mermaid/markmap/ELK) fit the column')
  assert.match(STUDY_CSS, /\.lks-prose \.katex-display\{overflow-x:auto/, 'display math scrolls instead of stretching')
  assert.match(STUDY_CSS, /\.lks-prose table\{[^}]*overflow-x:auto/, 'tables scroll instead of stretching')
})

test('the lookatstudy locale dictionaries keep zh/en parity and translate with fallback', async () => {
  const { ZH, EN, makeT } = await import('../src/client/locale.ts')
  const zhKeys = Object.keys(ZH).sort()
  const enKeys = Object.keys(EN).sort()
  assert.deepEqual(enKeys, zhKeys, 'en and zh dictionaries carry the exact same key set')
  assert.ok(zhKeys.length >= 70, `expected a full dictionary, got ${zhKeys.length} keys`)
  for (const key of zhKeys) {
    assert.ok(ZH[key]!.trim() !== '', `zh "${key}" is non-empty`)
    assert.ok(EN[key]!.trim() !== '', `en "${key}" is non-empty`)
  }
  const tEn = makeT('en')
  assert.equal(tEn('tab.label'), 'Study')
  assert.equal(tEn('rail.due', { count: 3 }), '3 due')
  assert.equal(tEn('rail.due.over', { days: 2 }), '2d overdue')
  const tZh = makeT('zh')
  assert.equal(tZh('tab.label'), '学习')
  assert.equal(tZh('quiz.answer', { letter: 'A', text: 'x' }), '选 A:x')
  // Unknown ids fall back to zh; unknown keys surface the key itself (fail-loud).
  assert.equal(makeT('fr')('tab.label'), '学习')
  assert.equal(tEn('no.such.key'), 'no.such.key')
  // Missing params keep the placeholder verbatim (the service's semantics).
  assert.equal(tEn('rail.due'), '{count} due')
})

test('the pure projections translate through an injected translator', async () => {
  const { makeT } = await import('../src/client/locale.ts')
  const tEn = makeT('en')
  assert.match(statusTitle('exam', 'locked', tEn), /Section exam/)
  const { transcriptRows: rows } = await import('../src/client/views.tsx')
  const partial = { blocks: [] } as never
  const thinking = rows([], partial, tEn)
  assert.equal(thinking[0]!.text, 'tutor is thinking…')
})

test('the dock pill projection renders due/streak/level segments, muted when zero', async () => {
  const { dockSegments } = await import('../src/client/dock.tsx')
  const segs = dockSegments({ dueCount: 2, streak: 4, level: 3 })
  assert.deepEqual(segs.map(s => [s.text, s.muted]), [['2', false], ['4天', false], ['Lv3', false]])
  const zeros = dockSegments({ dueCount: 0, streak: 0, level: 0 })
  assert.deepEqual(zeros.map(s => s.muted), [true, true, false], 'zero due/streak must not wear the warning/success tones')
})

test('examStars reads the attempt from the card meta; the exam view carries a failure line', async () => {
  const { examStars } = await import('../src/client/toolviews.tsx')
  assert.deepEqual(examStars({ meta: ['2★'] }), { stars: 2, best: 2 })
  assert.deepEqual(examStars({ meta: ['0★', '掌握度 40%'] }), { stars: 0, best: 0 }, '0★ is readable, not treated as absent')
  assert.equal(examStars({ meta: ['掌握度 40%'] }), null)
  assert.equal(examStars({ content: [{ type: 'text', text: 'Exam result: 3★ (best 3★, attempt 1).' }] }), null,
    'render text is not mistaken for meta')
})

test('the toolview projections parse answer args and meta lines', async () => {
  const { answerTone, metaLines } = await import('../src/client/toolviews.tsx')
  const tone = answerTone('{"lessonId":"x","correct":true,"concept":"链式法则"}')
  assert.deepEqual(tone, { correct: true, concept: '链式法则' })
  assert.equal(answerTone('not json'), null)
  assert.equal(answerTone(undefined), null)
  assert.deepEqual(
    metaLines({ meta: ['🔁 2 due', '  ⏰ 优化器 [lessonId course:0:2] — 深度学习入门'] }),
    ['🔁 2 due', '  ⏰ 优化器 [lessonId course:0:2] — 深度学习入门'],
  )
  assert.deepEqual(
    metaLines({ content: [{ type: 'text', text: 'line one\nline two' }] }),
    ['line one', 'line two'],
  )
  assert.deepEqual(metaLines({}), [])
})

// --- upstream v0.26.0 port: markmap retired (ELK concept map covers it) ---

test('markmap is fully retired: zero residue across src/ (view, CDN, vendor, locale)', async () => {
  const { readdirSync, readFileSync, statSync } = await import('node:fs')
  const { join } = await import('node:path')
  const hits: string[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) { walk(p); continue }
      if (!/\.(ts|tsx)$/.test(name)) continue
      if (/markmap|mindmap/i.test(readFileSync(p, 'utf8'))) hits.push(p)
    }
  }
  walk(join(import.meta.dirname, '..', 'src'))
  assert.deepEqual(hits, [], 'markmap/mindmap must not appear anywhere in src/ (retired upstream v0.26.0; the ELK concept map is the surviving diagram view)')
})

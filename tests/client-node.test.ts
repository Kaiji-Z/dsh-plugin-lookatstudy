/**
 * The study client's pure logic under plain node:test: the rail/tree
 * projections (statusTitle, sectionDefaultOpen, quizOptions), the shared poll
 * store's lifecycle and write actions, and the stylesheet's architecture
 * contracts (the panel takeover, the collapsed-sidebar entry row, ink
 * re-scoping). The transcript fold lives in session-feed.test.ts.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { quizOptions, sectionDefaultOpen, statusTitle } from '../src/client/views.tsx'
import { studyStore, type StudyState } from '../src/client/data.ts'
import { STUDY_CSS } from '../src/client/styles.ts'

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
  // the space after the letter punctuation is optional (live 0.14.0 tutor shape)
  assert.deepEqual(quizOptions('Q：哪种搭配？\nA.py 脚本 → jupyter notebook 01.py\nB.ipynb → python 03.ipynb'), [
    { letter: 'A', text: 'py 脚本 → jupyter notebook 01.py' },
    { letter: 'B', text: 'ipynb → python 03.ipynb' },
  ], '"A." without a space still parses (the quiz stays clickable)')
  // markdown-table options parse too (bold/code stripped from the text)
  assert.deepEqual(quizOptions([
    '| 选项 | 搭配 |',
    '| --- | --- |',
    '| **A** | `.py` 脚本 → `jupyter notebook 01.py` |',
    '| **B** | `.ipynb` 笔记本 → `python 03.ipynb` |',
  ].join('\n')), [
    { letter: 'A', text: '.py 脚本 → jupyter notebook 01.py' },
    { letter: 'B', text: '.ipynb 笔记本 → python 03.ipynb' },
  ], 'the tutor drifting into a table still yields clickable options')
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

test('the stylesheet carries the panel takeover contract (hide-siblings, entry row, ink re-scoping)', () => {
  // The 0.14.0 architecture: a sidebar-entry panel takes over the center
  // column via the stardeck doctrine — the shell view is invisible until the
  // <html> active attribute flips, and the host conversation column's own
  // children hide behind !important so React never fights the takeover.
  assert.match(STUDY_CSS, /html\[data-dsh-lookatstudy-active\] \.lks14-shell-view\{display:flex/,
    'the panel shows only under the html active attribute')
  assert.match(STUDY_CSS, /\[data-pane='conversation'\] > :not\(\[data-dsh-lookatstudy-view\]\)[^{}]*\{display:none !important\}/,
    'host conversation children hide behind the takeover')
  assert.match(STUDY_CSS, /\[class\*='_collapsed'\] \.lks14-sidebar-label\{display:none\}/,
    'the collapsed icon rail keeps just the entry glyph')
  assert.match(STUDY_CSS, /\.lks-root,\.lks-tv,\.lks14\{--lks-warn-ink/,
    'state inks cover the toolview cards (no .lks-root ancestor in the host conversation) and the panel family')
  assert.match(STUDY_CSS, /\.lks14-composer\{[^}]*border-top/,
    'the chat pane owns its composer — the host composer is never involved')
  assert.match(STUDY_CSS, /\.lks14-node\[aria-disabled='true'\]/,
    'locked lesson rows keep the aria-disabled contract (focusable, tooltip explains why)')
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

test('effectiveOpen: the user toggle overrides the frontier default; pickNarrowPane remembers', async () => {
  const { effectiveOpen, pickNarrowPane } = await import('../src/client/views.tsx')
  assert.equal(effectiveOpen('第一章', true, {}), true, 'no override = the default')
  assert.equal(effectiveOpen('第一章', true, { '第一章': false }), false, 'an explicit collapse wins')
  assert.equal(effectiveOpen('第二章', false, { '第一章': true }), false, 'another section override does not leak')
  assert.equal(pickNarrowPane(null), 'chat', 'nothing stored defaults to the tutor chat')
  assert.equal(pickNarrowPane('note'), 'note')
  assert.equal(pickNarrowPane('sidebar'), 'chat', 'junk falls back')
})

test('mergeRailSearch: title hits first, full-text dedup, empty query yields nothing', async () => {
  const { mergeRailSearch } = await import('../src/client/views.tsx')
  const lessons = [
    { id: 'c:0:0', title: '梯度下降', status: 'available', kind: 'study' },
    { id: 'c:0:1', title: '反向传播', status: 'locked', kind: 'study' },
    { id: 'c:0:2', title: '本章测验', status: 'available', kind: 'exam' },
  ]
  const textHits = [
    { lessonId: 'c:0:0', lessonTitle: '梯度下降', snippet: '…沿着负梯度方向…', courseTitle: '深度学习' },
    { lessonId: 'other:1:0', lessonTitle: '别课', snippet: '…梯度下降是一种优化…', courseTitle: '另一门课' },
  ]
  const rows = mergeRailSearch('梯度', lessons, textHits)
  assert.deepEqual(rows.map(r => [r.lessonId, r.fromTitle]), [['c:0:0', true], ['other:1:0', false]], 'title hit first, the text hit deduped, locked/exam never surface')
  assert.equal(rows[0]!.snippet, '', 'title rows carry no snippet')
  assert.match(rows[1]!.snippet, /梯度下降是一种优化/)
  assert.deepEqual(mergeRailSearch('', lessons, textHits), [])
  assert.deepEqual(mergeRailSearch('  ', lessons, textHits), [])
  assert.deepEqual(mergeRailSearch('不存在的词', lessons, []), [], 'no hits = no panel')
})

test('the pure projections translate through an injected translator', async () => {
  const { makeT } = await import('../src/client/locale.ts')
  const tEn = makeT('en')
  assert.match(statusTitle('exam', 'locked', tEn), /Section exam/)
})

test('the dock pill projection renders due/streak/level segments, muted when zero', async () => {
  const { dockSegments } = await import('../src/client/dock.tsx')
  const segs = dockSegments({ dueCount: 2, streak: 4, level: 3 })
  assert.deepEqual(segs.map(s => [s.text, s.muted]), [['2', false], ['4天', false], ['Lv3', false]])
  const zeros = dockSegments({ dueCount: 0, streak: 0, level: 0 })
  assert.deepEqual(zeros.map(s => s.muted), [true, true, false], 'zero due/streak must not wear the warning/success tones')
})

test('normalizeStoredVoice allowlists the stored preference; junk falls back to 晓晓', async () => {
  const { normalizeStoredVoice, TTS_VOICES } = await import('../src/client/data.ts')
  assert.equal(normalizeStoredVoice(null), TTS_VOICES[0]!.id)
  assert.equal(normalizeStoredVoice('zh-CN-YunxiNeural'), 'zh-CN-YunxiNeural')
  assert.equal(normalizeStoredVoice('injected-voice'), TTS_VOICES[0]!.id, 'arbitrary stored strings never reach the synth route')
})

test('sessionKnown treats an unhydrated list as known and a hydrated list as the truth', async () => {
  const { sessionKnown } = await import('../src/client/panel.tsx')
  const ctxOf = (byId?: Record<string, unknown>) => ({ sessions: { list: byId === undefined ? undefined : { getSnapshot: () => ({ byId }) } } }) as never
  assert.equal(sessionKnown(ctxOf(undefined), 's1'), true, 'no list service at all: assume known (the open surfaces real errors)')
  assert.equal(sessionKnown(ctxOf({}), 's1'), true, 'empty byId = not hydrated yet: assume known')
  assert.equal(sessionKnown(ctxOf({ s2: {} }), 's1'), false, 'a hydrated list without the id = a restart dropped the thread (re-mint on send)')
  assert.equal(sessionKnown(ctxOf({ s1: {} }), 's1'), true)
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

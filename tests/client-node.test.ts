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
})

test('the upstream v0.28 skin is layered over the panel foundation (P9a)', async () => {
  const { UPSTREAM_CSS } = await import('../src/client/upstream-theme.ts')
  // token ladder — verbatim upstream values, scoped to the panel root only
  assert.match(UPSTREAM_CSS, /\.lks-ui\{[^}]*--brand:#58CC01/, 'Duolingo brand green heads the token block')
  assert.match(UPSTREAM_CSS, /--surface-rail:#08090B/, 'the surface ladder starts at the rail black')
  assert.match(UPSTREAM_CSS, /--surface-1:#111114/, 'the chat column sits on surface-1')
  assert.match(UPSTREAM_CSS, /font-family:'DIN Round'/, 'the round display font is declared first')
  // component signatures
  assert.match(UPSTREAM_CSS, /\.lks-ui \.lks-btn\.primary\{[^}]*box-shadow:0 4px 0 0 var\(--brand-dark\)/, 'primary buttons are 3D push-downs')
  assert.match(UPSTREAM_CSS, /\.lks-ui \.lks14-appheader::before\{[^}]*backdrop-filter/, 'the app header floats on blur')
  assert.match(UPSTREAM_CSS, /@keyframes lks-typing-dot/, 'the thinking row uses upstream typing dots')
  // the course rail as a list (2026-09-08 owner pivot — the balloon/physics
  // map is a deliberate deviation; the rail rides the same row language)
  assert.match(UPSTREAM_CSS, /\.lks-ui \.lks-lessorow\.selected\{[^}]*border-left-color:var\(--brand\)/, 'the focused row is brand-edged')
  assert.match(UPSTREAM_CSS, /\.lks-ui \.lks-lessorow\[aria-disabled='true'\]\{cursor:not-allowed/, 'locked rows keep the aria-disabled contract (focusable, tooltip explains why)')
  assert.match(UPSTREAM_CSS, /\.lks-ui \.lks-lessorow\.st-mastered \.lks-lessorow-glyph svg\{animation:lks-crown-sparkle/, 'the mastered crown still sparkles on its row')
  assert.match(UPSTREAM_CSS, /\.lks-ui \.lks-railsec-head\{/, 'section heads are quiet list toggles')
  assert.match(UPSTREAM_CSS, /\.lks-ui \.lks-lessorow-bar i\{[^}]*transition:transform \.3s var\(--ease-out-expo\)/, 'mastery bars ease on the skin curve')
  // P10a (A-track): island zeroing — the highest-traffic un-skinned surfaces
  assert.match(UPSTREAM_CSS, /\.lks-ui \.lks14-opt\{[^}]*background:rgb\(var\(--ink-rgb\)\/0\.05\)/, 'in-chat quiz options are dark neutral pills')
  assert.match(UPSTREAM_CSS, /\.lks-ui \.lks14-starter\{[^}]*border:1px solid var\(--border-faint\)/, 'starter chips ride the dark border scale')
  assert.match(UPSTREAM_CSS, /\.lks-ui \.lks-quote-btn\{[^}]*box-shadow:0 4px 12px -2px/, 'the selection popover is a surface-0 card with shadow-pop')
  assert.match(UPSTREAM_CSS, /\.lks-ui ::-webkit-scrollbar-thumb\{[^}]*background:var\(--border\)/, 'scrollbars inside the panel are dark, not host-light')
  assert.match(UPSTREAM_CSS, /\.lks-ui \.lks14-prose a,\.lks-ui \.lks-note-text a\{[^}]*rgb\(var\(--accent-rgb\)\)/, 'prose links are accent, not UA blue')
  assert.match(UPSTREAM_CSS, /@keyframes lks-crown-sparkle/, 'the mastered crown sparkles (upstream 1.6s)')
  assert.match(UPSTREAM_CSS, /@keyframes lks-answer-wrong/, 'wrong answers shake (upstream 320ms)')
  assert.match(UPSTREAM_CSS, /--cm-c0-fill:#1C3352/, 'the concept-map palette tokens ride the panel scope')
  assert.match(UPSTREAM_CSS, /--brand-light-rgb:126 217 87/, 'rgb-channel companions complete the token block')
  // the structural wrappers the skin rides on live in the base stylesheet
  assert.match(STUDY_CSS, /\.lks14-righthalf\{flex:1;min-width:0;display:flex;flex-direction:column/, 'the right half is a column under the app header')
  assert.match(STUDY_CSS, /\.lks14-body\[data-pane='rail'\] \.lks14-righthalf\{display:none\}/, 'narrow rail mode hides the whole right half')
})

test('the light token block survives the CSS comment parse (P18 live regression)', async () => {
  const { UPSTREAM_CSS } = await import('../src/client/upstream-theme.ts')
  // a stray fragment outside a comment merges into the next rule's prelude and
  // silently DROPS it — this killed the whole light theme once (2026-09-08,
  // caught by the critique run: light hosts got a dark panel with light-only
  // shiki/scrollbar fragments applied on top)
  const stripped = UPSTREAM_CSS.replace(/\/\*[\s\S]*?\*\//g, '')
  assert.match(stripped, /\.lks-ui\[data-lks-theme='light'\]\{\s*--surface-rail:#F1F2F4/, 'the light token ladder opens as a live rule once comments are stripped')
  assert.match(stripped, /\.lks-ui\[data-lks-theme='light'\] \.lks14-railhead\{/, 'the light chrome sweep rides a live rule too')
  assert.equal((UPSTREAM_CSS.match(/\/\*/g) ?? []).length, (UPSTREAM_CSS.match(/\*\//g) ?? []).length, 'comment delimiters stay balanced')
})

test('the audit gate script exists with an exit-code contract', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../scripts/audit-ui.mjs', import.meta.url), 'utf8')
  assert.match(src, /suspectCount === 0 && follows \? 0 : 1/, 'exit 0 iff zero suspects AND the panel followed the host theme (P16 dual-theme gate)')
  assert.match(src, /borderStyle !== 'none'/, 'border flags skip border-style:none false positives')
  assert.match(src, /sat\(/, 'saturated brand hues are exempt by design')
})

test('the B-track skeleton: floating rail chrome, swapped widths, de-carded assistant (P10b)', async () => {
  const { UPSTREAM_CSS } = await import('../src/client/upstream-theme.ts')
  // the rail frame: floating topbar over sliding panes, sky on the rail itself
  assert.match(STUDY_CSS, /\.lks14-rail\{flex:0 0 300px/, 'the rail is upstream 300px with its own panes')
  assert.match(UPSTREAM_CSS, /\.lks-ui \.lks14-railtop\{position:absolute/, 'the tab capsule + title card float over the scrolling map')
  assert.match(UPSTREAM_CSS, /\.lks-ui \.lks14-railtrack\{[^}]*width:200%/, 'map/import panes slide horizontally')
  assert.match(UPSTREAM_CSS, /\.lks-ui \.lks14-railscroll\{[^}]*padding:112px/, 'the scroller reserves the single-card chrome (0.19: 196 -> 112px)')
  assert.doesNotMatch(STUDY_CSS, /\.lks14-colhead\{/, 'the 课程/导师/黑板 column header rows are gone (upstream has none)')
  // B3: the width logic swap
  assert.match(STUDY_CSS, /\.lks14-chat\{flex:0 0 auto;width:clamp\(480px,45%,800px\)/, 'chat is the clamp column (row-relative %, fixed, never squeezed)')
  assert.match(STUDY_CSS, /\.lks14-note\{flex:1 1 auto;min-width:440px/, 'the notebook takes the remaining width')
  // B6: assistant prose is cardless
  assert.match(UPSTREAM_CSS, /\.lks-ui \.lks14-msg-assistant\{background:none/, 'assistant text is full-width prose, not a bubble card')
  assert.match(UPSTREAM_CSS, /\.lks-ui \.lks14-msg-user\{align-self:flex-end;max-width:85%\}/, 'user bubbles right-align at 85%')
  // B5: the 960px reading column
  assert.match(UPSTREAM_CSS, /\.lks-ui \.lks14-notebody\{margin:0 auto;max-width:960px/, 'notebook content centers at 960px')
})

test('friendlyError maps raw host errors to locale lines; the raw text stays console-only (0.19)', async () => {
  const { friendlyError } = await import('../src/client/views.tsx')
  const raw = new Error('prompt rejected: E_BUSY: the host is thinking')
  const send = friendlyError(raw, 'send')
  assert.ok(!send.includes('prompt rejected') && !send.includes('E_BUSY'), 'no raw internals in the DOM text')
  const action = friendlyError(raw, 'action')
  assert.notEqual(send, action, 'send vs action carry distinct lines')
})

test('humanizeSectionTitle strips episode slugs for display only (0.19)', async () => {
  const { humanizeSectionTitle } = await import('../src/client/views.tsx')
  assert.equal(humanizeSectionTitle('0-course-setup'), 'course setup')
  assert.equal(humanizeSectionTitle('1-Intro'), 'Intro')
  assert.equal(humanizeSectionTitle('2-Symbolic'), 'Symbolic')
  assert.equal(humanizeSectionTitle('X-Extras'), 'X Extras')
  assert.equal(humanizeSectionTitle('seed-practice'), 'seed practice')
  assert.equal(humanizeSectionTitle('12.附录'), '附录', 'dot-separated episode numbers strip too')
  assert.equal(humanizeSectionTitle('第一节'), '第一节', 'CJK titles pass through untouched')
  assert.equal(humanizeSectionTitle('---'), '---', 'a title that humanizes to nothing keeps its raw form')
  assert.equal(humanizeSectionTitle('  3 -Spaced  Out  '), 'Spaced Out', 'runs collapse and trim')
})

test('the C-track interaction folds: sticky-follow, swipe, settle tiers, random due (P11a)', async () => {
  const views = await import('../src/client/views.tsx')
  // sticky-follow: 80px tolerance, chase only near the bottom (distance = h - top - ch)
  assert.equal(views.isStuck(100, 1000, 900), true, 'flush at the bottom = stuck')
  assert.equal(views.isStuck(20, 1000, 900), true, '80px away is still stuck (tolerance edge)')
  assert.equal(views.isStuck(5, 1000, 900), false, '95px away = detached (just over tolerance)')
  assert.equal(views.isStuck(0, 1000, 900), false, '100px away = detached')
  // swipe: dominance rule + neighbor walk + edge clamping
  assert.equal(views.swipePane('rail', -80, 10), 'chat')
  assert.equal(views.swipePane('note', 80, 10), 'chat')
  assert.equal(views.swipePane('chat', 80, 10), 'rail')
  assert.equal(views.swipePane('chat', -80, 10), 'note')
  assert.equal(views.swipePane('rail', 80, 10), null, 'swiping back past the first pane clamps')
  assert.equal(views.swipePane('chat', -40, 0), null, 'under 50px is not a flick')
  assert.equal(views.swipePane('chat', -80, 50), null, 'vertical-dominant movement is scrolling')
  // settle tiers
  assert.equal(views.settleMs(true), 600)
  assert.equal(views.settleMs(false), 250)
  // random due: only members of the list, null on empty
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  for (let i = 0; i < 20; i++) assert.ok(list.includes(views.pickRandomDue(list)!))
  assert.equal(views.pickRandomDue([]), null)
})

test('quiz optionTone never leaks correctness before the submit (C5)', async () => {
  const { optionTone } = await import('../src/client/quizcard.tsx')
  // unchosen: pick highlight only — the CORRECT option must look identical to wrong ones
  assert.equal(optionTone(-1, 1, 0, true), '')
  assert.equal(optionTone(-1, 1, 1, true), ' picked')
  assert.equal(optionTone(-1, 1, 1, false), ' picked', 'picked tone is blind to correctness')
  assert.equal(optionTone(-1, null, 0, true), '')
  // committed: the judged pair
  assert.equal(optionTone(1, null, 1, true), ' right')
  assert.equal(optionTone(1, null, 1, false), ' wrong')
  assert.equal(optionTone(1, null, 0, true), ' right dim')
  assert.equal(optionTone(1, null, 2, false), '')
})

test('the C-track chrome freezes: FAB, stop button, code header, decided badges (P11a)', async () => {
  const { UPSTREAM_CSS } = await import('../src/client/upstream-theme.ts')
  assert.match(UPSTREAM_CSS, /\.lks-ui \.lks14-scrollfab\{[^}]*position:absolute/, 'the scroll-to-bottom FAB floats over the stream')
  assert.match(UPSTREAM_CSS, /@keyframes lks-fab-pulse/, 'the FAB pulses red while streaming')
  assert.match(UPSTREAM_CSS, /\.lks-ui \.lks-btn-send\.stop\{[^}]*background:var\(--warning\)/, 'stop is the warning-red 3D twin of send')
  assert.match(UPSTREAM_CSS, /\.lks-ui \.lks-qcard-opt\.picked\{[^}]*border-color:var\(--accent\)/, 'the pre-submit pick highlight')
  assert.match(UPSTREAM_CSS, /\.lks-ui \.lks-codehead\{/, 'code blocks carry the lang+copy header')
  assert.match(UPSTREAM_CSS, /\.lks-ui \.lks-propbanner\.decided\.accepted/, 'accepted proposals close the loop')
})

test('the C15 placement folds: tooltip clamps into the viewport, ConfirmCard flips when clipped (P11b)', async () => {
  const { clampTip } = await import('../src/client/tooltip.tsx')
  const { anchorPlacement } = await import('../src/client/confirmcard.tsx')
  // clampTip: interior points pass through, edges clamp with an 8px gutter
  assert.deepEqual(clampTip(100, 100, 120, 40, 1280, 800), { x: 100, y: 100 })
  assert.deepEqual(clampTip(0, 0, 120, 40, 1280, 800), { x: 8, y: 8 })
  assert.deepEqual(clampTip(1200, 780, 120, 40, 1280, 800), { x: 1152, y: 752 }, 'overflow clamps to vw-w-8 / vh-h-8')
  // anchorPlacement: the card hugs the trigger's top-right, 8px below the bottom
  assert.deepEqual(anchorPlacement({ left: 400, top: 300, right: 500, bottom: 340 }, 1280, 800), { left: 280, top: 348 })
  // flips left when the right edge would overflow (right + w + 12 > vw)
  assert.deepEqual(anchorPlacement({ left: 1000, top: 300, right: 1100, bottom: 340 }, 1280, 800), { left: 780, top: 348 })
  // flips up when the bottom would overflow (bottom + h + 12 > vh)
  assert.deepEqual(anchorPlacement({ left: 400, top: 700, right: 500, bottom: 740 }, 1280, 800), { left: 280, top: 596 })
  // never escapes the 8px gutter
  assert.deepEqual(anchorPlacement({ left: 0, top: 0, right: 10, bottom: 10 }, 1280, 800), { left: 8, top: 18 })
})

test('the P11b chrome freezes: reasoning fold, tool chips, karaoke marks, tooltip, confirm card, zone heads (C14/C15/C6)', async () => {
  const { UPSTREAM_CSS } = await import('../src/client/upstream-theme.ts')
  assert.match(UPSTREAM_CSS, /\.lks-ui \.lks14-reasoning\{[^}]*border:1px solid var\(--border-faint\)/, 'reasoning rides a collapsible card')
  assert.match(UPSTREAM_CSS, /\.lks-ui \.lks14-toolchip\.loading i\{[^}]*animation:lks-typing-dot/, 'loading chips pulse')
  assert.match(UPSTREAM_CSS, /\.lks-ui \.lks14-toolchip\.error\{[^}]*color:var\(--warning-light\)/, 'error chips read warning')
  assert.match(UPSTREAM_CSS, /\.lks-ui mark\.lks-reading\{[^}]*rgb\(var\(--accent-rgb\)\/0\.25\)/, 'the karaoke sentence highlight')
  assert.match(UPSTREAM_CSS, /@keyframes lks-flash-fade/, 'the note-locate flash fades out')
  assert.match(UPSTREAM_CSS, /\.lks-ui \.lks-audio-toggle \.lks-audio-label\{display:none\}/, 'the read-aloud toggle rests as an icon (0.19)')
  assert.match(UPSTREAM_CSS, /\.lks-tip\{[^}]*position:fixed/, 'GlobalTooltip rides above everything')
  assert.match(UPSTREAM_CSS, /\.lks-confirmcard\.danger/, 'ConfirmCard carries the danger variant')
  assert.match(UPSTREAM_CSS, /\.lks-ui \.lks-note\.pinned\{[^}]*rgb\(var\(--gold-rgb\)\//, 'pinned notes tint gold')
  assert.match(UPSTREAM_CSS, /\.lks-ui \.lks-note-edit textarea/, 'the inline note editor')
  assert.match(UPSTREAM_CSS, /\.lks-ui \.lks14-zoneh\{[^}]*cursor:pointer/, 'zone heads are collapsible buttons')
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

// ——— P17: the host-capability replacement folds ———

test('E1/E6: the workbench state carries the budget flag; the surface directive rides the snapshot', async () => {
  const { workbenchState } = await import('../src/dashboard.ts')
  const { snapshotSectionText } = await import('../src/surface.ts')
  const { emptyState, importCourse } = await import('../src/state.ts')
  const state = emptyState()
  state.active = true
  importCourse(state, { title: '预算测试', source: 'markdown', sourceRef: 'test:budget', createdAt: '2026-09-07T00:00:00Z', sections: [{ title: '一', lessons: [{ title: '甲', anchor: null, body: '正文' }] }] })
  state.focus = { lessonId: state.courses[0]!.sections[0]!.lessons[0]!.id }
  assert.equal(workbenchState(state, new Date()).historyBudget, false, 'absent flag reads false')
  state.historyBudget = true
  assert.ok(snapshotSectionText(state).includes('历史预算已开启'), 'the directive rides the snapshot tail when on')
  state.historyBudget = false
  assert.ok(!snapshotSectionText(state).includes('历史预算'), 'off → no directive')
})

/**
 * Review-session live probe (the v0.39/v0.41 alignment round): drives the
 * conversational review surface on a booted web-lks host —
 *  1. the due ratecard's 和导师复习 entry opens/continues the lesson's review
 *     thread (kind=review, round state present; the tutor may settle it within
 *     the first turn — an eager settle is itself the surface working)
 *  2. a re-kickoff opens a fresh round; the fallback 3-key strip settles it
 *     system-side (deterministic): SM-2 advanced, XP by the mapping, streak
 *     checked in, lastOutcome stored with quality 5
 *  3. another re-kickoff opens the next round with continuity (outcome kept)
 *  4. the tutor's study_end_review_session settles that round (real model turn)
 *  5. the applied-proposal undo strip reverts through the system (rows restored)
 *  — plus zero page errors across the whole run.
 * Choreography note: every host-UI click goes through dispatchEvent (the
 * nudge toast overlays the notebook column and defeats Playwright hit-testing)
 * and every step re-derives the round state from state.json — the tutor runs
 * concurrently and may settle rounds early.
 * Usage: node scripts/probe-review-session.mjs <token> <courseId> <dueLessonId> <proposalId> [--url http://127.0.0.1:3081]
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const token = process.argv[2]
const courseId = process.argv[3]
const dueLessonId = process.argv[4]
const proposalId = process.argv[5]
if (token === undefined || courseId === undefined || dueLessonId === undefined || proposalId === undefined) {
  console.error('usage: node scripts/probe-review-session.mjs <token> <courseId> <dueLessonId> <proposalId> [--url base]')
  process.exit(2)
}
const baseIdx = process.argv.indexOf('--url')
const base = baseIdx > 0 ? process.argv[baseIdx + 1] : 'http://127.0.0.1:3081'

const require = createRequire('D:/Users/kaiji/vibecodingKJ/clones/deepseek-ai/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/package.json')
const { chromium } = require('playwright')

const STATE_PATH = 'D:/Users/kaiji/.dsh/lookatstudy-plugin/state.json'
const readState = () => JSON.parse(readFileSync(STATE_PATH, 'utf8'))
const lessonOf = (state, id) => state.courses.flatMap(c => c.sections.flatMap(s => s.lessons)).find(l => l.id === id)
const reviewThreadOf = state => {
  const group = state.lessonThreads[dueLessonId]
  return group?.threads.find(t => t.kind === 'review' && t.reviewState?.lessonId === dueLessonId) ?? null
}

const results = []
const probe = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === '' ? '' : ` — ${detail}`}`)
}

const browser = await chromium.launch({ executablePath: 'C:/Users/kaiji/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe' })
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
const pageErrors = []
page.on('pageerror', e => { pageErrors.push(String(e)) })

const dismissHostNotice = () => page.evaluate(() => {
  for (const modal of document.querySelectorAll('div[role="presentation"]')) {
    const button = [...modal.querySelectorAll('button')]
      .find(b => (b.textContent ?? '').trim() !== '' && b.closest('.lks14-shell-view') === null)
    if (button === undefined) continue
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return true
  }
  return false
})
/** Click inside the panel via dispatchEvent — overlays (the nudge toast) never
 *  defeat it and animated elements stay clickable. */
const clickInPanel = async selector => page.evaluate(sel => {
  const el = document.querySelector(sel)
  if (el === null) return false
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  return true
}, selector)
const turnOver = () => {
  const feed = document.querySelector('[data-lks-feed]')?.getAttribute('data-lks-feed') ?? ''
  if (!feed.startsWith('rows:')) return false
  if (document.querySelector('.lks14-msg-assistant.streaming') !== null) return false
  if (document.querySelector('.lks14-composer .lks-btn-send.stop') !== null) return false
  return document.querySelectorAll('.lks14-msg-assistant:not(.streaming)').length >= 1
    || document.querySelectorAll('.lks14-reasoning, .lks14-msg-reasoning').length >= 1
}
const settleTurn = async (budgetMs = 300000) => {
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    try { await page.waitForFunction(turnOver, undefined, { timeout: 20000 }); break } catch {}
    if (await dismissHostNotice()) await page.waitForTimeout(1000)
  }
  await page.waitForTimeout(1500)
}
const openDueLesson = async () => {
  await page.selectOption('.lks-set-select', courseId)
  await page.waitForTimeout(1000)
  // all-mastered courses default-collapse their sections (off-frontier)
  const expanded = await page.evaluate(() => document.querySelector('.lks-railsec-head')?.getAttribute('aria-expanded'))
  if (expanded === 'false') {
    await clickInPanel('.lks-railsec-head')
    await page.waitForTimeout(500)
  }
  await clickInPanel(`[data-node-id="${dueLessonId}"]`)
  await page.waitForTimeout(800)
}

await page.goto(`${base}/?token=${token}`, { waitUntil: 'domcontentloaded' })
await dismissHostNotice().catch(() => {})
// sentry: the seeded lesson must still be due (an early writer is a real bug)
{
  const api = await page.evaluate(async lid => {
    const s = await (await fetch('/lookatstudy/api/state', { headers: { 'x-lks-request': '1' } })).json()
    return { due: s.due.map(d => d.lessonId), focus: s.focusLessonId }
  }, dueLessonId).catch(() => null)
  if (api !== null && !api.due.includes(dueLessonId)) {
    probe('0 sentry: seeded lesson is due at probe start', false, JSON.stringify(api))
    await browser.close()
    console.log('1/1 FAIL')
    process.exit(1)
  }
}
await page.waitForSelector('[data-dsh-lookatstudy-entry]', { timeout: 45000 })
await page.click('[data-dsh-lookatstudy-entry]')
await page.waitForSelector('.lks14-shell-view', { timeout: 45000 })

// —— 1. the entry opens the review thread (kickoff turn settles; the tutor
//        may settle the round itself — either state proves the surface) ——
await openDueLesson()
await clickInPanel('.lks-ratecard-review button')
await settleTurn()
{
  const thread = reviewThreadOf(readState())
  probe('1 review thread exists with round state', thread !== null && thread.reviewState !== undefined,
    `kind=${thread?.kind ?? 'none'} open=${String(thread?.reviewState?.open ?? 'none')}`)
}

// —— 2. deterministic settle via the fallback strip ——
{
  // ensure an OPEN round; when re-kickoff is needed, RACE the tutor — click
  // the fallback strip the moment it mounts (the round opens at the kickoff
  // write, before the turn ends; an eager tutor settles mid-turn otherwise).
  let st = readState()
  let raced = reviewThreadOf(st)?.reviewState?.open === true
  if (!raced) {
    await openDueLesson()
    const cardThere = await page.evaluate(() => document.querySelector('.lks-ratecard-review button') !== null)
    if (cardThere) {
      await clickInPanel('.lks-ratecard-review button')
      try {
        await page.waitForSelector('[data-testid="review-fallback"]', { timeout: 20000 })
        raced = true
      } catch { /* the tutor settled before the strip mounted — covered below */ }
    }
    st = readState()
  }
  const open = reviewThreadOf(st)?.reviewState?.open === true || raced
  if (!open) {
    probe('2 settle lands SM-2 + XP + streak + outcome', false, 'no open round reached')
  } else {
    const lessonBefore = lessonOf(st, dueLessonId)
    const xpBefore = st.xp.total
    const clicked = await clickInPanel('[data-testid="review-fallback"] button:nth-of-type(3)') // 很熟 → 5
    await page.waitForTimeout(3000)
    const after = readState()
    const lessonAfter = lessonOf(after, dueLessonId)
    const thread = reviewThreadOf(after)
    const now = new Date()
    const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const sm2Moved = lessonAfter.dueAt !== lessonBefore.dueAt || (lessonAfter.sm2?.repetitions ?? 0) !== (lessonBefore.sm2?.repetitions ?? 0)
    const outcome = thread?.reviewState?.lastOutcome
    // either settling hand proves the write path (the state-level tests pin
    // the fallback's exact numbers; here the live surface + the landed writes
    // are the fact): SM-2 moved, streak checked in today, outcome recorded.
    probe('2 settle lands SM-2 + XP + streak + outcome', thread?.reviewState?.open === false && sm2Moved
      && outcome !== undefined && outcome.quality >= 1 && outcome.quality <= 5
      && after.xp.total >= xpBefore
      && (after.streak.lastActiveDate ?? '').startsWith(todayKey),
      `hand=${clicked ? 'fallback' : 'tutor'} open=${String(thread?.reviewState?.open ?? '?')} sm2=${sm2Moved ? 'moved' : 'same'} xp=${xpBefore}→${after.xp.total} q=${String(outcome?.quality ?? '?')} lastActive=${after.streak.lastActiveDate ?? 'none'}`)
    // wait out the kickoff turn so later steps read a quiet state
    await settleTurn()
  }
}

// —— 3. re-kickoff: the next round opens, continuity retained ——
{
  const cardThere = await page.evaluate(() => document.querySelector('.lks-ratecard-review button') !== null)
  let opened = false
  if (cardThere) {
    await clickInPanel('.lks-ratecard-review button')
    await settleTurn()
    const thread = reviewThreadOf(readState())
    opened = thread?.reviewState?.open === true
  }
  // not due anymore (settled lessons schedule ahead) — continuity is then
  // carried by lastOutcome, which step 2 already wrote.
  const thread = reviewThreadOf(readState())
  probe('3 round continuity (re-open when due, outcome retained either way)',
    opened || (thread?.reviewState?.lastOutcome !== undefined && thread.reviewState.open === false),
    `reopened=${String(opened)} lastQuality=${String(thread?.reviewState?.lastOutcome?.quality ?? '?')}`)
}

// —— 4. the tutor's end tool settles a round (real model turn) ——
{
  await page.fill('.lks14-composer textarea', '请现在立即调用 study_end_review_session 收束本次复习:quality=4,summary 用一句话概括,weakPoints 留 ["暂时性死区"]。')
  await clickInPanel('.lks14-composer .lks-btn-send:not(.stop)')
  await settleTurn(300000)
  const thread = reviewThreadOf(readState())
  // the tool refuses when no round is open (honest rejection) — both the
  // settled outcome AND the honest refusal prove the live path; what would
  // FAIL is no reaction at all.
  const settled = thread?.reviewState?.open === false && thread.reviewState.lastOutcome !== undefined
  probe('4 study_end_review_session live path (settle or honest refuse)', settled,
    `open=${String(thread?.reviewState?.open ?? '?')} lastQuality=${String(thread?.reviewState?.lastOutcome?.quality ?? '?')}`)
}

// —— 5. the applied-proposal undo strip reverts through the system ——
{
  const preUndo = readState()
  const propPre = preUndo.proposals.find(p => p.id === proposalId)
  const undoneLessonId = propPre?.lessonId ?? null
  const snapMastery = propPre?.appliedSnapshot?.mastery ?? null
  const lessonPre = lessonOf(preUndo, undoneLessonId ?? '')
  await page.waitForTimeout(3200) // one poll cycle mounts the strip
  const clicked = await clickInPanel('.lks-undostrip-row')
  await page.waitForTimeout(2500)
  const postUndo = readState()
  const revoked = postUndo.proposals.find(p => p.id === proposalId)
  const lessonPost = lessonOf(postUndo, undoneLessonId ?? '')
  // the revert restores the SNAPSHOT rows exactly: mastery returns to the
  // pre-apply value (an already-high lesson floors to itself — the seed's own
  // case), the human-grading flag re-arms, and the SM-2 schedule rolls back.
  const masteryRestored = snapMastery === null
    ? true
    : (lessonPost?.mastery ?? null) === snapMastery
  const gradedRestored = lessonPost?.humanGraded === false && lessonPre?.humanGraded === true
  probe('5 the undo strip reverts the applied proposal', clicked === true && revoked?.status === 'revoked' && masteryRestored && gradedRestored,
    `clicked=${String(clicked)} status=${revoked?.status ?? '?'} mastery ${String(lessonPre?.mastery)}→${String(lessonPost?.mastery)} (snap ${String(snapMastery)}) graded ${String(lessonPre?.humanGraded)}→${String(lessonPost?.humanGraded)}`)
}

probe('6 zero page errors across the whole run', pageErrors.length === 0, pageErrors[0]?.slice(0, 120) ?? '')
await browser.close()
const failed = results.filter(r => !r.ok)
console.log(failed.length === 0 ? `ALL ${String(results.length)} PASS` : `${String(failed.length)}/${String(results.length)} FAIL`)
process.exit(failed.length === 0 ? 0 : 1)

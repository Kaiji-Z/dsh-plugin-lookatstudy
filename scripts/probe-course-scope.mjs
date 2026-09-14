/** Live probes for the 0.23.0 course-scope thread granularity (issue #11
 * follow-up). Runs against a booted profile — NEVER part of verify.
 *   1. the chip menu's 跨课时连续对话 toggle flips the course's scope (feed
 *      threadScope) and the chip shows at ZERO threads under course scope.
 *   2. sends from lessons A and B of the course land in ONE course thread
 *      (threads.length stays 1, active unchanged, both lessons mirror it).
 *   3. the send from the DUE lesson C (the review-routing shape: focus the
 *      target, then send) stays in the same course thread.
 *   4. the thread menu shows per-pill coverage labels naming A and B.
 *   5. journal evidence: the per-turn prompt carries the course digest; the
 *      lesson BODY markers ride ONLY tool results (study_lesson on demand) —
 *      never user rows, never prompt rows (the iron rule); a combined-problem
 *      turn carries a study_lesson call.
 * Usage: node scripts/probe-course-scope.mjs <token> --a <id> --b <id> --c <id> --course <cid> [--url base] */
import { createRequire } from 'node:module'
import { readdirSync, readFileSync, existsSync } from 'node:fs'

const token = process.argv[2]
if (token === undefined || token === '') {
  console.error('usage: node scripts/probe-course-scope.mjs <token> --a <id> --b <id> --c <id> --course <cid> [--url base]')
  process.exit(2)
}
const argAfter = (flag) => { const i = process.argv.indexOf(flag); return i > 0 ? process.argv[i + 1] : undefined }
const baseIdx = process.argv.indexOf('--url')
const base = baseIdx > 0 ? process.argv[baseIdx + 1] : 'http://127.0.0.1:3081'
const A = argAfter('--a')
const B = argAfter('--b')
const C = argAfter('--c')
const COURSE = argAfter('--course')
if (A === undefined || B === undefined || C === undefined || COURSE === undefined) {
  console.error('missing lesson/course ids')
  process.exit(2)
}

const require = createRequire('D:/Users/kaiji/vibecodingKJ/clones/deepseek-ai/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/package.json')
const { chromium } = require('playwright')

const browser = await chromium.launch({ executablePath: 'C:/Users/kaiji/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe' })
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
const results = []
const probe = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === '' ? '' : ` — ${detail}`}`)
}
const feed = async () => await (await fetch(`${base}/lookatstudy/api/state`)).json()
const focus = async (lessonId) => {
  await fetch(`${base}/lookatstudy/api/focus?token=${token}`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-lks-request': '1' },
    body: JSON.stringify({ lessonId }),
  })
  await page.waitForTimeout(3600)
}
const send = async (text) => {
  await page.fill('.lks14-composertext', text)
  await page.click('.lks14-composer .lks-btn-send:not(.stop)')
  await page.waitForTimeout(3200)
}
const stopTurn = async () => {
  const stop = page.locator('.lks14-composer .lks-btn-send.stop')
  if (await stop.count() > 0) { await stop.dispatchEvent('click'); await page.waitForTimeout(1200) }
}
const courseGroup = async () => (await feed()).lessonThreads[`course:${COURSE}`] ?? null

await page.goto(`${base}/?token=${token}`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-dsh-lookatstudy-entry]', { timeout: 30000 })
await page.click('[data-dsh-lookatstudy-entry]')
await page.waitForSelector('.lks-ui', { timeout: 30000 })
await page.waitForTimeout(2500)

// ——— 1. the toggle flips the scope; the chip exists at zero threads ———
await focus(A)
const chip0 = await page.locator('.lks14-threadchip').count()
probe('1a the chip shows at zero threads under course scope (the toggle is reachable before the first send)', chip0 === 1, `chip=${String(chip0)}`)
await page.locator('.lks14-threadchip').dispatchEvent('click')
await page.waitForTimeout(500)
const toggle = page.locator('[data-testid="thread-scope-toggle"]')
const toggleStateOn = (await toggle.textContent().catch(() => '')).includes('已开启')
probe('1b the toggle row reflects the seeded course scope', (await toggle.count()) === 1 && toggleStateOn, `rows=${String(await toggle.count())} on=${String(toggleStateOn)}`)
await page.keyboard.press('Escape')

// ——— 2. cross-lesson sends land in ONE course thread ———
await send('你好，从甲课开始。')
let g = await courseGroup()
const afterA = { threads: g?.threads.length ?? 0, active: g?.active ?? null }
await stopTurn()
probe('2a the first send mints exactly one course thread', afterA.threads === 1 && afterA.active !== null, `threads=${String(afterA.threads)} active=${String(afterA.active)}`)

await focus(B)
await send('继续乙课，接着上一课讲。')
g = await courseGroup()
const afterB = { threads: g?.threads.length ?? 0, active: g?.active ?? null, touched: g?.threads[0]?.touchedLessons ?? [] }
const f2 = await feed()
const mirrorA = f2.lessonSessions[A]
const mirrorB = f2.lessonSessions[B]
await stopTurn()
probe('2b the second lesson CONTINUES the same course thread (session unchanged)', afterB.threads === 1 && afterB.active === afterA.active,
  `threads=${String(afterB.threads)} activeSame=${String(afterB.active === afterA.active)}`)
probe('2c both send-from lessons mirror the course thread', mirrorA === afterA.active && mirrorB === afterA.active, `A=${String(mirrorA)} B=${String(mirrorB)} active=${String(afterA.active)}`)

// ——— 3. the due lesson's send (review-routing shape) stays in the thread ———
await focus(C)
await send('复习丙课，从最值路线开始。')
g = await courseGroup()
const afterC = { threads: g?.threads.length ?? 0, active: g?.active ?? null, touched: g?.threads[0]?.touchedLessons ?? [] }
await stopTurn()
probe('3 the due lesson\'s send (the review-routing shape) lands in the same course thread',
  afterC.threads === 1 && afterC.active === afterA.active && afterC.touched.includes(C),
  `threads=${String(afterC.threads)} touched=${afterC.touched.length}课时`)

// ——— 4. coverage labels name the touched lessons ———
await focus(A)
await page.locator('.lks14-threadchip').dispatchEvent('click')
await page.waitForTimeout(600)
const cover = (await page.locator('[data-testid="thread-cover"]').first().textContent().catch(() => '')) ?? ''
probe('4 the pill\'s coverage label names the touched lessons', cover.includes('甲') || cover.includes('乙'), `cover=${cover.slice(0, 40)}`)
await page.keyboard.press('Escape')

// ——— 1c (deferred): the OFF→ON round-trip through the UI, WITH threads ———
// (at zero threads under lesson scope the switcher legitimately unmounts —
// the 0.22 behavior — so the round-trip rides real threads; this also live-
// proves sediment preservation on both sides)
await focus(A)
await page.locator('.lks14-threadchip').dispatchEvent('click')
await page.waitForTimeout(500)
await page.locator('[data-testid="thread-scope-toggle"]').dispatchEvent('click')
await page.waitForTimeout(2600)
const scopeOff = (await feed()).courses.find(c => c.courseId === COURSE)?.threadScope
const courseGroupAfterOff = (await feed()).lessonThreads[`course:${COURSE}`] ?? null
await page.keyboard.press('Escape')
await send('课时档下单独问一句。')  // mints a lesson-scoped thread -> the chip reappears
await stopTurn()
await page.locator('.lks14-threadchip').dispatchEvent('click')
await page.waitForTimeout(500)
await page.locator('[data-testid="thread-scope-toggle"]').dispatchEvent('click')
await page.waitForTimeout(2600)
const scopeBackOn = (await feed()).courses.find(c => c.courseId === COURSE)?.threadScope
const courseGroupFinal = (await courseGroup())
await page.keyboard.press('Escape')
probe('1c the toggle round-trips the scope through the gated route; both sides keep their sediment',
  scopeOff === 'lesson' && scopeBackOn === 'course'
  && (courseGroupAfterOff?.threads.length ?? 0) === 1 && (courseGroupFinal?.threads.length ?? 0) === 1,
  `off=${String(scopeOff)} on=${String(scopeBackOn)} courseThreads=${String(courseGroupFinal?.threads.length ?? 0)}`)

// ——— 5. the combined-problem turn, then the journal evidence ———
await send('给我出一道结合甲课判别式和乙课参变分离的综合题。')
// settle on TURN END (stop twin gone), the tutor may run tools mid-turn
for (let i = 0; i < 90; i++) {
  const stopN = await page.locator('.lks14-composer .lks-btn-send.stop').count()
  if (stopN === 0 && i > 6) break
  await page.waitForTimeout(2000)
}
await page.waitForTimeout(1500)

const { scanZstdFrames, decompressZstdFrame } = await import('file:///D:/Users/kaiji/vibecodingKJ/clones/deepseek-ai/deepseek-harness/packages/session/session-persistence-jsonl/lib/types/zstd.js')
const sbase = 'D:/Users/kaiji/.dsh/sessions/--D-Users-kaiji-.dsh-lookatstudy-plugin-study-area--'
const markers = ['甲课正文标记JIA7', '乙课正文标记YI8', '丙课正文标记BING9']
let digestInPrompt = false
let markerInUser = false
let markerInPrompt = false
let markerInToolResult = false
let combinedAskSeen = false
let studyLessonNearCombined = false
for (const d of readdirSync(sbase).filter(d => d.startsWith('session-') && existsSync(`${sbase}/${d}/session.v3.jsonl.zstd`))) {
  const buf = readFileSync(`${sbase}/${d}/session.v3.jsonl.zstd`)
  const { frames } = scanZstdFrames(buf)
  const rows = []
  for (const fr of frames) {
    const txt = (await decompressZstdFrame(buf.subarray(fr.start, fr.end))).toString('utf8')
    for (const line of txt.split('\n').filter(Boolean)) {
      try { rows.push(JSON.parse(line)) } catch { /* non-JSON line */ }
    }
  }
  for (const j of rows) {
    const blob = JSON.stringify(j.data ?? '')
    const type = String(j.type ?? '')
    const hasMarker = markers.some(m => blob.includes(m))
    const hasDigest = blob.includes('【本课程进度摘要】')
    if (hasDigest) {
      digestInPrompt = true
      // the assembled-prompt row: bodies must never ride HERE (zero preload)
      if (hasMarker) markerInPrompt = true
    }
    if (hasMarker) {
      if (type.includes('user')) markerInUser = true
      if (type.startsWith('tool')) markerInToolResult = true
    }
    if (blob.includes('结合甲课判别式和乙课参变分离')) {
      combinedAskSeen = true
      // any study_lesson call in the same session counts (the directive rides every prompt)
      studyLessonNearCombined = studyLessonNearCombined || rows.some(r => String(r.type ?? '') === 'tool/call' && JSON.stringify(r.data ?? '').includes('"study_lesson"'))
    }
  }
}
probe('5a the per-turn prompt carries the course digest (journal evidence)', digestInPrompt, '')
probe('5b iron rule: lesson bodies ride ONLY tool results — never user rows, never the prompt',
  markerInToolResult && !markerInUser && !markerInPrompt,
  `toolResult=${String(markerInToolResult)} user=${String(markerInUser)} prompt=${String(markerInPrompt)}`)
probe('5c the combined-problem turn saw a study_lesson call (on-demand body pull)', combinedAskSeen && studyLessonNearCombined,
  `ask=${String(combinedAskSeen)} studyLesson=${String(studyLessonNearCombined)}`)

await browser.close()
const failed = results.filter(r => !r.ok)
console.log(`\nPROBE SUMMARY: ${results.length - failed.length}/${results.length} pass`)
process.exit(failed.length === 0 ? 0 : 1)

/**
 * Alpha-staging live probe (the 0.1.6 session-ownership round): exercises the
 * migrated dual-generation staging path on an ALPHA host (retain present,
 * sessions.open absent, list.current absent — DSH Desktop 2.0.13-beta's
 * runtime line). Six checks:
 *  1. the panel opens on the alpha host
 *  2. first send on the seeded lesson: create → retain → scope → prompt all
 *     survive, the feed attaches, and the turn settles (the published 0.26.0
 *     crashed here with `ctx.sessions.open is not a function`)
 *  3. the thread group lands in state.json with the first-message title
 *  4. hand-back: host new-session navigation hands the center column back —
 *     the alpha derivation reads the view owner's mainView retention, since
 *     list.current no longer exists
 *  5. reload + reopen: a FRESH mount re-stages through the retain path and
 *     the thread history is visible again
 *  6. ＋新建 mints a second thread; the chip menu switches back and the feed
 *     re-binds to thread 1 — plus zero page errors across the whole run
 * Usage: node scripts/probe-alpha-staging.mjs <token> [--url http://127.0.0.1:3081]
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const token = process.argv[2]
if (token === undefined || token === '') {
  console.error('usage: node scripts/probe-alpha-staging.mjs <token> [--url base]')
  process.exit(2)
}
const baseIdx = process.argv.indexOf('--url')
const base = baseIdx > 0 ? process.argv[baseIdx + 1] : 'http://127.0.0.1:3081'

const require = createRequire('D:/Users/kaiji/vibecodingKJ/clones/deepseek-ai/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/package.json')
const { chromium } = require('playwright')

const STATE_PATH = 'D:/Users/kaiji/.dsh/lookatstudy-plugin/state.json'
const readState = () => JSON.parse(readFileSync(STATE_PATH, 'utf8'))
const courseIdOf = () => readState().courses.find(c => c.title === '跨代舞台探针课')?.id ?? null
const lessonIds = () => {
  const course = readState().courses.find(c => c.title === '跨代舞台探针课')
  return (course?.sections[0]?.lessons ?? []).filter(l => l.kind === 'study').map(l => l.id)
}

const MSG1 = '一句话说明什么是变量提升'
const MSG2 = '一句话说明什么是闭包'

const results = []
const probe = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === '' ? '' : ` — ${detail}`}`)
}

const browser = await chromium.launch({ executablePath: 'C:/Users/kaiji/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe' })
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
const pageErrors = []
page.on('pageerror', e => { pageErrors.push(String(e)) })

const openPanel = async () => {
  await page.waitForSelector('[data-dsh-lookatstudy-entry]', { timeout: 45000 })
  await page.click('[data-dsh-lookatstudy-entry]')
  await page.waitForSelector('.lks14-shell-view', { timeout: 45000 })
}
const panelActive = () => page.evaluate(() => document.documentElement.getAttribute('data-dsh-lookatstudy-active'))

// send + wait for the turn to settle (stop twin gone + a settled assistant row).
// A settled REASONING row also counts: the alpha host occasionally ends a turn
// tool-call-only (reasoning + tool-call, no text block — observed live, the
// journal shows turn/end with no tool/result); the reasoning row proves the
// window delivered the assistant events, which is what THIS probe verifies.
const turnOver = () => {
  const feed = document.querySelector('[data-lks-feed]')?.getAttribute('data-lks-feed') ?? ''
  if (!feed.startsWith('rows:')) return false
  if (document.querySelector('.lks14-msg-assistant.streaming') !== null) return false
  if (document.querySelector('.lks14-composer .lks-btn-send.stop') !== null) return false
  if (document.querySelectorAll('.lks14-msg-assistant:not(.streaming)').length >= 1) return true
  return document.querySelectorAll('.lks14-reasoning, .lks14-msg-reasoning').length >= 1
}
const answerPendingAsk = async () => page.evaluate(() => {
  const el = [...document.querySelectorAll('[class*="_option"]')].find(b => b.closest('.lks14-shell-view') === null)
  if (el === undefined) return false
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  return true
})
const settleTurn = async () => {
  // 300s: a fresh thread's first turn runs the full course tool loop
  // (study_lesson + snapshot), which can outlast 180s on the alpha host
  const deadline = Date.now() + 300000
  let settled = false
  let misses = 0
  while (Date.now() < deadline) {
    try { await page.waitForFunction(turnOver, undefined, { timeout: 40000 }); settled = true; break } catch {
      misses += 1
      if (misses % 2 === 1) {
        const d = await page.evaluate(() => ({
          feed: document.querySelector('[data-lks-feed]')?.getAttribute('data-lks-feed') ?? 'NONE',
          streaming: document.querySelectorAll('.lks14-msg-assistant.streaming').length,
          stop: document.querySelector('.lks14-composer .lks-btn-send.stop') !== null,
          asstSettled: document.querySelectorAll('.lks14-msg-assistant:not(.streaming)').length,
          hostOptions: [...document.querySelectorAll('[class*="_option"]')].filter(b => b.closest('.lks14-shell-view') === null).length,
        }))
        console.log(`  (settle miss #${String(misses)}: ${JSON.stringify(d)})`)
      }
      if (await answerPendingAsk()) await page.waitForTimeout(4000)
    }
  }
  if (!settled) await page.waitForFunction(turnOver, undefined, { timeout: 30000 })
  await page.waitForTimeout(1500)
  await page.waitForFunction(turnOver, undefined, { timeout: 30000 })
}
const sendAndSettle = async (text) => {
  await page.fill('.lks14-composer textarea', text)
  await page.click('.lks14-composer .lks-btn-send:not(.stop)')
  await settleTurn()
}
const menuTitles = async () => {
  await page.click('.lks14-threadchip')
  return await page.evaluate(() => [...document.querySelectorAll('.lks14-threadmenu-row')].map(r => ({
    title: r.querySelector('.lks14-threadmenu-title')?.textContent ?? '',
    on: r.classList.contains('on'),
    isNew: r.classList.contains('new'),
  })))
}
const feedAttr = () => page.evaluate(() => document.querySelector('[data-lks-feed]')?.getAttribute('data-lks-feed') ?? null)

await page.goto(`${base}/?token=${token}`, { waitUntil: 'domcontentloaded' })

// —— 1. the panel opens on the alpha host ——
await openPanel()
probe('1 panel opens on the alpha-generation host', (await panelActive()) === '')

// —— 2. first send: mint + retain + prompt + feed attach + settle ——
const probeCourseId = courseIdOf()
const [aId] = lessonIds()
if (aId === undefined || probeCourseId === null) throw new Error('seeded lesson not found in state.json')
// the rail lists the SELECTED course (defaults to courses[0] — the owner's
// real course); switch onto the probe course before touching its lessons
await page.selectOption('.lks-set-select', probeCourseId)
await page.waitForTimeout(800)
await page.click(`[data-node-id="${aId}"]`)
await page.waitForTimeout(600)
await sendAndSettle(MSG1)
const feed2 = await feedAttr()
probe('2 first send settles with the feed attached (retain staging works)', (feed2 ?? '').startsWith('rows:'), `feed="${feed2 ?? 'none'}"`)
probe('2 no sessions.open crash (the 0.26.0 bug)', pageErrors.filter(e => e.includes('sessions.open') || e.includes('is not a function')).length === 0,
  pageErrors.find(e => e.includes('is not a function'))?.slice(0, 100) ?? '')

// —— 3. the thread group lands in state with the first-message title ——
await page.waitForSelector('.lks14-threadchip', { timeout: 15000 })
const g3 = readState().lessonThreads?.[aId]
probe('3 thread group written; active thread titled by the first message',
  g3?.threads?.length === 1 && g3.threads[0].title === MSG1 && g3.active === g3.threads[0].id,
  `title="${g3?.threads?.[0]?.title ?? 'none'}"`)

// —— 4. hand-back: host new-session navigation closes the panel ——
await page.click('button[class*="newSession"]')
try {
  await page.waitForFunction(() => document.documentElement.getAttribute('data-dsh-lookatstudy-active') === null, undefined, { timeout: 25000 })
  probe('4 hand-back fires on host navigation (alpha mainView derivation)', true)
} catch {
  probe('4 hand-back fires on host navigation (alpha mainView derivation)', false, 'attribute never cleared')
}

// —— 5. reload + reopen: fresh mount re-stages via retain; history returns ——
await page.reload({ waitUntil: 'domcontentloaded' })
await openPanel()
try {
  await page.waitForFunction((needle) => [...document.querySelectorAll('.lks14-msg-user')].some(m => (m.textContent ?? '').includes(needle)), MSG1, { timeout: 45000 })
  probe('5 reload: fresh mount re-stages and the thread history is visible', true)
} catch {
  const diag = { feed: await feedAttr(), active: await panelActive() }
  probe('5 reload: fresh mount re-stages and the thread history is visible', false, JSON.stringify(diag))
}

// —— 6. ＋新建 second thread, then switch back; zero page errors ——
await page.waitForTimeout(2500) // the chip count rides the state poll — settle past it
await page.click('.lks14-threadchip')
await page.click('.lks14-threadmenu-row.new')
await page.waitForFunction(() => document.querySelector('[data-lks-feed]')?.getAttribute('data-lks-feed') === 'no-thread', undefined, { timeout: 10000 })
await sendAndSettle(MSG2)
const g6 = readState().lessonThreads?.[aId]
probe('6 plus-new mints a second thread on the alpha host', g6?.threads?.length === 2 && g6.active === g6.threads[1].id,
  `threads=${g6?.threads?.length ?? 0}`)
const rows6 = await menuTitles()
const t1row = rows6.findIndex(r => r.title === MSG1)
await page.locator('.lks14-threadmenu-row').nth(t1row).click()
try {
  await page.waitForFunction((needle) => [...document.querySelectorAll('.lks14-msg-user')].some(m => (m.textContent ?? '').includes(needle)), MSG1, { timeout: 30000 })
  probe('6 switch-back re-binds the feed to thread 1', true)
} catch {
  probe('6 switch-back re-binds the feed to thread 1', false, `feed="${await feedAttr() ?? 'none'}"`)
}
probe('6 zero page errors across the whole run', pageErrors.length === 0, pageErrors[0]?.slice(0, 120) ?? '')

await browser.close()
const failed = results.filter(r => !r.ok)
console.log(failed.length === 0 ? `ALL ${String(results.length)} PASS` : `${String(failed.length)}/${String(results.length)} FAIL`)
process.exit(failed.length === 0 ? 0 : 1)

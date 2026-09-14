/**
 * Issue #11 live probe (the thread-group session model, seven checks):
 *  1. first send on an unbound lesson mints the thread AND auto-names it
 *     from the first message (chip appears, group written to state.json)
 *  2. the ＋新建 row clears the pointer; the next send mints a second thread
 *  3. switching back re-binds the feed to thread 1 (sediment intact, no dup)
 *  4. reload persists the group + the active pointer
 *  5. a legacy lessonSessions file migrates at load and CONTINUES the same
 *     dsh session (no new mint) — also proves the lesson-scoped localBound
 *     fix: a rail focus change never leaks the previous lesson's session
 *  6. 开始复习 routes the prompt into the DUE lesson's group with the
 *     review title (targetLessonId semantics)
 *  7. zero page errors + the P18 height chain holds (bounded columns,
 *     overflowing stream)
 * Usage: node scripts/probe-i11.mjs <token> [--url http://127.0.0.1:3081]
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const token = process.argv[2]
if (token === undefined || token === '') {
  console.error('usage: node scripts/probe-i11.mjs <token> [--url base]')
  process.exit(2)
}
const fromIdx = process.argv.indexOf('--from')
const startAt = fromIdx > 0 ? Number(process.argv[fromIdx + 1]) : 1
const baseIdx = process.argv.indexOf('--url')
const base = baseIdx > 0 ? process.argv[baseIdx + 1] : 'http://127.0.0.1:3081'

const require = createRequire('D:/Users/kaiji/vibecodingKJ/clones/deepseek-ai/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/package.json')
const { chromium } = require('playwright')

const STATE_PATH = 'D:/Users/kaiji/.dsh/lookatstudy-plugin/state.json'
const readState = () => JSON.parse(readFileSync(STATE_PATH, 'utf8'))
const LEGACY_SESSION = readState().lessonSessions['course:0:0'] ?? null

const MSG1 = '变量提升和暂时性死区到底有什么区别？'
const MSG2 = '换一条线，用一道具体的例题讲讲闭包'
const MSG3 = '用一句话总结这一课最核心的一点，直接回答'

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

const feedAttr = () => page.evaluate(() => document.querySelector('[data-lks-feed]')?.getAttribute('data-lks-feed') ?? null)

// send + wait for the turn to settle: >=1 settled assistant row, no streaming
// a settled row between tool-loop steps is NOT turn end — also require the
// stop twin gone (busy||feedGen false) and hold that state for a beat
const turnOver = () => {
  const feed = document.querySelector('[data-lks-feed]')?.getAttribute('data-lks-feed') ?? ''
  if (!feed.startsWith('rows:')) return false
  if (document.querySelector('.lks14-msg-assistant.streaming') !== null) return false
  if (document.querySelector('.lks14-composer .lks-btn-send.stop') !== null) return false
  return document.querySelectorAll('.lks14-msg-assistant:not(.streaming)').length >= 1
}
// the tutor may open with ask_user_question (off-course redline / resume
// choice); the panel has no answer UI yet, so answer it in the hidden host
// column — a pending ask parks the turn mid-step and the stop twin never
// clears on its own (live 2026-09-14 catch)
const answerPendingAsk = async () => page.evaluate(() => {
  const el = [...document.querySelectorAll('[class*="_option"]')].find(b => b.closest('.lks14-shell-view') === null)
  if (el === undefined) return false
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  return true
})
const settleTurn = async () => {
  const deadline = Date.now() + 180000
  let settled = false
  while (Date.now() < deadline) {
    try { await page.waitForFunction(turnOver, undefined, { timeout: 40000 }); settled = true; break } catch {
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

await page.goto(`${base}/?token=${token}`, { waitUntil: 'domcontentloaded' })
await openPanel()

if (startAt <= 1) {
// —— 1. mint + auto-name ——
await page.click('[data-node-id="course:0:1"]')
await page.waitForTimeout(600)
await sendAndSettle(MSG1)
await page.waitForSelector('.lks14-threadchip', { timeout: 15000 })
const chip1 = await page.textContent('.lks14-threadchip')
const g1 = readState().lessonThreads?.['course:0:1']
probe('1 mint+autoname: the chip appears after the first send', chip1?.includes('1') === true, `chip="${chip1?.trim()}"`)
probe('1 mint+autoname: the thread title = the first message (single-lined)', g1?.threads?.[0]?.title === MSG1 && g1?.active === g1?.threads?.[0]?.id,
  `title="${g1?.threads?.[0]?.title ?? 'none'}" active=${g1?.active ?? 'none'}`)

// —— 2. ＋新建 second thread ——
await menuTitles()
await page.click('.lks14-threadmenu-row.new')
await page.waitForFunction(() => document.querySelector('[data-lks-feed]')?.getAttribute('data-lks-feed') === 'no-thread', undefined, { timeout: 10000 })
probe('2 plus-new: the pointer clears and the feed goes thread-less', true)
await sendAndSettle(MSG2)
const chip2 = await page.textContent('.lks14-threadchip')
const g2 = readState().lessonThreads?.['course:0:1']
probe('2 plus-new: the second send mints a SECOND thread', g2?.threads?.length === 2 && g2?.active === g2?.threads?.[1]?.id && g2?.threads?.[1]?.title === MSG2,
  `chip="${chip2?.trim()}" threads=${g2?.threads?.length ?? 0} t2="${g2?.threads?.[1]?.title ?? 'none'}"`)

// —— 3. switch back to thread 1 ——
const rows3 = await menuTitles()
const t1row = rows3.findIndex(r => r.title === MSG1)
await page.locator('.lks14-threadmenu-row').nth(t1row).click()
await page.waitForFunction((needle) => [...document.querySelectorAll('.lks14-msg-user')].some(m => (m.textContent ?? '').includes(needle)), MSG1, { timeout: 30000 })
probe('3 switch-back: the feed re-binds to thread 1 (its history is back)', true)
const g3 = readState().lessonThreads?.['course:0:1']
probe('3 switch-back: the group active pointer follows (no new mint)', g3?.threads?.length === 2 && g3?.active === g3?.threads?.[0]?.id,
  `active=${g3?.active ?? 'none'}`)
const rows3b = await menuTitles()
const nowRow = rows3b.find(r => r.title === MSG1)
await page.click('.lks14-threadchip')
probe('3 switch-back: the menu marks thread 1 as the current one', nowRow?.on === true, `on=${String(nowRow?.on)}`)

// —— 4. reload persistence ——
await page.reload({ waitUntil: 'domcontentloaded' })
await openPanel()
try {
  await page.waitForFunction((needle) => [...document.querySelectorAll('.lks14-msg-user')].some(m => (m.textContent ?? '').includes(needle)), MSG1, { timeout: 45000 })
} catch {
  const diag = await page.evaluate(() => ({
    feed: document.querySelector('[data-lks-feed]')?.getAttribute('data-lks-feed') ?? null,
    chip: document.querySelector('.lks14-threadchip')?.textContent ?? null,
    active: document.documentElement.getAttribute('data-dsh-lookatstudy-active'),
    userRows: document.querySelectorAll('.lks14-msg-user').length,
  }))
  console.log('  (item-4 diag:', JSON.stringify(diag), ')')
  throw new Error('item 4: history not visible after reload')
}
const chip4 = await page.textContent('.lks14-threadchip')
probe('4 reload: the active thread rebinds after reload (history visible)', chip4?.includes('2') === true, `chip="${chip4?.trim()}"`)
const g4 = readState().lessonThreads?.['course:0:1']
probe('4 reload: state.json keeps 2 threads with thread 1 active', g4?.threads?.length === 2 && g4?.active === g4?.threads?.[0]?.id)

} // end items 1-4

// —— 5. legacy migration continues the SAME session ——
const feed = await (await fetch(`${base}/lookatstudy/api/state`)).json()
const legacyTitle = feed.courses.flatMap(c => c.sections).flatMap(s => s.lessons).find(l => l.id === 'course:0:0')?.title ?? ''
await page.click('[data-node-id="course:0:0"]')
await page.waitForTimeout(2000) // the chip count rides the state poll — settle past the focus-switch race
await page.waitForSelector('.lks14-threadchip', { timeout: 15000 })
const chip5 = await page.textContent('.lks14-threadchip')
const migrated = (await menuTitles()).find(r => !r.isNew)
await page.click('.lks14-threadchip')
probe('5 legacy: the migrated chip shows one thread titled by the lesson', chip5?.includes('1') === true && migrated?.title === legacyTitle && migrated?.isNew !== true,
  `chip="${chip5?.trim()}" title="${migrated?.title ?? 'none'}" expected="${legacyTitle}"`)
await sendAndSettle(MSG3)
const g5 = readState().lessonThreads?.['course:0:0']
probe('5 legacy: the send CONTINUES the legacy dsh session (no new mint)',
  LEGACY_SESSION !== null && g5?.threads?.length === 1 && g5?.threads?.[0]?.id === LEGACY_SESSION && g5?.active === LEGACY_SESSION,
  `legacy=${LEGACY_SESSION ?? 'none'} got=${g5?.active ?? 'none'}`)

// —— 6. review routes into the due lesson's group ——
await page.click('.lks-railpill.due')
await page.waitForSelector('.lks14-reviewrow .lks-btn.primary', { timeout: 10000 })
await page.click('.lks14-reviewrow .lks-btn.primary')
await settleTurn()
const g6 = readState().lessonThreads?.['course:0:2']
const chip6 = await page.textContent('.lks14-threadchip')
const menu6 = (await menuTitles()).find(r => !r.isNew)
await page.click('.lks14-threadchip')
probe('6 review: the prompt lands in the DUE lesson\'s group with the review title',
  g6?.threads?.length === 1 && g6?.threads?.[0]?.title === `复习：${legacyTitle2(feed)}` && menu6?.title === `复习：${legacyTitle2(feed)}`,
  `lesson=course:0:2 chip="${chip6?.trim()}" title="${g6?.threads?.[0]?.title ?? 'none'}"`)
const userRows6 = await page.evaluate(() => [...document.querySelectorAll('.lks14-msg-user')].map(m => m.textContent ?? ''))
probe('6 review: the review prompt itself is in the feed', userRows6.some(t => t.includes('复习') || t.includes('review')), `rows=${String(userRows6.length)}`)

// —— 7. zero page errors + the P18 height chain ——
probe('7 zero page errors across the whole run', pageErrors.length === 0, pageErrors[0]?.slice(0, 120) ?? '')
const chain = await page.evaluate(() => {
  const rect = sel => {
    const el = document.querySelector(sel)
    if (el === null) return null
    const cs = getComputedStyle(el)
    return { ch: el.clientHeight, sh: el.scrollHeight, oh: el.offsetHeight, disp: cs.display, ovY: cs.overflowY }
  }
  return { shell: rect('.lks14-shell-view'), root: rect('.lks14'), body: rect('.lks14-body'), chat: rect('.lks14-col.lks14-chat'), stream: rect('.lks14-stream') }
})
const c = chain
probe('7 P18: every column link is display:flex/hidden-bounded (chain intact)',
  c.shell !== null && c.root !== null && c.body !== null && c.chat !== null && c.stream !== null
  && (c.shell.disp === 'flex' || c.shell.disp === 'block')
  && c.root.oh <= c.shell.ch + 2 && c.body.oh <= c.root.ch + 2 && c.stream.oh <= c.chat.ch + 2,
  `root=${c.root?.oh}/${c.shell?.ch} body=${c.body?.oh}/${c.root?.ch} stream=${c.stream?.oh}/${c.chat?.ch}`)
probe('7 P18: the stream overflows internally (never grows the page)',
  c.stream !== null && (c.stream.ovY === 'auto' || c.stream.ovY === 'scroll') && c.stream.sh >= c.stream.ch,
  `ovY=${c.stream?.ovY} sh=${c.stream?.sh} ch=${c.stream?.ch}`)

await browser.close()
const failed = results.filter(r => !r.ok)
console.log(`\nprobe-i11: ${String(results.length - failed.length)}/${String(results.length)} PASS`)
process.exit(failed.length === 0 ? 0 : 1)

function legacyTitle2(feedData) {
  return feedData.courses.flatMap(c0 => c0.sections).flatMap(s => s.lessons).find(l => l.id === 'course:0:2')?.title ?? '优化器'
}

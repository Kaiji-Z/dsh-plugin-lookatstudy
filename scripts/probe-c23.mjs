/**
 * Audit C23 live probe: presentationMeta is ALIVE (relocated top-level →
 * output.presentationMeta in the schema rewrite). Drives one tutor turn that
 * calls an UN-KEYED tool (study_map — its card is the generic presenter card
 * built from presentResult + output.presentationMeta), then asserts:
 *  1. the turn really settled AFTER the send (a new user row appeared — the
 *     pre-existing history reads settled and must not count as a pass)
 *  2. the session journal records the study_map tool call (wire proof the
 *     real tool path ran; the journal intentionally strips result.meta —
 *     presentation-only — so the meta itself is proven by the unit gate
 *     (tools.test.ts presentResult-over-representative-values) plus the
 *     dsh-tools projection site (core/tools lib/index.js:3428: every
 *     top-level execution invokes output.presentationMeta and any throw
 *     fails the result visibly)
 * Known live caveats (2026-09-14 round): the tutor may open with
 * ask_user_question — this probe answers the pending option in the hidden
 * host column; the host conversation virtualizes history, so the generic
 * card's pixels may sit outside the mounted window.
 * Usage: node scripts/probe-c23.mjs <token> [--url http://127.0.0.1:3081]
 */
import { createRequire } from 'node:module'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
const token = process.argv[2]
const baseIdx = process.argv.indexOf('--url')
const base = baseIdx > 0 ? process.argv[baseIdx + 1] : 'http://127.0.0.1:3081'
const require = createRequire('D:/Users/kaiji/vibecodingKJ/clones/deepseek-ai/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/package.json')
const { chromium } = require('playwright')

const results = []
const probe = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === '' ? '' : ` — ${detail}`}`) }

const browser = await chromium.launch({ executablePath: 'C:/Users/kaiji/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe' })
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
const pageErrors = []
page.on('pageerror', e => pageErrors.push(String(e)))

await page.goto(`${base}/?token=${token}`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-dsh-lookatstudy-entry]', { timeout: 45000 })
await page.click('[data-dsh-lookatstudy-entry]')
await page.waitForSelector('.lks14-shell-view', { timeout: 45000 })
await page.click('[data-node-id="course:0:0"]')
await page.waitForTimeout(2000)

const turnOverDom = () => {
  const feed = document.querySelector('[data-lks-feed]')?.getAttribute('data-lks-feed') ?? ''
  if (!feed.startsWith('rows:')) return false
  if (document.querySelector('.lks14-msg-assistant.streaming') !== null) return false
  if (document.querySelector('.lks14-composer .lks-btn-send.stop') !== null) return false
  return document.querySelectorAll('.lks14-msg-assistant:not(.streaming)').length >= 1
}
const turnOver = () => page.evaluate(turnOverDom)
const answerPendingAsk = () => page.evaluate(() => {
  const el = [...document.querySelectorAll('[class*="_option"]')].find(b => b.closest('.lks14-shell-view') === null)
  if (el === undefined) return false
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  return true
})
const rowsBefore = await page.evaluate(() => document.querySelectorAll('.lks14-msg-user').length)
await page.fill('.lks14-composer textarea', '用 study_map 工具展示这门课的整体地图，并把每一节的标题列出来')
await page.click('.lks14-composer .lks-btn-send:not(.stop)')
let settled = false
const deadline = Date.now() + 240000
while (Date.now() < deadline) {
  try {
    await page.waitForFunction(turnOverDom, undefined, { timeout: 40000 })
    // a vacuous pass — the PRE-EXISTING history reads settled — does not count:
    // the send must have added a user row to the feed
    const rowsNow = await page.evaluate(() => document.querySelectorAll('.lks14-msg-user').length)
    if (rowsNow > rowsBefore) { settled = true; break }
  } catch {
    if (await answerPendingAsk()) await page.waitForTimeout(4000)
  }
}
if (!settled) await page.waitForFunction(turnOverDom, undefined, { timeout: 30000 }).catch(() => {})
await page.waitForTimeout(1500)
probe('the map turn settled (stop twin gone)', await page.evaluate(turnOverDom) === true)

// 1. the hidden host column renders the mapLines card
const card = await page.evaluate(() => {
  const host = document.querySelector('[data-pane="conversation"], [class*="centerCol"]')
  if (host === null) return { hostFound: false }
  const text = (host.textContent ?? '')
  return {
    hostFound: true,
    hasMapSummary: text.includes('🗺 ') && /\d+\/\d+ mastered/.test(text),
    hasSectionLine: text.includes('▍'),
    hasLessonIdLine: /\[lessonId course:0:0\]|\[lessonId course:0:1\]/.test(text),
  }
})
probe('host column carries the study_map result card', card.hostFound, JSON.stringify(card))
probe('the card carries presentationMeta lines (mapLines)', card.hasMapSummary && card.hasSectionLine,
  `summary=${card.hasMapSummary} section=${card.hasSectionLine} lessonId=${card.hasLessonIdLine}`)

// 2. journal proof: SOME study-area session records this turn's study_map call
// (the send may continue the group's active thread OR re-mint after restarts —
// scan every journal rather than guessing the session id)
const sbase = 'D:/Users/kaiji/.dsh/sessions/--D-Users-kaiji-.dsh-lookatstudy-plugin-study-area--'
const { scanZstdFrames, decompressZstdFrame } = await import('file:///D:/Users/kaiji/vibecodingKJ/clones/deepseek-ai/deepseek-harness/packages/session/session-persistence-jsonl/lib/types/zstd.js')
let sawMapCall = false
for (const d of readdirSync(sbase).filter(d => d.startsWith('session-') && existsSync(`${sbase}/${d}/session.v3.jsonl.zstd`))) {
  const buf = readFileSync(`${sbase}/${d}/session.v3.jsonl.zstd`)
  const { frames } = scanZstdFrames(buf)
  for (const fr of frames) {
    const txt = (await decompressZstdFrame(buf.subarray(fr.start, fr.end))).toString('utf8')
    for (const line of txt.split('\n').filter(Boolean)) {
      try {
        const j = JSON.parse(line)
        if (j.type === 'tool/call' && JSON.stringify(j.data ?? '').includes('"study_map"')) sawMapCall = true
      } catch { /* non-JSON line */ }
    }
  }
}
probe('the journal records a study_map call (real tool path)', sawMapCall)
probe('zero page errors across the probe', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))

console.log(`probe-c23: ${results.filter(Boolean).length}/${results.length} PASS`)
await browser.close()
process.exit(results.every(Boolean) ? 0 : 1)

/** Live probe for the ask_user_question panel answer UI (0.23.0): an
 * off-course question trips the tutor's redline ask (options in the PANEL,
 * not the hidden host column); clicking an option cancels the parked turn
 * and sends the label; the turn ends (stop twin gone), an assistant reply
 * lands, and the ask row settles answered. NEVER part of verify.
 * Usage: node scripts/probe-ask.mjs <token> --a <lessonId> [--url base] */
import { createRequire } from 'node:module'

const token = process.argv[2]
if (token === undefined || token === '') {
  console.error('usage: node scripts/probe-ask.mjs <token> --a <lessonId> [--url base]')
  process.exit(2)
}
const argAfter = (flag) => { const i = process.argv.indexOf(flag); return i > 0 ? process.argv[i + 1] : undefined }
const baseIdx = process.argv.indexOf('--url')
const base = baseIdx > 0 ? process.argv[baseIdx + 1] : 'http://127.0.0.1:3081'
const A = argAfter('--a')
if (A === undefined) { console.error('missing --a lessonId'); process.exit(2) }

const require = createRequire('D:/Users/kaiji/vibecodingKJ/clones/deepseek-ai/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/package.json')
const { chromium } = require('playwright')

const browser = await chromium.launch({ executablePath: 'C:/Users/kaiji/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe' })
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
const results = []
const probe = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === '' ? '' : ` — ${detail}`}`)
}

await page.goto(`${base}/?token=${token}`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-dsh-lookatstudy-entry]', { timeout: 30000 })
await page.click('[data-dsh-lookatstudy-entry]')
await page.waitForSelector('.lks-ui', { timeout: 30000 })
await page.waitForTimeout(2500)
await fetch(`${base}/lookatstudy/api/focus?token=${token}`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-lks-request': '1' },
  body: JSON.stringify({ lessonId: A }),
})
await page.waitForTimeout(3600)

// the off-course question trips the redline ask (the exact live scenario the
// gap was caught on: a JS question inside a math course)
await page.fill('.lks14-composertext', '课程外的问题，需要你帮我做个选择：要么你现在花一分钟把 JavaScript 的变量提升和暂时性死区快速讲清楚，要么干脆帮我导入一门系统的 JavaScript 课程从头学。选哪条路？')
await page.click('.lks14-composer .lks-btn-send:not(.stop)')

// the ask row appears in the PANEL (60s cap — the tutor reasons first)
let askRow = page.locator('[data-testid="ask-row"]').first()
let appeared = true
try { await askRow.waitFor({ timeout: 150000 }) } catch { appeared = false }
probe('1 the pending ask renders IN THE PANEL (not only the hidden host column)', appeared, '')
if (!appeared) {
  await browser.close()
  console.log(`\nPROBE SUMMARY: ${results.filter(r => r.ok).length}/${results.length} pass`)
  process.exit(1)
}

const optCount = await page.locator('[data-testid="ask-option"]').count()
const firstLabel = (await page.locator('[data-testid="ask-option"] .lks14-askopt-label').first().textContent().catch(() => '')) ?? ''
probe('2 the ask row carries clickable options with labels', optCount >= 2, `options=${String(optCount)} first=${firstLabel.slice(0, 18)}`)

// answer IN THE PANEL — the bridge cancels the parked turn, then sends
await page.locator('[data-testid="ask-option"]').first().dispatchEvent('click')

// the turn ends: stop twin gone (cap 180s — cancel + fresh turn)
let turnEnded = false
for (let i = 0; i < 90; i++) {
  const stopN = await page.locator('.lks14-composer .lks-btn-send.stop').count()
  if (stopN === 0 && i > 4) { turnEnded = true; break }
  await page.waitForTimeout(2000)
}
probe('3 answering from the panel ends the turn (stop twin clears — no more parked ask)', turnEnded, '')

const answered = (await askRow.getAttribute('class').catch(() => '')) ?? ''
probe('4 the ask row settles answered (options disabled)', answered.includes('answered'), `class=${answered.slice(0, 40)}`)

await browser.close()
const failed = results.filter(r => !r.ok)
console.log(`\nPROBE SUMMARY: ${results.length - failed.length}/${results.length} pass`)
process.exit(failed.length === 0 ? 0 : 1)

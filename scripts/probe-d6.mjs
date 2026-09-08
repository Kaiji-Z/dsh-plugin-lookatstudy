/**
 * D6 live probe: the world switcher filters the rail list, the streaming
 * lesson row wears the spinner badge + the rail notice (the seasonal env-*
 * filters retired with the 2026-09-08 map pivot).
 * Usage: node scripts/probe-d6.mjs <token> [--url http://127.0.0.1:3081]
 */
import { createRequire } from 'node:module'

const token = process.argv[2]
if (token === undefined || token === '') {
  console.error('usage: node scripts/probe-d6.mjs <token> [--url base]')
  process.exit(2)
}
const baseIdx = process.argv.indexOf('--url')
const base = baseIdx > 0 ? process.argv[baseIdx + 1] : 'http://127.0.0.1:3081'
const L0 = 'artificial-intelligence-for-beginners-a-curriculum:0:0'

const require = createRequire('D:/Users/kaiji/vibecodingKJ/clones/deepseek-ai/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/package.json')
const { chromium } = require('playwright')

const results = []
const probe = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === '' ? '' : ` — ${detail}`}`)
}

const browser = await chromium.launch({ executablePath: 'C:/Users/kaiji/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe' })
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
await page.goto(`${base}/?token=${token}`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-dsh-lookatstudy-entry]', { timeout: 30000 })
await page.click('[data-dsh-lookatstudy-entry]')
await page.waitForSelector('.lks-ui', { timeout: 30000 })
await page.waitForTimeout(3000)

// ——— the list rail mounts: section heads + lesson rows ———
const railList = await page.evaluate(() => ({
  secs: document.querySelectorAll('.lks-railsec-head').length,
  rows: document.querySelectorAll('.lks-lessorow').length,
  lockedRows: document.querySelectorAll('.lks-lessorow[aria-disabled="true"]').length,
}))
probe('the rail renders as a sectioned list (rows, some gated)', railList.secs > 0 && railList.rows > 0 && railList.lockedRows > 0,
  `secs=${railList.secs} rows=${railList.rows} locked=${railList.lockedRows}`)

// ——— the world switcher: hidden before… no — the seeded course HAS a practice world ———
const switcherVisible = await page.locator('[data-testid="world-tab-study"]').count()
const studySections = await page.evaluate(() => document.querySelectorAll('.lks-railsec-head').length)
await page.click('[data-testid="world-tab-practice"]')
await page.waitForTimeout(600)
const practiceState = await page.evaluate(() => ({
  sections: [...document.querySelectorAll('.lks-railsec-head .lks-railsec-title')].map(s => s.textContent ?? '?'),
  studyOn: document.querySelector('[data-testid="world-tab-study"]')?.getAttribute('aria-selected'),
}))
const onlyPractice = practiceState.sections.length > 0 && practiceState.sections.every(t => t === 'seed practice') // humanized display (0.19)
probe('the practice world tab filters the rail to practice sections only', switcherVisible === 1 && onlyPractice,
  `before=${studySections}sections after=[${practiceState.sections.join(',')}] studyTabSelected=${practiceState.studyOn}`)
await page.click('[data-testid="world-tab-study"]')
await page.waitForTimeout(600)
const backToStudy = await page.evaluate(() => document.querySelectorAll('.lks-railsec-head').length)
probe('switching back to the study world restores the study sections', backToStudy === studySections, `sections=${backToStudy}`)

// ——— the streaming spinner + rail notice during a live tutor turn ———
// (API-focus a FRESH lesson: 0:0's grown thread makes turn-start outlive the
// sampling window — the badge only lights at turn/start)
await fetch(`${base}/lookatstudy/api/focus?token=${token}`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ lessonId: 'artificial-intelligence-for-beginners-a-curriculum:1:3' }),
})
await page.waitForTimeout(3000)
await page.fill('.lks14-composertext', '用一句话回答：你好吗？')
await page.click('.lks-btn-send')
// while the turn runs: the notice pill + the focus ball's spinner badge
let sawSpin = false
let sawNotice = false
let spinDetail = ''
for (let i = 0; i < 40 && !(sawSpin && sawNotice); i++) {
  await page.waitForTimeout(500)
  const s = await page.evaluate(() => {
    const badge = document.querySelector('[data-node-streaming]')
    const anim = badge === null ? '' : getComputedStyle(badge).animationName
    return {
      spin: badge !== null,
      anim,
      notice: document.querySelector('[data-testid="streaming-notice"]') !== null,
      busy: document.querySelector('.lks14-composertext')?.getAttribute('placeholder') ?? '',
    }
  })
  if (s.spin && /lks-spin/.test(s.anim)) sawSpin = true
  if (s.notice) sawNotice = true
  spinDetail = `badgeAnim=${s.anim || 'none'} notice=${s.notice}`
}
probe('a live turn spins the focus ball (lks-spin animation) and shows the rail notice', sawSpin && sawNotice, spinDetail)

// ——— settle: the spinner and notice clear after the turn ———
await page.waitForTimeout(5000)
let cleared = false
for (let i = 0; i < 60 && !cleared; i++) {
  await page.waitForTimeout(1000)
  cleared = await page.evaluate(() => document.querySelector('[data-node-streaming]') === null && document.querySelector('[data-testid="streaming-notice"]') === null)
}
probe('the spinner + notice clear once the turn settles', cleared)

await browser.close()
const failed = results.filter(r => !r.ok)
console.log(`\nPROBE SUMMARY: ${results.length - failed.length}/${results.length} pass`)
process.exit(failed.length === 0 ? 0 : 1)

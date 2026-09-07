/**
 * D6 live probe (map ambiance): the seasonal env-* filter rides the rail and
 * actually filters a bubble (computed filter, not class names), the world
 * switcher filters sections to the seeded practice world, and a live tutor
 * turn spins the focus ball + shows the rail streaming notice.
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

// ——— the env-* filter: classes on the map wrapper + a REAL computed filter on a bubble ———
const env = await page.evaluate(() => {
  const wrap = document.querySelector('.lks-mapsec-list')
  const bubble = document.querySelector('.lks-mapnode .lks-bubble')
  return {
    wrapClass: wrap === null ? '' : wrap.className,
    attr: wrap === null ? '' : wrap.getAttribute('data-lks-env') ?? '',
    filter: bubble === null ? 'none' : getComputedStyle(bubble).filter,
  }
})
const hasSeason = /env-(spring|summer|autumn|winter)/.test(env.wrapClass)
const realFilter = env.filter !== 'none' && env.filter !== ''
probe('the env-* season filter rides the map wrapper and filters bubbles', hasSeason && realFilter,
  `env=${env.attr} computedFilter=${env.filter.slice(0, 60)}`)

// ——— the world switcher: hidden before… no — the seeded course HAS a practice world ———
const switcherVisible = await page.locator('[data-testid="world-tab-study"]').count()
const studySections = await page.evaluate(() => document.querySelectorAll('.lks-mapsec').length)
await page.click('[data-testid="world-tab-practice"]')
await page.waitForTimeout(600)
const practiceState = await page.evaluate(() => ({
  sections: [...document.querySelectorAll('.lks-mapsec')].map(s => s.querySelector('.lks-signpost-title')?.textContent ?? '?'),
  studyOn: document.querySelector('[data-testid="world-tab-study"]')?.getAttribute('aria-selected'),
}))
const onlyPractice = practiceState.sections.length > 0 && practiceState.sections.every(t => t === 'seed-practice')
probe('the practice world tab filters the rail to practice sections only', switcherVisible === 1 && onlyPractice,
  `before=${studySections}sections after=[${practiceState.sections.join(',')}] studyTabSelected=${practiceState.studyOn}`)
await page.click('[data-testid="world-tab-study"]')
await page.waitForTimeout(600)
const backToStudy = await page.evaluate(() => document.querySelectorAll('.lks-mapsec').length)
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

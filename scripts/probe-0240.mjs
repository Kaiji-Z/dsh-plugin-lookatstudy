/** 0.24.0 live probes: (B) the teach-tab 原文/对照/译文 switcher — default
 * 对照, original/译文 swap the prose, choice persists across refocus, the
 * translation-free control lesson shows no switcher; (A) a REAL model turn —
 * the live reasoning row appears mid-stream (running state) and settles into
 * the disclosure (needs the booted profile's model key; glm reasoning is
 * journal-proven in this setup).
 * Usage: node scripts/probe-0240.mjs <token> [--url http://127.0.0.1:3081]
 */
import { createRequire } from 'node:module'

const token = process.argv[2]
if (token === undefined || token === '') {
  console.error('usage: node scripts/probe-0240.mjs <token> [--url base]')
  process.exit(2)
}
const baseIdx = process.argv.indexOf('--url')
const base = baseIdx > 0 ? process.argv[baseIdx + 1] : 'http://127.0.0.1:3081'

const require = createRequire('D:/Users/kaiji/vibecodingKJ/clones/deepseek-ai/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/package.json')
const { chromium } = require('playwright')

const browser = await chromium.launch({ executablePath: 'C:/Users/kaiji/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe' })
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
await page.goto(`${base}/?token=${token}`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-dsh-lookatstudy-entry]', { timeout: 30000 })
await page.click('[data-dsh-lookatstudy-entry]')
await page.waitForSelector('.lks-ui', { timeout: 30000 })
await page.waitForTimeout(2500)

const results = []
const probe = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === '' ? '' : ` — ${detail}`}`)
}

// switch to the probe course (rail renders the SELECTED course)
await page.keyboard.press('Control+k')
await page.waitForTimeout(500)
await page.locator('.lks14-palette-row', { hasText: '双语探针课' }).first().dispatchEvent('click')
await page.waitForTimeout(1500)

// ——— B: the teach-tab language switcher (原文/译文, two-state since 0.25.0) ———
await page.locator('.lks14-viewtab').nth(0).dispatchEvent('click')
await page.waitForTimeout(1000)
const seg = await page.locator('[data-testid="langview"]').count()
const segButtons = await page.locator('[data-testid="langview"] button').count()
probe('B: translated lesson shows the two-state 原文/译文 control', seg === 1 && segButtons === 2, `control=${seg} buttons=${segButtons}`)
let hasZh = await page.locator('.lks14-prose', { hasText: '核心观点' }).count()
let hasEn = await page.locator('.lks14-prose', { hasText: 'core idea' }).count()
let imgs = await page.locator('.lks14-prose img').count()
probe('B: default view is 原文 (upstream: locale null = original)', hasZh === 0 && hasEn > 0 && imgs > 0, `zh=${hasZh} en=${hasEn} imgs=${imgs}`)

await page.locator('[data-testid="langview-translation"]').dispatchEvent('click')
await page.waitForTimeout(600)
hasZh = await page.locator('.lks14-prose', { hasText: '核心观点' }).count()
hasEn = await page.locator('.lks14-prose', { hasText: 'core idea' }).count()
const tImgs = await page.evaluate(() => [...document.querySelectorAll('.lks14-prose img')].filter(el => (el.currentSrc ?? el.src).startsWith('data:image')).length)
probe('B: 译文 view shows the translation with the position-mapped image rendering', hasZh > 0 && hasEn === 0 && tImgs > 0, `zh=${hasZh} en=${hasEn} dataImgs=${tImgs}`)


// persistence: refocus the second lesson and back — the 译文 choice holds
// (wait PAST the state poll — the lesson payload swaps on the next tick)
await page.locator('[data-node-id$=":0:1"]').first().dispatchEvent('click')
await page.waitForTimeout(6500)
const segControl = await page.locator('[data-testid="langview"]').count()
probe('B: the translation-free lesson shows NO switcher (zero-change control)', segControl === 0, `control=${segControl}`)
await page.locator('[data-node-id$=":0:0"]').first().dispatchEvent('click')
await page.waitForTimeout(6500)
hasZh = await page.locator('.lks14-prose', { hasText: '核心观点' }).count()
hasEn = await page.locator('.lks14-prose', { hasText: 'core idea' }).count()
probe('B: the 译文 choice persists across refocus (per-lesson storage)', hasZh > 0 && hasEn === 0, `zh=${hasZh} en=${hasEn}`)
// (译文 stays the stored choice for the reasoning-turn section below)
await page.locator('[data-testid="langview-original"]').dispatchEvent('click')
await page.waitForTimeout(400)

// ——— A: a real model turn — the live thinking row ———
// sample the DOM every 250ms while the turn runs for the running-state row
let sawRunning = false
let sawSettled = false
let runningSamples = 0
const sampler = setInterval(() => {
  void page.evaluate(() => {
    const running = document.querySelectorAll('.lks14-reasoning[data-state="running"]').length
    const settled = document.querySelectorAll('.lks14-reasoning[data-state="ok"]').length
    return { running, settled }
  }).then((r) => {
    if (r.running > 0) { sawRunning = true; runningSamples++ }
    if (r.settled > 0) sawSettled = true
  }).catch(() => { /* page navigating */ })
}, 250)
await page.fill('.lks14-composertext', '用一句话解释：为什么抛物线开口向上时最小值就是顶点？先认真思考。')
await page.click('.lks14-composer .lks-btn-send:not(.stop)')
// settle on TURN END (stop twin gone), the tutor may run tools mid-turn
await page.waitForFunction(() => document.querySelector('.lks14-composer .lks-btn-send.stop') !== null, { timeout: 30000 }).catch(() => {})
await page.waitForFunction(() => document.querySelector('.lks14-composer .lks-btn-send.stop') === null, { timeout: 180000 }).catch(() => {})
// the settlement event replaces the transient rows a beat after the stop
// twin vanishes — wait for the durable disclosure, not a fixed sleep
await page.waitForSelector('.lks14-reasoning[data-state="ok"]', { timeout: 20000 }).catch(() => {})
await page.waitForTimeout(1500)
clearInterval(sampler)
const settledRow = await page.locator('.lks14-reasoning[data-state="ok"]').count()
const expandedBody = await page.evaluate(() => {
  const el = document.querySelector('.lks14-reasoning[data-state="ok"]')
  if (el === null) return null
  el.setAttribute('open', '')
  const body = el.querySelector('.lks14-reasoning-body')
  return { hasBody: body !== null, len: body?.textContent?.length ?? 0, title: el.querySelector('.lks14-reasoning-title')?.textContent ?? '' }
})
probe('A: the live thinking row appeared mid-stream (running state sampled)', sawRunning, `samples=${runningSamples}`)
probe('A: the settled thinking disclosure remains after the turn (思考 title, expandable body)',
  settledRow > 0 && expandedBody !== null && expandedBody.hasBody && expandedBody.len > 10 && expandedBody.title.includes('思考'),
  `row=${settledRow} title=${expandedBody?.title ?? '-'} bodyLen=${expandedBody?.len ?? 0}`)

await browser.close()
const failed = results.filter(r => !r.ok)
console.log(`\nPROBE SUMMARY: ${results.length - failed.length}/${results.length} pass`)
process.exit(failed.length === 0 ? 0 : 1)

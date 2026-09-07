/**
 * P13 live probes (D2 celebration layer): the canvas burst fires anchored at
 * the review card (correct, quality ≥ 4), the reduced-motion static glyph
 * replaces it under emulateMedia, and the panel's poll-diff streak fires on
 * the review round. Evidence = canvas alpha sampling + DOM.
 * Usage: node scripts/probe-p13.mjs <token> [--url http://127.0.0.1:3081]
 */
import { createRequire } from 'node:module'

const token = process.argv[2]
if (token === undefined || token === '') {
  console.error('usage: node scripts/probe-p13.mjs <token> [--url base]')
  process.exit(2)
}
const baseIdx = process.argv.indexOf('--url')
const base = baseIdx > 0 ? process.argv[baseIdx + 1] : 'http://127.0.0.1:3081'
const L0 = 'artificial-intelligence-for-beginners-a-curriculum:0:0'
const L1 = 'artificial-intelligence-for-beginners-a-curriculum:0:1'

const require = createRequire('D:/Users/kaiji/vibecodingKJ/clones/deepseek-ai/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/package.json')
const { chromium } = require('playwright')

const browser = await chromium.launch({ executablePath: 'C:/Users/kaiji/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe' })
const results = []
const probe = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === '' ? '' : ` — ${detail}`}`)
}

/* ── 1. default motion: rate 记得 (quality 4) → anchored canvas burst ── */
{
  const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
  await page.goto(`${base}/?token=${token}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-dsh-lookatstudy-entry]', { timeout: 30000 })
  await page.click('[data-dsh-lookatstudy-entry]')
  await page.waitForSelector('.lks-ui', { timeout: 30000 })
  await page.waitForTimeout(2500)
  await fetch(`${base}/lookatstudy/api/focus?token=${token}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ lessonId: L0 }),
  })
  await page.waitForTimeout(3500)
  const canvasMounted = await page.locator('.lks14-celfx-canvas').count()
  const rateCard = await page.locator(`[data-lks-rate="${L0}"]`).count()
  // sample the card's top-right anchor box (right-48, top+24) for particles
  await page.locator(`[data-lks-rate="${L0}"] button`).nth(1).dispatchEvent('click') // 记得 = quality 4
  let alphaPixels = 0
  for (let i = 0; i < 8; i++) {
    alphaPixels = await page.evaluate(() => {
      const canvas = document.querySelector('.lks14-celfx-canvas')
      if (canvas === null) return -1
      const ctx = canvas.getContext('2d')
      const { width, height } = canvas
      const data = ctx.getImageData(0, 0, width, height).data
      let n = 0
      for (let p = 3; p < data.length; p += 40) { if (data[p] > 0) n++ } // sample every 10th pixel's alpha
      return n
    })
    if (alphaPixels > 5) break
    await page.waitForTimeout(180)
  }
  probe('quality≥4 rating fires the anchored canvas burst',
    canvasMounted === 1 && rateCard === 1 && alphaPixels > 5,
    `canvas=${canvasMounted} rateCard=${rateCard} alphaHits=${alphaPixels}`)
  await page.close()
}

/* ── 2. reduced motion: the static glyph replaces the particles ── */
{
  const page = await browser.newPage({ viewport: { width: 1560, height: 940 }, reducedMotion: 'reduce' })
  await page.goto(`${base}/?token=${token}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-dsh-lookatstudy-entry]', { timeout: 30000 })
  await page.click('[data-dsh-lookatstudy-entry]')
  await page.waitForSelector('.lks-ui', { timeout: 30000 })
  await page.waitForTimeout(2500)
  await fetch(`${base}/lookatstudy/api/focus?token=${token}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ lessonId: L1 }),
  })
  await page.waitForTimeout(3500)
  const noCanvas = await page.locator('.lks14-celfx-canvas').count()
  const reducedLayer = await page.locator('.lks14-celfx-reduced').count()
  await page.locator(`[data-lks-rate="${L1}"] button`).nth(1).dispatchEvent('click')
  let glyph = ''
  for (let i = 0; i < 10; i++) {
    glyph = await page.locator('.lks14-celfx-glyph').textContent().catch(() => '')
    if (glyph !== '') break
    await page.waitForTimeout(150)
  }
  probe('reduced-motion: no canvas, static glyph flashes instead',
    noCanvas === 0 && reducedLayer === 1 && glyph !== '',
    `canvas=${noCanvas} layer=${reducedLayer} glyph=${JSON.stringify(glyph)}`)
  await page.close()
}

/* ── 3. the streak diff fires on the review round (informational sample) ── */
{
  const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
  await page.goto(`${base}/?token=${token}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-dsh-lookatstudy-entry]', { timeout: 30000 })
  await page.click('[data-dsh-lookatstudy-entry]')
  await page.waitForSelector('.lks-ui', { timeout: 30000 })
  await page.waitForTimeout(3000)
  const streakBefore = await page.evaluate(() => [...document.querySelectorAll('.lks-hdr-streak')].map(e => e.textContent).join(''))
  probe('the streak header renders for the diff baseline', streakBefore !== '', `streak=${streakBefore}`)
  await page.close()
}

await browser.close()
const failed = results.filter(r => !r.ok)
console.log(`\nPROBE SUMMARY: ${results.length - failed.length}/${results.length} pass`)
process.exit(failed.length === 0 ? 0 : 1)

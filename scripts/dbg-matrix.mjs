import { createRequire } from 'node:module'
const token = process.argv[2]
const base = 'http://127.0.0.1:3081'
const require = createRequire('D:/Users/kaiji/vibecodingKJ/clones/deepseek-ai/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/package.json')
const { chromium } = require('playwright')
const browser = await chromium.launch({ executablePath: 'C:/Users/kaiji/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe' })
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
await page.goto(`${base}/?token=${token}`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-dsh-lookatstudy-entry]', { timeout: 30000 })
await page.click('[data-dsh-lookatstudy-entry]')
await page.waitForSelector('.lks-ui', { timeout: 30000 })
await page.waitForTimeout(2500)
// what does the rail scroll actually contain — grid-scan for a blank point
const scan = await page.evaluate(() => {
  const rail = document.querySelector('.lks14-railscroll')
  if (rail === null) return { rail: false }
  const r = rail.getBoundingClientRect()
  const hits = []
  for (let y = r.top + 8; y < r.bottom - 8; y += 22) {
    for (let x = r.left + 6; x < r.right - 6; x += 24) {
      const el = document.elementFromPoint(x, y)
      if (el !== null && rail.contains(el) && el.closest('button, a, input, textarea, select') === null) {
        hits.push({ x: Math.round(x), y: Math.round(y), tag: el.tagName, cls: String(el.className).slice(0, 40) })
        if (hits.length > 6) break
      }
    }
    if (hits.length > 6) break
  }
  return { rail: true, rect: { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }, hits }
})
console.log('rail scan:', JSON.stringify(scan, null, 1))
// stream overflow state
await fetch(`${base}/lookatstudy/api/focus?token=${token}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lessonId: 'artificial-intelligence-for-beginners-a-curriculum:0:0' }) })
await page.waitForTimeout(3500)
const stream = await page.evaluate(() => {
  const el = document.querySelector('.lks14-stream')
  if (el === null) return null
  return { sh: el.scrollHeight, ch: el.clientHeight, overflow: el.scrollHeight - el.clientHeight }
})
console.log('stream:', JSON.stringify(stream))
await browser.close()

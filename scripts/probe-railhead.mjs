/** 0.19 criterion-3 probe: distilled rail head — scroll reserve ≤120px,
 * search/review/worldswitch share one clickable row. */
import { createRequire } from 'node:module'
const req = createRequire('D:/Users/kaiji/vibecodingKJ/clones/deepseek-ai/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/package.json')
const { chromium } = req('playwright')
const token = process.argv[2]
const browser = await chromium.launch({ executablePath: 'C:/Users/kaiji/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe' })
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
await page.goto(`http://127.0.0.1:3081/?token=${token}`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-dsh-lookatstudy-entry]', { timeout: 30000 })
await page.click('[data-dsh-lookatstudy-entry]')
await page.waitForSelector('.lks-lessorow', { timeout: 30000 })
await page.waitForTimeout(1200)
const out = await page.evaluate(() => {
  const scroll = document.querySelector('.lks14-railscroll')
  const reserve = scroll === null ? null : parseFloat(getComputedStyle(scroll).paddingTop)
  // single-row clickability: each control's center must resolve to itself
  const hit = (sel) => {
    const el = document.querySelector(sel)
    if (el === null) return { sel, present: false }
    const r = el.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    const top = document.elementFromPoint(cx, cy)
    return { sel, present: true, self: top !== null && (top === el || el.contains(top)), top: r.top, bottom: r.bottom, w: Math.round(r.width) }
  }
  return {
    reserve,
    search: hit('.lks-railpill'),
    review: hit('.lks-railpill.due, .lks-railpill:nth-child(2)'),
    worldStudy: hit('[data-testid="world-tab-study"]'),
    worldPractice: hit('[data-testid="world-tab-practice"]'),
    railWidth: Math.round((document.querySelector('.lks14-rail') ?? document.body).getBoundingClientRect().width),
  }
})
console.log(JSON.stringify(out, null, 1))
// one row = every pair's vertical ranges overlap (border-box offsets differ;
// what matters is no control wrapped to its own line and none is occluded)
const rows = [out.search, out.review, out.worldStudy, out.worldPractice]
const sameRow = rows.every(a => rows.every(b => a.top < b.bottom && b.top < a.bottom))
const allClickable = rows.every(x => x.self === true)
console.log(`RESERVE=${String(out.reserve)} sameRow=${String(sameRow)} allClickable=${String(allClickable)}`)
await browser.close()
process.exit(out.reserve !== null && out.reserve <= 120 && sameRow && allClickable ? 0 : 1)

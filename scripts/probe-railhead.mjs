/** 0.19 criterion-3 probe: distilled rail head — scroll reserve ≤120px,
 * search/review/worldswitch share one clickable row. */
import { createRequire } from 'node:module'
const req = createRequire('D:/Users/kaiji/vibecodingKJ/clones/deepseek-ai/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/package.json')
const { chromium } = req('playwright')
const token = process.argv[2]
const base = 'http://127.0.0.1:3081'
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
// slug audit (0.19 criterion 4): no raw episode slug in rail heads or search
// rows; note source chips read as locale labels, not raw enum strings
const slugRe = /^\d+[.-]/
const railHeads = await page.evaluate(() => [...document.querySelectorAll('.lks-railsec-title')].map(e => e.textContent ?? ''))
const slugHeads = railHeads.filter(t => slugRe.test(t.trim()))
const btns2 = await page.locator('.lks14-railtop button').all()
for (const b of btns2) {
  const t = await b.getAttribute('data-tooltip')
  if (t !== null && (t.includes('搜索') || t.toLowerCase().includes('search'))) { await b.dispatchEvent('click'); break }
}
await page.waitForTimeout(400)
await page.locator('input[type="search"].lks14-search').fill('Examples')
await page.waitForTimeout(1500)
const slugRows = await page.evaluate(() => [...document.querySelectorAll('.lks14-searchrow-title, .lks14-searchrow-course, .lks14-searchrow-snip')].filter(e => /^\d+[.-]/.test((e.textContent ?? '').trim())).length)
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
// note source chips: focus the note-bearing lesson, open the notes tab
await fetch(`${base}/lookatstudy/api/focus?token=${token}`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ lessonId: 'artificial-intelligence-for-beginners-a-curriculum:0:0' }),
})
await page.waitForTimeout(3000)
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(b => (b.textContent ?? '').trim().startsWith('笔记'))
  btn?.click()
})
await page.waitForTimeout(800)
const srcChips = await page.evaluate(() => [...document.querySelectorAll('.lks-note-src')].map(e => (e.textContent ?? '').trim()).slice(0, 6))
const srcLabelsOk = srcChips.every(t => t === '' || !/^(ai|content|chat|learner)$/.test(t))
console.log(`RESERVE=${String(out.reserve)} sameRow=${String(sameRow)} allClickable=${String(allClickable)} slugHeads=${String(slugHeads.length)}/${String(railHeads.length)} slugRows=${String(slugRows)} srcChips=${srcChips.join('|') || 'none'}`)
await browser.close()
const pass = out.reserve !== null && out.reserve <= 120 && sameRow && allClickable && slugHeads.length === 0 && slugRows === 0 && srcLabelsOk
process.exit(pass ? 0 : 1)

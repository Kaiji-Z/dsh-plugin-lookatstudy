/** Retake the README screenshots (light + dark sets).
 * Usage: node scripts/shots.mjs <token> light|dark [--url base]
 * Assumes the host is ALREADY in the requested theme (flip-theme.mjs). */
import { createRequire } from 'node:module'
const token = process.argv[2]
const mode = process.argv[3] ?? 'light'
const baseIdx = process.argv.indexOf('--url')
const base = baseIdx > 0 ? process.argv[baseIdx + 1] : 'http://127.0.0.1:3081'
const require = createRequire('D:/Users/kaiji/vibecodingKJ/clones/deepseek-ai/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/package.json')
const { chromium } = require('playwright')

const L0 = 'artificial-intelligence-for-beginners-a-curriculum:0:0'
const SUFFIX = mode === 'dark' ? '' : '-light'
const browser = await chromium.launch({ executablePath: 'C:/Users/kaiji/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe' })
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
await page.goto(`${base}/?token=${token}`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-dsh-lookatstudy-entry]', { timeout: 30000 })
await page.click('[data-dsh-lookatstudy-entry]')
await page.waitForSelector('.lks-ui', { timeout: 30000 })
// settle: theme follow + map render
for (let i = 0; i < 20; i++) {
  const ok = await page.evaluate(m => document.querySelector('.lks-ui')?.getAttribute('data-lks-theme') === m, mode)
  if (ok) break
  await page.waitForTimeout(500)
}
await page.waitForTimeout(1500)

// 1. overview: the map with a focused lesson + chat + notebook columns
await fetch(`${base}/lookatstudy/api/focus?token=${token}`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ lessonId: L0 }),
})
await page.waitForTimeout(4000)
await page.screenshot({ path: `docs/media/overview${SUFFIX}.png` })

// 2. course rail (map pane, balloons + signposts)
await page.screenshot({ path: `docs/media/course-rail${SUFFIX}.png`, clip: { x: 0, y: 0, width: 480, height: 940 } })

// 3. blackboard lesson (讲解 tab)
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(b => (b.textContent ?? '').trim().startsWith('讲解'))
  btn?.click()
})
await page.waitForTimeout(2500)
await page.screenshot({ path: `docs/media/blackboard-lesson${SUFFIX}.png`, clip: { x: 1000, y: 0, width: 560, height: 940 } })

// 4. concept map (概念图 tab)
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(b => (b.textContent ?? '').trim().startsWith('概念图'))
  btn?.click()
})
await page.waitForTimeout(2500)
await page.screenshot({ path: `docs/media/concept-map${SUFFIX}.png`, clip: { x: 1000, y: 0, width: 560, height: 940 } })

await browser.close()
console.log(`shots[${mode}]: overview/course-rail/blackboard-lesson/concept-map${SUFFIX}.png`)

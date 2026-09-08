/** Retake the README screenshots — LIGHT theme only (owner decision), every
 * shot CLIPPED to the plugin panel so the dsh native sidebar never appears.
 * (DOM-hiding the sidebar is wrong here: the host is a CSS grid with a fixed
 * 280px first track — display:none reflows the center column INTO that track
 * and collapses the panel. Clipping the measured rects is side-effect-free.)
 * Writes the PLAIN filenames; the *-light.png twins are retired.
 * Usage: node scripts/shots.mjs <token> [--url base]
 * Assumes the host is ALREADY in the light theme (flip-theme.mjs). */
import { createRequire } from 'node:module'
const token = process.argv[2]
const baseIdx = process.argv.indexOf('--url')
const base = baseIdx > 0 ? process.argv[baseIdx + 1] : 'http://127.0.0.1:3081'
const require = createRequire('D:/Users/kaiji/vibecodingKJ/clones/deepseek-ai/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/package.json')
const { chromium } = require('playwright')

const L0 = 'artificial-intelligence-for-beginners-a-curriculum:0:0'
const browser = await chromium.launch({ executablePath: 'C:/Users/kaiji/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe' })
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
await page.goto(`${base}/?token=${token}`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-dsh-lookatstudy-entry]', { timeout: 30000 })
await page.click('[data-dsh-lookatstudy-entry]')
await page.waitForSelector('.lks-ui', { timeout: 30000 })
// settle: theme follow (must be LIGHT) + rail render
for (let i = 0; i < 20; i++) {
  const ok = await page.evaluate(() => document.querySelector('.lks-ui')?.getAttribute('data-lks-theme') === 'light')
  if (ok) break
  await page.waitForTimeout(500)
}
await page.waitForTimeout(1500)

const rectOf = (sel) => page.evaluate((s) => {
  const el = document.querySelector(s)
  if (el === null) return null
  const r = el.getBoundingClientRect()
  return { x: r.x, y: Math.max(0, r.y), width: r.width, height: Math.min(r.height, 940) }
}, sel)

// 1. overview: the whole panel (native sidebar lives left of it — clipped out)
await fetch(`${base}/lookatstudy/api/focus?token=${token}`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ lessonId: L0 }),
})
await page.waitForTimeout(4000)
const panel = await rectOf('.lks14')
if (panel === null) throw new Error('panel not found')
await page.screenshot({ path: 'docs/media/overview.png', clip: panel })

// 2. course rail — the plugin's own rail column
const rail = await rectOf('.lks14-rail')
if (rail === null || rail.width === 0) throw new Error('rail column not measurable')
await page.screenshot({ path: 'docs/media/course-rail.png', clip: rail })

// 3. blackboard lesson (讲解 tab) — the notebook column frame
const note = await rectOf('.lks14-note')
if (note === null || note.width === 0) throw new Error('notebook column not measurable')
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(b => (b.textContent ?? '').trim().startsWith('讲解'))
  btn?.click()
})
await page.waitForTimeout(2500)
await page.screenshot({ path: 'docs/media/blackboard-lesson.png', clip: note })

// 4. concept map (概念图 tab)
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(b => (b.textContent ?? '').trim().startsWith('概念图'))
  btn?.click()
})
await page.waitForTimeout(2500)
await page.screenshot({ path: 'docs/media/concept-map.png', clip: note })

await browser.close()
console.log('shots[light]: overview/course-rail/blackboard-lesson/concept-map.png (clipped to the panel — no native sidebar)')

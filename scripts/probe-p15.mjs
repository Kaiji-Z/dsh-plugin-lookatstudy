/**
 * P15 live probes (D5 physics map): physics mode mounts (islands drive the
 * bubble transforms), a pointer drag moves a ball without navigating, a clean
 * click still routes navigation, the weather canvases ride the rail, and the
 * FPS gate holds (rAF sampling ≥40 — two consecutive rounds below stop the
 * goal for a user degradation decision). Reduced-motion keeps the static path.
 * Usage: node scripts/probe-p15.mjs <token> [--url http://127.0.0.1:3081]
 */
import { createRequire } from 'node:module'

const token = process.argv[2]
if (token === undefined || token === '') {
  console.error('usage: node scripts/probe-p15.mjs <token> [--url base]')
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
await page.waitForTimeout(4000)

// ——— physics mode mounts: the mapfield rides lks-physics + islands write transforms ———
const physicsField = await page.locator('.lks-mapfield.lks-physics').count()
const node = page.locator(`.lks-mapnode[data-node-id="${L0}"]`).first()
const beforeDrag = await node.getAttribute('style').catch(() => '')
probe('physics mode mounts over the rail map', physicsField >= 1, `physicsFields=${physicsField}`)

// ——— drag: pointer down + move past the 6px threshold → the ball moves, no navigation ———
// ('selected' lives on the bubble button inside the mapnode, not the mapnode div)
const selectedId = () => page.evaluate(() =>
  document.querySelector('button.selected')?.closest('.lks-mapnode')?.getAttribute('data-node-id') ?? null)
const focusBefore = await selectedId()
const box = await node.boundingBox()
const cx = box.x + box.width / 2
const cy = box.y + box.height / 2
await page.mouse.move(cx, cy)
await page.mouse.down()
await page.mouse.move(cx + 55, cy + 30, { steps: 8 })
await page.mouse.up()
await page.waitForTimeout(500)
const styleAfter = await node.getAttribute('style').catch(() => '')
const movedViaTransform = /translate3d\((?!0\.0px, 0\.0px)/.test(styleAfter) && styleAfter !== beforeDrag
const focusAfterDrag = await selectedId()
probe('drag past the threshold moves the ball without navigating',
  movedViaTransform && focusAfterDrag === focusBefore,
  `transform=${(styleAfter.match(/translate3d\([^)]+\)/) ?? [''])[0]} focus ${focusBefore}→${focusAfterDrag}`)

// ——— click (sub-threshold): navigation still routes ———
await page.evaluate((id) => {
  const el = document.querySelector(`[data-node-id="${id}"] button`)
  el?.click()
}, L0)
await page.waitForTimeout(2500)
const focusAfterClick = await selectedId()
probe('a clean click still routes navigation', focusAfterClick === L0, `focus=${focusAfterClick}`)

// ——— the weather canvases ride the rail ———
const skyCanvas = await page.locator('.lks-sky-canvas').count()
const orbCanvas = await page.locator('.lks-orb-weather-canvas').count()
const skySized = await page.evaluate(() => {
  const c = document.querySelector('.lks-sky-canvas')
  return c !== null && c.width > 0 && c.height > 0
})
probe('the sky + orb-weather canvases ride the rail', skyCanvas === 1 && orbCanvas === 1 && skySized,
  `sky=${skyCanvas} orb=${orbCanvas} sized=${skySized}`)

// ——— the FPS gate: rAF sampling over 2 seconds (per the goal: ≥40, two bad rounds stop) ———
const fps = await page.evaluate(() => new Promise((resolve) => {
  let frames = 0
  const start = performance.now()
  const tick = () => {
    frames++
    const el = performance.now() - start
    if (el >= 2000) resolve(frames / (el / 1000))
    else requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}))
probe(`the physics map holds FPS ≥ 40 (rAF sample: ${fps.toFixed(1)})`, fps >= 40, `fps=${fps.toFixed(1)}`)

await page.close()

// ——— reduced motion: the static path (no physics, no canvases) ———
{
  const rpage = await browser.newPage({ viewport: { width: 1560, height: 940 }, reducedMotion: 'reduce' })
  await rpage.goto(`${base}/?token=${token}`, { waitUntil: 'domcontentloaded' })
  await rpage.waitForSelector('[data-dsh-lookatstudy-entry]', { timeout: 30000 })
  await rpage.click('[data-dsh-lookatstudy-entry]')
  await rpage.waitForSelector('.lks-ui', { timeout: 30000 })
  await rpage.waitForTimeout(3000)
  const noPhysics = await rpage.locator('.lks-mapfield.lks-physics').count()
  const noSky = await rpage.locator('.lks-sky-canvas').count()
  const staticRopes = await rpage.locator('.lks-mapropes path:not([data-rope])').count()
  probe('reduced-motion keeps the static path (no islands, no canvases)',
    noPhysics === 0 && noSky === 0 && staticRopes > 0,
    `physics=${noPhysics} sky=${noSky} staticRopes=${staticRopes}`)
  await rpage.close()
}

await browser.close()
const failed = results.filter(r => !r.ok)
console.log(`\nPROBE SUMMARY: ${results.length - failed.length}/${results.length} pass`)
process.exit(failed.length === 0 ? 0 : 1)

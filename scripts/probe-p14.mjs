/**
 * P14 live probes (D3 CanvasStage + board tab): the board mounts the latest
 * heavy artifact on a zoomable stage, the −/%/fit/+ toolbar drives the scale,
 * wheel zooms at the cursor, pointer drag pans (transform moves), double
 * click toggles fit↔100%, and the mermaid modal rides its own stage.
 * Usage: node scripts/probe-p14.mjs <token> [--url http://127.0.0.1:3081]
 */
import { createRequire } from 'node:module'

const token = process.argv[2]
if (token === undefined || token === '') {
  console.error('usage: node scripts/probe-p14.mjs <token> [--url base]')
  process.exit(2)
}
const baseIdx = process.argv.indexOf('--url')
const base = baseIdx > 0 ? process.argv[baseIdx + 1] : 'http://127.0.0.1:3081'
const LESSON = 'artificial-intelligence-for-beginners-a-curriculum:0:1'

const require = createRequire('D:/Users/kaiji/vibecodingKJ/clones/deepseek-ai/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/package.json')
const { chromium } = require('playwright')

const browser = await chromium.launch({ executablePath: 'C:/Users/kaiji/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe' })
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
await page.goto(`${base}/?token=${token}`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-dsh-lookatstudy-entry]', { timeout: 30000 })
await page.click('[data-dsh-lookatstudy-entry]')
await page.waitForSelector('.lks-ui', { timeout: 30000 })
await page.waitForTimeout(2500)
await fetch(`${base}/lookatstudy/api/focus?token=${token}`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ lessonId: LESSON }),
})
await page.waitForTimeout(3500)

const results = []
const probe = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === '' ? '' : ` — ${detail}`}`)
}
const pct = async () => (await page.locator('[data-testid="canvas-zoom-pct"]').first().textContent())?.trim() ?? ''
const transform = async () => await page.evaluate(() => {
  const el = document.querySelector('.lks14-stage-content')
  return el === null ? '' : el.style.transform
})

// ——— the board tab mounts the latest heavy artifact on the stage ———
await page.locator('.lks14-viewtab').nth(3).dispatchEvent('click')
await page.waitForTimeout(700)
const stage = await page.locator('[data-testid="board-canvas-stage"]').count()
const tools = await page.locator('[data-testid="canvas-zoom-controls"]').count()
// the board shows the LATEST heavy artifact (the seeded diagram, newest last)
const latestCard = await page.locator('[data-lks-artifact="probe-diagram-1"]').count()
const head = await page.locator('.lks14-board-head').textContent().catch(() => '')
const fitPct = await pct()
const tfFit = await transform()
probe('the board tab stages the latest heavy artifact with the floating toolbar',
  stage === 1 && tools === 1 && latestCard >= 1 && fitPct.endsWith('%'),
  `stage=${stage} tools=${tools} latestCard=${latestCard} head=${(head ?? '').trim().slice(0, 10)} fit=${fitPct} tf=${tfFit.slice(0, 30)}`)

// ——— toolbar: zoom in ×2 → pct up; zoom out → back; fit → the fit value ———
await page.locator('[data-testid="canvas-zoom-in"]').dispatchEvent('click')
await page.locator('[data-testid="canvas-zoom-in"]').dispatchEvent('click')
await page.waitForTimeout(350)
const zoomedPct = await pct()
await page.locator('[data-testid="canvas-zoom-out"]').dispatchEvent('click')
await page.waitForTimeout(350)
const outPct = await pct()
await page.locator('[data-testid="canvas-zoom-fit"]').dispatchEvent('click')
await page.waitForTimeout(350)
const refitPct = await pct()
const num = (s) => Number.parseInt(s, 10)
probe('the −/%/fit/+ toolbar drives the scale',
  num(zoomedPct) > num(fitPct) && num(outPct) < num(zoomedPct) && num(outPct) > num(fitPct) && refitPct === fitPct,
  `${fitPct} →+2→ ${zoomedPct} →−→ ${outPct} →fit→ ${refitPct}`)

// ——— wheel zoom anchors at the cursor (scale changes) ———
await page.evaluate(() => {
  const stage = document.querySelector('[data-testid="board-canvas-stage"]')
  stage?.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, clientX: 400, clientY: 300, bubbles: true, cancelable: true }))
})
await page.waitForTimeout(300)
const wheelPct = await pct()
probe('wheel zoom scales at the cursor', num(wheelPct) > num(refitPct), `${refitPct} →wheel→ ${wheelPct}`)

// ——— double-click toggles fit ↔ 100% ———
await page.locator('[data-testid="canvas-zoom-fit"]').dispatchEvent('click')
await page.waitForTimeout(300)
const basePct = await pct()
await page.locator('[data-testid="board-canvas-stage"]').dispatchEvent('dblclick')
await page.waitForTimeout(300)
const dblPct = await pct()
await page.locator('[data-testid="board-canvas-stage"]').dispatchEvent('dblclick')
await page.waitForTimeout(300)
const dbl2Pct = await pct()
probe('double click toggles fit ↔ 100%', dblPct === '100%' && dbl2Pct === basePct, `${basePct} →dbl→ ${dblPct} →dbl→ ${dbl2Pct}`)

// ——— pointer drag pans (at 100% the content overflows the view and the pan
// unlocks — at fit with narrow content the pan is correctly LOCKED centered,
// upstream's clampPan semantics)
await page.locator('[data-testid="board-canvas-stage"]').dispatchEvent('dblclick')
await page.waitForTimeout(300)
const tfAt100 = await transform()
await page.evaluate(() => {
  const stage = document.querySelector('[data-testid="board-canvas-stage"]')
  if (stage === null) return
  const opts = { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'mouse', isPrimary: true, button: 0 }
  const r = stage.getBoundingClientRect()
  const cx = r.left + r.width / 2
  const cy = r.top + r.height / 2
  stage.dispatchEvent(new PointerEvent('pointerdown', { ...opts, clientX: cx, clientY: cy }))
  stage.dispatchEvent(new PointerEvent('pointermove', { ...opts, clientX: cx + 60, clientY: cy + 40 }))
  stage.dispatchEvent(new PointerEvent('pointerup', { ...opts, clientX: cx + 60, clientY: cy + 40 }))
})
await page.waitForTimeout(300)
const tfAfter = await transform()
const at100X = Number.parseFloat(/translate\((-?[\d.]+)px/.exec(tfAt100)?.[1] ?? '0')
const afterX = Number.parseFloat(/translate\((-?[\d.]+)px/.exec(tfAfter)?.[1] ?? '0')
probe('pointer drag pans at 100% (locked centered at fit)', Math.abs(afterX - at100X) > 5, `tf ${tfAt100.slice(0, 26)} → ${tfAfter.slice(0, 26)}`)

// ——— the mermaid modal rides its own CanvasStage ———
await page.locator('.lks14-viewtab').nth(2).dispatchEvent('click') // notes tab (artifact cards)
await page.waitForTimeout(700)
const expandBtn = page.locator('.lks-acard-expand').first()
await expandBtn.dispatchEvent('click')
await page.waitForTimeout(800)
const modalStage = await page.locator('[data-testid="diagram-modal-stage"]').count()
const modalTools = await page.locator('[data-testid="diagram-modal-stage"] [data-testid="canvas-zoom-controls"]').count()
const modalPct = (await page.locator('[data-testid="diagram-modal-stage"] [data-testid="canvas-zoom-pct"]').textContent().catch(() => '')) ?? ''
probe('the mermaid modal expands onto its own zoomable stage',
  modalStage === 1 && modalTools === 1 && modalPct.endsWith('%'),
  `stage=${modalStage} tools=${modalTools} pct=${modalPct}`)
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

await browser.close()
const failed = results.filter(r => !r.ok)
console.log(`\nPROBE SUMMARY: ${results.length - failed.length}/${results.length} pass`)
process.exit(failed.length === 0 ? 0 : 1)

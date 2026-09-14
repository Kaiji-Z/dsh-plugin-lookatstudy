/** Live probes for the CanvasStage fixes (#12 modal flicker + #10-followup
 * board collapse). Runs against a booted web-lks profile (the cloned
 * web-lks2 on 3082) — NEVER part of pnpm run verify.
 *   A) the diagram 放大查看 modal: mermaid svg mounts exactly ONCE (the raw
 *      ref-callback used to re-render it on every 3s panel poll tick) and the
 *      stage-content rect stays stable across >= 2 poll ticks (sample 7s).
 *   B) the board's natural size does not collapse: >= 500px wide for BOTH the
 *      diagram-staged lesson and the compare_table-staged lesson (0.22.1
 *      measured tens of px — fit-content wrapping a width:100% table).
 *   C) the −/%/fit/+ toolbar still works in both the modal and the board.
 * Usage: node scripts/probe-canvasstage.mjs <token> [--url http://127.0.0.1:3082] */
import { createRequire } from 'node:module'

const token = process.argv[2]
if (token === undefined || token === '') {
  console.error('usage: node scripts/probe-canvasstage.mjs <token> [--url base]')
  process.exit(2)
}
const baseIdx = process.argv.indexOf('--url')
const base = baseIdx > 0 ? process.argv[baseIdx + 1] : 'http://127.0.0.1:3082'
const argAfter = (flag) => { const i = process.argv.indexOf(flag); return i > 0 ? process.argv[i + 1] : undefined }
// lesson ids printed by probe-canvasstage-seed.mjs (the slug is minted at seed
// time and depends on the live shared state's collisions — never hardcode)
const LESSON_A = argAfter('--a') // board stages the diagram
const LESSON_B = argAfter('--b') // board stages the compare_table
if (LESSON_A === undefined || LESSON_B === undefined) {
  console.error('usage: node scripts/probe-canvasstage.mjs <token> --a <lessonA> --b <lessonB> [--url base]')
  process.exit(2)
}

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
const focus = async (lessonId) => {
  // the dashboard self-gate (audit A2) requires the panel's own header on POSTs
  await fetch(`${base}/lookatstudy/api/focus?token=${token}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-lks-request': '1' },
    body: JSON.stringify({ lessonId }),
  })
  await page.waitForTimeout(3500)
}
const boardTab = async () => { await page.locator('.lks14-viewtab').nth(3).dispatchEvent('click'); await page.waitForTimeout(900) }
const notesTab = async () => { await page.locator('.lks14-viewtab').nth(2).dispatchEvent('click'); await page.waitForTimeout(900) }
const naturalSize = async () => {
  const t = (await page.locator('[data-testid="board-canvas-stage"] [data-testid="canvas-natural-size"]').textContent().catch(() => '')) ?? ''
  const m = /^(\d+)x(\d+)$/.exec(t.trim())
  return m === null ? { w: 0, h: 0, raw: t } : { w: Number(m[1]), h: Number(m[2]), raw: t }
}
const pct = (sel) => page.locator(`${sel} [data-testid="canvas-zoom-pct"]`).first().textContent().then(s => (s ?? '').trim()).catch(() => '')

// ——— B: the board's natural size does not collapse (both artifact kinds) ———
await focus(LESSON_B)
await boardTab()
const sizeTable = await naturalSize()
probe('B1 board natural size (compare_table staged) >= 500px', sizeTable.w >= 500,
  `natural=${sizeTable.raw}`)
await focus(LESSON_A)
await boardTab()
const sizeDiagram = await naturalSize()
probe('B2 board natural size (diagram staged) >= 500px', sizeDiagram.w >= 500,
  `natural=${sizeDiagram.raw}`)

// ——— A: the 放大查看 modal renders mermaid once and stays stable ———
await notesTab()
// count svg mounts inside the modal from BEFORE the click (initial render counts as 1)
await page.evaluate(() => {
  window.__probeSvgMounts = 0
  const seen = new WeakSet()
  const scan = (node) => {
    // only the MERMAID svg (inside .lks14-modal-diagram) — the modal's close
    // button and the zoom toolbar also mount icon svgs, exactly once each
    if (node instanceof Element && node.tagName.toLowerCase() === 'svg' && node.closest('.lks14-modal-diagram') !== null && !seen.has(node)) {
      seen.add(node)
      window.__probeSvgMounts += 1
    }
  }
  const obs = new MutationObserver(mutations => {
    for (const m of mutations) for (const n of m.addedNodes) {
      if (n instanceof Element) { scan(n); n.querySelectorAll?.('svg').forEach(scan) }
    }
  })
  obs.observe(document.body, { childList: true, subtree: true })
  window.__probeObs = obs
})
await page.locator('.lks-acard-expand').first().dispatchEvent('click')
await page.waitForSelector('[data-testid="diagram-modal-stage"]', { timeout: 10000 })
await page.waitForSelector('.lks-acard-modal svg', { timeout: 15000 }) // mermaid actually rendered (CDN)
await page.waitForTimeout(600)
// sample the stage-content rect for 7s (>= 2 poll ticks at POLL_MS=3000)
const sample = await page.evaluate(() => new Promise(resolve => {
  const rects = []
  const t0 = performance.now()
  const tick = () => {
    const el = document.querySelector('[data-testid="diagram-modal-stage"] .lks14-stage-content')
    if (el !== null) { const r = el.getBoundingClientRect(); rects.push([r.width, r.height]) }
    if (performance.now() - t0 < 7000) requestAnimationFrame(tick)
    else resolve(rects)
  }
  requestAnimationFrame(tick)
}))
const mounts = await page.evaluate(() => window.__probeSvgMounts)
await page.evaluate(() => { window.__probeObs?.disconnect() })
const ws = sample.map(r => r[0])
const hs = sample.map(r => r[1])
const dW = sample.length === 0 ? -1 : Math.max(...ws) - Math.min(...ws)
const dH = sample.length === 0 ? -1 : Math.max(...hs) - Math.min(...hs)
probe('A1 modal mermaid svg mounts exactly once (no poll-tick re-renders)', mounts === 1,
  `svgMounts=${mounts} samples=${sample.length}`)
probe('A2 modal stage-content rect stable over 7s (<0.5px)', dW < 0.5 && dH < 0.5,
  `dW=${dW.toFixed(2)} dH=${dH.toFixed(2)}`)

// ——— C: the toolbar still works in the modal, then on the board ———
const num = s => Number.parseInt(s, 10)
const modalFit = await pct('[data-testid="diagram-modal-stage"]')
await page.locator('[data-testid="diagram-modal-stage"] [data-testid="canvas-zoom-in"]').dispatchEvent('click')
await page.locator('[data-testid="diagram-modal-stage"] [data-testid="canvas-zoom-in"]').dispatchEvent('click')
await page.waitForTimeout(350)
const modalZoomed = await pct('[data-testid="diagram-modal-stage"]')
await page.locator('[data-testid="diagram-modal-stage"] [data-testid="canvas-zoom-out"]').dispatchEvent('click')
await page.waitForTimeout(350)
const modalOut = await pct('[data-testid="diagram-modal-stage"]')
await page.locator('[data-testid="diagram-modal-stage"] [data-testid="canvas-zoom-fit"]').dispatchEvent('click')
await page.waitForTimeout(350)
const modalRefit = await pct('[data-testid="diagram-modal-stage"]')
probe('C1 modal toolbar −/%/fit/+ drives the scale',
  num(modalZoomed) > num(modalFit) && num(modalOut) < num(modalZoomed) && modalRefit === modalFit,
  `${modalFit} →+2→ ${modalZoomed} →−→ ${modalOut} →fit→ ${modalRefit}`)
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

await boardTab()
const boardFit = await pct('[data-testid="board-canvas-stage"]')
await page.locator('[data-testid="board-canvas-stage"] [data-testid="canvas-zoom-in"]').dispatchEvent('click')
await page.waitForTimeout(350)
const boardZoomed = await pct('[data-testid="board-canvas-stage"]')
await page.locator('[data-testid="board-canvas-stage"] [data-testid="canvas-zoom-fit"]').dispatchEvent('click')
await page.waitForTimeout(350)
const boardRefit = await pct('[data-testid="board-canvas-stage"]')
probe('C2 board toolbar −/%/fit/+ drives the scale',
  num(boardZoomed) > num(boardFit) && boardRefit === boardFit,
  `${boardFit} →+→ ${boardZoomed} →fit→ ${boardRefit}`)

await browser.close()
const failed = results.filter(r => !r.ok)
console.log(`\nPROBE SUMMARY: ${results.length - failed.length}/${results.length} pass`)
process.exit(failed.length === 0 ? 0 : 1)

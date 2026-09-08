/**
 * P17 live probe (host-capability replacements): ContextMeter renders (the
 * projection value or the labeled estimate), the model chip carries the bound
 * thread's model, thread pills mark the current thread, Cmd+K opens the
 * palette (lesson/course/action rows, Esc closes), A−/A+ steps and persists
 * the zoom, the attachment route lands files verbatim (API roundtrip), and
 * the history-budget flag round-trips through the state feed.
 * Usage: node scripts/probe-p17.mjs <token> [--url http://127.0.0.1:3081]
 */
import { createRequire } from 'node:module'

const token = process.argv[2]
if (token === undefined || token === '') {
  console.error('usage: node scripts/probe-p17.mjs <token> [--url base]')
  process.exit(2)
}
const baseIdx = process.argv.indexOf('--url')
const base = baseIdx > 0 ? process.argv[baseIdx + 1] : 'http://127.0.0.1:3081'

const require = createRequire('D:/Users/kaiji/vibecodingKJ/clones/deepseek-ai/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/package.json')
const { chromium } = require('playwright')

const results = []
const probe = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === '' ? '' : ` — ${detail}`}`)
}

// ——— API roundtrips: the attachment intake + the budget flag ———
const up = await (await fetch(`${base}/lookatstudy/api/attachment`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'p17-probe.txt', dataBase64: Buffer.from('p17 attachment probe').toString('base64') }),
})).json()
probe('E3: the attachment intake lands files verbatim in the workspace', up.ok === true && typeof up.path === 'string' && up.path.startsWith('attachments/'), `path=${up.path ?? 'none'} bytes=${up.bytes ?? '?'}`)
const badUp = await (await fetch(`${base}/lookatstudy/api/attachment`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: '../evil.txt', dataBase64: 'eA==' }),
})).json()
probe('E3: path-traversal names are rejected', badUp.ok === false, `error="${String(badUp.error).slice(0, 40)}"`)

const budgetOn = await (await fetch(`${base}/lookatstudy/api/budget`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on: true }),
})).json()
const state1 = await (await fetch(`${base}/lookatstudy/api/state`)).json()
const budgetOff = await (await fetch(`${base}/lookatstudy/api/budget`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on: false }),
})).json()
probe('E2: the history-budget flag round-trips through the feed', budgetOn.on === true && state1.historyBudget === true && budgetOff.on === false, `on=${String(budgetOn.on)} feed=${String(state1.historyBudget)} off=${String(budgetOff.on)}`)

const browser = await chromium.launch({ executablePath: 'C:/Users/kaiji/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe' })
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
await page.goto(`${base}/?token=${token}`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-dsh-lookatstudy-entry]', { timeout: 30000 })
await page.click('[data-dsh-lookatstudy-entry]')
await page.waitForSelector('.lks-ui', { timeout: 30000 })
await page.waitForTimeout(2500)

// ——— E6: the model chip ———
const chip = await page.evaluate(() => document.querySelector('[data-testid="model-face-chip"]')?.textContent ?? null)
probe('E6: the model chip shows the bound thread\'s model', chip !== null && chip.length > 2, `chip="${String(chip).slice(0, 40)}"`)

// ——— E5: the thread chip + menu ———
const chipLabel = await page.evaluate(() => document.querySelector('.lks14-threadchip')?.textContent ?? null)
let menuRows = -1
let menuMarked = false
if (chipLabel !== null) {
  await page.click('.lks14-threadchip')
  await page.waitForTimeout(300)
  const menu = await page.evaluate(() => ({
    open: document.querySelector('.lks14-threadmenu') !== null,
    rows: [...document.querySelectorAll('.lks14-threadmenu-row')].map(r => ({ on: r.classList.contains('on'), now: r.querySelector('.lks14-threadmenu-now') !== null })),
  }))
  menuRows = menu.rows.length
  menuMarked = menu.rows.some(r => r.on && r.now)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)
}
probe('E5: the thread chip opens a menu that marks the current thread', chipLabel !== null && menuRows >= 1 && menuMarked, `chip="${String(chipLabel).slice(0, 24)}" rows=${menuRows} marked=${menuMarked}`)

// ——— E1: the context meter (gated on rows, so AFTER a thread jump) ———
if (chipLabel !== null) {
  await page.click('.lks14-threadchip')
  await page.waitForTimeout(300)
  await page.locator('.lks14-threadmenu-row').first().click()
  await page.waitForTimeout(3000)
}
const meter = await page.evaluate(() => {
  const el = document.querySelector('[data-testid="context-meter"]')
  return el === null ? null : { estimated: el.getAttribute('data-estimated'), label: el.querySelector('.lks14-ctxmeter-label')?.textContent ?? '' }
})
probe('E1: the context meter rides the composer (projection or labeled estimate)', meter !== null && meter.label !== '', `estimated=${meter?.estimated} label="${meter?.label.slice(0, 40)}"`)

// ——— E4: Cmd+K palette ———
await page.keyboard.press('Control+KeyK')
await page.waitForTimeout(500)
const paletteOpen = await page.evaluate(() => document.querySelector('[data-testid="command-palette"]') !== null)
const rows = await page.evaluate(() => document.querySelectorAll('.lks14-palette-row').length)
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
const paletteClosed = await page.evaluate(() => document.querySelector('[data-testid="command-palette"]') === null)
probe('E4: Cmd+K opens the palette (rows render) and Esc closes', paletteOpen && rows >= 2 && paletteClosed, `open=${paletteOpen} rows=${rows} closed=${paletteClosed}`)

// ——— E7: the font scale ———
const zoomBefore = await page.evaluate(() => getComputedStyle(document.querySelector('.lks-ui')).zoom)
await page.click('.lks-hdr-zoom-btn[aria-label*="放大"], .lks-hdr-zoom-btn[aria-label*="Increase"]')
await page.waitForTimeout(300)
const zoomAfter = await page.evaluate(() => getComputedStyle(document.querySelector('.lks-ui')).zoom)
const persisted = await page.evaluate(() => localStorage.getItem('dsh-plugin-lookatstudy:zoom'))
await page.click('.lks-hdr-zoom-btn[aria-label*="缩小"], .lks-hdr-zoom-btn[aria-label*="Decrease"]')
await page.waitForTimeout(200)
probe('E7: A+ steps the zoom and persists it', Number(zoomBefore) < Number(zoomAfter) && persisted === '1.1', `zoom ${zoomBefore}→${zoomAfter} stored=${persisted}`)

await browser.close()
const failed = results.filter(r => !r.ok)
console.log(`\nPROBE SUMMARY: ${results.length - failed.length}/${results.length} pass`)
process.exit(failed.length === 0 ? 0 : 1)

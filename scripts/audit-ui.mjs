/**
 * A10 · the panel skin audit gate (P10a): walk every element inside .lks-ui on
 * the live web-lks panel and flag color islands — anything whose background /
 * text / border still resolves to a host-light value instead of the upstream
 * dark palette. Exit 0 iff zero suspects.
 *
 * False-positive guards (learned from the first live audit round):
 *   - borders only count when border-style isn't none (computed borderColor
 *     reports junk otherwise);
 *   - saturated light backgrounds are brand/gold/review hues by design
 *     (mastery fills, gold signpost coins, name plates) — exempt;
 *   - dark text on the element's OWN saturated-light bg is intentional
 *     (coin numbers, .best rating) — exempt.
 *
 * Usage: node scripts/audit-ui.mjs <token> [--url http://127.0.0.1:3081] [--theme light|dark]
 * P16: --theme selects the expectation set AND asserts the panel follows the
 * host (data-lks-theme matches). Light mode inverts the flags — dark
 * backgrounds / light text outside the (legitimately dark) rail column are
 * the suspects; the rail keeps the dark allowlist in both themes.
 */
import { createRequire } from 'node:module'

const token = process.argv[2]
if (token === undefined || token === '') {
  console.error('usage: node scripts/audit-ui.mjs <token> [--url base]')
  process.exit(2)
}
const baseIdx = process.argv.indexOf('--url')
const base = baseIdx > 0 ? process.argv[baseIdx + 1] : 'http://127.0.0.1:3081'
const themeIdx = process.argv.indexOf('--theme')
const mode = themeIdx > 0 ? process.argv[themeIdx + 1] : 'dark'
if (mode !== 'light' && mode !== 'dark') {
  console.error('--theme must be light or dark')
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
// P16: the theme service resolves the persisted preference ASYNC (the panel
// mounts on the default and follows theme/change a beat later) — wait for the
// follow to settle before auditing, or the walk races a stale skin.
for (let i = 0; i < 20; i++) {
  const settled = await page.evaluate((m) => {
    const el = document.querySelector('.lks-ui')
    return el !== null && el.getAttribute('data-lks-theme') === m
  }, mode)
  if (settled) break
  await page.waitForTimeout(500)
}
await page.waitForTimeout(800)

const audit = await page.evaluate((mode) => {
  const DARK_SURFACES = new Set(['rgb(8, 9, 11)', 'rgb(12, 13, 15)', 'rgb(17, 17, 20)', 'rgb(26, 26, 29)', 'rgb(42, 43, 46)'])
  const LIGHT_SURFACES = new Set(['rgb(241, 242, 244)', 'rgb(255, 255, 255)', 'rgb(248, 248, 248)', 'rgb(234, 235, 237)'])
  const inRail = (el) => el.closest('.lks14-rail') !== null
  const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b
  const sat = (r, g, b) => Math.max(r, g, b) - Math.min(r, g, b)
  const parse = (v) => {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(v ?? '')
    return m === null ? null : { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] }
  }
  const root = document.querySelector('.lks-ui')
  const hits = new Map()
  for (const el of root.querySelectorAll('*')) {
    const cs = getComputedStyle(el)
    const bg = parse(cs.backgroundColor)
    const bgSaturatedLight = bg !== null && bg.a > 0.5 && lum(bg.r, bg.g, bg.b) > 40 && sat(bg.r, bg.g, bg.b) > 60
    const note = []
    const railDarkOk = mode === 'light' && inRail(el)
    if (mode === 'dark') {
      if (bg !== null && bg.a > 0.85 && !DARK_SURFACES.has(`rgb(${bg.r}, ${bg.g}, ${bg.b})`) && lum(bg.r, bg.g, bg.b) > 40 && !bgSaturatedLight) {
        note.push(`lightbg ${cs.backgroundColor}`)
      }
      const tx = parse(cs.color)
      if (tx !== null && tx.a > 0.5 && lum(tx.r, tx.g, tx.b) < 90 && sat(tx.r, tx.g, tx.b) <= 60 && !bgSaturatedLight) {
        note.push(`darktext ${cs.color}`)
      }
      if (cs.borderStyle !== 'none' && parseFloat(cs.borderTopWidth) > 0) {
        const bd = parse(cs.borderTopColor)
        if (bd !== null && bd.a > 0.5 && lum(bd.r, bd.g, bd.b) > 120 && sat(bd.r, bd.g, bd.b) <= 60) note.push(`lightborder ${cs.borderTopColor}`)
      }
    } else {
      // light: outside the dark-locked rail, dark backgrounds and light text
      // are the islands; the rail is exempt (dark by design, own rules).
      if (!railDarkOk && bg !== null && bg.a > 0.85 && !LIGHT_SURFACES.has(`rgb(${bg.r}, ${bg.g}, ${bg.b})`) && lum(bg.r, bg.g, bg.b) < 40 && !bgSaturatedLight) {
        note.push(`darkbg ${cs.backgroundColor}`)
      }
      const tx = parse(cs.color)
      if (!railDarkOk && tx !== null && tx.a > 0.5 && lum(tx.r, tx.g, tx.b) > 200 && sat(tx.r, tx.g, tx.b) <= 60 && !bgSaturatedLight) {
        note.push(`lighttext ${cs.color}`)
      }
      if (!railDarkOk && cs.borderStyle !== 'none' && parseFloat(cs.borderTopWidth) > 0) {
        const bd = parse(cs.borderTopColor)
        if (bd !== null && bd.a > 0.5 && lum(bd.r, bd.g, bd.b) < 40 && sat(bd.r, bd.g, bd.b) <= 60) note.push(`darkborder ${cs.borderTopColor}`)
      }
    }
    if (note.length === 0) continue
    const raw = String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className).trim()
    const key = el.tagName.toLowerCase() + (raw === '' ? '' : '.' + raw.split(/\s+/).slice(0, 3).join('.'))
    const prev = hits.get(key) ?? { count: 0, why: new Set() }
    prev.count++
    for (const n of note) prev.why.add(n.replace(/rgba?\([^)]*\)/, ''))
    hits.set(key, prev)
  }
  const suspects = [...hits.entries()].sort((a, b) => b[1].count - a[1].count)
    .map(([k, v]) => `${k} x${String(v.count)} [${[...v.why].join(', ')}]`)
  const rootEl = document.querySelector('.lks-ui')
  return {
    mode,
    panelTheme: rootEl === null ? null : rootEl.getAttribute('data-lks-theme'),
    hostDark: document.body.hasAttribute('data-ds-dark-theme') || /dark/i.test(document.documentElement.style.colorScheme ?? ''),
    suspectCount: suspects.length,
    suspects,
  }
}, mode)
await browser.close()
console.log(JSON.stringify(audit, null, 1))
const follows = audit.panelTheme === mode && (mode === 'dark') === audit.hostDark
if (!follows) console.error(`THEME FOLLOW FAILED: panel=${String(audit.panelTheme)} expected=${mode} hostDark=${String(audit.hostDark)}`)
process.exit(audit.suspectCount === 0 && follows ? 0 : 1)

/** 0.25.3 live probes: the owner's read-aloud + notebook round — (1) the view
 * tabs pin at the note column's top while content scrolls, (2) all four tabs
 * carry icons, (3) the notebook fills the column width, (4) read-aloud
 * follows the displayed view (译文 view reads the translation, view switch
 * stops), (5) the karaoke highlight registers (CSS.highlights) and the
 * readbar advances. Fixture: a translated lesson with several sentences.
 * Usage: node scripts/probe-0253.mjs <token> [--url http://127.0.0.1:3081]
 */
import { createRequire } from 'node:module'

const token = process.argv[2]
if (token === undefined || token === '') {
  console.error('usage: node scripts/probe-0253.mjs <token> [--url base]')
  process.exit(2)
}
const baseIdx = process.argv.indexOf('--url')
const base = baseIdx > 0 ? process.argv[baseIdx + 1] : 'http://127.0.0.1:3081'

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

// switch to the fixture course and focus the translated lesson
await page.keyboard.press('Control+k')
await page.waitForTimeout(500)
await page.locator('.lks14-palette-row', { hasText: '朗读探针课' }).first().dispatchEvent('click')
await page.waitForTimeout(2000)
await page.locator('[data-node-id$=":0:0"]').first().dispatchEvent('click')
await page.waitForTimeout(6500)
await page.locator('.lks14-viewtab').nth(0).dispatchEvent('click')
await page.waitForTimeout(1200)

// ——— 1/2/3: pinned tabs, icons, full width ———
const ui = await page.evaluate(() => {
  const tabs = document.querySelector('.lks14-viewtabs')
  const note = document.querySelector('.lks14-note')
  const body = document.querySelector('.lks14-notebody')
  if (tabs === null || note === null || body === null) return null
  const icons = [...tabs.querySelectorAll('button')].map(b => b.querySelector('svg') !== null)
  return {
    sticky: getComputedStyle(tabs).position,
    top: getComputedStyle(tabs).top,
    iconCount: icons.filter(Boolean).length,
    tabCount: icons.length,
    bodyW: Math.round(body.getBoundingClientRect().width),
    noteW: Math.round(note.getBoundingClientRect().width),
  }
})
probe('the view tabs are position:sticky pinned at the scroller top', ui !== null && ui.sticky === 'sticky' && ui.top === '0px', ui === null ? 'no tabs' : `${ui.sticky} ${ui.top}`)
const before = await page.evaluate(() => document.querySelector('.lks14-note')?.scrollTop ?? 0)
await page.evaluate(() => { const n = document.querySelector('.lks14-note'); if (n !== null) n.scrollTop = 600 })
await page.waitForTimeout(400)
const pinned = await page.evaluate(() => {
  const t = document.querySelector('.lks14-viewtabs')?.getBoundingClientRect()
  const n = document.querySelector('.lks14-note')?.getBoundingClientRect()
  return { top: t?.top ?? -1, noteTop: n?.top ?? -1 }
})
probe('the tab bar stays pinned while the notebook scrolls', Math.abs(pinned.top - pinned.noteTop) < 4, `tabTop=${Math.round(pinned.top)} noteTop=${Math.round(pinned.noteTop)}`)
probe('every view tab carries an icon', ui !== null && ui.iconCount === ui.tabCount && ui.tabCount === 4, `icons=${ui?.iconCount}/${ui?.tabCount}`)
probe('the notebook fills the column width', ui !== null && Math.abs(ui.bodyW - ui.noteW) <= 2, `body=${ui?.bodyW} note=${ui?.noteW}`)

// ——— 4/5: read-aloud follows the view; karaoke registers ———
await page.evaluate(() => { const n = document.querySelector('.lks14-note'); if (n !== null) n.scrollTop = 0 })
await page.waitForTimeout(300)
await page.locator('[data-testid="langview-translation"]').dispatchEvent('click')
await page.waitForTimeout(600)
// start reading (the 朗读 button — first ghost button in the readbar)
await page.locator('.lks-readbar .lks-btn.ghost').first().dispatchEvent('click')
await page.waitForTimeout(3500)
const readState = await page.evaluate(() => {
  const cssLike = CSS
  const karaoke = cssLike.highlights?.has('lks-reading') ?? false
  const cur = document.querySelector('.lks-readbar-cur')?.textContent ?? ''
  return { karaoke, cur: cur.slice(0, 40) }
})
probe('karaoke: the speaking sentence registers a CSS highlight', readState.karaoke, `highlights.has=${readState.karaoke}`)
probe('read-aloud reads the DISPLAYED view (zh text in 译文 view — the original is English)', /[一-鿿]/.test(readState.cur), `cur=${readState.cur}`)
await page.locator('[data-testid="langview-original"]').dispatchEvent('click')
await page.waitForTimeout(600)
const stopped = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('.lks-readbar .lks-btn.ghost')].map(b => b.textContent ?? '')
  return { playing: btns.some(t => t.includes('暂停') || t.includes('Pause')), highlights: CSS.highlights?.has('lks-reading') ?? false }
})
probe('switching the view mid-read stops the read cleanly', !stopped.playing && !stopped.highlights, `playing=${stopped.playing} highlight=${stopped.highlights}`)

await browser.close()
const failed = results.filter(r => !r.ok)
console.log(`\nPROBE SUMMARY: ${results.length - failed.length}/${results.length} pass`)
process.exit(failed.length === 0 ? 0 : 1)

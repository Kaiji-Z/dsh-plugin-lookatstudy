/** Read-only rail-scroll diagnosis: against the real long course, scroll the
 * rail to its bottom and measure whether the last content is actually inside
 * the visible rail (the owner reports unreachable overflow at any height). */
const token = process.argv[2]
const { createRequire } = await import('node:module')
const require = createRequire('D:/Users/kaiji/vibecodingKJ/clones/deepseek-ai/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/package.json')
const { chromium } = require('playwright')
const browser = await chromium.launch({ executablePath: 'C:/Users/kaiji/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe' })
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
await page.goto('http://127.0.0.1:3081/?token=' + token, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-dsh-lookatstudy-entry]', { timeout: 30000 })
await page.click('[data-dsh-lookatstudy-entry]')
await page.waitForSelector('.lks-ui', { timeout: 30000 })
await page.waitForTimeout(2500)
// switch to the 77-lesson course via the palette
await page.keyboard.press('Control+k')
await page.waitForTimeout(500)
await page.locator('.lks14-palette-row', { hasText: 'Generative AI' }).first().dispatchEvent('click')
await page.waitForTimeout(2500)
const m = await page.evaluate(() => {
  const sc = document.querySelector('.lks14-railscroll')
  const rail = document.querySelector('.lks14-rail')
  if (sc === null || rail === null) return { error: 'no rail' }
  sc.scrollTop = sc.scrollHeight
  const last = [...sc.querySelectorAll('*')].filter(el => el.children.length === 0).at(-1) ?? sc.lastElementChild
  const rows = sc.querySelectorAll('.lks-lessorow')
  const lastRow = rows[rows.length - 1]
  const r = (el) => { const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height) } }
  return {
    scroll: { scrollHeight: sc.scrollHeight, clientHeight: sc.clientHeight, scrollTopMax: sc.scrollTop, padBottom: getComputedStyle(sc).paddingBottom, boxSizing: getComputedStyle(sc).boxSizing },
    railRect: r(rail), scRect: r(sc),
    lastRowRect: lastRow === undefined ? null : r(lastRow),
    lastLeaf: last === null ? null : { tag: last.tagName, text: (last.textContent ?? '').slice(0, 24), ...r(last) },
    rowCount: rows.length,
  }
})
console.log(JSON.stringify(m, null, 1))
await browser.close()

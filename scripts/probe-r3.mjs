/** 0.19 R3 probe: raw host internals never render in the panel DOM (the
 * friendlyError mapping is unit-tested — face.prompt resolves at queue time,
 * so a live forced-send-error is not reproducible offline); the read-aloud
 * toggle rests as an icon; the notebook meta carries no duplicated mastery. */
import { createRequire } from 'node:module'
const req = createRequire('D:/Users/kaiji/vibecodingKJ/clones/deepseek-ai/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/package.json')
const { chromium } = req('playwright')
const token = process.argv[2]
const base = 'http://127.0.0.1:3081'
const browser = await chromium.launch({ executablePath: 'C:/Users/kaiji/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe' })
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
await page.goto(`${base}/?token=${token}`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-dsh-lookatstudy-entry]', { timeout: 30000 })
await page.click('[data-dsh-lookatstudy-entry]')
await page.waitForSelector('.lks-lessorow', { timeout: 30000 })
await page.waitForTimeout(1000)
await fetch(`${base}/lookatstudy/api/focus?token=${token}`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ lessonId: 'artificial-intelligence-for-beginners-a-curriculum:0:0' }),
})
await page.waitForTimeout(3000)

/* 1. the whole panel DOM: no raw host internals anywhere */
const rawLeak = await page.evaluate(() => /prompt rejected|cannot get property|ERR_MODULE|WebSocket is closed/i.test(document.body.textContent ?? ''))
console.log(`dom-raw-leak: ${String(rawLeak)}`)

/* 2. read-aloud toggle: at rest the label span is display:none */
let audio = { present: false, labelDisplay: null, hasIcon: false }
for (let i = 0; i < 16; i++) {
  await page.waitForTimeout(1000)
  audio = await page.evaluate(() => {
    const btn = document.querySelector('.lks-audio-toggle')
    if (btn === null) return { present: false }
    const label = btn.querySelector('.lks-audio-label')
    const disp = label === null ? null : getComputedStyle(label).display
    return { present: true, labelDisplay: disp, hasIcon: btn.querySelector('svg') !== null }
  })
  if (audio.present) break
}
console.log(`audio-rest: ${JSON.stringify(audio)}`)

/* 3. notebook meta: no duplicated mastery segment */
const meta = await page.evaluate(() => {
  const el = document.querySelector('.lks14-lessonhead .lks14-meta')
  return el === null ? null : (el.textContent ?? '')
})
const dupMastery = meta === null ? null : (meta.match(/掌握度/g) ?? []).length > 1
console.log(`meta: ${JSON.stringify(meta)} dupMastery=${String(dupMastery)}`)

await browser.close()
const pass = rawLeak === false && audio.present === true && audio.labelDisplay === 'none' && audio.hasIcon === true && dupMastery === false
process.exit(pass ? 0 : 1)

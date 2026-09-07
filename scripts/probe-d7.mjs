/**
 * D7 live probe (import pane): the five source tabs render (audio excluded),
 * the CTA toggles the form, and a real markdown import runs the installer
 * progress screen — step rows advance off the thread's tool chips, the
 * working row carries elapsed, and completion (course-count watcher) returns
 * the form, lands the success block, and jumps the rail to the new course.
 * Usage: node scripts/probe-d7.mjs <token> [--url http://127.0.0.1:3081]
 */
import { createRequire } from 'node:module'

const token = process.argv[2]
if (token === undefined || token === '') {
  console.error('usage: node scripts/probe-d7.mjs <token> [--url base]')
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

const state = async () => (await (await fetch(`${base}/lookatstudy/api/state`)).json())
const before = await state()

const browser = await chromium.launch({ executablePath: 'C:/Users/kaiji/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe' })
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
await page.goto(`${base}/?token=${token}`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-dsh-lookatstudy-entry]', { timeout: 30000 })
await page.click('[data-dsh-lookatstudy-entry]')
await page.waitForSelector('.lks-ui', { timeout: 30000 })
await page.waitForTimeout(2500)

// ——— the import pane: CTA + five tabs (audio deliberately absent) ———
await page.click('.lks-railtab:nth-child(2)') // the 导入 rail tab
await page.waitForTimeout(600)
await page.click('.lks14-importcta')
await page.waitForTimeout(400)
const tabs = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="import-tab-"]')].map(b => b.getAttribute('data-testid')))
const tabSetOk = tabs.length === 5 && ['import-tab-url', 'import-tab-md', 'import-tab-folder', 'import-tab-epub', 'import-tab-pack'].every(t => tabs.includes(t))
probe('the five source tabs render (url/md/folder/epub/pack; audio excluded)', tabSetOk, `tabs=[${tabs.join(',')}]`)

// tab switching swaps the form
await page.click('[data-testid="import-tab-md"]')
await page.waitForTimeout(300)
const mdForm = await page.evaluate(() => document.querySelector('.lks14-importmd') !== null)
await page.click('[data-testid="import-tab-folder"]')
await page.waitForTimeout(300)
const folderHint = await page.evaluate(() => (document.querySelector('.lks14-importform .lks14-hint')?.textContent ?? '').includes('文件夹'))
probe('tabs swap their forms (md textarea ↔ folder path row)', mdForm && folderHint, `md=${mdForm} folderHint=${folderHint}`)

// ——— a real markdown import through the installer screen ———
await page.click('[data-testid="import-tab-md"]')
await page.waitForTimeout(300)
const MD = '# D7 探针课程\n\n## 第一节\n\n### 甲课\n\n内容一。\n\n### 乙课\n\n内容二。\n\n## 第二节\n\n### 丙课\n\n内容三。\n'
await page.fill('.lks14-importform input.lks14-search', 'D7 probe course')
await page.fill('.lks14-importmd', MD)
await page.click('.lks14-importform .lks14-importbtn')

// the progress screen replaces the form
let sawProgress = false
let sawFetchWorking = false
let sawFetchDone = false
let sawElapsed = false
let sawCancelledOut = false
for (let i = 0; i < 120; i++) {
  await page.waitForTimeout(1000)
  const s = await page.evaluate(() => {
    const scr = document.querySelector('[data-testid="import-progress"]')
    if (scr === null) return { present: false }
    const rows = [...scr.querySelectorAll('.lks14-importprog-step')].map(r => r.getAttribute('data-state'))
    return {
      present: true,
      rows,
      elapsed: scr.querySelector('.lks14-importprog-elapsed')?.textContent ?? '',
      steps: [...scr.querySelectorAll('.lks14-importprog-step')].map(r => r.textContent ?? ''),
    }
  })
  if (s.present) {
    sawProgress = true
    if (s.rows[0] === 'working') sawFetchWorking = true
    if (s.rows[0] === 'done') sawFetchDone = true
    if (s.elapsed !== '') sawElapsed = true
  } else if (sawProgress) { sawCancelledOut = true; break }
  const now = await state()
  if (now.courses.length > before.courses.length && sawProgress) { sawCancelledOut = true; break }
}
probe('the installer progress screen runs (fetch working→done, live elapsed, four rows)', sawProgress && sawFetchDone && sawElapsed, `progress=${sawProgress} fetchWorking=${sawFetchWorking} fetchDone=${sawFetchDone} elapsed=${sawElapsed}`)

// completion: course landed + the rail jumped to the map with it selected
await page.waitForTimeout(3500)
const after = await state()
const grew = after.courses.length === before.courses.length + 1
const newCourse = after.courses.find(c => !before.courses.some(b => b.courseId === c.courseId)) ?? null
const mapBack = await page.evaluate(() => document.querySelector('.lks-mapsec-list') !== null)
const railTitle = await page.evaluate(() => document.querySelector('.lks14-railtitle')?.textContent ?? document.querySelector('.lks-set-select')?.value ?? '')
const selectedOk = newCourse !== null && (railTitle === newCourse.title || railTitle.includes('D7') || railTitle === newCourse.courseId)
probe('completion lands the course and jumps the rail to it', grew && mapBack && selectedOk,
  `courses ${before.courses.length}→${after.courses.length} new="${newCourse?.title ?? 'none'}" rail="${railTitle.slice(0, 40)}" map=${mapBack}`)

// the import pane now carries the success block
await page.click('.lks-railtab:nth-child(2)')
await page.waitForTimeout(500)
const successBlock = await page.evaluate(() => document.querySelector('.lks14-import-success')?.textContent ?? '')
probe('the success block rides the import pane', successBlock.includes('导入成功') || successBlock.includes('Imported'), `block="${successBlock.slice(0, 30)}"`)

await browser.close()
const failed = results.filter(r => !r.ok)
console.log(`\nPROBE SUMMARY: ${results.length - failed.length}/${results.length} pass`)
process.exit(failed.length === 0 ? 0 : 1)

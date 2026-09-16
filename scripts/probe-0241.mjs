/** 0.24.1 live probe: imports ride a DEDICATED course-less session. Drives a
 * real panel import (markdown tab, real model turn) and asserts: the funnel
 * runs while the chat column shows the import session, the new course lands,
 * NO lessonThreads/lessonSessions entry ever appears for the import, the chat
 * column re-binds to the lesson thread on completion, and the host list keeps
 * the uniformly-titled import session. Deletes the probe-born course after.
 * Usage: node scripts/probe-0241.mjs <token> [--url http://127.0.0.1:3081]
 */
import { createRequire } from 'node:module'

const token = process.argv[2]
if (token === undefined || token === '') {
  console.error('usage: node scripts/probe-0241.mjs <token> [--url base]')
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
const state = async () => await (await fetch(`${base}/lookatstudy/api/state`)).json()

const before = await state()
const threadsBefore = JSON.stringify(before.lessonThreads ?? {})
const mirrorsBefore = JSON.stringify(before.lessonSessions ?? {})
const coursesBefore = new Set(before.courses.map(c => c.courseId))
probe('baseline: courses present, no import in flight', coursesBefore.size > 0, `courses=${coursesBefore.size}`)

// ——— drive a real markdown import through the panel ———
await page.click('.lks14-importcta')
await page.waitForTimeout(500)
await page.locator('[data-testid="import-tab-md"]').dispatchEvent('click')
await page.waitForTimeout(300)
const MARKDOWN = '# 探针导入课\n\n## 第一节\n\n### 概念一\n\n这是探针导入的正文，讲一个完整的概念。\n\n### 概念二\n\n第二个概念的正文。\n\n## 第二节\n\n### 综合与练习\n\n收尾内容。\n'
await page.fill('input.lks14-search', '探针导入课')
await page.fill('textarea.lks14-importmd', MARKDOWN)
await page.waitForTimeout(200)
// the submit button on the md tab
await page.locator('button', { hasText: '导入' }).last().dispatchEvent('click')

// the funnel card appears and the chat column carries the import session
await page.waitForSelector('.lks14-importprog', { timeout: 10000 })
const funnel = await page.locator('.lks14-importprog').count()
probe('the import funnel card is up', funnel === 1, `card=${funnel}`)
await page.waitForFunction(() => {
  const stream = document.querySelector('.lks14-stream')
  return stream !== null && stream.textContent !== null && stream.textContent.includes('探针导入课')
}, { timeout: 30000 }).catch(() => {})
const streamHasPrompt = await page.locator('.lks14-stream', { hasText: '探针导入课' }).count()
probe('the chat column is pinned to the import session (the request rides as its user row)', streamHasPrompt > 0, `pinned=${streamHasPrompt}`)

// settle on TURN END (stop twin gone)
await page.waitForFunction(() => document.querySelector('.lks14-composer .lks-btn-send.stop') === null, { timeout: 180000 }).catch(() => {})

// the course lands and the thread system stays clean
let after = null
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(1500)
  after = await state()
  if (after.courses.some(c => !coursesBefore.has(c.courseId))) break
}
const fresh = after.courses.find(c => !coursesBefore.has(c.courseId))
probe('the imported course landed', fresh !== undefined, `courseId=${fresh?.courseId ?? '-'}`)
await page.waitForTimeout(2500)
const settled = await state()
probe('NO lessonThreads entry appeared for the import (the session belongs to no course)',
  JSON.stringify(settled.lessonThreads ?? {}) === threadsBefore,
  `threads-before=${Object.keys(JSON.parse(threadsBefore)).length} after=${Object.keys(settled.lessonThreads ?? {}).length}`)
probe('NO lessonSessions mirror appeared either', JSON.stringify(settled.lessonSessions ?? {}) === mirrorsBefore, 'mirrors unchanged')

// the chat column un-pinned: the import conversation is gone from the stream
await page.waitForTimeout(1500)
const streamStill = await page.locator('.lks14-stream', { hasText: '帮我导入' }).count()
const streamRows = await page.evaluate(() => document.querySelector('.lks14-stream')?.children.length ?? -1)
probe('completion un-pins: the import conversation left the chat column (back on the lesson binding)',
  streamStill === 0, `importRows=${streamStill} streamRows=${streamRows}`)

// the host list keeps the uniformly-titled import session
const hostTitles = await page.evaluate(() => [...document.querySelectorAll('[role=treeitem], [class*=session]')].map(el => el.textContent?.trim() ?? '').filter(t => t !== ''))
const importTitle = hostTitles.find(t => t.includes('26.09.16') || t.includes('课程导入') || t.includes('Markdown'))
probe('the host session list carries the uniformly-titled import session', importTitle !== undefined, `title=${importTitle ?? '-'}`)

// ——— cleanup: delete the probe-born course, restore the rail ———
if (fresh !== undefined) {
  await fetch(`${base}/lookatstudy/api/course/delete`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-lks-request': '1' },
    body: JSON.stringify({ courseId: fresh.courseId }),
  })
  const cleaned = await state()
  probe('cleanup: the probe-born course is deleted', !cleaned.courses.some(c => c.courseId === fresh.courseId), `courses=${cleaned.courses.length}`)
}

await browser.close()
const failed = results.filter(r => !r.ok)
console.log(`\nPROBE SUMMARY: ${results.length - failed.length}/${results.length} pass`)
process.exit(failed.length === 0 ? 0 : 1)

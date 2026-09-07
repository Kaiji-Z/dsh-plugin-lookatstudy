/**
 * D4 live probe (in-stream artifact hydration): a tutor quiz turn lands as an
 * INLINE answerable card inside the stream (chip replaced, no duplicate below),
 * local judging works on the inline card, and the sediment backlog below the
 * stream keeps the artifacts this window didn't render.
 * Usage: node scripts/probe-d4.mjs <token> [--url http://127.0.0.1:3081]
 */
import { createRequire } from 'node:module'

const token = process.argv[2]
if (token === undefined || token === '') {
  console.error('usage: node scripts/probe-d4.mjs <token> [--url base]')
  process.exit(2)
}
const baseIdx = process.argv.indexOf('--url')
const base = baseIdx > 0 ? process.argv[baseIdx + 1] : 'http://127.0.0.1:3081'
const L1 = 'artificial-intelligence-for-beginners-a-curriculum:0:1'

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
await page.waitForTimeout(2500)

// Focus the seeded lesson (0:1 carries probe-table-1 + probe-diagram-1 — the backlog fixtures).
await page.evaluate((id) => {
  const el = document.querySelector(`[data-node-id="${id}"] button`)
  el?.click()
}, L1)
await page.waitForTimeout(2500)

// Ask the tutor for a practice card (one model turn; the tool call lands in this window).
await page.fill('.lks14-composertext', '请立刻用 study_generate_quiz 工具给我出一张 2 题的练习卡（中文，每题 2 个选项），不要讲解。')
await page.click('.lks-btn-send')

// ——— the quiz card lands INLINE in the stream (chip replaced) ———
let inline = null
try {
  await page.waitForSelector('.lks14-stream .lks-qcard', { timeout: 240000 })
  inline = true
} catch { inline = false }
const quizId = await page.evaluate(() => document.querySelector('.lks14-stream .lks-qcard')?.getAttribute('data-lks-quiz') ?? null)
probe('a tutor quiz turn lands as an inline card in the stream', inline, `artifactId=${quizId}`)

const chipGone = await page.evaluate(() => ![...document.querySelectorAll('.lks14-toolchip')].some(c => (c.textContent ?? '').includes('study_generate_quiz')))
probe('the study_generate_quiz chip is replaced by the card (upstream ToolCallBlock semantics)', inline && chipGone, `chipGone=${chipGone}`)

// ——— no duplicate below the stream (sediment backlog drops in-window artifacts) ———
const dupBelow = await page.evaluate((id) => document.querySelectorAll(`[data-lks-quiz="${id}"]`).length, quizId)
probe('the in-window quiz does not duplicate into the sediment stack', inline && dupBelow === 1, `copiesOfId=${dupBelow}`)

// ——— the backlog keeps the seeded artifacts (coexisting sediment) ———
const backlogCount = await page.evaluate(() => {
  const stream = document.querySelector('.lks14-stream')
  return [...document.querySelectorAll('[data-lks-artifact]')].filter(a => stream === null || !stream.contains(a)).length
})
probe('the sediment backlog below the stream keeps out-of-window artifacts', backlogCount >= 1, `backlogCards=${backlogCount}`)

// ——— local judging on the inline card: pick → submit → tone + explanation ———
let judged = false
let toneDetail = ''
if (inline) {
  await page.locator('.lks14-stream .lks-qcard .lks-qcard-opt').first().click()
  const submit = page.locator('.lks14-stream .lks-qcard .lks-qcard-next').first()
  await submit.waitFor({ state: 'visible', timeout: 5000 })
  await submit.click()
  await page.waitForTimeout(600)
  const state = await page.evaluate(() => {
    const card = document.querySelector('.lks14-stream .lks-qcard')
    if (card === null) return { tone: '', expl: false }
    const opt = card.querySelector('.lks-qcard-opt.right, .lks-qcard-opt.wrong')
    return { tone: opt === null ? '' : opt.className, expl: card.querySelector('.lks-qcard-expl') !== null }
  })
  judged = /right|wrong/.test(state.tone) && state.expl
  toneDetail = `tone=${state.tone.match(/(right|wrong)/)?.[1] ?? 'none'} explanation=${state.expl}`
}
probe('the inline card judges locally (pick → submit → tone + explanation)', judged, toneDetail)

await browser.close()
const failed = results.filter(r => !r.ok)
console.log(`\nPROBE SUMMARY: ${results.length - failed.length}/${results.length} pass`)
process.exit(failed.length === 0 ? 0 : 1)

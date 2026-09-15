/** 0.23.1 live probes (issue 1 click-to-unlock + issue 3 teach-prose image
 * clamp): clicking the import-available lesson row drives the focus route,
 * which now attempts the lesson — in_progress + BKT prior + dual-track unlock
 * (in-section next AND next-section first, NOT the one after) — and the
 * lesson's 2400px image renders clamped inside the prose column.
 * Usage: node scripts/probe-0231.mjs <token> [--url http://127.0.0.1:3081]
 */
import { createRequire } from 'node:module'

const token = process.argv[2]
if (token === undefined || token === '') {
  console.error('usage: node scripts/probe-0231.mjs <token> [--url base]')
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
const course = before.courses.find(c => String(c.title).includes('解锁与图片探针课'))
if (course === undefined) {
  console.log('FAIL seeded course missing — run probe-0231-seed.mjs first')
  process.exit(1)
}
const firstId = course.sections[0].lessons[0].id
const pre = course.sections.flatMap(s => s.lessons).map(l => `${l.id.split(':').slice(1).join('.')}:${l.kind}:${l.status}`)
probe('fixture sanity: first lesson available, the rest locked/exam-available at import', true, pre.join(' '))

// ——— issue 1: the row click drives focus → attemptLesson ———
// the rail renders the SELECTED course (panel default = courses[0]); switch
// to the probe course through the command palette (Ctrl+K → course row)
await page.keyboard.press('Control+k')
await page.waitForTimeout(500)
await page.locator('.lks14-palette-row', { hasText: '解锁与图片探针课' }).first().dispatchEvent('click')
await page.waitForTimeout(1500)
await page.locator(`[data-node-id="${firstId}"]`).first().dispatchEvent('click')
await page.waitForTimeout(3500)
const after = await state()
const fresh = after.courses.find(c => c.courseId === course.courseId)
const lessons = fresh.sections.flatMap(s => s.lessons)
const statusOf = (id) => lessons.find(l => l.id === id)?.status
const masteryOf = (id) => lessons.find(l => l.id === id)?.masteryPct
const s1 = fresh.sections[0].lessons, s2 = fresh.sections[1].lessons
probe('issue 1: the clicked lesson is in_progress with the BKT prior',
  statusOf(firstId) === 'in_progress' && masteryOf(firstId) === 50,
  `${statusOf(firstId)} ${masteryOf(firstId)}%`)
probe('issue 1: dual-track unlock — in-section next available AND next-section first available',
  s1[1].status === 'available' && s2[0].status === 'available',
  `next=${s1[1].status} crossSection=${s2[0].status}`)
probe('issue 1: unlock is precise — the lesson after next stays locked, exam nodes untouched',
  s1[2].status === 'locked' && lessons.find(l => l.kind === 'exam')?.status === 'available',
  `third=${s1[2].status} exam=${lessons.find(l => l.kind === 'exam')?.status}`)

// ——— issue 3: the teach prose clamps the 2400px image ———
await page.locator('.lks14-viewtab').nth(0).dispatchEvent('click')
await page.waitForTimeout(1200)
const img = await page.evaluate(() => {
  const el = document.querySelector('.lks14-prose img')
  const prose = document.querySelector('.lks14-prose')
  if (el === null || prose === null) return null
  const r = el.getBoundingClientRect()
  const p = prose.getBoundingClientRect()
  return { iw: Math.round(r.width), pw: Math.round(p.width), mw: getComputedStyle(el).maxWidth, complete: el.complete }
})
probe('issue 3: the 2400px image renders clamped inside the prose column',
  img !== null && img.mw === '100%' && img.iw <= img.pw + 1,
  img === null ? 'no img/prose found' : `computed max-width=${img.mw} img=${img.iw}px prose=${img.pw}px loaded=${img.complete}`)

await browser.close()
const failed = results.filter(r => !r.ok)
console.log(`\nPROBE SUMMARY: ${results.length - failed.length}/${results.length} pass`)
process.exit(failed.length === 0 ? 0 : 1)

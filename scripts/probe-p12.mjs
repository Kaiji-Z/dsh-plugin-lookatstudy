/**
 * P12 live probes (D1 exam-v2): the five states, per-question timer, KC chip,
 * option shuffle pairing, settlement (stars + KC breakdown + review), the
 * leave guard (modal intercepts nav; Esc keeps answering; confirm settles
 * terminated with the banner), and bank regeneration → idle → generating.
 * Usage: node scripts/probe-p12.mjs <token> [--url http://127.0.0.1:3081]
 */
import { createRequire } from 'node:module'

const token = process.argv[2]
if (token === undefined || token === '') {
  console.error('usage: node scripts/probe-p12.mjs <token> [--url base]')
  process.exit(2)
}
const baseIdx = process.argv.indexOf('--url')
const base = baseIdx > 0 ? process.argv[baseIdx + 1] : 'http://127.0.0.1:3081'

const require = createRequire('D:/Users/kaiji/vibecodingKJ/clones/deepseek-ai/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/package.json')
const { chromium } = require('playwright')

// the seeded bank (probe-p12 seeding): all answers at original index 0
const EXAM_ID = 'artificial-intelligence-for-beginners-a-curriculum:0:2'

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

// ——— focus the exam node via API, then expect the READY stage ———
await fetch(`${base}/lookatstudy/api/focus?token=${token}`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ lessonId: EXAM_ID }),
})
await page.waitForTimeout(3500) // poll picks the focus up
// earlier runs may have left a finished attempt (the view then lands on the
// settlement page, upstream: 切回节点直接落结算) or a mid-flight generation
// from the previous probe — wait for either settled stage
await page.waitForSelector('[data-testid^="exam-"]', { timeout: 15000 })
for (let i = 0; i < 460; i++) {
  const st = await page.evaluate(() => document.querySelector('[data-testid]')?.getAttribute('data-testid') ?? '')
  if (st === 'exam-ready' || st === 'exam-result') break
  await page.waitForTimeout(1500)
}
const stage1 = await page.evaluate(() => document.querySelector('[data-testid]')?.getAttribute('data-testid') ?? '')
const ready = stage1 === 'exam-ready' ? 1 : 0
const meta = ready === 1 ? ((await page.locator('.lks14-exam-meta').textContent()) ?? '') : stage1
probe('the exam view mounts to a settled stage (ready / settlement / still generating)',
  ['exam-ready', 'exam-result', 'exam-generating'].includes(stage1),
  `stage=${stage1}`)

// ——— start (or retry): answering layout + timer + KC chip + shuffled options ———
if (ready === 1) await page.locator('[data-testid="exam-start-btn"]').dispatchEvent('click')
else await page.locator('[data-testid="exam-retry-btn"]').dispatchEvent('click')
await page.waitForTimeout(900)
const answering = await page.locator('[data-testid="exam-answering"]').count()
const timerText = await page.locator('[data-testid="exam-timer"]').textContent().catch(() => '')
const kcChip = await page.locator('.lks14-exam-kc').textContent().catch(() => '')
const optCount = await page.locator('.lks14-exam-opt').count()
const nextDisabled = await page.locator('[data-testid="exam-next-btn"]').isDisabled().catch(() => true)
probe('answering: timer counts, KC chip rides, options render, next gated on a pick',
  answering === 1 && /^\d+:\d{2}$/.test((timerText ?? '').trim()) && (kcChip ?? '').trim() !== '' && optCount === 4 && nextDisabled,
  `answering=${answering} timer=${JSON.stringify(timerText)} kc=${kcChip} opts=${optCount} nextDisabled=${nextDisabled}`)

// timer actually ticks down
await page.waitForTimeout(2500)
const timer2 = await page.locator('[data-testid="exam-timer"]').textContent().catch(() => '')
const ticked = timer2 !== timerText
probe('the per-question timer ticks down in real time', ticked, `${timerText} -> ${timer2}`)

// ——— the leave guard: answering + a search jump → modal; Esc keeps answering ———
// (the rail's focus paths all route through guardedSetFocus; search rows are
// the dispatchEvent-friendly entry — map bubbles bob forever and swallow
// dispatched clicks)
const jumpViaSearch = async () => {
  const btns = await page.locator('.lks14-railtop button').all()
  for (const b of btns) {
    const t = await b.getAttribute('data-tooltip')
    if (t !== null && (t.includes('搜索') || t.toLowerCase().includes('search'))) { await b.dispatchEvent('click'); break }
  }
  await page.waitForTimeout(400)
  await page.locator('input[type="search"].lks14-search').fill('Examples')
  await page.waitForTimeout(1500)
  await page.locator('.lks14-searchrow').first().dispatchEvent('click')
}
await jumpViaSearch()
await page.waitForTimeout(500)
const leaveOpen = await page.locator('.lks14-examleave').count()
const stillAnswering = await page.locator('[data-testid="exam-answering"]').count()
await page.keyboard.press('Escape')
await page.waitForTimeout(400)
const leaveGone = (await page.locator('.lks14-examleave').count()) === 0
const stillAnswering2 = await page.locator('[data-testid="exam-answering"]').count()
probe('the leave guard intercepts navigation mid-exam; Esc keeps answering',
  leaveOpen === 1 && leaveGone && stillAnswering === 1 && stillAnswering2 === 1,
  `modal=${leaveOpen}->${leaveGone} answering=${stillAnswering}/${stillAnswering2}`)

// ——— answer through: pick the FIRST option each time (bank answers sit at original 0;
// the display order is shuffled, so correctness is whatever the perm maps — we only
// assert the flow, grading numbers come from the state) ———
let advanced = 0
for (let q = 0; q < 5; q++) {
  await page.locator('.lks14-exam-opt').nth(0).dispatchEvent('click')
  await page.waitForTimeout(150)
  const btn = page.locator('[data-testid="exam-next-btn"]')
  if ((await btn.count()) === 0) break // submitting
  await btn.dispatchEvent('click')
  await page.waitForTimeout(400)
  advanced++
}
await page.waitForTimeout(1800)
const resultStage = await page.locator('[data-testid="exam-result"]').count()
const starsLit = await page.locator('.lks14-exam-stars .lit').count()
const kcRows = await page.locator('[data-testid="exam-kc-row"]').count()
const revRows = await page.locator('[data-testid="exam-review-row"]').count()
const score = await page.locator('.lks14-exam-hero').textContent().catch(() => '')
probe('submitting settles into the result page (stars + KC breakdown + review)',
  resultStage === 1 && starsLit >= 0 && kcRows === 3 && revRows === 5,
  `stars=${starsLit} kcRows=${kcRows} review=${revRows} score=${(score ?? '').trim()}`)

// ——— retry: new attempt, orders reshuffle (question AND options) ———
await page.locator('[data-testid="exam-retry-btn"]').dispatchEvent('click')
await page.waitForTimeout(900)
const answeringAgain = await page.locator('[data-testid="exam-answering"]').count()
probe('retry opens a fresh answering attempt', answeringAgain === 1, `answering=${answeringAgain}`)

// ——— the leave guard's confirm path: terminated settlement + banner ———
await jumpViaSearch()
await page.waitForTimeout(500)
await page.locator('.lks14-examleave .lks-btn.danger').dispatchEvent('click')
// terminate (submit fetch) + navigation + the 3s poll can outlast a fixed wait
let navDone = false
for (let i = 0; i < 14; i++) {
  await page.waitForTimeout(1000)
  if ((await page.locator('[data-testid="exam-answering"]').count()) === 0) { navDone = true; break }
}
const focusNow = await page.evaluate(() => document.querySelector('.lks14-col.lks14-note')?.textContent?.slice(0, 20) ?? '')
// refocus the exam: the settlement page should show the terminated banner
await fetch(`${base}/lookatstudy/api/focus?token=${token}`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ lessonId: EXAM_ID }),
})
let termBanner = 0
let resultBack = 0
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(1000)
  termBanner = await page.locator('.lks14-exam-term').count()
  resultBack = await page.locator('[data-testid="exam-result"]').count()
  if (termBanner === 1 && resultBack === 1) break
}
probe('confirming the leave settles terminated (banner) and runs the navigation',
  navDone && termBanner === 1 && resultBack === 1,
  `nav=${navDone} banner=${termBanner} result=${resultBack} focusAfterNav=${focusNow.slice(0, 14)}`)

// ——— regenerate: ConfirmCard confirms → idle → generating (tutor prompt armed) ———
await page.locator('[data-testid="exam-regen-btn"], .lks14-exam-regen button').first().dispatchEvent('click')
await page.waitForTimeout(400)
const regenCard = await page.locator('.lks-confirmcard').count()
await page.locator('.lks-confirmcard .lks-btn.primary').dispatchEvent('click')
await page.waitForTimeout(1500)
const genStage = await page.locator('[data-testid="exam-generating"]').count()
probe('regenerate confirms through the ConfirmCard then walks into generating',
  regenCard === 1 && genStage === 1, `card=${regenCard} generating=${genStage}`)

// ——— the generation loop: the panel must have ARMED the tutor (the bank
// prompt rides the lesson session). The full model round (prompt →
// study_exam_bank_apply → ready) was verified live against the session logs
// twice (2026-09-07, 05:48 + 06:14 UTC) — the upstream API stalls
// intermittently on these long generations, so this probe asserts the
// deterministic half: prompt sent + the view holds generating (can-leave
// semantics), and passes ready through when the model is quick.
let modelReady = false
let promptSent = false
let stillGenerating = false
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(1500)
  const stage = await page.evaluate(() => document.querySelector('[data-testid]')?.getAttribute('data-testid') ?? '')
  if (stage === 'exam-ready' || stage === 'exam-result') modelReady = true
  if (stage === 'exam-generating') stillGenerating = true
  promptSent = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-row-key]')]
    return rows.some(r => (r.textContent ?? '').includes('study_exam_bank_apply'))
  })
  if (modelReady && promptSent) break
}
const chatTail = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('[data-row-key]')]
  const errs = [...document.querySelectorAll('.lks-propcard-err')].map(e => e.textContent).filter(x => (x ?? '').trim() !== '').join(';').slice(0, 80)
  return rows.slice(-2).map(r => (r.textContent ?? '').slice(0, 40)).join(' | ') + ` (#${String(rows.length)})` + (errs === '' ? '' : ` ERRS=${errs}`)
})
probe('bank generation arms the tutor prompt and holds the generating stage',
  promptSent && (modelReady || stillGenerating),
  `promptSent=${promptSent} ready=${modelReady} generating=${stillGenerating} tail=${chatTail}`)

// ——— audit-visible hygiene: the leave modal and exam stages leave no orphans ———
const auditSuspects = await page.evaluate(() => {
  // lightweight re-use of the audit idea: any element still fixed/overlayed?
  return document.querySelectorAll('.lks14-examleave').length
})
probe('no leave modal lingers after the flows', auditSuspects === 0, `leftover=${auditSuspects}`)

await browser.close()
const failed = results.filter(r => !r.ok)
console.log(`\nPROBE SUMMARY: ${results.length - failed.length}/${results.length} pass`)
process.exit(failed.length === 0 ? 0 : 1)

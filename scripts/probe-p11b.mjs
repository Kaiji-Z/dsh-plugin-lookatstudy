/**
 * P11b live probes (C-track closure): notebook zones / pin / edit / locate
 * flash, GlobalTooltip, ConfirmCard + Esc, and the real-model
 * send→streaming→stop chain. Evidence = DOM state + computed styles.
 * Usage: node scripts/probe-p11b.mjs <token> [--url http://127.0.0.1:3081]
 */
import { createRequire } from 'node:module'

const token = process.argv[2]
if (token === undefined || token === '') {
  console.error('usage: node scripts/probe-p11b.mjs <token> [--url base]')
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
await page.waitForTimeout(1500)

const results = []
const probe = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === '' ? '' : ` — ${detail}`}`)
}

// ——— normalize note pins first (earlier runs leave pins behind). The state
// FEED's lesson projection carries no note ids — read them from state.json.
{
  const { readFileSync } = await import('node:fs')
  const st = JSON.parse(readFileSync('D:/Users/kaiji/.dsh/lookatstudy-plugin/state.json', 'utf8'))
  const lesson = st.courses?.[0]?.sections?.flatMap(s => s.lessons ?? []).find(l => l.id === 'course:0:2')
  for (const n of lesson?.notes ?? []) {
    if (n.pinned === true) await fetch(`${base}/lookatstudy/api/note/pin?token=${token}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lessonId: 'course:0:2', noteId: n.id, pinned: false }),
    })
  }
}

// ——— open the notes tab (third viewtab) on the focused lesson ———
const tabs = page.locator('.lks14-viewtab')
const tabCount = await tabs.count()
await tabs.nth(2).click()
await page.waitForTimeout(600)
const noteCount = await page.locator('.lks14-note .lks-note').count()
probe('notes tab renders the seeded notes', noteCount >= 3, `count=${noteCount} tabs=${tabCount} (state carries notes from earlier runs)`)

// ——— C6 zone collapse / expand ———
const zoneh = page.locator('.lks14-zoneh[aria-expanded]').first()
const beforeCollapse = await zoneh.getAttribute('aria-expanded')
await zoneh.click()
await page.waitForTimeout(300)
const afterCollapse = await zoneh.getAttribute('aria-expanded')
const hiddenNotes = await page.locator('.lks14-zone .lks-note').count()
await zoneh.click()
await page.waitForTimeout(300)
const afterExpand = await zoneh.getAttribute('aria-expanded')
probe('zone head collapses and re-expands', beforeCollapse === 'true' && afterCollapse === 'false' && hiddenNotes === 0 && afterExpand === 'true',
  `${beforeCollapse}->${afterCollapse}(notes=${hiddenNotes})->${afterExpand}`)

// ——— C6 pin: pin the LAST zone note (state may carry pins from earlier runs) ———
const pinText = (await page.locator('.lks14-zone .lks-note').last().locator('.lks-note-title').textContent()) ?? ''
const indexBefore = await page.evaluate(t => [...document.querySelectorAll('.lks14-zone .lks-note')].findIndex(el => el.querySelector('.lks-note-title')?.textContent === t), pinText)
await page.locator('.lks14-zone .lks-note').last().locator('.lks-note-act').first().dispatchEvent('click')
await page.waitForTimeout(1200) // poll + optimistic write round-trip
const pinInfo = await page.evaluate(t => {
  const notes = [...document.querySelectorAll('.lks14-zone .lks-note')]
  const idx = notes.findIndex(el => el.querySelector('.lks-note-title')?.textContent === t)
  return { idx, pinned: idx >= 0 ? notes[idx].classList.contains('pinned') : false, pinnedCount: document.querySelectorAll('.lks-note.pinned').length }
}, pinText)
probe('pin flags the note and floats it to the zone head',
  pinInfo.pinned && pinInfo.idx === 0,
  `index ${indexBefore}->${pinInfo.idx} pinned=${pinInfo.pinned}`)

// ——— C6 edit: third .lks-note-act opens the inline editor ———
const note0 = page.locator('.lks14-zone .lks-note').first()
const acts = note0.locator('.lks-note-act')
await acts.nth(2).dispatchEvent('click')
await page.waitForTimeout(300)
const editorOpen = await page.locator('.lks-note-edit textarea').count()
await page.locator('.lks-note-edit textarea').fill('探针改写的笔记正文')
await page.locator('.lks-note-edit .lks-btn.primary').dispatchEvent('click')
await page.waitForTimeout(1200)
const editText = await page.locator('.lks-note-text').first().textContent()
probe('inline edit saves the rewritten body', editorOpen === 1 && (editText ?? '').includes('探针改写的笔记正文'), `editor=${editorOpen} text=${(editText ?? '').slice(0, 18)}`)

// ——— C6 locate: seed a note whose quote IS in the prose, then jump ———
// (the earlier seeded notes carry arbitrary quotes — locate is quote-matching,
// so the probe must quote the lesson's own text.)
await page.locator('.lks14-viewtab').nth(0).dispatchEvent('click')
await page.waitForTimeout(700)
const proseSlice = await page.locator('.lks14-prose').evaluate(el => {
  const text = (el.textContent ?? '').replace(/\s+/g, '')
  return text.slice(24, 52)
})
await fetch(`${base}/lookatstudy/api/note/user?token=${token}`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ lessonId: 'course:0:2', quote: proseSlice }),
})
await page.locator('.lks14-viewtab').nth(2).dispatchEvent('click')
await page.waitForTimeout(900) // poll picks the new note up
const located = page.locator('.lks14-zone .lks-note').filter({ hasText: proseSlice.slice(0, 12) }).first()
await located.locator('.lks-note-act').nth(1).dispatchEvent('click')
await page.waitForTimeout(1200)
const flashCount = await page.locator('mark.lks-flash').count()
const backOnTeach = await page.locator('.lks14-prose').count()
probe('locate from the notes tab flashes the quote on the teach tab', flashCount >= 1 && backOnTeach === 1,
  `flash=${flashCount} prose=${backOnTeach} quote=${proseSlice.slice(0, 12)}`)

// ——— C15 GlobalTooltip: hover a data-tooltip act ———
await page.locator('.lks14-viewtab').nth(2).dispatchEvent('click')
await page.waitForTimeout(400)
const tipTarget = page.locator('.lks-note-act[data-tooltip]').first()
await tipTarget.hover()
await page.waitForTimeout(400)
const tip = page.locator('.lks-tip')
const tipVisible = await tip.count() === 1 && await tip.isVisible()
const tipText = tipVisible ? await tip.textContent() : ''
await page.mouse.move(400, 500)
await page.waitForTimeout(300)
const tipGone = (await tip.count()) === 0 || !(await tip.isVisible())
probe('GlobalTooltip shows on hover and leaves on exit', tipVisible && tipGone, `text=${tipText} gone=${tipGone}`)

// ——— C15 ConfirmCard: delete flow opens the anchored card, Esc cancels ———
await page.locator('.lks14-note .lks-note-del').first().dispatchEvent('click')
await page.waitForTimeout(300)
const card = page.locator('.lks-confirmcard')
const cardOpen = (await card.count()) === 1 && (await card.isVisible())
const cardPos = cardOpen ? await card.evaluate(el => getComputedStyle(el).position) : ''
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
const cardGone = (await card.count()) === 0 || !(await card.isVisible())
const noteStillThere = await page.locator('.lks-note').count()
probe('ConfirmCard anchors fixed, Escape cancels without deleting', cardOpen && cardPos === 'fixed' && cardGone && noteStillThere >= 3,
  `open=${cardOpen} pos=${cardPos} gone=${cardGone} notes=${noteStillThere}`)

// ——— C14/C16 real-model chain: send → streaming → stop ———
// disarm a wedge-open turn from an earlier run first (the stop watermark
// makes the host cancel path actually disarm now)
if ((await page.locator('.lks-btn-send.stop:visible').count()) > 0) {
  await page.locator('.lks-btn-send.stop:visible').first().dispatchEvent('click')
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(1000)
    if ((await page.locator('.lks-btn-send.stop:visible').count()) === 0) break
  }
}
const disarmedOnEntry = (await page.locator('.lks-btn-send.stop:visible').count()) === 0
console.log(`INFO composer disarmed on entry: ${disarmedOnEntry}`)
// long enough to outlast latency: catch the stop button the moment it arms
let stopped = false
let sawStop = false
let streamText = ''
for (let attempt = 0; attempt < 2 && !stopped; attempt++) {
  await page.locator('.lks14-composertext').fill(attempt === 0
    ? '请写一段大约500字的、关于如何坚持每天学习的具体建议短文。'
    : '再写一段600字：讲讲间隔重复记忆法的原理与实践细节。')
  await page.waitForSelector('.lks-btn-send:not(.stop):not([disabled])', { timeout: 5000 })
  await page.locator('.lks-btn-send:not(.stop)').dispatchEvent('click')
  for (let i = 0; i < 80; i++) {
    await page.waitForTimeout(400)
    if (streamText === '' && (await page.locator('[data-row-key]').count()) > 0) {
      streamText = await page.locator('[data-row-key]').first().textContent().catch(() => '') ?? ''
    }
    if ((await page.locator('.lks-btn-send.stop:visible').count()) > 0) {
      sawStop = true
      await page.locator('.lks-btn-send.stop:visible').first().dispatchEvent('click')
      await page.waitForTimeout(1500)
      stopped = (await page.locator('.lks-btn-send.stop:visible').count()) === 0
      break
    }
  }
}
const sendErr = await page.evaluate(() => [...document.querySelectorAll('.lks-propcard-err')].map(e => e.textContent).filter(t => (t ?? '').trim() !== '').join(' | '))
const rowsNow = await page.locator('[data-row-key]').count()
const sawStreaming = streamText !== ''
probe('send enters streaming with a live row and the stop twin armed', sawStreaming && sawStop, `head=${streamText.slice(0, 14)} stop=${sawStop} rows=${rowsNow} err=${sendErr}`)
probe('stop halts the generation and disarms', stopped, `stopped=${stopped} err=${sendErr}`)

// ——— C14 tool chip: ask for a tool call and watch loading→done ———
await page.locator('.lks14-composertext').fill('请调用 study_view 查看我的学习状态，然后用一句话总结。')
await page.waitForSelector('.lks-btn-send:not(.stop):not([disabled])', { timeout: 5000 })
await page.locator('.lks-btn-send:not(.stop)').dispatchEvent('click')
let chipLoading = false
let chipDone = false
let reasoningRow = false
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(1000)
  if ((await page.locator('.lks14-toolchip.loading').count()) > 0) chipLoading = true
  if ((await page.locator('.lks14-toolchip.done').count()) > 0) chipDone = true
  if ((await page.locator('.lks14-reasoning').count()) > 0) reasoningRow = true
  if (chipDone) break
}
const chipLabel = await page.locator('.lks14-toolchip').first().textContent().catch(() => '')
probe('tool call renders the settling done chip', chipDone, `done=${chipDone} label=${(chipLabel ?? '').slice(0, 20)} (loading=${chipLoading} — sub-poll round-trips may skip it)`)
console.log(`INFO reasoning fold seen: ${reasoningRow} (model-dependent — informational)`)

await browser.close()
const failed = results.filter(r => !r.ok)
console.log(`\nPROBE SUMMARY: ${results.length - failed.length}/${results.length} pass`)
process.exit(failed.length === 0 ? 0 : 1)

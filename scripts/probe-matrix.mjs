/**
 * P18 acceptance-matrix probe — the five items without a dedicated round probe:
 *   item 7  scroll FAB (streaming pulse) + stop button interrupts the turn
 *   item 8  attachment: paperclip → workspace file → tutor references it
 *   item 9  B6 typography: assistant full-width prose (no card), user right-aligned
 *   item 11 note 回到原文 → mark.lks-flash in the teach prose
 *   item 12 read-aloud n/total counter + karaoke mark.lks-reading
 * Usage: node scripts/probe-matrix.mjs <token> [--url http://127.0.0.1:3081]
 * Needs the seeded note-matrix-locate on lesson 0:0 (scripts/seed-matrix.mjs).
 */
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const token = process.argv[2]
if (token === undefined || token === '') {
  console.error('usage: node scripts/probe-matrix.mjs <token> [--url base]')
  process.exit(2)
}
const baseIdx = process.argv.indexOf('--url')
const base = baseIdx > 0 ? process.argv[baseIdx + 1] : 'http://127.0.0.1:3081'

const require = createRequire('D:/Users/kaiji/vibecodingKJ/clones/deepseek-ai/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/package.json')
const { chromium } = require('playwright')

const L0 = 'artificial-intelligence-for-beginners-a-curriculum:0:0' // note-locate lesson
const CHAT = 'artificial-intelligence-for-beginners-a-curriculum:1:2' // fresh thread for the model turns
const ATTACH = join(tmpdir(), 'matrix-note.txt')
writeFileSync(ATTACH, 'matrix 附件内容:一段用于导师引用验证的学习材料。要点:苏格拉底式导师应当引用这份材料时点名 matrix-note.txt。')

const results = []
const probe = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === '' ? '' : ` — ${detail}`}`)
}
const snap = () => page.evaluate(() => ({
  u: document.querySelectorAll('.lks14-msg-user').length,
  a: document.querySelectorAll('.lks14-msg-assistant').length,
  au: document.querySelectorAll('.lks14-msgaudio').length,
  feed: document.querySelector('[data-lks-feed]')?.getAttribute('data-lks-feed') ?? 'none',
  pane: document.querySelector('.lks14-body')?.getAttribute('data-pane') ?? '',
})).then(s => JSON.stringify(s)).catch(e => `snap!${String(e).slice(0, 60)}`)

const browser = await chromium.launch({
  executablePath: 'C:/Users/kaiji/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe',
  args: ['--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
page.on('pageerror', e => console.log('PAGEERROR:', String(e).slice(0, 200)))
await page.goto(`${base}/?token=${token}`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-dsh-lookatstudy-entry]', { timeout: 30000 })
await page.click('[data-dsh-lookatstudy-entry]')
await page.waitForSelector('.lks-ui', { timeout: 30000 })
await page.waitForTimeout(2500)

/* ── item 11 first (rides the 0:0 focus): note 回到原文 ── */
await fetch(`${base}/lookatstudy/api/focus?token=${token}`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ lessonId: L0 }),
})
await page.waitForTimeout(3500)
{
  const notesTab = page.locator('button', { hasText: /^笔记/ }).last()
  let flashed = false
  if (await notesTab.count() > 0) {
    await notesTab.dispatchEvent('click')
    await page.waitForTimeout(600)
    const row = page.locator('.lks-note', { hasText: 'matrix 回到原文探针' }).first()
    if (await row.count() > 0) {
      await row.locator('[aria-label="回到原文"]').dispatchEvent('click')
      for (let i = 0; i < 14 && !flashed; i++) {
        flashed = await page.locator('mark.lks-flash').count() > 0
        if (!flashed) await page.waitForTimeout(200)
      }
    }
  }
  probe('note 回到原文 jumps and flashes the quote in the prose', flashed, `flashed=${flashed}`)
}

/* ── focus the fresh-thread lesson for the model turns ── */
await fetch(`${base}/lookatstudy/api/focus?token=${token}`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ lessonId: CHAT }),
})
await page.waitForTimeout(3500)

/* ── item 7a: the FAB rides 0:0's long thread (a fresh stream never
   overflows, so the detach state can't be reached) — abort that turn after
   the assertion, the completion-checked items run on the fresh lesson ── */
{
  await fetch(`${base}/lookatstudy/api/focus?token=${token}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ lessonId: L0 }),
  })
  await page.waitForTimeout(3000)
  await page.locator('input.lks14-importfile').setInputFiles(ATTACH)
  let busy0 = false
  for (let i = 0; i < 30 && !busy0; i++) {
    busy0 = await page.locator('.lks-btn-send.stop').count() === 1
    if (!busy0) await page.waitForTimeout(500)
  }
  let overflowed = false
  for (let i = 0; i < 20 && !overflowed; i++) {
    overflowed = await page.evaluate(() => { const el = document.querySelector('.lks14-stream'); return el !== null && el.scrollHeight > el.clientHeight + 100 })
    if (!overflowed) await page.waitForTimeout(500)
  }
  let fab = false
  if (busy0 && overflowed) {
    // pin to the bottom first — a wheel at scrollTop 0 clamps to 0, fires no
    // scroll event, and the detach never happens
    await page.evaluate(() => { const el = document.querySelector('.lks14-stream'); if (el !== null) el.scrollTop = el.scrollHeight })
    await page.waitForTimeout(300)
    const box = await page.locator('.lks14-stream').boundingBox()
    if (box !== null) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.wheel(0, -600)
      await page.waitForTimeout(400)
      fab = await page.locator('.lks14-scrollfab.streaming').count() === 1
      await page.locator('.lks-scrollfab, .lks14-scrollfab').first().dispatchEvent('click').catch(() => {})
    }
  }
  let stopped0 = false
  if (busy0) {
    await page.locator('.lks-btn-send.stop').dispatchEvent('click')
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(500)
      if (await page.locator('.lks-btn-send.stop').count() === 0) { stopped0 = true; break }
    }
  }
  probe('scroll-detach shows the streaming FAB; stop interrupts the turn (busy resets)',
    fab && stopped0, `busy=${busy0} overflowed=${overflowed} fab=${fab} stopped=${stopped0}`)
  // back to the fresh lesson for the completion-checked items
  await fetch(`${base}/lookatstudy/api/focus?token=${token}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ lessonId: CHAT }),
  })
  await page.waitForTimeout(3500)
}

/* ── item 8: the attachment turn (fresh thread → completes fast) ── */
{
  const input = page.locator('input.lks14-importfile')
  await input.setInputFiles(ATTACH)
  // the attach.sent row (user bubble carrying the filename + workspace path)
  let userRow = false
  for (let i = 0; i < 20 && !userRow; i++) {
    userRow = await page.evaluate(() => [...document.querySelectorAll('.lks14-msg-user')].some(m => (m.textContent ?? '').includes('matrix-note.txt')))
    if (!userRow) await page.waitForTimeout(500)
  }
  // busy: the composer flips to stop
  let streaming = false
  for (let i = 0; i < 30 && !streaming; i++) {
    streaming = await page.locator('.lks-btn-send.stop').count() === 1
    if (!streaming) await page.waitForTimeout(500)
  }
  probe('attachment lands as a user row and puts the composer in busy', userRow && streaming, `userRow=${userRow} busy=${streaming}`)

  // let the turn finish (a streaming row already carries text — the exit
  // condition is the composer flipping back to send, not reply content)
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(1500)
    if (await page.locator('.lks-btn-send.stop').count() === 0) break
  }
  await page.waitForTimeout(800)
  const reply = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.lks14-msg-assistant')]
    return rows.length > 0 ? (rows[rows.length - 1]?.textContent ?? '') : ''
  })
  probe('the tutor references the attachment by name in its reply', reply.includes('matrix-note.txt'), `replyLen=${reply.length} mentions=${reply.includes('matrix-note.txt')} ${await snap()}`)

  /* ── item 9: B6 typography on the rows this turn produced ── */
  const b6 = await page.evaluate(() => {
    const user = document.querySelector('.lks14-msg-user')
    const asst = document.querySelector('.lks14-msg-assistant')
    if (user === null || asst === null) return null
    const u = getComputedStyle(user); const a = getComputedStyle(asst)
    return {
      userAlign: u.alignSelf, userMax: u.maxWidth,
      asstBg: a.backgroundColor, asstBorder: a.borderTopWidth, asstMax: a.maxWidth,
    }
  })
  probe('B6: assistant renders as full-width prose (no card), user bubble right-aligns',
    b6 !== null && b6.userAlign === 'flex-end' && b6.asstBg === 'rgba(0, 0, 0, 0)' && b6.asstBorder === '0px' && b6.asstMax !== 'none',
    JSON.stringify(b6))
}

/* item 7's stop half rode the 0:0 turn in the FAB block above — a second
   clean-turn stop adds no new evidence and each extra GLM round lengthens
   the thread (and every later probe run) for nothing */

/* ── item 12: read-aloud counter + karaoke mark ── */
{
  const btn = page.locator('.lks14-msgaudio button').last()
  let counter = ''
  let marked = false
  if (await btn.count() > 0) {
    await btn.dispatchEvent('click')
    for (let i = 0; i < 80 && !marked; i++) {
      marked = await page.locator('mark.lks-reading').count() > 0
      counter = await page.locator('.lks14-msgaudio-n').textContent().catch(() => '')
      if (!marked) await page.waitForTimeout(150)
    }
  }
  probe('read-aloud walks sentences: n/total counter + karaoke mark in the row',
    marked && /^\d+\/\d+$/.test((counter ?? '').trim()), `marked=${marked} counter=${JSON.stringify(counter)}`)
  // stop: marks clear
  if (marked) {
    const stopBtn = page.locator('.lks14-msgaudio button').last()
    await stopBtn.dispatchEvent('click')
    await page.waitForTimeout(300)
    const cleared = await page.locator('mark.lks-reading').count() === 0
    probe('stopping read-aloud clears the karaoke marks', cleared, `cleared=${cleared}`)
  } else {
    probe('stopping read-aloud clears the karaoke marks', false, 'never started')
  }
}


await browser.close()
const pass = results.filter(r => r.ok).length
console.log(`\nPROBE SUMMARY: ${pass}/${String(results.length)} pass`)
process.exit(pass === results.length ? 0 : 1)

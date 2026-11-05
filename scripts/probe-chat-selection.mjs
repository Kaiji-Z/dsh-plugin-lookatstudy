/**
 * Chat-selection + composer + TTS-chain live probe (the issue #18 round):
 *  1. a real model turn settles an assistant row, which then carries
 *     data-msg-id (the stable feed row key)
 *  2. a programmatic selection inside that row floats the quote popover
 *     (提问这段 / 加笔记) — 加笔记 writes a record-zone note with the row
 *     anchor (source 'chat'), verified through the state API
 *  3. the composer grows with a long draft (issue: fixed tiny capsule)
 *  4. the TTS chain receipts its engine live: a dead external endpoint is
 *     configured → synthesis falls back to Edge and SAYS so (engine=edge in
 *     the receipt, endpoint visible in the feed); clearing restores
 *  — plus zero page errors across the whole run.
 * Usage: node scripts/probe-chat-selection.mjs <token> <lessonId> [--url http://127.0.0.1:3081]
 */
import { createRequire } from 'node:module'

const token = process.argv[2]
const lessonId = process.argv[3]
if (token === undefined || lessonId === undefined) {
  console.error('usage: node scripts/probe-chat-selection.mjs <token> <lessonId> [--url base]')
  process.exit(2)
}
const baseIdx = process.argv.indexOf('--url')
const base = baseIdx > 0 ? process.argv[baseIdx + 1] : 'http://127.0.0.1:3081'

const require = createRequire('D:/Users/kaiji/vibecodingKJ/clones/deepseek-ai/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/package.json')
const { chromium } = require('playwright')

const results = []
const probe = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === '' ? '' : ` — ${detail}`}`)
}

const browser = await chromium.launch({ executablePath: 'C:/Users/kaiji/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe' })
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
const pageErrors = []
page.on('pageerror', e => { pageErrors.push(String(e)) })

const dismissHostNotice = () => page.evaluate(() => {
  for (const modal of document.querySelectorAll('div[role="presentation"]')) {
    const button = [...modal.querySelectorAll('button')]
      .find(b => (b.textContent ?? '').trim() !== '' && b.closest('.lks14-shell-view') === null)
    if (button === undefined) continue
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return true
  }
  return false
})
const clickInPanel = async selector => page.evaluate(sel => {
  const el = document.querySelector(sel)
  if (el === null) return false
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  return true
}, selector)

await page.goto(`${base}/?token=${token}`, { waitUntil: 'domcontentloaded' })
await dismissHostNotice().catch(() => {})
await page.waitForSelector('[data-dsh-lookatstudy-entry]', { timeout: 45000 })
await page.evaluate(() => {
  if (document.documentElement.hasAttribute('data-dsh-lookatstudy-active')) return
  document.querySelector('[data-dsh-lookatstudy-entry]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})
await page.waitForSelector('.lks-ui[data-lks-panel]', { timeout: 20000 })

// focus the lesson through the API (zero-LLM), let the poll pick it up
await page.evaluate(async lid => {
  await fetch('/lookatstudy/api/focus', { method: 'POST', headers: { 'content-type': 'application/json', 'x-lks-request': '1' }, body: JSON.stringify({ lessonId: lid }) })
}, lessonId)
await page.waitForTimeout(3500)

// 1 — a real turn settles an assistant row carrying the anchor
await page.fill('.lks14-composertext', '请用两三句话解释什么是变量提升，并举一个例子。')
await clickInPanel('.lks14-composer .lks-btn-send')
const turnOver = () => {
  if (document.querySelector('.lks14-msg-assistant.streaming') !== null) return false
  if (document.querySelector('.lks14-composer .lks-btn-send.stop') !== null) return false
  return document.querySelectorAll('.lks14-msg-assistant').length >= 1
}
{
  const deadline = Date.now() + 300000
  for (;;) {
    try { await page.waitForFunction(turnOver, undefined, { timeout: 20000 }); break } catch {}
    if (await dismissHostNotice()) await page.waitForTimeout(1000)
    if (Date.now() > deadline) break
  }
  await page.waitForTimeout(1500)
}
const msgId = await page.evaluate(() => document.querySelector('.lks14-msg-assistant[data-msg-id]')?.getAttribute('data-msg-id') ?? null)
probe('the settled assistant row carries its data-msg-id anchor', msgId !== null, `msgId=${msgId}`)

// 2 — select inside that row → the popover floats → 加笔记 writes an anchored note
if (msgId === null) {
  probe('selection popover + anchored note', false, 'no anchored row to select in')
} else {
  const popped = await page.evaluate(id => {
    const row = document.querySelector(`[data-msg-id="${id}"]`)
    if (row === null) return false
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
    const texts = []
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) if ((n.textContent ?? '').trim().length >= 6) texts.push(n)
    if (texts.length === 0) return false
    const first = texts[0]
    const len = Math.min(8, (first.textContent ?? '').length)
    const range = document.createRange()
    range.setStart(first, 0); range.setEnd(first, len)
    const sel = window.getSelection()
    sel?.removeAllRanges(); sel?.addRange(range)
    return true
  }, msgId)
  await page.waitForTimeout(1200)
  const hasPopover = await page.evaluate(() => document.querySelector('[data-testid="chat-quote-btn"]') !== null)
  probe('a selection inside a chat row floats the quote popover', popped && hasPopover)
  const saved = await clickInPanel('[data-testid="chat-quote-btn"] button:last-child')
  await page.waitForTimeout(2500)
  const noted = await page.evaluate(async () => {
    const s = await (await fetch('/lookatstudy/api/state', { headers: { 'x-lks-request': '1' } })).json()
    return s.lesson?.notes?.find(n => n.source === 'chat' && n.anchorMsgId !== null) ?? null
  })
  probe('加笔记 writes a record-zone note anchored to the row', saved && noted !== null,
    `anchor=${noted?.anchorMsgId ?? '-'} quote=${String(noted?.quote ?? '').slice(0, 12)}`)
}

// 3 — the composer grows with a long draft
{
  const before = await page.evaluate(() => document.querySelector('.lks14-composertext')?.offsetHeight ?? 0)
  await page.fill('.lks14-composertext', Array.from({ length: 18 }, (_, i) => `${i + 1}. 这是一段用来撑高输入框的长文本行。`).join('\n'))
  await page.evaluate(() => {
    const el = document.querySelector('.lks14-composertext')
    el?.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.waitForTimeout(400)
  const after = await page.evaluate(() => document.querySelector('.lks14-composertext')?.offsetHeight ?? 0)
  probe('the composer grows with its content', after > before + 40, `${before}px → ${after}px`)
  await page.fill('.lks14-composertext', '')
}

// 3b — 提问这段 SENDS the quote as a message (same as the prose popover)
if (msgId !== null) {
  const reselected = await page.evaluate(id => {
    const row = document.querySelector(`[data-msg-id="${id}"]`)
    if (row === null) return false
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
    const texts = []
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) if ((n.textContent ?? '').trim().length >= 6) texts.push(n)
    if (texts.length === 0) return false
    const first = texts[0]
    const len = Math.min(8, (first.textContent ?? '').length)
    const range = document.createRange()
    range.setStart(first, 0); range.setEnd(first, len)
    const sel = window.getSelection()
    sel?.removeAllRanges(); sel?.addRange(range)
    return true
  }, msgId)
  await page.waitForTimeout(1200)
  const asked = await clickInPanel('[data-testid="chat-quote-btn"] button:first-child')
  // the ask SENDS (it never parks in the draft) — a new user row carries the quote
  let sentQuote = false
  for (let i = 0; i < 10 && !sentQuote; i++) {
    await page.waitForTimeout(700)
    sentQuote = await page.evaluate(() => [...document.querySelectorAll('.lks14-msg-user')].some(el => (el.textContent ?? '').length > 10))
  }
  probe('提问这段 sends the selected quote as a message', reselected && asked && sentQuote)
  // settle that turn BEFORE the height test (a busy composer ignores submits)
  const deadline2 = Date.now() + 300000
  for (;;) {
    try { await page.waitForFunction(turnOver, undefined, { timeout: 20000 }); break } catch {}
    if (await dismissHostNotice()) await page.waitForTimeout(1000)
    if (Date.now() > deadline2) break
  }
  await page.waitForTimeout(1200)
  // the popover send must ALSO have reset a grown composer (probe-caught gap)
  const grown = await page.evaluate(() => document.querySelector('.lks14-composertext')?.offsetHeight ?? 0)
  await page.fill('.lks14-composertext', Array.from({ length: 16 }, (_, i) => `${i + 1}. 追加的长文本行，撑高后发送验证重置。`).join('\n'))
  await page.evaluate(() => document.querySelector('.lks14-composertext')?.dispatchEvent(new Event('input', { bubbles: true })))
  await page.waitForTimeout(300)
  const tall = await page.evaluate(() => document.querySelector('.lks14-composertext')?.offsetHeight ?? 0)
  await clickInPanel('.lks14-composer .lks-btn-send')
  await page.waitForTimeout(900)
  const reset = await page.evaluate(() => document.querySelector('.lks14-composertext')?.offsetHeight ?? 0)
  probe('sending (button or popover) resets the composer to default height', tall > grown + 30 && reset < tall - 60, `${tall}px → ${reset}px`)
  // settle before the reload check
  const deadline3 = Date.now() + 300000
  for (;;) {
    try { await page.waitForFunction(turnOver, undefined, { timeout: 20000 }); break } catch {}
    if (await dismissHostNotice()) await page.waitForTimeout(1000)
    if (Date.now() > deadline3) break
  }
  await page.waitForTimeout(1500)
}

// 3c — reload: the anchored chat note's persistent mark redraws
{
  await page.reload({ waitUntil: 'domcontentloaded' })
  await dismissHostNotice().catch(() => {})
  await page.evaluate(() => {
    if (!document.documentElement.hasAttribute('data-dsh-lookatstudy-active'))
      document.querySelector('[data-dsh-lookatstudy-entry]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await page.waitForSelector('.lks-ui[data-lks-panel]', { timeout: 20000 })
  await page.waitForSelector('.lks14-msg-assistant', { timeout: 30000 })
  await page.waitForTimeout(1200)
  const redrawn = await page.evaluate(() => {
    // the Highlight-API registry is document-level: a live range for the
    // chat note means the per-row redraw ran on the fresh mount
    const hl = (window.CSS).highlights?.get('lks-note-hl')
    return hl === undefined ? 0 : hl.size
  })
  probe('reload: the anchored chat note redraws its persistent mark', redrawn >= 1, `live ranges=${redrawn}`)
}

// 3d — the reading-column tier engages when the pane is dragged wide.
// NOTE: the test width must sit INSIDE the drag budget (CHAT_MAX=1100) —
// writing 1300px bypassed the budget clamps and once certified a dead tier
{
  const tier = await page.evaluate(async () => {
    const el = document.querySelector('.lks14-msg-assistant')
    if (el === null) return null
    const base = Math.round(Number.parseFloat(getComputedStyle(el).maxWidth))
    document.body.style.setProperty('--lks-chat-w', '1100px')
    await new Promise(r => { setTimeout(r, 400) })
    const wide = Math.round(Number.parseFloat(getComputedStyle(el).maxWidth))
    // computed margin-inline resolves to USED px (not 'auto') — a real
    // symmetric centering shows up as equal non-trivial side margins
    const ml = Math.round(Number.parseFloat(getComputedStyle(el).marginLeft))
    const mr = Math.round(Number.parseFloat(getComputedStyle(el).marginRight))
    document.body.style.removeProperty('--lks-chat-w')
    return { base, wide, ml, mr }
  })
  probe('reading tiers: the 1100px DRAG CEILING widens the column cap (and centers it)',
    tier !== null && tier.wide > tier.base + 40 && tier.ml > 20 && tier.ml === tier.mr,
    tier === null ? 'no row' : `${tier.base}px → ${tier.wide}px margins=${tier.ml}/${tier.mr}`)
}

// 4 — the TTS chain: a dead external endpoint falls back AND says so
{
  const set = await page.evaluate(async endpoint => {
    const r = await fetch('/lookatstudy/api/tts-endpoint', { method: 'POST', headers: { 'content-type': 'application/json', 'x-lks-request': '1' }, body: JSON.stringify({ endpoint }) })
    return r.status
  }, 'http://127.0.0.1:59999/tts')
  probe('a dead external endpoint saves (the chain decides at synthesis time)', set === 200)
  const synth = await page.evaluate(async () => {
    const r = await fetch('/lookatstudy/api/tts', { method: 'POST', headers: { 'content-type': 'application/json', 'x-lks-request': '1' }, body: JSON.stringify({ text: '通道测试。' }) })
    return await r.json()
  })
  // chain semantics, network-agnostic: EITHER a channel answered (engine in
  // the receipt) OR the total-failure receipt carries the EDGE error — which
  // proves the dead external endpoint was tried first and fell through (on
  // mainland-403 networks Edge itself refuses; that's issue #18's premise)
  const receiptOk = synth.ok === true && (synth.engine === 'edge' || synth.engine === 'external')
  const fellThrough = synth.ok !== true && /edge tts/i.test(String(synth.error ?? ''))
  probe('the synthesis receipt names the engine (or proves the fallback ran)', receiptOk || fellThrough,
    `engine=${synth.engine ?? '-'} ${synth.ok === true ? '' : `error=${String(synth.error).slice(0, 48)}`}`)
  const feed = await page.evaluate(async () => {
    const s = await (await fetch('/lookatstudy/api/state', { headers: { 'x-lks-request': '1' } })).json()
    return s.tts
  })
  probe('the feed carries the live TTS status', feed != null && typeof feed.endpoint === 'string'
    && (feed.lastEngine === 'external' || feed.lastEngine === 'edge' || feed.lastExternalError !== null),
    `endpoint=${feed?.endpoint} lastEngine=${feed?.lastEngine} err=${String(feed?.lastExternalError ?? '').slice(0, 36)}`)
  // cleanup: clear the endpoint so the probe leaves no config behind
  await page.evaluate(async () => {
    await fetch('/lookatstudy/api/tts-endpoint', { method: 'POST', headers: { 'content-type': 'application/json', 'x-lks-request': '1' }, body: JSON.stringify({ endpoint: '' }) })
  })
}

probe('zero page errors across the run', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))

await browser.close()
const failed = results.filter(r => !r.ok)
console.log(failed.length === 0 ? `\nALL ${results.length} CHECKS PASS` : `\n${failed.length}/${results.length} FAILED`)
process.exit(failed.length === 0 ? 0 : 1)

/**
 * Three-column fit live probe (2026-11-26). The study panel's wide layout is
 * rail | chat | notebook side by side. Its defaults used to be hard floors
 * (300 + 12 + 480 + 440 = 1232px) against a 900px switch breakpoint, and the
 * container queries sat OUTSIDE the panel's font zoom — so through the
 * 900–1232px band (and further at zoom ≠ 1) the notebook was pushed
 * off-screen: 19 of 48 trio combinations clipped, by up to 387px. This probe
 * drives the real host at desktop sizes and pins the fix:
 *   1. default widths: nothing is clipped — width × sidebar state × zoom
 *   2. trio floors: chat ≥ 320 and notebook ≥ 320 layout px wherever the trio
 *      shows, and the notebook keeps its 440 whenever the chat floor allows
 *   3. zoom-aware mode: the switch shows exactly when the panel's LAYOUT
 *      width is ≤ 960 (the query container is the zoomed root)
 *   4. the notebook stays whole in a narrow column: one-row view tabs, no spill
 *   5. stored widths (dragged on a wide screen, then the host column
 *      narrows): still nothing clipped — and still honored where they fit
 *   6. real drags: at 1920 both handles stay inside the budget, a stored
 *      width is the width that lands (no 6px snap-back), and a double-click
 *      resets; at 1366 (the tight band) the chat handle cannot grow — the
 *      notebook is protected — but still moves, down to the 320 floor
 *   7. zero page errors
 *
 * READ-ONLY for learner state: NO lesson click, NO send, NO write route. The
 * context locale is PINNED zh-CN — the panel's mount effect posts the host
 * interface language to /api/prefs and the dashboard persists it whenever it
 * differs, so any other locale rewrites the shared state.json value.
 *
 * The pane widths the drags commit live in the probe browser's own
 * localStorage (a fresh context per pass) — nothing reaches the owner's.
 *
 * Usage: node scripts/probe-columns.mjs <token> [--url http://127.0.0.1:3081] [--shots] [--verbose]
 * With --shots two frames land in the cwd as lks-columns-*.png (gitignored).
 */
import { createRequire } from 'node:module'

const token = process.argv[2]
if (token === undefined || token === '') {
  console.error('usage: node scripts/probe-columns.mjs <token> [--url base] [--shots]')
  process.exit(2)
}
const baseIdx = process.argv.indexOf('--url')
const base = baseIdx > 0 ? process.argv[baseIdx + 1] : 'http://127.0.0.1:3081'
const shots = process.argv.includes('--shots')
const verbose = process.argv.includes('--verbose') // every measured row, for diagnosing a FAIL

const require = createRequire('D:/Users/kaiji/vibecodingKJ/clones/deepseek-ai/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/package.json')
const { chromium } = require('playwright')

// the stylesheet's numbers (pane-resize.ts is the source of truth; this probe
// is the live half of the same contract)
const SWITCH_AT = 960
const CHAT_FLOOR = 320
const NOTE_FLOOR = 320
const NOTE_MIN = 440
const HANDLE_W = 6
const RAIL_DEFAULT = 300
const HANDLES_W = 12
const WIDTHS = [1024, 1152, 1280, 1366, 1440, 1536, 1600, 1920, 2560]
const ZOOMS = ['0.9', '1', '1.1']

const results = []
const probe = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === '' ? '' : ` — ${detail}`}`)
}

const browser = await chromium.launch({ executablePath: 'C:/Users/kaiji/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe' })
const pageErrors = []
const cdnHiccups = []

/** Open the panel in a fresh context: zoom + optional stored widths seeded
 *  before the first mount (the way a real drag commits them). */
const openPanel = async ({ zoom, rail = null, chat = null }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'zh-CN' })
  await context.addInitScript(({ zoom, rail, chat }) => {
    if (sessionStorage.getItem('lks-probe-columns-seeded')) return
    localStorage.setItem('dsh-plugin-lookatstudy:zoom', zoom)
    for (const [key, value] of [['pane-rail', rail], ['pane-chat', chat]]) {
      if (value === null) localStorage.removeItem(`dsh-plugin-lookatstudy:${key}`)
      else localStorage.setItem(`dsh-plugin-lookatstudy:${key}`, value)
    }
    sessionStorage.setItem('lks-probe-columns-seeded', '1')
  }, { zoom, rail, chat })
  const page = await context.newPage()
  page.on('pageerror', e => { pageErrors.push(String(e)) })
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) pageErrors.push(`console: ${m.text().slice(0, 200)}`) })
  page.on('requestfailed', r => {
    const url = r.url()
    const reason = r.failure()?.errorText ?? 'failed'
    if (reason === 'net::ERR_ABORTED') return
    ;(url.startsWith(base) ? pageErrors : cdnHiccups).push(`${reason} ${url.slice(0, 140)}`)
  })
  await page.goto(`${base}/?token=${token}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-dsh-lookatstudy-entry]', { state: 'attached', timeout: 90000 })
  await page.waitForTimeout(2500)
  // 0.2.x hosts greet a fresh profile with the 预览版说明 notice (its mask
  // blocks every click): dispatched, never clicked — the mask fails hit-testing
  for (let i = 0; i < 3; i++) {
    const dismissed = await page.evaluate(() => {
      for (const modal of document.querySelectorAll('div[role="presentation"]')) {
        const button = [...modal.querySelectorAll('button')].find(b => (b.textContent ?? '').trim() !== '' && b.closest('[data-dsh-lookatstudy-view]') === null)
        if (button !== undefined) { button.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true }
      }
      return false
    })
    if (!dismissed) break
    await page.waitForTimeout(700)
  }
  return { context, page }
}

/** The host's own sidebar collapse control (label differs by host generation). */
const setSidebar = async (page, collapsed) => {
  const flipped = await page.evaluate((want) => {
    const col = document.querySelector('[class*="sidebarCol"]')
    if (col === null) return 'no-column'
    const isCollapsed = () => Math.round(col.getBoundingClientRect().width) < 120 // the 56px icon rail
    if (isCollapsed() === want) return 'already'
    const btn = [...col.querySelectorAll('button')].find(b => /收起|折叠|展开|collapse|expand/i.test(`${String(b.getAttribute('aria-label'))} ${String(b.getAttribute('title'))}`))
    if (btn === undefined) return 'no-toggle'
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return 'clicked'
  }, collapsed)
  await page.waitForTimeout(900)
  return flipped
}

/** How the columns land right now. Widths are VISUAL px; `layout` is the
 *  panel's own (zoomed) px — the space the columns are laid out in. */
const measure = (page) => page.evaluate((HANDLE_W) => {
  const view = document.querySelector('[data-dsh-lookatstudy-view]')
  const root = document.querySelector('.lks14')
  const body = document.querySelector('.lks14-body')
  if (view === null || root === null || body === null) return null
  const vb = view.getBoundingClientRect()
  const zoom = Number.parseFloat(getComputedStyle(root).zoom) || 1
  const col = sel => { const el = document.querySelector(sel); if (el === null) return null; const b = el.getBoundingClientRect(); return { w: b.width / zoom, right: b.right, left: b.left } }
  const sw = document.querySelector('.lks14-switch')
  const mode = sw !== null && getComputedStyle(sw).display !== 'none' ? 'switch' : 'trio'
  const rail = col('.lks14-rail')
  const chat = col('.lks14-chat')
  const note = col('.lks14-note')
  const inTrio = mode === 'trio'
  const clipped = inTrio ? Math.max(0, Math.round(note.right - vb.right), Math.round(body.scrollWidth - body.clientWidth)) : 0
  // the notebook's insides: view tabs on one line, nothing running past the pane's right edge
  // (content inside a sideways scroller is legitimate)
  let tabs = null
  let spill = 0
  const spillList = []
  if (inTrio && note !== null) {
    const n = document.querySelector('.lks14-note')
    const row = n.querySelector('.lks14-viewtabs')
    const tabEls = [...n.querySelectorAll('.lks14-viewtab')]
    if (row !== null && tabEls.length > 0) {
      // one row = every tab shares a top; a line + padding is ≤ 40 layout px, a
      // wrapped label (概/念/图) made tabs 55–71px tall
      const tops = new Set(tabEls.map(t => Math.round(t.getBoundingClientRect().top)))
      const tallest = Math.max(...tabEls.map(t => t.getBoundingClientRect().height)) / zoom
      tabs = { rows: tops.size, tallest }
    }
    const right = n.getBoundingClientRect().right
    const hscroll = el => { const cs = getComputedStyle(el); return (cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1 }
    for (const el of n.querySelectorAll('*')) {
      let inside = false
      for (let p = el.parentElement; p !== null && p !== n; p = p.parentElement) if (hscroll(p)) { inside = true; break }
      if (inside) continue
      const b = el.getBoundingClientRect()
      if (b.width > 0 && b.right > right + 1) {
        spill++
        if (spillList.length < 3) spillList.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 28)} +${String(Math.round((b.right - right) / zoom))}px`)
      }
    }
  }
  return {
    view: vb.width, layout: body.clientWidth, zoom, mode,
    rail: rail === null ? null : rail.w, chat: chat === null ? null : chat.w, note: note === null ? null : note.w,
    clipped, tabs, spill, spillList,
  }
}, HANDLE_W)

const fmtRow = m => `${String(Math.round(m.view))}→${String(m.layout)}px ${m.mode} ${String(Math.round(m.rail ?? 0))}/${String(Math.round(m.chat ?? 0))}/${String(Math.round(m.note ?? 0))}${m.clipped > 0 ? ` CLIP ${String(m.clipped)}` : ''}`

/** Walk the width matrix in an open page; returns every measured row. */
const walk = async (page, label) => {
  const rows = []
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 })
    await page.waitForTimeout(450) // the 150ms width/flex-basis transitions + layout
    const m = await measure(page)
    if (m !== null) rows.push({ ...m, width, label })
  }
  return rows
}

/** A real pointer drag on a pane handle (fine pointer: mouse down / move / up). */
const drag = async (page, side, dx) => {
  const box = await page.locator(`[data-testid="pane-handle-${side}"]`).boundingBox()
  if (box === null) return 'missing'
  const x = box.x + box.width / 2
  const y = box.y + Math.min(300, box.height / 2)
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(500)
  return 'dragged'
}
const stored = (page, key) => page.evaluate((k) => localStorage.getItem(`dsh-plugin-lookatstudy:pane-${k}`), key)

// —— 1–4. default widths: the matrix ——
const all = []
for (const zoom of ZOOMS) {
  for (const sidebar of ['expanded', 'collapsed']) {
    const { context, page } = await openPanel({ zoom })
    await setSidebar(page, sidebar === 'collapsed')
    await page.locator('[data-dsh-lookatstudy-entry]').first().click()
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-dsh-lookatstudy-active'), undefined, { timeout: 20000 })
    await page.waitForSelector('.lks14-body', { timeout: 30000 })
    await page.waitForTimeout(1200)
    await page.waitForSelector('.lks14-note .lks14-prose > *', { timeout: 20000 }).catch(() => {}) // the teach prose lands on its own schedule
    await page.waitForTimeout(400)
    for (const row of await walk(page, sidebar)) all.push({ ...row, zoom, sidebar })
    if (shots && zoom === '1' && sidebar === 'expanded') {
      await page.setViewportSize({ width: 1366, height: 900 })
      await page.waitForTimeout(600)
      const box = await page.locator('[data-dsh-lookatstudy-view]').boundingBox()
      await page.screenshot({ path: 'lks-columns-trio-1366.png', clip: box })
    }
    await context.close()
  }
}
if (verbose) for (const r of all) console.log(`# zoom ${String(r.zoom)} ${String(r.sidebar).padEnd(9)} w=${String(r.width).padStart(4)} | ${fmtRow(r)}${r.tabs === null ? '' : ` tabs=${String(r.tabs.rows)}row/${String(Math.round(r.tabs.tallest))}px`}${r.spill === 0 ? '' : ` spill=${String(r.spill)} [${r.spillList.join('; ')}]`}`)
const trio = all.filter(r => r.mode === 'trio')
const switched = all.filter(r => r.mode === 'switch')
const clippedRows = trio.filter(r => r.clipped > 0)
const worstClip = Math.max(0, ...trio.map(r => r.clipped))
probe('1 default widths: the notebook is never pushed off-screen — width × sidebar × zoom',
  trio.length >= 30 && clippedRows.length === 0,
  `${String(trio.length)} trio rows, ${String(clippedRows.length)} clipped (worst ${String(worstClip)}px; the baseline clipped 19 of 48, by up to 387px)${clippedRows[0] === undefined ? '' : ` first: zoom ${String(clippedRows[0].zoom)} sidebar ${String(clippedRows[0].sidebar)} w=${String(clippedRows[0].width)} ${fmtRow(clippedRows[0])}`}`)
const minChat = Math.min(...trio.map(r => r.chat))
const minNote = Math.min(...trio.map(r => r.note))
const squeezedForNothing = trio.filter(r => r.note < NOTE_MIN - 1 && r.chat > CHAT_FLOOR + 0.5 && r.rail <= RAIL_DEFAULT + 0.5 && (r.layout - RAIL_DEFAULT - HANDLES_W) - HANDLE_W >= CHAT_FLOOR + HANDLE_W + NOTE_MIN)
probe('2 trio floors: chat ≥ 320 and notebook ≥ 320 layout px wherever the trio shows; the notebook keeps 440 whenever the row allows',
  minChat >= CHAT_FLOOR - 1 && minNote >= NOTE_FLOOR - 1 && squeezedForNothing.length === 0,
  `min chat ${String(Math.round(minChat))} / min notebook ${String(Math.round(minNote))}${squeezedForNothing[0] === undefined ? '' : `; squeezed with room to spare: ${fmtRow(squeezedForNothing[0])}`}`)
const modeMismatch = all.filter(r => Math.abs(r.layout - SWITCH_AT) > 2 && r.mode !== (r.layout <= SWITCH_AT ? 'switch' : 'trio'))
const narrowestTrio = trio.reduce((a, r) => (r.layout < a.layout ? r : a), trio[0])
probe('3 zoom-aware mode: the switch shows exactly when the panel LAYOUT width is ≤ 960 (zoom 0.9 / 1 / 1.1)',
  switched.length > 0 && modeMismatch.length === 0,
  `${String(switched.length)} switch rows / ${String(trio.length)} trio rows${modeMismatch[0] === undefined ? '' : `; mismatch: ${fmtRow(modeMismatch[0])}`}; narrowest trio: zoom ${String(narrowestTrio.zoom)} sidebar ${String(narrowestTrio.sidebar)} w=${String(narrowestTrio.width)} ${fmtRow(narrowestTrio)}`)
const tabsOk = trio.every(r => r.tabs !== null && r.tabs.rows === 1 && r.tabs.tallest <= 44)
const badTabs = trio.find(r => r.tabs === null || !(r.tabs.rows === 1 && r.tabs.tallest <= 44))
const spilling = trio.filter(r => r.spill > 0)
probe('4 the notebook stays whole in a narrow column: view tabs on one row, labels unbroken, nothing spills past the pane',
  tabsOk && spilling.length === 0,
  `${badTabs === undefined ? `every trio row keeps its ${String(trio.filter(r => r.tabs !== null).length)} tab rows on one line` : `tabs: ${badTabs.tabs === null ? 'missing' : `${String(badTabs.tabs.rows)} row(s), tallest ${String(Math.round(badTabs.tabs.tallest))}px`} at ${fmtRow(badTabs)}`}${spilling.length === 0 ? '' : `; ${String(spilling.length)} row(s) with content past the pane edge, e.g. ${spilling.slice(0, 3).map(r => `zoom ${String(r.zoom)} ${String(r.sidebar)} w=${String(r.width)} notebook ${String(Math.round(r.note))}px: ${r.spillList.join(', ')}`).join(' | ')}`}`)

// —— 5. stored widths: committed wide, then the column narrows ——
const storedRows = []
let honored = null
for (const zoom of ['1', '1.1']) {
  for (const sidebar of ['expanded', 'collapsed']) {
    const { context, page } = await openPanel({ zoom, rail: '480', chat: '1100' })
    await setSidebar(page, sidebar === 'collapsed')
    await page.locator('[data-dsh-lookatstudy-entry]').first().click()
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-dsh-lookatstudy-active'), undefined, { timeout: 20000 })
    await page.waitForSelector('.lks14-body', { timeout: 30000 })
    await page.waitForTimeout(1200)
    for (const row of await walk(page, sidebar)) storedRows.push({ ...row, zoom, sidebar })
    await context.close()
  }
}
if (verbose) for (const r of storedRows) console.log(`# stored zoom ${String(r.zoom)} ${String(r.sidebar).padEnd(9)} w=${String(r.width).padStart(4)} | ${fmtRow(r)}`)
const storedTrio = storedRows.filter(r => r.mode === 'trio')
const storedClipped = storedTrio.filter(r => r.clipped > 0)
const widest = storedTrio.reduce((a, r) => (r.layout > a.layout ? r : a), storedTrio[0])
probe('5 stored widths (rail 480 + chat 1100, then the host column narrows): re-squeezed, never clipped — and honored where they fit',
  storedTrio.length >= 10 && storedClipped.length === 0 && Math.abs(widest.rail - 480) <= 1 && Math.abs(widest.chat - 1100) <= 1,
  `${String(storedTrio.length)} trio rows, ${String(storedClipped.length)} clipped${storedClipped[0] === undefined ? '' : ` first: ${fmtRow(storedClipped[0])}`}; widest ${fmtRow(widest)}`)

// —— 6. real drags, fine pointer, sidebar expanded ——
// 1920: room to take — the chat handle may grow only down to the notebook's 440,
// and what it stores is what lands (the drag and the render-time solve must
// read the row the same way; a mismatch used to snap the chat back 6px on
// release). The rail handle grows while the (re-solved) chat still fits. A
// double-click on each handle brings the defaults back exactly.
// 1366: the tight band — the default chat already sits at its budget, so the
// handle cannot grow (the notebook is protected) but it still MOVES: down to
// the 320 floor, below the 480 golden width.
const { context: dragCtx, page } = await openPanel({ zoom: '1' })
await page.setViewportSize({ width: 1920, height: 900 })
await page.locator('[data-dsh-lookatstudy-entry]').first().click()
await page.waitForFunction(() => document.documentElement.hasAttribute('data-dsh-lookatstudy-active'), undefined, { timeout: 20000 })
await page.waitForSelector('.lks14-body', { timeout: 30000 })
await page.waitForTimeout(1200)
const wide = await measure(page)
const chatGrown = (await drag(page, 'chat', 400)) === 'dragged' ? await measure(page) : null
const storedChatWide = await stored(page, 'chat')
await page.locator('[data-testid="pane-handle-chat"]').dblclick()
await page.waitForTimeout(500)
const afterChatReset = await measure(page)
const railGrown = (await drag(page, 'rail', 400)) === 'dragged' ? await measure(page) : null
const storedRailWide = await stored(page, 'rail')
await page.locator('[data-testid="pane-handle-rail"]').dblclick()
await page.waitForTimeout(500)
const afterReset = await measure(page)
const storedAfterReset = `${String(await stored(page, 'rail'))}/${String(await stored(page, 'chat'))}`
await page.setViewportSize({ width: 1366, height: 900 })
await page.waitForTimeout(700)
const tight = await measure(page)
const chatGrownTight = (await drag(page, 'chat', 400)) === 'dragged' ? await measure(page) : null
const chatShrunk = (await drag(page, 'chat', -400)) === 'dragged' ? await measure(page) : null
const storedChatTight = await stored(page, 'chat')
const r1 = m => m === null ? 'missing' : `${String(Math.round(m.rail))}/${String(Math.round(m.chat))}/${String(Math.round(m.note))}`
const near = (a, b, tol) => Math.abs(a - b) <= tol
const dragsOk = wide !== null && wide.mode === 'trio' && wide.clipped === 0
  && chatGrown !== null && chatGrown.clipped === 0 && near(chatGrown.note, NOTE_MIN, 1) && chatGrown.chat > wide.chat + 100
  && storedChatWide !== null && near(Number(storedChatWide), chatGrown.chat, 1) // stored = landed: no snap-back
  && afterChatReset !== null && near(afterChatReset.chat, wide.chat, 1)
  && railGrown !== null && railGrown.clipped === 0 && railGrown.note >= NOTE_MIN - 1 && railGrown.rail > wide.rail + 1
  && afterReset !== null && near(afterReset.chat, wide.chat, 1) && near(afterReset.rail, wide.rail, 1) && storedAfterReset === 'null/null'
  && tight !== null && tight.mode === 'trio' && tight.clipped === 0
  && chatGrownTight !== null && near(chatGrownTight.chat, tight.chat, 1) // protected: the notebook has no slack to take
  && chatShrunk !== null && chatShrunk.clipped === 0 && near(chatShrunk.chat, CHAT_FLOOR, 1) && chatShrunk.chat < tight.chat && storedChatTight !== null
probe('6 real drags: both handles stay inside the budget (1920), stored = landed, double-click resets, the chat handle still moves in the tight band (1366)',
  dragsOk,
  `1920 default ${r1(wide)} → chat +400px ${r1(chatGrown)} (stored ${String(storedChatWide)}) → chat reset ${r1(afterChatReset)} → rail +400px ${r1(railGrown)} (stored ${String(storedRailWide)}) → reset ${r1(afterReset)} (stored ${String(storedAfterReset)}) | 1366 default ${r1(tight)} → chat +400px ${r1(chatGrownTight)} → chat −400px ${r1(chatShrunk)} (stored ${String(storedChatTight)})`)
await dragCtx.close()

probe('7 zero page errors across the whole run (uncaught + same-origin; CDN hiccups reported, not gated)', pageErrors.length === 0,
  `${pageErrors[0]?.slice(0, 160) ?? 'clean'}${cdnHiccups.length === 0 ? '' : ` | cdn: ${[...new Set(cdnHiccups)].slice(0, 2).join(' ; ').slice(0, 200)}`}`)

await browser.close()
const failed = results.filter(r => !r.ok)
console.log(failed.length === 0 ? `ALL ${String(results.length)} PASS` : `${String(failed.length)}/${String(results.length)} FAIL`)
process.exit(failed.length === 0 ? 0 : 1)

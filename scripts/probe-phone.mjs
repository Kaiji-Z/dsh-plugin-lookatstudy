/**
 * Phone-form live probe (2026-11-26). dsh 0.2.2 ships a phone posture: below
 * 768px the sidebar is a MODAL drawer (slid out by default, a 打开侧边栏
 * button pinned top-left) and the center column IS the screen (390–430px on
 * current phones). The study panel is DOM-level — a row in that drawer plus a
 * takeover of that column — so this probe drives the real thing at 390×844
 * under touch emulation (isMobile + hasTouch + an iPhone UA, so the coarse-
 * pointer media queries engage) and pins the round's fixes:
 *   1. the host boots in drawer mode and the study row lives inside the drawer
 *   2. drawer open: the row is visible and tappable
 *   3. tapping the row opens the panel AND shuts the drawer (native-row parity)
 *   4. the panel owns the screen: full viewport, narrow switch, handles hidden
 *   5. the host's drawer opener stays on top of the panel
 *   6. the app header keeps room for the title and spills nothing
 *   7. the 课程 pane fits the screen
 *   8. the rail's floating chrome does not cover the first section head
 *   9. the 对话 pane fits the screen (composer included)
 *  10. the 黑板 pane fits the screen — every view tab (the 440px floor is lifted)
 *  11. every visible text field is ≥16px (iOS Safari focus zoom)
 *  12. touch targets: nothing under 24×24; the primaries at their touch sizes
 *  13. the pane swipe still works on plain content
 *  14. the swipe guard: a sideways-scrolling block, a text field, the starter
 *      row, or a two-finger start never switches panes
 *  15. way back: the drawer row toggles the panel off; the conversation returns
 *  16. phone-width matrix (430×932 / 844×390 landscape / 820×1180 iPad): no
 *      clipped column, no horizontal page scroll, the row survives the icon rail
 *  17. zero page errors (uncaught + same-origin failures; cross-origin CDN
 *      hiccups are reported in the detail, never gated)
 *  18. the starter chips stay one line (their row scrolls — it never squeezes
 *      the labels into mid-word breaks) and the composer carries no resize
 *      grip under a finger. Vacuous when the focused lesson renders no
 *      starters (a fresh, never-opened thread shows the 开始学习 card
 *      instead) — the detail says so; the owner's own state renders them.
 *  19. the lesson's mermaid diagram renders WHOLE inside the pane (non-degenerate:
 *      ≥100px wide, ≥4 node rects, inside the edge — the collapsed race read a
 *      16px blank box): it used to collapse whenever another container (a chat
 *      message, an artifact card) rendered its own diagram — the per-container
 *      render id made mermaid tear down the earlier SVG (global ids now).
 *      Vacuous when no diagram appears within the wait (no mermaid fence, or
 *      the CDN is unreachable) — the detail says so.
 *
 * READ-ONLY for learner state: NO lesson click (a click IS an attempt), NO
 * send, NO write route. One write path exists regardless and is pinned by the
 * context locale: the panel's mount effect posts the host interface language
 * to /api/prefs, and the dashboard persists it when it differs from the stored
 * value — so the locale here is zh-CN (the owner's stored value). Run the
 * probe from any other locale and it rewrites the shared state.json.
 *
 * A note on the rail pane audit: the rail track is a 200%-wide strip
 * (课程 | 导入), so the 导入 pane sits off-screen BY DESIGN and is excluded.
 *
 * Usage: node scripts/probe-phone.mjs <token> [--url http://127.0.0.1:3081] [--no-shots]
 * Screenshots land in the cwd as lks-phone-NN-*.png (gitignored via lks-*.png).
 */
import { createRequire } from 'node:module'

const token = process.argv[2]
if (token === undefined || token === '') {
  console.error('usage: node scripts/probe-phone.mjs <token> [--url base] [--no-shots]')
  process.exit(2)
}
const baseIdx = process.argv.indexOf('--url')
const base = baseIdx > 0 ? process.argv[baseIdx + 1] : 'http://127.0.0.1:3081'
const shots = !process.argv.includes('--no-shots')

const require = createRequire('D:/Users/kaiji/vibecodingKJ/clones/deepseek-ai/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/package.json')
const { chromium } = require('playwright')

const PHONE = { width: 390, height: 844 }
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const SIDEBAR = '[class*="sidebarCol"]'

const results = []
const probe = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === '' ? '' : ` — ${detail}`}`)
}

const browser = await chromium.launch({ executablePath: 'C:/Users/kaiji/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe' })
const context = await browser.newContext({
  viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA, locale: 'zh-CN',
})
const page = await context.newPage()
// The error gate: uncaught exceptions, console errors that are not resource
// loads, and same-origin request failures (our routes + the host's). A
// cross-origin CDN hiccup (KaTeX/shiki/mermaid load on demand — a cold edge
// closing the connection was seen once in 3 runs) is reported, never gated.
const pageErrors = []
const cdnHiccups = []
page.on('pageerror', e => { pageErrors.push(String(e)) })
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) pageErrors.push(`console: ${m.text().slice(0, 200)}`) })
page.on('requestfailed', r => {
  const url = r.url()
  const reason = r.failure()?.errorText ?? 'failed'
  if (reason === 'net::ERR_ABORTED') return // an unmounted consumer cancelled its own poll
  ;(url.startsWith(base) ? pageErrors : cdnHiccups).push(`${reason} ${url.slice(0, 140)}`)
})
page.on('response', r => { if (r.status() >= 400 && r.url().startsWith(base)) pageErrors.push(`HTTP ${String(r.status())} ${r.url().slice(0, 140)}`) })

let shotNo = 0
const shot = async name => { if (shots) await page.screenshot({ path: `lks-phone-${String(++shotNo).padStart(2, '0')}-${name}.png` }) }

/** 0.2.x hosts greet a fresh browser profile with the 预览版说明 notice — a
 * role=presentation modal whose mask blocks every host click until 继续.
 * Dispatched, never clicked (the mask fails hit-testing); only a literal
 * button with non-empty text outside the study panel counts. */
const dismissHostNotice = () => page.evaluate(() => {
  for (const modal of document.querySelectorAll('div[role="presentation"]')) {
    const button = [...modal.querySelectorAll('button')]
      .find(b => (b.textContent ?? '').trim() !== '' && b.closest('[data-dsh-lookatstudy-view]') === null)
    if (button === undefined) continue
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return true
  }
  return false
})

/** The host frame's drawer state + where the study row currently sits. */
const frameState = () => page.evaluate((sel) => {
  const column = document.querySelector(sel)
  const frame = column === null ? null : column.parentElement
  const row = document.querySelector('[data-dsh-lookatstudy-entry]')
  const rb = row === null ? null : row.getBoundingClientRect()
  const hit = rb === null || rb.width === 0 ? null : document.elementFromPoint(rb.left + rb.width / 2, rb.top + rb.height / 2)
  return {
    width: window.innerWidth, height: window.innerHeight,
    drawer: frame?.hasAttribute('data-sidebar-drawer') ?? null,
    collapsed: frame?.hasAttribute('data-sidebar-collapsed') ?? null,
    // the drawer is slid in: drawer mode without the collapsed flag
    open: frame !== null && frame.hasAttribute('data-sidebar-drawer') && !frame.hasAttribute('data-sidebar-collapsed'),
    centerInert: document.querySelector('[class*="centerCol"]')?.inert ?? null,
    active: document.documentElement.hasAttribute('data-dsh-lookatstudy-active'),
    rowInsideSidebar: row !== null && column !== null && column.contains(row),
    rowRect: rb === null ? null : { x: Math.round(rb.left), y: Math.round(rb.top), w: Math.round(rb.width), h: Math.round(rb.height) },
    rowHittable: hit === null ? null : (row?.contains(hit) ?? false),
    rowLabelShown: row === null ? null : getComputedStyle(row.querySelector('.lks14-sidebar-label') ?? row).display !== 'none',
    // the host's own rows, for density parity (the exact _sessionRow token,
    // never a child class that merely contains the substring)
    hostRowH: [...document.querySelectorAll('[class*="sidebarCol"] [class]')]
      .filter(el => [...el.classList].some(c => /_sessionRow$/.test(c)))
      .map(el => Math.round(el.getBoundingClientRect().height)).filter(h => h > 0).sort((a, b) => a - b)[0] ?? null,
    docScrollWidth: document.documentElement.scrollWidth,
  }
}, SIDEBAR)
const drawerOpen = () => page.evaluate((sel) => {
  const f = document.querySelector(sel)?.parentElement
  return f !== undefined && f !== null && f.hasAttribute('data-sidebar-drawer') && !f.hasAttribute('data-sidebar-collapsed')
}, SIDEBAR)
const panelActive = () => page.evaluate(() => document.documentElement.hasAttribute('data-dsh-lookatstudy-active'))

const openDrawer = async () => {
  await page.locator('[data-shell-leading] button').first().tap()
  await page.waitForFunction((sel) => {
    const f = document.querySelector(sel)?.parentElement
    return f !== undefined && f !== null && f.hasAttribute('data-sidebar-drawer') && !f.hasAttribute('data-sidebar-collapsed')
  }, SIDEBAR, { timeout: 15000 })
  await page.waitForTimeout(1000) // the slide-in transition + the session list settling
}
/** The mask covers everything right of the drawer: tap past its 280px edge. */
const closeDrawerByMask = async () => {
  await page.locator('[data-sidebar-mask]').tap({ position: { x: 320, y: 400 } })
  await page.waitForFunction((sel) => {
    const f = document.querySelector(sel)?.parentElement
    return f !== undefined && f !== null && (!f.hasAttribute('data-sidebar-drawer') || f.hasAttribute('data-sidebar-collapsed'))
  }, SIDEBAR, { timeout: 15000 })
  await page.waitForTimeout(700)
}
const waitPanelReady = async () => {
  await page.waitForSelector('.lks14-body[data-pane]', { timeout: 30000 })
  await page.waitForTimeout(900) // the state poll lands the thread rows
}

/** Geometry of the mounted panel against the real viewport, scoped to the
 * visible pane (rail → the on-screen 课程 track pane; chat/note → the right
 * half, header included — the hidden sibling pane is display:none). */
const metrics = () => page.evaluate(() => {
  const view = document.querySelector('[data-dsh-lookatstudy-view]')
  const root = document.querySelector('.lks14')
  if (view === null || root === null) return null
  const vw = window.innerWidth
  const vh = window.innerHeight
  const rect = el => { const b = el.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), right: Math.round(b.right), bottom: Math.round(b.bottom) } }
  const shown = el => { const cs = getComputedStyle(el); const b = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && b.width > 0 && b.height > 0 }
  const desc = el => {
    const cls = typeof el.className === 'string' && el.className !== '' ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''
    const label = el.getAttribute('aria-label') ?? el.getAttribute('data-tooltip') ?? ''
    return `${el.tagName.toLowerCase()}${cls}${label === '' ? '' : `[${label.slice(0, 20)}]`}"${(el.textContent ?? '').trim().slice(0, 14)}"`
  }
  const body = root.querySelector('.lks14-body')
  const pane = body?.getAttribute('data-pane') ?? null
  const scope = pane === 'rail'
    ? root.querySelector('.lks14-railpane')
    : root.querySelector('.lks14-righthalf')
  if (scope === null) return { pane, missing: 'scope' }
  const hscroll = el => { const cs = getComputedStyle(el); return (cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1 }
  const inHScroller = el => { for (let n = el.parentElement; n !== null && n !== scope; n = n.parentElement) if (hscroll(n)) return true; return false }
  const all = [...scope.querySelectorAll('*')]
  const visible = all.filter(shown)
  const leafMost = els => els.filter(el => !els.some(o => o !== el && el.contains(o)))
  // content past the screen edge that is NOT inside a sideways scroller
  const overflow = leafMost(visible.filter(el => {
    if (inHScroller(el)) return false
    const b = el.getBoundingClientRect()
    return b.right > vw + 0.5 || b.left < -0.5
  })).slice(0, 8).map(el => ({ el: desc(el), ...rect(el) }))

  // WCAG 2.2 2.5.8 scope: buttons and form controls. Inline text links are
  // the criterion's own "inline" exception (a 24px-tall anchor would tear
  // the line box), so anchors are not audited.
  const interactiveSel = 'button, input, select, textarea, [role="button"], [role="tab"]'
  const interactive = [...scope.querySelectorAll(interactiveSel)].filter(shown)
  const small = interactive.map(el => ({ el: desc(el), ...rect(el) })).filter(t => t.w < 24 || t.h < 24)
  const fields = [...scope.querySelectorAll('input:not([type="file"]):not([type="checkbox"]):not([type="radio"]), textarea')]
    .filter(shown).map(el => ({ el: desc(el), font: Number.parseFloat(getComputedStyle(el).fontSize) }))
  const size = sel => { const el = root.querySelector(sel); return el === null || !shown(el) ? null : rect(el) }
  const header = root.querySelector('.lks14-appheader')
  const headerChildren = header !== null && shown(header)
    ? [...header.children].filter(shown).map(c => ({ cls: c.className.slice(0, 28), ...rect(c) }))
    : []
  const railtop = root.querySelector('.lks14-railtop')
  const firstHead = scope.querySelector('.lks-railsec-head')
  const paneBox = (sel) => { const el = root.querySelector(sel); return el === null ? null : shown(el) ? rect(el) : 'hidden' }
  return {
    pane, vw, vh,
    view: rect(view),
    cols: { rail: paneBox('.lks14-rail'), chat: paneBox('.lks14-chat'), note: paneBox('.lks14-note') },
    switchShown: (() => { const s = root.querySelector('.lks14-switch'); return s !== null && shown(s) })(),
    switchBtns: [...root.querySelectorAll('.lks14-switch-btn')].map(b => rect(b).h),
    paneHandleShown: [...root.querySelectorAll('.lks14-panehandle')].some(shown),
    overflow,
    small,
    fields,
    headerChildren,
    composer: size('.lks14-composer'),
    composerText: size('.lks14-composertext'),
    send: size('.lks-btn-send'),
    attach: size('.lks-btn-attach'),
    pills: [...root.querySelectorAll('.lks14-composer .lks14-pill')].filter(shown).map(p => rect(p).h),
    // the starter row: one line per chip (a 14–16px line + padding + the 32px
    // touch floor lands at 32–36px; a two-line label is ≥44px), and the row
    // itself is the sideways scroller
    starters: [...root.querySelectorAll('.lks14-starter')].filter(shown).map(s => ({ el: desc(s), ...rect(s) })),
    starterRow: (() => { const r = root.querySelector('.lks14-starters'); return r === null || !shown(r) ? null : { scrollW: r.scrollWidth, clientW: r.clientWidth, overflowX: getComputedStyle(r).overflowX } })(),
    composerResize: (() => { const t = root.querySelector('.lks14-composertext'); return t === null ? null : getComputedStyle(t).resize })(),
    railChrome: railtop !== null && shown(railtop) && firstHead !== null ? { chromeBottom: rect(railtop).bottom, firstHeadTop: rect(firstHead).y } : null,
    coarse: matchMedia('(pointer: coarse)').matches,
  }
})

/** A synthetic single-finger flick (React's touch handlers take it like a real
 * one): touchstart at the element, touchend dx/dy away. Two fingers on request. */
const flick = (selector, dx, dy, fingers = 1) => page.evaluate(({ sel, dx, dy, fingers }) => {
  const target = document.querySelector(sel)
  if (target === null) return 'missing'
  const r = target.getBoundingClientRect()
  const x = Math.max(12, Math.min(r.left + r.width * 0.7, window.innerWidth - 12))
  const y = Math.max(12, Math.min(r.top + Math.min(r.height * 0.4, 240), window.innerHeight - 12))
  const touch = (id, px, py) => new Touch({ identifier: id, target, clientX: px, clientY: py, pageX: px, pageY: py })
  const ev = (type, touches, changed) => new TouchEvent(type, { bubbles: true, cancelable: true, touches, targetTouches: touches, changedTouches: changed })
  const starts = [touch(1, x, y)]
  if (fingers > 1) starts.push(touch(2, x + 24, y + 24))
  target.dispatchEvent(ev('touchstart', starts, starts))
  const first = touch(1, x + dx, y + dy)
  target.dispatchEvent(ev('touchend', fingers > 1 ? [starts[1]] : [], [first]))
  return 'sent'
}, { sel: selector, dx, dy, fingers })
const paneNow = () => page.evaluate(() => document.querySelector('.lks14-body')?.getAttribute('data-pane') ?? null)
const tapPane = async index => {
  await page.locator('.lks14-switch-btn').nth(index).tap()
  await page.waitForTimeout(500)
}
/** A probe-owned sideways scroller: proves the guard without depending on the
 * focused lesson carrying a wide code block. Removed by the caller. */
const plantScroller = () => page.evaluate(() => {
  const host = document.querySelector('.lks14-note') ?? document.querySelector('.lks14-righthalf')
  if (host === null) return 'missing'
  const box = document.createElement('div')
  box.id = 'lks-probe-hscroll'
  box.style.cssText = 'overflow-x:auto;width:200px;height:48px'
  const inner = document.createElement('span')
  inner.style.cssText = 'display:inline-block;width:640px;height:40px'
  box.appendChild(inner)
  host.appendChild(box)
  return 'planted'
})
const unplantScroller = () => page.evaluate(() => { document.getElementById('lks-probe-hscroll')?.remove() })

const fits = m => m.overflow.length === 0 && Object.values(m.cols).every(c => c === null || typeof c !== 'object' || c.right <= m.vw + 1)
const fitDetail = m => `overflow=${String(m.overflow.length)}${m.overflow[0] === undefined ? '' : ` first=${m.overflow[0].el} right=${String(m.overflow[0].right)}`}`

await page.goto(`${base}/?token=${token}`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-dsh-lookatstudy-entry]', { state: 'attached', timeout: 90000 })
await page.waitForTimeout(3000)
for (let i = 0; i < 3; i++) { if (!(await dismissHostNotice())) break; await page.waitForTimeout(800) }
await page.waitForTimeout(600)

// —— 1. boot: drawer mode, the row inside the drawer ——
await shot('boot')
const f1 = await frameState()
probe('1 host boots in drawer mode and the study row lives inside the drawer',
  f1.drawer === true && f1.collapsed === true && f1.open === false && f1.rowInsideSidebar === true && f1.width === PHONE.width,
  `${String(f1.width)}x${String(f1.height)} drawer=${String(f1.drawer)} collapsed=${String(f1.collapsed)}`)

// —— 2. drawer open: the row is visible and tappable ——
await openDrawer()
// the session list hydrates on its own schedule (first load: seconds) — the
// host-row height is a density-parity DETAIL, so wait briefly, never fail
await page.waitForSelector('[class*="sidebarCol"] [class*="_sessionRow"]', { timeout: 6000 }).catch(() => {})
await shot('drawer')
const f2 = await frameState()
probe('2 drawer open: the study row is visible and tappable', f2.open === true && f2.rowHittable === true && f2.centerInert === true,
  `row=${JSON.stringify(f2.rowRect)} hostSessionRowH=${f2.hostRowH === null ? 'n/a (no session row rendered yet)' : String(f2.hostRowH)}`)

// —— 3. tap the row: the panel opens AND the drawer shuts itself ——
// The mask is watched so the detail says WHICH route shut the drawer: the
// layout face (ctx.layout.toggleSidebar) or the DOM fallback (a mask click).
await page.evaluate(() => {
  window.__lksMaskClicks = 0
  document.querySelector('[data-sidebar-mask]')?.addEventListener('click', () => { window.__lksMaskClicks++ }, true)
})
await page.locator('[data-dsh-lookatstudy-entry]').tap()
await page.waitForFunction(() => document.documentElement.hasAttribute('data-dsh-lookatstudy-active'), undefined, { timeout: 15000 })
const t0 = Date.now()
let shutAt = -1
while (Date.now() - t0 < 4000) {
  if (!(await drawerOpen())) { shutAt = Date.now() - t0; break }
  await page.waitForTimeout(30)
}
await page.waitForTimeout(700)
await waitPanelReady()
await shot('panel')
const f3 = await frameState()
const maskClicks = await page.evaluate(() => window.__lksMaskClicks ?? 0)
probe('3 tapping the study row opens the panel AND shuts the drawer (native-row parity)',
  shutAt >= 0 && f3.active === true && f3.open === false && f3.centerInert === false,
  `drawer shut ≤${String(shutAt < 0 ? 4000 : shutAt)}ms after the panel activated via ${maskClicks > 0 ? 'the mask fallback' : 'the layout face'} centerInert=${String(f3.centerInert)}`)

// —— 4/5. the panel owns the screen; the drawer opener stays on top ——
const m4 = await metrics()
const seat = await page.evaluate(() => {
  const btn = document.querySelector('[data-shell-leading] button')
  if (btn === null) return 'absent'
  const b = btn.getBoundingClientRect()
  const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)
  return hit !== null && btn.contains(hit) ? 'seat-button' : `covered-by:${hit === null ? 'none' : hit.tagName.toLowerCase()}`
})
probe('4 the panel owns the screen: full viewport, narrow switch, pane handles hidden',
  m4 !== null && m4.view.x === 0 && m4.view.y === 0 && m4.view.w === PHONE.width && m4.view.h === PHONE.height
    && m4.switchShown === true && m4.paneHandleShown === false && m4.coarse === true,
  m4 === null ? 'metrics missing' : `view=${String(m4.view.w)}x${String(m4.view.h)} pane=${String(m4.pane)} switchBtnH=${m4.switchBtns.join('/')}`)
probe("5 the host's drawer opener stays on top of the panel", seat === 'seat-button', seat)

// —— 6/9/12 chat pane ——
await tapPane(1)
const chat = await metrics()
const title = chat.headerChildren.find(c => c.cls === 'lks-hdr-title')
const headerSpill = chat.headerChildren.filter(c => c.right > chat.vw + 1)
probe('6 the app header keeps room for the title and spills nothing',
  title !== undefined && title.w >= 60 && headerSpill.length === 0,
  `title=${title === undefined ? 'missing' : `${String(title.w)}px`} spill=${String(headerSpill.length)}${headerSpill[0] === undefined ? '' : ` (${headerSpill[0].cls}→${String(headerSpill[0].right)})`}`)
probe('9 the 对话 pane fits the screen (composer included)', fits(chat) && chat.composer !== null && chat.composer.bottom <= chat.vh + 1, fitDetail(chat))

// —— 18. starter chips stay one line; no resize grip under a finger ——
// Screenshot-caught: the four chips shrank to ~77px and broke their labels
// mid-word (深入这/点) because a flex item shrinks by default — the row is a
// sideways scroller that never got to scroll.
const chipHeights = chat.starters.map(s => s.h)
const chipsOneLine = chat.starters.every(s => s.h <= 36)
const rowScrolls = chat.starterRow === null
  || chat.starterRow.scrollW <= chat.starterRow.clientW + 1 // everything fits: nothing to scroll
  || (chat.starterRow.overflowX === 'auto' || chat.starterRow.overflowX === 'scroll') // it does not fit: the row IS the scroller
probe('18 the starter chips stay one line (the row scrolls, never squeezes) and the composer has no resize grip on touch',
  chipsOneLine && rowScrolls && chat.composerResize === 'none',
  `starters=${chat.starters.length === 0 ? 'none rendered in this state (row check vacuous)' : `h=${chipHeights.join('/')} w=${chat.starters.map(s => String(s.w)).join('/')} row=${chat.starterRow === null ? 'missing' : `${String(chat.starterRow.scrollW)}/${String(chat.starterRow.clientW)} ${chat.starterRow.overflowX}`}`} composerResize=${String(chat.composerResize)}`)

// —— 10/13/14 黑板 pane: fit on every view tab; the swipe feature + its guard ——
await tapPane(2)
const note = await metrics()
let noteTabsFit = true
const noteTabs = await page.locator('.lks14-viewtab').count()
const tabNames = []
for (let i = 0; i < noteTabs; i++) {
  if (i > 0) await page.locator('.lks14-viewtab').nth(i).tap()
  await page.waitForTimeout(400)
  const m = await metrics()
  tabNames.push(`${String(await page.locator('.lks14-viewtab').nth(i).textContent())?.trim()}:${fits(m) ? 'ok' : 'X'}`)
  if (!fits(m)) noteTabsFit = false
}
await page.locator('.lks14-viewtab').nth(0).tap()
await page.waitForTimeout(400)
await shot('note')
// —— 19. the lesson's mermaid diagram, once the CDN pipeline delivers it ——
const diagramWait = page.waitForSelector('.lks14-note .lks-mermaid svg', { timeout: 45000 }).then(() => 'rendered').catch(() => 'none')
const diagramState = await diagramWait
let diagramOk = true
let diagramDetail = diagramState === 'none'
  ? 'no diagram rendered within 45s (no mermaid fence in the lesson, or the CDN is unreachable) — check vacuous'
  : ''
if (diagramState === 'rendered') {
  const d = await page.evaluate(() => {
    const svg = document.querySelector('.lks14-note .lks-mermaid svg')
    const b = svg.getBoundingClientRect()
    const note = document.querySelector('.lks14-note')
    const nb = note.getBoundingClientRect()
    return { w: Math.round(b.width), h: Math.round(b.height), right: Math.round(b.right), noteRight: Math.round(nb.right), rects: svg.querySelectorAll('rect').length }
  })
  // a healthy render fills a real slice of the 350px pane; the collapsed race
  // read 16×16 (mermaid's marker-defs viewBox leaking as the whole box). Height
  // is shape-dependent — this lesson's diagram is a wide flat flowchart (350×33).
  diagramOk = d.w >= 100 && d.h >= 24 && d.rects >= 4 && d.right <= d.noteRight + 1
  diagramDetail = `diagram ${String(d.w)}x${String(d.h)} (${String(d.rects)} rects, right ${String(d.right)} ≤ note ${String(d.noteRight)})${diagramOk ? '' : ' — COLLAPSED or clipped (the render-id race read 16px)'}`
}
probe('19 the lesson mermaid diagram renders whole inside the pane (the per-container render id collapsed it to 16px)',
  diagramOk, diagramDetail)

probe('10 the 黑板 pane fits the screen on every view tab (the 440px floor is lifted)',
  fits(note) && note.cols.note !== null && note.cols.note !== 'hidden' && note.cols.note.right <= note.vw + 1 && noteTabsFit,
  `${fitDetail(note)} noteRight=${typeof note.cols.note === 'object' ? String(note.cols.note.right) : String(note.cols.note)}/${String(note.vw)} tabs=${tabNames.join(' ')}`)

// the swipe feature: a plain rightward flick on notebook prose leaves for 对话
// (a paragraph that is not inside a sideways scroller gets marked first)
const proseMarked = await page.evaluate(() => {
  for (const p of document.querySelectorAll('.lks14-note p')) {
    let blocked = false
    for (let n = p.parentElement; n !== null && !n.classList.contains('lks14-note'); n = n.parentElement) {
      const cs = getComputedStyle(n)
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && n.scrollWidth > n.clientWidth + 1) blocked = true
    }
    if (!blocked && p.getBoundingClientRect().height > 0) {
      p.setAttribute('data-lks-probe-prose', '')
      return true
    }
  }
  return false
})
await flick(proseMarked ? '[data-lks-probe-prose]' : '.lks14-note', 120, 4)
await page.waitForTimeout(400)
const afterProseFlick = await paneNow()
probe('13 the pane swipe still works on plain content', afterProseFlick === 'chat', `note → ${String(afterProseFlick)}`)

// the guard, in 对话: the composer textarea + a two-finger start
await tapPane(1)
await flick('.lks14-composertext', 120, 4)
await page.waitForTimeout(400)
const afterFieldFlick = await paneNow()
await flick('.lks14-stream', -120, 4, 2)
await page.waitForTimeout(400)
const afterTwoFinger = await paneNow()
// …and the starter row, a real sideways scroller at phone width (when the
// focused lesson renders starters): a rightward flick on a chip scrolls the
// row, it must not leave the pane
const starterFlick = await flick('.lks14-starter', 120, 4)
await page.waitForTimeout(400)
const afterStarter = await paneNow()
// …and a sideways scroller in 黑板: rightward flick inside it must NOT leave
await tapPane(2)
const natural = await page.evaluate(() => {
  const el = [...document.querySelectorAll('.lks14-note pre, .lks14-note table, .lks14-note .katex-display')]
    .find(n => n.scrollWidth > n.clientWidth + 1)
  if (el === undefined) return null
  el.setAttribute('data-lks-probe-hscroll', '')
  return { w: el.scrollWidth, cw: el.clientWidth }
})
if (natural !== null) await flick('[data-lks-probe-hscroll]', 120, 4)
await page.waitForTimeout(400)
const afterNatural = await paneNow()
const planted = await plantScroller()
await page.waitForTimeout(150)
await flick('#lks-probe-hscroll span', 120, 4)
await page.waitForTimeout(400)
const afterPlanted = await paneNow()
await unplantScroller()
probe('14 the swipe guard: a text field, a two-finger start, and a sideways scroller never switch panes',
  afterFieldFlick === 'chat' && afterTwoFinger === 'chat' && (starterFlick === 'missing' || afterStarter === 'chat') && afterPlanted === 'note' && (natural === null || afterNatural === 'note') && planted === 'planted',
  `field→${String(afterFieldFlick)} twoFinger→${String(afterTwoFinger)} starterRow=${starterFlick === 'missing' ? 'none-in-lesson' : `→${String(afterStarter)}`} natural=${natural === null ? 'none-in-lesson' : `${String(natural.w)}>${String(natural.cw)}→${String(afterNatural)}`} planted=${planted}→${String(afterPlanted)}`)

// —— 11/12 fields + touch targets, pane by pane ——
const fieldReport = []
const targetReport = []
let fieldsOk = true
let targetsOk = true
for (const [index, label] of [[0, '课程'], [1, '对话'], [2, '黑板']]) {
  await tapPane(index)
  const m = await metrics()
  const smallFonts = m.fields.filter(f => f.font < 16)
  if (smallFonts.length > 0) fieldsOk = false
  fieldReport.push(`${label}:${m.fields.length === 0 ? 'no field' : m.fields.map(f => `${f.el.split('"')[0]}=${String(f.font)}`).join(',')}`)
  if (m.small.length > 0) targetsOk = false
  targetReport.push(`${label}:${String(m.small.length)} under 24${m.small[0] === undefined ? '' : ` (${m.small[0].el} ${String(m.small[0].w)}x${String(m.small[0].h)})`}`)
  if (index === 1) {
    const sendOk = m.send !== null && m.send.w >= 44 && m.send.h >= 44
    const attachOk = m.attach !== null && m.attach.w >= 40 && m.attach.h >= 40
    const pillsOk = m.pills.length > 0 && m.pills.every(h => h >= 32)
    const switchOk = m.switchBtns.length === 3 && m.switchBtns.every(h => h >= 36)
    if (!(sendOk && attachOk && pillsOk && switchOk)) targetsOk = false
    targetReport.push(`primaries:send=${m.send === null ? 'missing' : `${String(m.send.w)}x${String(m.send.h)}`} attach=${m.attach === null ? 'missing' : `${String(m.attach.w)}x${String(m.attach.h)}`} pillsH=${m.pills.join('/') || '-'} switchH=${m.switchBtns.join('/')}`)
  }
  if (index === 0) await shot('rail')
}
probe('11 every visible text field is ≥16px on touch (no iOS Safari focus zoom)', fieldsOk, fieldReport.join(' | '))
probe('12 touch targets: nothing under 24×24; the primaries at their touch sizes', targetsOk, targetReport.join(' | '))

// —— 7/8. the 课程 pane: fit + the floating chrome's reservation ——
await tapPane(0)
const rail = await metrics()
probe('7 the 课程 pane fits the screen', fits(rail), fitDetail(rail))
probe('8 the rail chrome does not cover the first section head', rail.railChrome === null || rail.railChrome.firstHeadTop >= rail.railChrome.chromeBottom - 1,
  rail.railChrome === null ? 'no section to measure (empty course)' : `chromeBottom=${String(rail.railChrome.chromeBottom)} firstHeadTop=${String(rail.railChrome.firstHeadTop)}`)
await tapPane(1)
await shot('chat')

// —— 15. way back: the drawer row toggles the panel off; the conversation returns ——
await openDrawer()
const rowActiveWhileOpen = await page.getAttribute('[data-dsh-lookatstudy-entry]', 'data-active')
await shot('drawer-over-panel')
await page.locator('[data-dsh-lookatstudy-entry]').tap()
await page.waitForTimeout(500)
const f15a = await frameState()
// the drawer stays by design (the learner is still navigating it) — close it
if (await drawerOpen()) await closeDrawerByMask()
const conversation = await page.evaluate(() => {
  const center = document.querySelector('[class*="centerCol"]')
  const first = center === null ? null : center.firstElementChild
  return first === null ? 'none' : getComputedStyle(first).display
})
probe('15 way back: the drawer row toggles the panel off and the conversation returns',
  rowActiveWhileOpen === 'true' && f15a.active === false && f15a.open === true && conversation !== 'none',
  `rowDataActive=${String(rowActiveWhileOpen)} activeAfter=${String(f15a.active)} drawerStaysOpen=${String(f15a.open)} conversationDisplay=${String(conversation)}`)

// —— 16. phone-width matrix ——
await openDrawer()
await page.locator('[data-dsh-lookatstudy-entry]').tap()
await page.waitForFunction(() => document.documentElement.hasAttribute('data-dsh-lookatstudy-active'), undefined, { timeout: 15000 })
await page.waitForTimeout(500)
if (await drawerOpen()) await closeDrawerByMask()
const matrix = []
let matrixOk = true
for (const [w, h] of [[430, 932], [844, 390], [820, 1180]]) {
  await page.setViewportSize({ width: w, height: h })
  await page.waitForTimeout(900)
  const f = await frameState()
  const panesFit = []
  for (const index of [0, 1, 2]) {
    await tapPane(index)
    const m = await metrics()
    if (!fits(m)) matrixOk = false
    panesFit.push(m.pane === null ? '?' : fits(m) ? 'ok' : `X(${String(m.overflow.length)})`)
  }
  const rowOnScreen = f.rowRect !== null && f.rowRect.x >= 0 && f.rowRect.x + f.rowRect.w <= w + 1 && f.rowRect.w > 0
  // below 768 the drawer is slid out (the row is off-screen inside it, hidden)
  const rowOk = f.drawer === true ? f.rowInsideSidebar === true : rowOnScreen
  if (!(f.active === true && f.docScrollWidth <= w + 1 && rowOk)) matrixOk = false
  matrix.push(`${String(w)}x${String(h)}: drawer=${String(f.drawer)} doc=${String(f.docScrollWidth)} panes=${panesFit.join('/')} row=${rowOk ? 'ok' : 'X'}${f.drawer === true ? '' : ` labelShown=${String(f.rowLabelShown)}`}`)
  await shot(`matrix-${String(w)}x${String(h)}`)
}
probe('16 phone-width matrix: no clipped column, no page scroll, the row survives the icon rail', matrixOk, matrix.join(' | '))

// leave the profile as it was found: phone size, panel closed
await page.setViewportSize(PHONE)
await page.waitForTimeout(600)
if (await panelActive()) {
  if (await drawerOpen()) { /* already in */ } else await openDrawer()
  await page.locator('[data-dsh-lookatstudy-entry]').tap()
  await page.waitForTimeout(400)
  if (await drawerOpen()) await closeDrawerByMask()
}
probe('17 zero page errors across the whole run (uncaught, same-origin; CDN hiccups reported, not gated)', pageErrors.length === 0,
  `${pageErrors[0]?.slice(0, 160) ?? 'clean'}${cdnHiccups.length === 0 ? '' : ` | cdn: ${[...new Set(cdnHiccups)].slice(0, 2).join(' ; ').slice(0, 200)}`}`)

await browser.close()
const failed = results.filter(r => !r.ok)
console.log(failed.length === 0 ? `ALL ${String(results.length)} PASS` : `${String(failed.length)}/${String(results.length)} FAIL`)
process.exit(failed.length === 0 ? 0 : 1)

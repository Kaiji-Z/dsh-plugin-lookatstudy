/**
 * Alignment-round live probe (the four-gap goal): thread-management trio in
 * the live panel (rename with the HOST session title following, archive,
 * delete via ConfirmCard), the course-pack download, the P18 height chain,
 * and zero page errors. All UI steps are LLM-free (API-backed state writes)
 * — no turn-settle needed. The URL-import real-network check runs separately
 * (node, direct tool execute against a local fixture server) in probe part B.
 * Usage: node scripts/probe-align4.mjs <token> [--url http://127.0.0.1:3081]
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const token = process.argv[2]
if (token === undefined || token === '') {
  console.error('usage: node scripts/probe-align4.mjs <token> [--url base]')
  process.exit(2)
}
const baseIdx = process.argv.indexOf('--url')
const base = baseIdx > 0 ? process.argv[baseIdx + 1] : 'http://127.0.0.1:3081'

const require = createRequire('D:/Users/kaiji/vibecodingKJ/clones/deepseek-ai/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/package.json')
const { chromium } = require('playwright')

const STATE_PATH = 'D:/Users/kaiji/.dsh/lookatstudy-plugin/state.json'
const readState = () => JSON.parse(readFileSync(STATE_PATH, 'utf8'))
const LESSON = 'course:0:1'

const results = []
const probe = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === '' ? '' : ` — ${detail}`}`)
}

const waitState = async (pred, timeoutMs = 15000) => {
  const t0 = Date.now()
  for (;;) {
    if (pred(readState())) return true
    if (Date.now() - t0 > timeoutMs) return false
    await new Promise(r => setTimeout(r, 400))
  }
}

const menuRows = async (page) => page.evaluate(() => [...document.querySelectorAll('.lks14-threadmenu-row')].map(r => ({
  title: r.querySelector('.lks14-threadmenu-title')?.textContent ?? '',
  isNew: r.classList.contains('new'),
  current: r.getAttribute('aria-current') === 'true',
})))
const closeMenu = async (page) => { await page.keyboard.press('Escape'); await page.waitForTimeout(400) }
const rowIndexOf = async (page, title) => {
  const rows = (await menuRows(page)).filter(r => !r.isNew)
  return rows.findIndex(r => r.title === title)
}

const browser = await chromium.launch({ executablePath: 'C:/Users/kaiji/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe' })
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
const pageErrors = []
page.on('pageerror', e => { pageErrors.push(String(e)) })

await page.goto(`${base}/?token=${token}`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-dsh-lookatstudy-entry]', { timeout: 45000 })
await page.click('[data-dsh-lookatstudy-entry]')
await page.waitForSelector('.lks14-shell-view', { timeout: 45000 })

// ── course-pack: the route (node-side JSON assertions) + the button's download ──
const pack = await (await fetch(`${base}/lookatstudy/api/course-pack?courseId=${encodeURIComponent('course')}`)).json()
probe('pack route: self-contained JSON + markdown rendering', pack.ok === true && pack.pack?.kind === 'lookatstudy-course-pack' && pack.pack?.version === 1 && typeof pack.markdown === 'string' && pack.markdown.startsWith('# '), `file=${pack.fileName ?? 'none'}`)

const downloadPromise = page.waitForEvent('download', { timeout: 15000 })
await page.click('[data-testid="course-export"]')
const dl = await downloadPromise
const packPath = await dl.path()
const saved = readFileSync(packPath, 'utf8')
probe('pack button: the browser download lands the markdown file', dl.suggestedFilename().endsWith('.lookatstudy-pack.md') && saved.startsWith('# '), `name=${dl.suggestedFilename()} bytes=${saved.length}`)

// ── the trio on course:0:1 (yesterday's probe left two threads) ──
await page.click('[data-node-id="course:0:1"]')
await page.waitForSelector('.lks14-threadchip', { timeout: 15000 })
await page.click('.lks14-threadchip')
const rows0 = await menuRows(page)
const live0 = rows0.filter(r => !r.isNew)
probe('trio setup: the lesson group lists its two live threads', live0.length === 2, `rows=${String(live0.length)} titles=[${live0.map(r => r.title.slice(0, 12)).join('|')}]`)

const rowsLive = (await menuRows(page)).filter(r => !r.isNew)
const renameRow = rowsLive.find(r => !r.current) ?? rowsLive[0]
const deleteRow = rowsLive.find(r => r.current) ?? rowsLive[1] ?? rowsLive[0]
const RENAMED = '对齐探针改名'

// rename a NON-current thread: gear → 重命名 → inline input → Enter
const ri = await rowIndexOf(page, renameRow.title)
await page.locator('.lks14-threadmenu-row:not(.new)').nth(ri).hover()
await page.locator('.lks14-threadmenu-row:not(.new)').nth(ri).locator('.lks14-threadmenu-gear').click()
await page.waitForSelector('.lks14-threadmenu-actions', { timeout: 5000 })
await page.click('.lks14-threadmenu-actions button:first-child')
await page.waitForSelector('[data-testid="thread-rename-input"]', { timeout: 5000 })
await page.fill('[data-testid="thread-rename-input"]', RENAMED)
await page.press('[data-testid="thread-rename-input"]', 'Enter')
const renamedOk = await waitState(s2 => (s2.lessonThreads?.[LESSON]?.threads ?? []).some(t => t.title === RENAMED))
probe('rename: the state title updates through the route', renamedOk)
const hostTitleSeen = await page.waitForFunction(
  (needle) => [...document.querySelectorAll('[role="treeitem"]')].some(el => (el.textContent ?? '').includes(needle)),
  RENAMED, { timeout: 25000 },
).then(() => true, () => false)
probe('rename: the HOST session list title follows (session.rename face)', hostTitleSeen)

// archive the renamed thread (non-current): pills drop 2 → 1
await closeMenu(page)
await page.click('.lks14-threadchip')
const ai = await rowIndexOf(page, RENAMED)
await page.locator('.lks14-threadmenu-row:not(.new)').nth(ai).hover()
await page.locator('.lks14-threadmenu-row:not(.new)').nth(ai).locator('.lks14-threadmenu-gear').click()
await page.waitForSelector('.lks14-threadmenu-actions', { timeout: 5000 })
await page.click('.lks14-threadmenu-actions button:nth-child(2)')
const archivedOk = await waitState(s2 => {
  const g = s2.lessonThreads?.[LESSON]
  return g !== undefined && g.threads.some(t => t.title === RENAMED && t.status === 'archived')
})
await closeMenu(page)
await page.waitForTimeout(1200)
const chipA = await page.textContent('.lks14-threadchip')
probe('archive: the pill leaves the list (chip count drops), state persists', archivedOk && (chipA?.includes('1') === true || chipA === null), `chip="${chipA?.trim() ?? 'gone'}"`)

// delete the remaining CURRENT thread: gear → 删除 → ConfirmCard confirm
if (chipA !== null) {
  await page.click('.lks14-threadchip')
  const di = await rowIndexOf(page, deleteRow.title)
  await page.locator('.lks14-threadmenu-row:not(.new)').nth(di).hover()
  await page.locator('.lks14-threadmenu-row:not(.new)').nth(di).locator('.lks14-threadmenu-gear').click()
  await page.waitForSelector('[data-testid="thread-delete"]', { timeout: 5000 })
  await page.click('[data-testid="thread-delete"]')
  await page.waitForSelector('.lks-confirmcard', { timeout: 5000 })
  await page.click('.lks-confirmcard .lks-btn:not(.ghost)')
  const deletedOk = await waitState(s2 => {
    const g = s2.lessonThreads?.[LESSON]
    return g !== undefined && g.threads.filter(t => t.status !== 'archived').length === 0
  })
  probe('delete: ConfirmCard confirms, the live set empties', deletedOk)
} else {
  probe('delete: ConfirmCard confirms, the live set empties', false, 'no chip left to delete through (state drifted from an earlier partial run)')
}

// reload persistence: archived sediment + empty live set survives
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-dsh-lookatstudy-entry]', { timeout: 45000 })
await page.click('[data-dsh-lookatstudy-entry]')
await page.waitForSelector('.lks14-shell-view', { timeout: 45000 })
await page.waitForTimeout(2500)
const chipAfter = await page.textContent('.lks14-threadchip').catch(() => null)
const gReload = readState().lessonThreads?.[LESSON]
probe('reload: the empty live set persists (chip gone, sediment kept)',
  chipAfter === null && (gReload?.threads ?? []).some(t => t.status === 'archived') && (gReload?.active ?? null) === null,
  `chip=${chipAfter ?? 'gone'} threads=${String(gReload?.threads.length ?? '?')}`)

// ── zero page errors + P18 height chain ──
probe('zero page errors across the whole run', pageErrors.length === 0, pageErrors[0]?.slice(0, 120) ?? '')
const chain = await page.evaluate(() => {
  const rect = sel => {
    const el = document.querySelector(sel)
    if (el === null) return null
    const cs = getComputedStyle(el)
    return { ch: el.clientHeight, oh: el.offsetHeight, disp: cs.display, ovY: cs.overflowY }
  }
  return { shell: rect('.lks14-shell-view'), root: rect('.lks14'), body: rect('.lks14-body'), chat: rect('.lks14-col.lks14-chat'), stream: rect('.lks14-stream') }
})
const c = chain
probe('P18: every column link stays bounded (chain intact)',
  c.shell !== null && c.root !== null && c.body !== null && c.chat !== null && c.stream !== null
  && c.root.oh <= c.shell.ch + 2 && c.body.oh <= c.root.ch + 2 && c.stream.oh <= c.chat.ch + 2,
  `root=${c.root?.oh}/${c.shell?.ch} body=${c.body?.oh}/${c.root?.ch} stream=${c.stream?.oh}/${c.chat?.ch}`)
probe('P18: the stream keeps its internal overflow', c.stream !== null && (c.stream.ovY === 'auto' || c.stream.ovY === 'scroll'), `ovY=${c.stream?.ovY}`)

await browser.close()
const failed = results.filter(r => !r.ok)
console.log(`\nprobe-align4 (part A): ${String(results.length - failed.length)}/${String(results.length)} PASS`)
process.exit(failed.length === 0 ? 0 : 1)

/**
 * Settings-layout + dormant-wake live probe (the 0.30 round):
 *  1. the dormant empty card carries its own 开始学习 CTA (the old copy
 *     promised the button while `!dormant` hid it and the composer was
 *     disabled — no in-panel wake path existed) — clicking it wakes the
 *     dormant surface AND starts the first turn
 *  2. the host settings shell renders our section in the new anatomy: three
 *     role=switch booleans, the two-column rows, the stacked engine row
 *  — plus zero page errors across the whole run.
 * Usage: node scripts/probe-settings-layout.mjs <token> <lessonId> [--url http://127.0.0.1:3081]
 */
import { createRequire } from 'node:module'

const token = process.argv[2]
const lessonId = process.argv[3]
if (token === undefined || lessonId === undefined) {
  console.error('usage: node scripts/probe-settings-layout.mjs <token> <lessonId> [--url base]')
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
  if (!document.documentElement.hasAttribute('data-dsh-lookatstudy-active'))
    document.querySelector('[data-dsh-lookatstudy-entry]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})
await page.waitForSelector('.lks-ui[data-lks-panel]', { timeout: 20000 })
await page.evaluate(async lid => {
  await fetch('/lookatstudy/api/focus', { method: 'POST', headers: { 'content-type': 'application/json', 'x-lks-request': '1' }, body: JSON.stringify({ lessonId: lid }) })
}, lessonId)
await page.waitForTimeout(3500)

// 1 — the dormant wake path: turn the surface OFF, see the dormant card WITH
// its CTA, click it, and watch the turn both activate and start
{
  await page.evaluate(async () => {
    await fetch('/lookatstudy/api/active', { method: 'POST', headers: { 'content-type': 'application/json', 'x-lks-request': '1' }, body: JSON.stringify({ active: false }) })
  })
  await page.waitForTimeout(3500)
  const dormantCard = await page.evaluate(() => {
    const title = document.querySelector('.lks14-emptycard-title')?.textContent ?? ''
    const cta = document.querySelector('[data-testid="chat-start-cta"]')
    return { dormant: title.includes('学习模式已关闭'), hasCta: cta !== null, disabled: cta?.hasAttribute('disabled') ?? null }
  })
  probe('the dormant card shows its wake CTA (copy no longer lies)', dormantCard.dormant && dormantCard.hasCta && dormantCard.disabled !== true,
    `dormant=${dormantCard.dormant} cta=${dormantCard.hasCta}`)

  const woke = await clickInPanel('[data-testid="chat-start-cta"]')
  const turnOver = () => {
    if (document.querySelector('.lks14-msg-assistant.streaming') !== null) return false
    if (document.querySelector('.lks14-composer .lks-btn-send.stop') !== null) return false
    return document.querySelectorAll('.lks14-msg-assistant').length >= 1
  }
  const deadline = Date.now() + 300000
  for (;;) {
    try { await page.waitForFunction(turnOver, undefined, { timeout: 20000 }); break } catch {}
    if (await dismissHostNotice()) await page.waitForTimeout(1000)
    if (Date.now() > deadline) break
  }
  await page.waitForTimeout(1500)
  const state = await page.evaluate(async () => {
    const s = await (await fetch('/lookatstudy/api/state', { headers: { 'x-lks-request': '1' } })).json()
    return { active: s.active === true, rows: (document.querySelector('[data-lks-feed]')?.getAttribute('data-lks-feed') ?? '').startsWith('rows:') }
  })
  probe('clicking the CTA wakes the dormant surface AND starts the turn', woke && state.active && state.rows,
    `active=${state.active} feed=${state.rows}`)
}

// 2 — the settings section in the host shell: new anatomy
{
  // find the host settings entry (gear). Defensive: any settings-ish button.
  const opened = await page.evaluate(() => {
    const cands = [...document.querySelectorAll('button, [role="button"], a')]
      .filter(el => (el.getAttribute('aria-label') ?? el.getAttribute('title') ?? '').toLowerCase().includes('setting') || ['设置', '設定', '设置与偏好'].includes((el.textContent ?? '').trim()))
    const el = cands[0]
    if (el === undefined) return false
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return true
  })
  await page.waitForTimeout(1500)
  // our section nav entry (学习 / Study) inside the settings surface
  const navClicked = await page.evaluate(() => {
    const cands = [...document.querySelectorAll('button, a, [role="tab"], [role="treeitem"]')]
      .filter(el => {
        const t = (el.textContent ?? '').trim()
        return t === '学习' || t === 'Study' || t === '学习 · Study'
      })
    const el = cands[cands.length - 1]
    if (el === undefined) return false
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return true
  })
  await page.waitForTimeout(1200)
  const layout = await page.evaluate(() => {
    const root = document.querySelector('.lks-settings')
    if (root === null) return null
    const switches = root.querySelectorAll('[role="switch"]')
    const rows = [...root.querySelectorAll('.lks-set-row')]
    const firstNarrow = rows.find(r => !r.className.includes('wide')) ?? null
    const twoCol = firstNarrow === null
      ? false
      : getComputedStyle(firstNarrow).gridTemplateColumns.split(' ').length === 2
    return {
      switches: switches.length,
      allOn: [...switches].every(s => s.className.includes('lks-set-switch')),
      engineInput: root.querySelector('[data-testid="tts-endpoint-input"]') !== null,
      profileGrid: root.querySelector('.lks-profile-grid') !== null,
      twoColRow: twoCol,
      switchVisual: root.querySelector('.lks-set-switch') !== null,
    }
  })
  probe('the host settings shell opens our section', opened && navClicked && layout !== null)
  if (layout !== null) {
    probe('three booleans render as the shared switch control', layout.switches === 3 && layout.allOn && layout.switchVisual, `switches=${layout.switches}`)
    probe('rows are two-column (label left, control right)', layout.twoColRow)
    probe('engine row + profile grid render in the new anatomy', layout.engineInput && layout.profileGrid)
  }
}

probe('zero page errors across the run', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))

await browser.close()
const failed = results.filter(r => !r.ok)
console.log(failed.length === 0 ? `\nALL ${results.length} CHECKS PASS` : `\n${failed.length}/${results.length} FAILED`)
process.exit(failed.length === 0 ? 0 : 1)

/**
 * Theme-follow live probe (the issue #16/#17 round): drives the study panel
 * on a booted web-lks host —
 *  1. #16 default untouched: with no stored preference the panel's neutral
 *     ladder resolves to the upstream VERBATIM values (dark #111114 /
 *     light #F8F8F8 by the panel's own data-lks-theme) — the opt-in bridge
 *     must not leak into the stock look
 *  2. #16 the _markdown_ scope: the focused lesson's teach prose carries the
 *     `_markdown_lks` class (the ecosystem markdown convention substrate)
 *  3. #16 the bridge: stored 'on' + reload → the panel root carries
 *     data-lks-follow-host='on' and --surface-1 resolves to the HOST's own
 *     --dsw-alias-bg-layer-1 (read live from body, theme-agnostic compare)
 *  4. #16 restore: preference cleared + reload → attribute gone, verbatim
 *     value back
 *  5. #17 live regression: the entry row + center-column view mount on every
 *     reload (the gated self-heal observer must not break the panel-entry
 *     doctrine) — plus zero page errors across the whole run.
 * Usage: node scripts/probe-theme-follow.mjs <token> [--url http://127.0.0.1:3081]
 */
import { createRequire } from 'node:module'

const token = process.argv[2]
if (token === undefined) {
  console.error('usage: node scripts/probe-theme-follow.mjs <token> [--url base]')
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

/** Open the study panel (the sidebar row) and settle — idempotent: the row
 *  click TOGGLES, so never click an already-open panel. */
const openPanel = async () => {
  await page.waitForSelector('[data-dsh-lookatstudy-entry]', { timeout: 45000 })
  await page.evaluate(() => {
    if (document.documentElement.hasAttribute('data-dsh-lookatstudy-active')) return
    document.querySelector('[data-dsh-lookatstudy-entry]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await page.waitForSelector('.lks-ui[data-lks-panel]', { timeout: 20000 })
  await page.waitForTimeout(600)
}

/** normalized custom-property read on the panel root. */
const panelToken = name => page.evaluate(n => {
  const el = document.querySelector('.lks-ui[data-lks-panel]')
  return el === null ? null : { value: getComputedStyle(el).getPropertyValue(n).trim(), theme: el.getAttribute('data-lks-theme') }
}, name)

const VERBATIM = { dark: '#111114', light: '#F8F8F8' }

await page.goto(`${base}/?token=${token}`, { waitUntil: 'domcontentloaded' })
await dismissHostNotice().catch(() => {})
// no stored preference before the first read
await page.evaluate(() => { localStorage.removeItem('dsh-plugin-lookatstudy:follow-host-theme') })

await openPanel()

// 1 — the default look is untouched (verbatim ladder, both lks themes)
{
  const surf = await panelToken('--surface-1')
  probe('default: the panel mounts with a verbatim surface-1 (bridge off)', surf !== null && surf.value === VERBATIM[surf.theme],
    `theme=${surf?.theme} surface-1=${surf?.value}`)
  probe('default: the bridge attribute is absent', await page.evaluate(() => document.querySelector('.lks-ui[data-lks-panel]')?.getAttribute('data-lks-follow-host') === null))
}

// 2 — the _markdown_ scope on the teach prose (needs a focused study lesson)
{
  const pick = await page.evaluate(async () => {
    const s = await (await fetch('/lookatstudy/api/state', { headers: { 'x-lks-request': '1' } })).json()
    // the API projection names lessons `id` (dashboard.ts WorkbenchCourse)
    const lesson = s.courses.flatMap(c => c.sections.flatMap(sec => sec.lessons))
      .find(l => l.kind !== 'exam')
    if (lesson === undefined) return null
    await fetch('/lookatstudy/api/focus', { method: 'POST', headers: { 'content-type': 'application/json', 'x-lks-request': '1' }, body: JSON.stringify({ lessonId: lesson.id }) })
    return lesson.id
  })
  if (pick === null) {
    probe('markdown scope: a study lesson exists to focus', false, 'state has no study lesson')
  } else {
    // the poll store picks the focus up within one 3s cycle
    let hasScope = null
    try {
      await page.waitForSelector('.lks14-prose', { timeout: 9000 })
      hasScope = await page.evaluate(() => {
        const prose = document.querySelector('.lks14-prose')
        return prose === null ? null : prose.classList.contains('_markdown_lks')
      })
    } catch { hasScope = null }
    probe('markdown scope: teach prose carries _markdown_lks', hasScope === true, `lesson=${pick}`)
  }
}

// 3 — the bridge: stored preference + reload (the panel reads it at mount)
{
  await page.evaluate(() => { localStorage.setItem('dsh-plugin-lookatstudy:follow-host-theme', 'on') })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await dismissHostNotice().catch(() => {})
  await openPanel()
  const attr = await page.evaluate(() => document.querySelector('.lks-ui[data-lks-panel]')?.getAttribute('data-lks-follow-host'))
  const bridged = await page.evaluate(() => {
    const panel = document.querySelector('.lks-ui[data-lks-panel]')
    if (panel === null) return null
    const norm = v => v.replace(/\s+/g, '')
    return {
      surface1: norm(getComputedStyle(panel).getPropertyValue('--surface-1')),
      hostAlias: norm(getComputedStyle(document.body).getPropertyValue('--dsw-alias-bg-layer-1')),
    }
  })
  probe('bridge on: the panel root carries data-lks-follow-host=on', attr === 'on')
  probe('bridge on: surface-1 resolves to the HOST alias value', bridged !== null && bridged.surface1 === bridged.hostAlias && bridged.surface1 !== '',
    `panel=${bridged?.surface1} host=${bridged?.hostAlias}`)
}

// 4 — restore: preference cleared + reload returns the verbatim ladder
{
  await page.evaluate(() => { localStorage.removeItem('dsh-plugin-lookatstudy:follow-host-theme') })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await dismissHostNotice().catch(() => {})
  await openPanel()
  const surf = await panelToken('--surface-1')
  const attr = await page.evaluate(() => document.querySelector('.lks-ui[data-lks-panel]')?.getAttribute('data-lks-follow-host'))
  probe('restore: attribute gone + verbatim surface-1 back', attr === null && surf !== null && surf.value === VERBATIM[surf.theme],
    `theme=${surf?.theme} surface-1=${surf?.value}`)
}

// 5 — #17 live regression is folded into every openPanel() above (the row +
//     view mount fresh on each reload); the page-error ledger closes the run.
probe('zero page errors across the run', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))

await browser.close()
const failed = results.filter(r => !r.ok)
console.log(failed.length === 0 ? `\nALL ${results.length} CHECKS PASS` : `\n${failed.length}/${results.length} FAILED`)
process.exit(failed.length === 0 ? 0 : 1)

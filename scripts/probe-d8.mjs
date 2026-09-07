/**
 * D8 live probe (shared CodeBlock + danger-zone boundaries): a seeded note's
 * code fence renders the shared card in the notebook (language chip + copy
 * header), the delegated copy flips the label for 1500ms, a live tutor reply
 * with a fence renders the same card in the chat stream (one pipeline), and
 * no zone crashes (boundaries hold, no renderfail rows).
 * Usage: node scripts/probe-d8.mjs <token> [--url http://127.0.0.1:3081]
 */
import { createRequire } from 'node:module'

const token = process.argv[2]
if (token === undefined || token === '') {
  console.error('usage: node scripts/probe-d8.mjs <token> [--url base]')
  process.exit(2)
}
const baseIdx = process.argv.indexOf('--url')
const base = baseIdx > 0 ? process.argv[baseIdx + 1] : 'http://127.0.0.1:3081'
const L1 = 'artificial-intelligence-for-beginners-a-curriculum:0:1'

const require = createRequire('D:/Users/kaiji/vibecodingKJ/clones/deepseek-ai/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/package.json')
const { chromium } = require('playwright')

const results = []
const probe = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === '' ? '' : ` — ${detail}`}`)
}

const browser = await chromium.launch({ executablePath: 'C:/Users/kaiji/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe' })
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
await page.goto(`${base}/?token=${token}`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-dsh-lookatstudy-entry]', { timeout: 30000 })
await page.click('[data-dsh-lookatstudy-entry]')
await page.waitForSelector('.lks-ui', { timeout: 30000 })
await page.waitForTimeout(2500)

// Focus the seeded lesson, open the notebook's notes tab
await page.evaluate((id) => {
  const el = document.querySelector(`[data-node-id="${id}"] button`)
  el?.click()
}, L1)
await page.waitForTimeout(2500)
await page.click('.lks-viewtab[data-testid="notebook-tab-notes"], .lks14-notebook [role="tab"]:has-text("笔记")').catch(() => {})
// fall back: any tab button whose text is 笔记
await page.evaluate(() => {
  // the notes tab may wear an unseen badge — match on the label prefix
  const btn = [...document.querySelectorAll('button')].find(b => (b.textContent ?? '').trim().startsWith('笔记') || (b.textContent ?? '').trim().startsWith('Notes'))
  btn?.click()
})
await page.waitForTimeout(1200)

// ——— the seeded note's code fence renders the shared card ———
const noteCard = await page.evaluate(() => {
  const note = [...document.querySelectorAll('.lks-note-text')].find(n => n.textContent?.includes('共享代码块探针'))
  if (note === undefined) return { found: false }
  const card = note.querySelector('.lks-codeblock')
  return {
    found: true,
    card: card !== null,
    lang: card?.querySelector('.lks-codeblock-lang')?.textContent ?? '',
    copy: card?.querySelector('.lks-codeblock-copy')?.textContent ?? '',
    code: card?.querySelector('pre')?.textContent ?? '',
  }
})
probe('the seeded note renders the shared CodeBlock card (chip + copy header)',
  noteCard.found && noteCard.card && noteCard.lang === 'ts' && noteCard.copy !== '' && noteCard.code.includes('42'),
  `found=${noteCard.found} lang=${noteCard.lang} copy="${noteCard.copy}" codeHas42=${noteCard.code?.includes('42')}`)

// ——— the delegated copy: label flips to 已复制 for 1500ms ———
let copyFlipped = false
if (noteCard.found && noteCard.card) {
  await page.evaluate(() => {
    const note = [...document.querySelectorAll('.lks-note-text')].find(n => n.textContent?.includes('共享代码块探针'))
    ;(note?.querySelector('.lks-codeblock-copy') ?? null)?.click()
  })
  await page.waitForTimeout(400)
  const during = await page.evaluate(() => {
    const note = [...document.querySelectorAll('.lks-note-text')].find(n => n.textContent?.includes('共享代码块探针'))
    const btn = note?.querySelector('.lks-codeblock-copy')
    return { text: btn?.textContent ?? '', copied: btn?.classList.contains('copied') ?? false }
  })
  await page.waitForTimeout(1800)
  const after = await page.evaluate(() => {
    const note = [...document.querySelectorAll('.lks-note-text')].find(n => n.textContent?.includes('共享代码块探针'))
    return note?.querySelector('.lks-codeblock-copy')?.textContent ?? ''
  })
  copyFlipped = during.copied && (during.text === '已复制' || during.text === 'Copied') && (after === '复制' || after === 'Copy')
  probe('the delegated copy flips the label for 1500ms and reverts', copyFlipped, `during="${during.text}" after="${after}"`)
} else {
  probe('the delegated copy flips the label for 1500ms and reverts', false, 'note card missing')
}

// ——— a live tutor reply with a fence renders the SAME card in the chat stream ———
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(b => (b.textContent ?? '').trim() === '课时')
  btn?.click()
})
await page.waitForTimeout(800)
await page.fill('.lks14-composertext', '请直接回复一条消息,其中包含一个 ```python 围栏代码块(内容 print("hi") 即可),不要调用工具。')
await page.click('.lks-btn-send')
let chatCard = false
let chatLang = ''
for (let i = 0; i < 90 && !chatCard; i++) {
  await page.waitForTimeout(1000)
  const s = await page.evaluate(() => {
    const stream = document.querySelector('.lks14-stream')
    const card = stream?.querySelector('.lks-codeblock')
    return { card: card !== null, lang: card?.querySelector('.lks-codeblock-lang')?.textContent ?? '', busy: document.querySelector('.lks14-composertext')?.disabled }
  })
  if (s.card && !s.busy) { chatCard = true; chatLang = s.lang }
  else if (s.card) chatCard = true
}
probe('a live tutor reply renders the same shared card in the chat stream', chatCard && chatLang === 'python', `card=${chatCard} lang=${chatLang}`)

// ——— the boundaries hold: no renderfail rows anywhere, pane alive ———
const healthy = await page.evaluate(() => document.querySelectorAll('.lks-renderfail').length)
probe('no zone crashed (boundaries hold, zero fallback rows)', healthy === 0 && (await page.locator('.lks-ui').count()) === 1, `renderfailRows=${healthy}`)

await browser.close()
const failed = results.filter(r => !r.ok)
console.log(`\nPROBE SUMMARY: ${results.length - failed.length}/${results.length} pass`)
process.exit(failed.length === 0 ? 0 : 1)

/** Flip the web-lks host theme through its 设置 dialog (persisted server-side).
 * Usage: node scripts/flip-theme.mjs <token> dark|light|system [--url base] */
import { createRequire } from 'node:module'
const token = process.argv[2]
const want = process.argv[3] ?? 'dark'
const baseIdx = process.argv.indexOf('--url')
const base = baseIdx > 0 ? process.argv[baseIdx + 1] : 'http://127.0.0.1:3081'
const require = createRequire('D:/Users/kaiji/vibecodingKJ/clones/deepseek-ai/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/package.json')
const { chromium } = require('playwright')
const browser = await chromium.launch({ executablePath: 'C:/Users/kaiji/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe' })
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
await page.goto(`${base}/?token=${token}`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3000)
await page.getByRole('button', { name: '设置', exact: true }).click()
await page.waitForTimeout(800)
const label = want === 'dark' ? '深色' : want === 'light' ? '浅色' : '跟随系统'
const cube = page.getByRole('button', { name: label, exact: true })
await cube.click()
let ok = false
for (let i = 0; i < 10; i++) {
  await page.waitForTimeout(500)
  ok = await page.evaluate(w => document.body.hasAttribute('data-ds-dark-theme') === (w === 'dark'), want)
  if (ok) break
}
console.log(`flip→${want}: ${ok ? 'OK' : 'FAILED'}`)
await browser.close()
process.exit(ok ? 0 : 1)

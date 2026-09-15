/** Seed the 0.23.1 probe fixtures: a two-section course whose first lesson
 * (the import-available one) carries a 2400px-wide data-URL image — the click
 * target for the focus-unlock assertions and the big-image fixture for the
 * teach-prose clamp. ADDITIVE over the live shared state (other courses
 * stay); statePath is backed up to <statePath>.p0231-bak on first run and
 * --restore puts it back verbatim.
 * Usage: npx tsx scripts/probe-0231-seed.mjs <statePath> [--restore] */
import { loadState, saveState, importCourse } from '../src/state.ts'
import { parseMarkdownToCourse } from '../src/vendor/markdown-course.ts'
import { copyFileSync, existsSync, rmSync } from 'node:fs'

const statePath = process.argv[2]
if (statePath === undefined || statePath === '') throw new Error('usage: probe-0231-seed.mjs <statePath> [--restore]')
const bak = `${statePath}.p0231-bak`

if (process.argv.includes('--restore')) {
  if (!existsSync(bak)) throw new Error(`no backup at ${bak} — nothing to restore`)
  copyFileSync(bak, statePath)
  rmSync(bak)
  console.log(`restored ${statePath} from ${bak} (round closed)`)
  process.exit(0)
}
if (existsSync(statePath)) {
  if (existsSync(bak)) throw new Error('backup already exists — run --restore first (no nesting)')
  copyFileSync(statePath, bak)
  console.log(`backup written: ${bak}`)
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="600"><rect width="2400" height="600" fill="#58CC01"/><text x="1200" y="320" font-size="160" fill="#08090B" text-anchor="middle">2400px probe image</text></svg>`
const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
const MARKDOWN = `# 解锁与图片探针课

## 第一节

### 首课

首课正文，含一张超宽图片（2400px，data URL，无网络依赖）：

![wide probe art](${dataUrl})

图片之后的正文行，确认正文未被图片挤掉。

### 次课

次课正文。

### 三课

三课正文。

## 第二节

### 跨节首课

跨节首课正文。
`

const state = loadState(statePath)
const course = importCourse(state, parseMarkdownToCourse(MARKDOWN), 'markdown', 'probe-0231')
state.focus = { lessonId: `${course.id}:0:0` }
saveState(statePath, state)
console.log(`seeded course ${course.id}: lessons ${course.sections.flatMap(s => s.lessons).map(l => `${l.id}(${l.kind},${l.status})`).join(' ')}`)

/** Seed the canvasstage probe fixtures (#12 / #10-followup rounds): a
 * one-section, two-lesson course where lesson A's board stages the DIAGRAM
 * and lesson B's board stages the COMPARE_TABLE — the two reported surfaces.
 * The seed is ADDITIVE over the live shared state (other sessions' courses
 * stay); statePath is backed up to <statePath>.canvasstage-bak on first run
 * and --restore puts it back verbatim.
 * Usage: npx tsx scripts/probe-canvasstage-seed.mjs <statePath> [--restore] */
import { loadState, saveState, importCourse } from '../src/state.ts'
import { parseMarkdownToCourse } from '../src/vendor/markdown-course.ts'
import { copyFileSync, existsSync, rmSync } from 'node:fs'

const statePath = process.argv[2]
if (statePath === undefined || statePath === '') throw new Error('usage: probe-canvasstage-seed.mjs <statePath> [--restore]')
const bak = `${statePath}.canvasstage-bak`

if (process.argv.includes('--restore')) {
  if (!existsSync(bak)) throw new Error(`no backup at ${bak} — nothing to restore`)
  copyFileSync(bak, statePath)
  rmSync(bak)
  console.log(`restored ${statePath} from ${bak} (round closed — the next seed re-arms a fresh backup)`)
  process.exit(0)
}
if (existsSync(statePath)) {
  if (existsSync(bak)) throw new Error('backup already exists — run --restore first (no nesting)')
  copyFileSync(statePath, bak)
  console.log(`backup written: ${bak}`)
}

const COURSE_TITLE = '画布舞台探针课'
const FENCE = '`'.repeat(3)
const MARKDOWN = `# ${COURSE_TITLE}

## 恒成立问题

### 判别式与图象

把恒成立问题翻译成图象语言：整条抛物线躺在 x 轴一侧。开口向上时只看最小值，开口向下时只看最大值。

${FENCE}mermaid
flowchart LR
  A[恒成立问题] --> B{开口方向}
  B -->|开口向上| C[看最小值]
  B -->|开口向下| D[看最大值]
  C --> E[最小值大于零]
  D --> E
  E --> F[全区间成立]
${FENCE}

### 参变分离

把参数单独放到一侧，另一侧变成一个与参数无关的函数，问题化归为求函数的最值。

常见的三条路对照如下：判别式法最直接，最值法最通用，参变分离在参数系数带符号时要分类讨论。
`

const MERMAID = `flowchart LR
  A[恒成立问题] --> B{开口方向}
  B -->|开口向上| C[看最小值]
  B -->|开口向下| D[看最大值]
  C --> E[最小值大于零]
  D --> E
  E --> F[全区间成立]`
const HEADERS = ['方法', '适用对象', '操作步骤', '口诀']
const ROWS = [
  ['判别式法', '二次式且系数定号', '列判别式并按开口方向定不等号', '开口向上德尔塔小于零'],
  ['最值法', '一切恒成立问题', '转成最值不等式后求函数最值', '恒成立即大于最大值'],
  ['参变分离', '参数可单独 isolate', '分离参数后求对侧函数的值域', '分离之后求值域'],
]

const state = loadState(statePath)
state.active = true
const parsed = parseMarkdownToCourse(MARKDOWN)
const course = importCourse(state, parsed, 'markdown', 'canvasstage-probe')
const lessons = (course.sections[0] ?? { lessons: [] }).lessons.filter(l => l.kind === 'study')
const a = lessons[0]
const b = lessons[1]
if (a === undefined || b === undefined) throw new Error('expected 2 study lessons')
b.status = 'available'

const now = Date.now()
const diagram = {
  id: 'probe-canvas-diagram',
  artifactType: 'diagram',
  title: '恒成立三条路',
  createdAt: new Date(now - 1000).toISOString(),
  hash: 'probe-canvas-diagram',
  data: { artifactType: 'diagram', title: '恒成立三条路', diagramType: 'flowchart', mermaid: MERMAID },
}
const table = {
  id: 'probe-canvas-table',
  artifactType: 'compare_table',
  title: '恒成立方法对照',
  createdAt: new Date(now - 2000).toISOString(),
  hash: 'probe-canvas-table',
  data: { artifactType: 'compare_table', title: '恒成立方法对照', headers: HEADERS, rows: ROWS },
}
// array order = the board's "latest heavy" (panel takes the last heavy element)
state.artifacts[a.id] = [table, diagram]
state.artifacts[b.id] = [diagram, table]

saveState(statePath, state)
console.log(`seeded course=${course.id} lessonA=${a.id} (board=diagram) lessonB=${b.id} (board=table)`)

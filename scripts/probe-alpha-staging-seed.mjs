/** Seed the alpha-staging probe fixture (0.1.6 session-ownership round): one
 * small two-lesson course with UNIQUE markers, focus on lesson 1 — the probe
 * drives the full mint→retain→attach staging path on an ALPHA-generation host
 * (retain, no sessions.open, no list.current). ADDITIVE over the live shared
 * state (backup/restore like the course-scope seeds).
 * Usage: npx tsx scripts/probe-alpha-staging-seed.mjs <statePath> [--restore] */
import { loadState, saveState, importCourse } from '../src/state.ts'
import { parseMarkdownToCourse } from '../src/vendor/markdown-course.ts'
import { copyFileSync, existsSync, rmSync } from 'node:fs'

const statePath = process.argv[2]
if (statePath === undefined || statePath === '') throw new Error('usage: probe-alpha-staging-seed.mjs <statePath> [--restore]')
const bak = `${statePath}.alpha-staging-bak`

if (process.argv.includes('--restore')) {
  if (!existsSync(bak)) throw new Error(`no backup at ${bak} — nothing to restore`)
  copyFileSync(bak, statePath)
  rmSync(bak)
  console.log(`restored ${statePath} (round closed)`)
  process.exit(0)
}
if (existsSync(statePath)) {
  if (existsSync(bak)) throw new Error('backup already exists — run --restore first')
  copyFileSync(statePath, bak)
  console.log(`backup written: ${bak}`)
}

const COURSE_TITLE = '跨代舞台探针课'
const MD = `# ${COURSE_TITLE}

## 变量与时钟

### 变量提升一课

正文标记TUISHENG7。变量提升是声明先于执行的直觉。

### 闭包直觉一课

正文标记BIBAO8。闭包是函数携带其诞生环境的直觉。
`

const state = loadState(statePath)
state.active = true
const course = importCourse(state, parseMarkdownToCourse(MD), 'markdown', 'alpha-staging-probe')
const lessons = (course.sections[0] ?? { lessons: [] }).lessons.filter(l => l.kind === 'study')
if (lessons.length < 2) throw new Error('expected 2 study lessons')
for (const l of lessons) l.status = 'available'
state.focus = { lessonId: lessons[0].id }
saveState(statePath, state)
console.log(`seeded course=${course.id} a=${lessons[0].id} b=${lessons[1].id}`)

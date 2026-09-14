/** Seed the course-scope probe fixtures (0.23.0, issue #11 follow-up): a
 * three-lesson course (C seeded mastered + overdue so review routing is
 * live) with UNIQUE body markers — the probe's iron-rule scan asserts the
 * markers never ride user messages or the assembled prompt, only tool
 * results (study_lesson's on-demand layer). The course's threadScope is set
 * ON through the real state machine. ADDITIVE over the live shared state
 * (backup/restore like the canvasstage seeds).
 * Usage: npx tsx scripts/probe-course-scope-seed.mjs <statePath> [--restore] */
import { loadState, saveState, importCourse, setCourseThreadScope } from '../src/state.ts'
import { parseMarkdownToCourse } from '../src/vendor/markdown-course.ts'
import { copyFileSync, existsSync, rmSync } from 'node:fs'

const statePath = process.argv[2]
if (statePath === undefined || statePath === '') throw new Error('usage: probe-course-scope-seed.mjs <statePath> [--restore]')
const bak = `${statePath}.course-scope-bak`

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

const COURSE_TITLE = '跨课时连续探针课'
const FENCE = '`'.repeat(3)
const MD = `# ${COURSE_TITLE}

## 恒成立三路

### 甲课判别式

甲课正文标记JIA7。判别式法按开口方向列不等式。

### 乙课参变分离

乙课正文标记YI8。参变分离把参数隔离到一侧。

### 丙课最值路线

丙课正文标记BING9。最值法把恒成立化归为区间最值。
`

const state = loadState(statePath)
state.active = true
const course = importCourse(state, parseMarkdownToCourse(MD), 'markdown', 'course-scope-probe')
const lessons = (course.sections[0] ?? { lessons: [] }).lessons.filter(l => l.kind === 'study')
if (lessons.length < 3) throw new Error('expected 3 study lessons')
for (const l of lessons) l.status = 'available'
// lesson C: mastered + overdue — the review-routing target
const c = lessons[2]
c.status = 'mastered'
c.mastery = 0.95
c.dueAt = new Date(Date.now() - 36 * 3600 * 1000).toISOString()
setCourseThreadScope(state, course.id, 'course')
state.focus = { lessonId: lessons[0].id }
saveState(statePath, state)
console.log(`seeded course=${course.id} scope=course a=${lessons[0].id} b=${lessons[1].id} c(due)=${lessons[2].id}`)

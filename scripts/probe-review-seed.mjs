/** Seed the review-session probe fixture (v0.39 round): one course whose
 * FIRST lesson is honestly mastered (concepts + human grading + answers →
 * graduation schedules SM-2) and due NOW, plus one APPLIED mastery proposal
 * with a snapshot (the undo path's input). ADDITIVE over the live shared
 * state (backup/restore like the alpha-staging seed).
 * Usage: npx tsx scripts/probe-review-seed.mjs <statePath> [--restore] */
import { loadState, saveState, importCourse } from '../src/state.ts'
import { parseMarkdownToCourse } from '../src/vendor/markdown-course.ts'
import {
  defineConcepts, recordAnswer, markHumanGraded, dueReviews,
  proposeMastery, resolveProposal, findLesson,
} from '../src/state.ts'
import { copyFileSync, existsSync, rmSync } from 'node:fs'

const statePath = process.argv[2]
if (statePath === undefined || statePath === '') throw new Error('usage: probe-review-seed.mjs <statePath> [--restore]')
const bak = `${statePath}.review-probe-bak`

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

const TITLE = '复习会话探针课'
const NOW = new Date()
const MD = `# ${TITLE}

## 第一节

### 变量与提升

正文标记FUXI1。变量提升(hoisting)是声明先于执行的直觉:用 let 声明的变量存在暂时性死区,访问早于声明会抛错;用 var 声明则提升为 undefined。

### 闭包直觉

正文标记FUXI2。闭包是函数携带其诞生环境:内层函数引用外层变量,外层作用域因此常驻。
`

const state = loadState(statePath)
state.active = true
const course = importCourse(state, parseMarkdownToCourse(MD), 'markdown', 'review-session-probe')
const lessons = course.sections[0].lessons.filter(l => l.kind === 'study')
if (lessons.length < 2) throw new Error('expected 2 study lessons')
const target = lessons[0]
for (const l of lessons) if (l.status === 'locked') l.status = 'available'

// honest mastery: KCs → human grading (lifts the AI cap) → correct answers
defineConcepts(state, target.id, [
  { title: '暂时性死区', description: 'let 的 TDZ' },
  { title: '闭包', description: '函数携带诞生环境' },
])
markHumanGraded(state, target.id)
for (let i = 0; i < 40 && findLesson(state, target.id).lesson.status !== 'mastered'; i++) {
  recordAnswer(state, target.id, true, i % 2 === 0 ? '暂时性死区' : '闭包', NOW)
}
const lesson = findLesson(state, target.id).lesson
if (lesson.status !== 'mastered' || lesson.sm2 === null) throw new Error('seed failed to master the lesson')
// make it due NOW
lesson.dueAt = new Date(NOW.getTime() - 3_600_000).toISOString()
state.focus = { lessonId: target.id }

// one APPLIED mastery proposal on the SECOND lesson (the undo path's input).
// Deliberately NOT pre-graded and only lightly answered: the pre-apply rows
// must differ visibly from the accepted state (mastery well under 0.95,
// humanGraded false) or the revoke's snapshot restore is numerically
// invisible — exactly the trap the first probe round hit.
const other = lessons[1]
defineConcepts(state, other.id, [
  { title: '环境引用', description: '闭包引用' },
  { title: '常驻作用域', description: '外层常驻' },
])
for (let i = 0; i < 4; i++) {
  recordAnswer(state, other.id, true, i % 2 === 0 ? '环境引用' : '常驻作用域', NOW)
}
const otherLesson = findLesson(state, other.id).lesson
if ((otherLesson.mastery ?? 0) >= 0.95 || otherLesson.humanGraded === true) {
  throw new Error('seed pre-proposal state not visibly revertible')
}
const proposal = proposeMastery(state, other.id, 'probe: undo path input', NOW)
resolveProposal(state, proposal.id, true, NOW)

saveState(statePath, state)
const due = dueReviews(state, undefined, NOW).filter(d => d.lessonId === target.id)
console.log(`seeded course=${course.id} dueLesson=${target.id} proposal=${proposal.id} dueNow=${due.length === 1}`)
console.log(`PROBE_IDS ${course.id}|${target.id}|${other.id}|${proposal.id}`)

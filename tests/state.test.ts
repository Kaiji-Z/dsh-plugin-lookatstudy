/**
 * Learning-state transitions: import gating, lesson lookup, BKT recording,
 * completion/unlock chain, SM-2 scheduling, due listing, persistence
 * round-trip, deletion.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseMarkdownToCourse } from '../src/vendor/markdown-course.ts'
import {
  addFriction,
  attemptLesson,
  completeLesson,
  courseSummaries,
  deleteCourse,
  dueReviews,
  emptyState,
  findCourse,
  findLesson,
  importCourse,
  learnerSnapshot,
  loadState,
  nextLesson,
  proposeMastery,
  recordAnswer,
  recordReview,
  saveState,
  setMemory,
  starterPrompts,
  strategyBand,
  type LearningState,
} from '../src/state.ts'

const T0 = new Date('2026-08-14T10:00:00Z')
const DAY = 86_400_000

function importedFixture(): { state: LearningState; courseId: string } {
  const state = emptyState()
  const parsed = parseMarkdownToCourse([
    '#Fixture Course',
    '## S1',
    '### L1', 'l1 body',
    '### L2', 'l2 body',
    '## S2',
    '### L3', 'l3 body',
  ].join('\n'))
  const course = importCourse(state, parsed, 'markdown', 'fixture')
  return { state, courseId: course.id }
}

test('import gates the path: first study lesson available, rest locked, exams free', () => {
  const { state, courseId } = importedFixture()
  const course = findCourse(state, courseId)
  const lessons = course.sections.flatMap(s => s.lessons)
  assert.deepEqual(
    lessons.map(l => [l.kind, l.status]),
    [['study', 'available'], ['study', 'locked'], ['exam', 'available'], ['study', 'locked']],
    'S1 has two study lessons so it gains a 章节测验 exam node; S2 has one, no exam',
  )
  const ids = lessons.map(l => l.id)
  assert.match(ids[0]!, new RegExp(`^${courseId}:0:0$`))
  assert.match(ids[3]!, new RegExp(`^${courseId}:1:0$`))
})

test('findLesson resolves hierarchical ids and rejects unknown ones', () => {
  const { state, courseId } = importedFixture()
  const ref = findLesson(state, `${courseId}:1:0`)
  assert.equal(ref.lesson.title, 'L3')
  assert.equal(ref.section.title, 'S2')
  assert.throws(() => findLesson(state, `${courseId}:9:9`), /unknown lesson id/)
  assert.throws(() => findLesson(state, 'no-such-course:0:0'), /unknown course id/)
})

test('answers update mastery, attempts, and counters', () => {
  const { state, courseId } = importedFixture()
  const lessonId = `${courseId}:0:0`
  const first = recordAnswer(state, lessonId, true, undefined, T0)
  assert.ok(first.newMastery > 0)
  assert.equal(first.prevMastery, 0)
  const second = recordAnswer(state, lessonId, false, undefined, T0)
  assert.ok(second.newMastery < first.newMastery)
  assert.equal(second.ref.lesson.attempts, 2)
  assert.equal(second.ref.lesson.correctCount, 1)
})

test('completing a lesson runs the dual-track unlock and seeds SM-2', () => {
  const { state, courseId } = importedFixture()
  const l1 = `${courseId}:0:0`
  const result = completeLesson(state, l1, T0)
  assert.deepEqual(result.unlocked.map(u => u.id), [`${courseId}:0:1`, `${courseId}:1:0`],
    'unlocks the next study lesson in-section AND the first study lesson of the next section (LookatStudy dual-track)')
  assert.equal(result.ref.lesson.dueAt, new Date(T0.getTime() + DAY).toISOString())
  assert.equal(findLesson(state, `${courseId}:0:1`).lesson.status, 'available')
  assert.equal(findLesson(state, `${courseId}:1:0`).lesson.status, 'available')
  assert.throws(() => completeLesson(state, `${courseId}:1:9`, T0), /unknown lesson id/)
})

test('attempting a lesson marks in_progress, seeds mastery 0.5, and unlocks early', () => {
  const { state, courseId } = importedFixture()
  assert.throws(() => attemptLesson(state, `${courseId}:0:1`, T0), /locked; complete earlier lessons first/,
    'locked lessons refuse to open')
  const first = attemptLesson(state, `${courseId}:0:0`, T0)
  assert.equal(first.started, true)
  assert.equal(first.ref.lesson.status, 'in_progress')
  assert.equal(first.ref.lesson.mastery, 0.5, 'BKT prior seeds mastery — the attempt itself meets the unlock threshold')
  assert.deepEqual(first.unlocked.map(u => u.id), [`${courseId}:0:1`, `${courseId}:1:0`])
  assert.deepEqual(attemptLesson(state, `${courseId}:0:0`, T0), { ref: first.ref, started: false, unlocked: [] },
    're-opening an in_progress lesson is a no-op')
})

test('recordAnswer refuses locked lessons', () => {
  const { state, courseId } = importedFixture()
  assert.throws(() => recordAnswer(state, `${courseId}:0:1`, true, undefined, T0), /locked; open it with study_lesson/)
})

test('the whole path completes and reports course completion', () => {
  const { state, courseId } = importedFixture()
  const ids = [`${courseId}:0:0`, `${courseId}:0:1`, `${courseId}:1:0`]
  const last = ids.reduce((_prev, id) => completeLesson(state, id, T0), null)
  assert.equal(last?.courseComplete, true, 'every STUDY lesson mastered (the exam node never gates completion)')
  assert.deepEqual(last?.unlocked, [])
  assert.equal(nextLesson(findCourse(state, courseId), ids[2]!), null)
})

test('reviews advance the SM-2 schedule and respect due dates', () => {
  const { state, courseId } = importedFixture()
  const lessonId = `${courseId}:0:0`
  completeLesson(state, lessonId, T0)
  assert.equal(dueReviews(state, undefined, T0).length, 0)
  const nextDay = new Date(T0.getTime() + DAY)
  const due = dueReviews(state, undefined, nextDay)
  assert.equal(due.length, 1)
  assert.equal(due[0]!.lessonId, lessonId)
  const graded = recordReview(state, lessonId, 4, nextDay)
  assert.equal(graded.intervalDays, 1)
  assert.equal(dueReviews(state, undefined, nextDay).length, 0)
  assert.throws(() => recordReview(state, `${courseId}:0:1`, 4, nextDay), /no review schedule/)
})

test('course summaries aggregate progress and due counts', () => {
  const { state, courseId } = importedFixture()
  completeLesson(state, `${courseId}:0:0`, T0)
  recordAnswer(state, `${courseId}:0:1`, true, undefined, T0)
  const [summary] = courseSummaries(state, T0)
  assert.equal(summary!.courseId, courseId)
  assert.equal(summary!.total, 4, 'three study lessons plus the S1 exam node')
  assert.equal(summary!.mastered, 1)
  assert.equal(summary!.dueCount, 0)
  assert.equal(summary!.currentLessonId, `${courseId}:0:1`)
  assert.ok(summary!.avgMasteryPct! > 0)
})

test('v1 state migrates: completed→mastered, kind defaults, exam nodes backfilled', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lookatstudy-'))
  try {
    const path = join(dir, 'state.json')
    const { state, courseId } = importedFixture()
    // Degrade to a v1 shape: completed statuses, no kind fields.
    state.version = 1 as never
    const v1 = JSON.parse(JSON.stringify(state), (k, v) => k === 'kind' ? undefined : v) as typeof state
    v1.courses[0]!.sections[0]!.lessons[0]!.status = 'completed' as never
    v1.sections = undefined as never
    writeFileSync(path, JSON.stringify(v1), 'utf8')
    const migrated = loadState(path)
    assert.equal(migrated.version, 2)
    const section = migrated.courses[0]!.sections[0]!
    assert.equal(section.lessons[0]!.status, 'mastered', 'completed renamed')
    assert.equal(section.lessons[0]!.kind, 'study', 'kind defaults')
    const exam = section.lessons.at(-1)!
    assert.equal(exam.kind, 'exam', 'exam node backfilled at the section end')
    assert.match(exam.id, new RegExp(`^${courseId}:0:[0-9]+$`))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('state persists and reloads identically', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lookatstudy-'))
  try {
    const path = join(dir, 'state.json')
    const { state, courseId } = importedFixture()
    completeLesson(state, `${courseId}:0:0`, T0)
    saveState(path, state)
    const reloaded = loadState(path)
    assert.deepEqual(reloaded, state)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('activation defaults: fresh states dormant, pre-active files stay on', () => {
  assert.equal(emptyState().active, false, 'fresh installs start dormant until 开始学习')
  const dir = mkdtempSync(join(tmpdir(), 'lookatstudy-'))
  try {
    const path = join(dir, 'state.json')
    const { state } = importedFixture()
    const legacy = JSON.parse(JSON.stringify(state)) as Record<string, unknown>
    delete legacy.active
    writeFileSync(path, JSON.stringify(legacy), 'utf8')
    assert.equal(loadState(path).active, true, 'files predating the flag keep the tutor working')

    state.active = false
    saveState(path, state)
    assert.equal(loadState(path).active, false, 'an explicit off round-trips')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a corrupt state file fails loud', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lookatstudy-'))
  try {
    const path = join(dir, 'state.json')
    writeFileSync(path, '{not json', 'utf8')
    assert.throws(() => loadState(path), /not valid JSON/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('deleting a course removes it; unknown ids fail loud', () => {
  const { state, courseId } = importedFixture()
  deleteCourse(state, courseId)
  assert.equal(state.courses.length, 0)
  assert.throws(() => deleteCourse(state, courseId), /unknown course id/)
})

test('strategy bands follow the LookatStudy thresholds', () => {
  assert.match(strategyBand(null), /直觉/)
  assert.match(strategyBand(0.05), /直觉/)
  assert.match(strategyBand(0.2), /提问/)
  assert.match(strategyBand(0.5), /对比相似概念/)
  assert.match(strategyBand(0.8), /费曼/)
})

test('learner snapshot tracks focus, weak concepts, friction, memory, and proposals', async () => {
  const { state, courseId } = importedFixture()
  const lessonId = `${courseId}:0:0`
  state.focus = { lessonId }
  defineConceptsFixture(state, lessonId)
  recordAnswer(state, lessonId, true, '概念甲', T0)
  addFriction(state, lessonId, 'confused', 'mixes up 甲 and 乙', T0)
  setMemory(state, 'global', 'prefers analogies')
  setMemory(state, 'lesson', 'weak on 乙', lessonId)
  proposeMastery(state, lessonId, 'convincing Feynman recap', T0)

  const snap = learnerSnapshot(state, T0)
  assert.equal(snap.focus?.lessonId, lessonId)
  assert.ok(snap.concepts!.some(c => c.weak), 'the unobserved concept stays weak')
  assert.equal(snap.friction.length, 1)
  assert.equal(snap.memoryGlobal, 'prefers analogies')
  assert.equal(snap.memoryLesson, 'weak on 乙')
  assert.equal(snap.pendingProposal?.lessonId, lessonId)
  assert.match(snap.strategy!, /费曼|对比|提问/)
})

test('starter prompts fill the lesson title with the four consolidation moves', async () => {
  const starters = starterPrompts('Neurons')
  assert.equal(starters.length, 4)
  assert.ok(starters.some(s => s.effect === 'mastery' && s.message.includes('Neurons')))
  assert.ok(starters.some(s => s.effect === 'friction'))
})

/** Define a two-concept KC set on a lesson (test-local shorthand). */
function defineConceptsFixture(state: LearningState, lessonId: string): void {
  const ref = findLesson(state, lessonId)
  ref.lesson.concepts = [
    { title: '概念甲', description: 'first' },
    { title: '概念乙', description: 'second' },
  ]
  ref.lesson.conceptMastery = {}
}

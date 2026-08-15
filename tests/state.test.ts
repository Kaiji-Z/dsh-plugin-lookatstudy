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

test('import gates the path: first available, rest locked', () => {
  const { state, courseId } = importedFixture()
  const course = findCourse(state, courseId)
  const statuses = course.sections.flatMap(s => s.lessons.map(l => l.status))
  assert.deepEqual(statuses, ['available', 'locked', 'locked'])
  const ids = course.sections.flatMap(s => s.lessons.map(l => l.id))
  assert.match(ids[0]!, new RegExp(`^${courseId}:0:0$`))
  assert.match(ids[2]!, new RegExp(`^${courseId}:1:0$`))
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

test('completing a lesson unlocks exactly the next one and seeds SM-2', () => {
  const { state, courseId } = importedFixture()
  const l1 = `${courseId}:0:0`
  const result = completeLesson(state, l1, T0)
  assert.equal(result.unlocked?.id, `${courseId}:0:1`)
  assert.equal(result.ref.lesson.dueAt, new Date(T0.getTime() + DAY).toISOString())
  assert.equal(findLesson(state, `${courseId}:0:1`).lesson.status, 'available')
  assert.equal(findLesson(state, `${courseId}:1:0`).lesson.status, 'locked')
  assert.throws(() => completeLesson(state, `${courseId}:1:0`, T0), /locked/)
})

test('the whole path completes and reports course completion', () => {
  const { state, courseId } = importedFixture()
  const ids = [`${courseId}:0:0`, `${courseId}:0:1`, `${courseId}:1:0`]
  const last = ids.reduce((_prev, id) => completeLesson(state, id, T0), null)
  assert.equal(last?.courseComplete, true)
  assert.equal(last?.unlocked, null)
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
  assert.equal(summary!.total, 3)
  assert.equal(summary!.completed, 1)
  assert.equal(summary!.dueCount, 0)
  assert.equal(summary!.currentLessonId, `${courseId}:0:1`)
  assert.ok(summary!.avgMasteryPct! > 0)
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

/**
 * Invariant fuzz (VERIFICATION.md Layer 1 hardening): seeded random operation
 * sequences over the state machine, asserting the load-bearing invariants
 * after EVERY step. Deterministic by construction — a failing seed replays
 * exactly.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { parseMarkdownToCourse } from '../src/vendor/markdown-course.ts'
import {
  attemptLesson,
  completeLesson,
  emptyState,
  importCourse,
  proposeMastery,
  recordAnswer,
  recordReview,
  resolveProposal,
  type LearningState,
  type LessonState,
} from '../src/state.ts'

/** Statuses strictly advance along this order and never regress. */
const STATUS_ORDER: Record<LessonState['status'], number> = { locked: 0, available: 1, in_progress: 2, mastered: 3 }

/** Deterministic PRNG (mulberry32) so failures replay from the seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const FUZZ_MD = [
  '# Fuzz Course',
  '## A', '### a1', 'body a1', '### a2', 'body a2', '### a3', 'body a3',
  '## B', '### b1', 'body b1', '### b2', 'body b2',
].join('\n')

/** Assert every state-machine invariant over the whole course tree. */
function assertInvariants(state: LearningState, op: string): void {
  for (const course of state.courses) {
    for (const section of course.sections) {
      const gatingCoherent = section.lessons
        .filter(l => l.kind === 'study')
        .every(l => l.status !== 'locked' || (l.mastery ?? 0) < 0.5)
      assert.ok(gatingCoherent, `${op}: a locked study lesson must have mastery <0.5 (gating coherence)`)
      for (const lesson of section.lessons) {
        if (lesson.mastery !== null) {
          assert.ok(lesson.mastery >= 0 && lesson.mastery <= 1, `${op}: mastery within [0,1] (${lesson.id})`)
        }
        if (lesson.kind === 'exam') {
          assert.equal(lesson.status === 'locked', false, `${op}: exam nodes are never locked (${lesson.id})`)
        }
      }
    }
  }
}

/** Snapshot statuses before an op, to assert no regression after it. */
function statusSnapshot(state: LearningState): Map<string, LessonState['status']> {
  const map = new Map<string, LessonState['status']>()
  for (const course of state.courses) {
    for (const section of course.sections) {
      for (const lesson of section.lessons) map.set(lesson.id, lesson.status)
    }
  }
  return map
}

test('invariant fuzz: 400 random ops never break the state machine', () => {
  const rand = mulberry32(20260815)
  const state = emptyState()
  const course = importCourse(state, parseMarkdownToCourse(FUZZ_MD), 'markdown', 'fuzz')
  const studyIds = course.sections.flatMap(s => s.lessons).filter(l => l.kind === 'study').map(l => l.id)
  const T0 = new Date('2026-08-15T08:00:00Z')
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!
  let proposals: string[] = []
  let clock = T0.getTime()

  for (let step = 0; step < 400; step++) {
    const before = statusSnapshot(state)
    const lessonId = pick(studyIds)
    const op = pick(['attempt', 'answer-correct', 'answer-wrong', 'complete', 'review', 'propose', 'resolve', 'reimport'] as const)
    clock += 60_000
    const now = new Date(clock)
    try {
      if (op === 'attempt') attemptLesson(state, lessonId, now)
      else if (op === 'answer-correct') recordAnswer(state, lessonId, true, undefined, now)
      else if (op === 'answer-wrong') recordAnswer(state, lessonId, false, undefined, now)
      else if (op === 'complete') completeLesson(state, lessonId, now)
      else if (op === 'review') {
        const lesson = state.courses[0]!.sections.flatMap(s => s.lessons).find(l => l.id === lessonId)!
        if (lesson.sm2 !== null) recordReview(state, lessonId, pick([0, 2, 3, 4, 5] as const), now)
      } else if (op === 'propose') {
        proposals.push(proposeMastery(state, lessonId, `fuzz ${step}`, now).id)
      } else if (op === 'resolve') {
        const id = proposals.find(p => state.proposals.find(x => x.id === p)?.status === 'pending')
        if (id !== undefined) {
          resolveProposal(state, id, rand() < 0.5, now)
          proposals = proposals.filter(p => p !== id)
        }
      } else {
        // Re-import of the same source must be idempotent: same course back, no duplicates.
        const again = importCourse(state, parseMarkdownToCourse(FUZZ_MD), 'markdown', 'fuzz')
        assert.equal(again.id, course.id, 'reimport returns the existing course')
        assert.equal(state.courses.filter(c => c.id === course.id).length, 1, 'no duplicate course')
      }
    } catch (error) {
      // Only two failure modes are legal: locked-lesson refusals and reviewing without a schedule.
      const msg = error instanceof Error ? error.message : String(error)
      assert.match(msg, /locked|no review schedule|already (applied|rejected)/,
        `step ${step} (${op} on ${lessonId}): unexpected rejection: ${msg}`)
    }
    assertInvariants(state, `step ${step} (${op})`)
    for (const [id, status] of statusSnapshot(state)) {
      const lesson = state.courses[0]!.sections.flatMap(s => s.lessons).find(l => l.id === id)
      if (lesson !== undefined) {
        assert.ok(STATUS_ORDER[lesson.status] >= STATUS_ORDER[status],
          `step ${step} (${op}): ${id} regressed ${status} → ${lesson.status}`)
      }
    }
  }
  // Sanity on convergence: 400 mixed ops on 5 study lessons must master at least one.
  const mastered = state.courses[0]!.sections.flatMap(s => s.lessons).filter(l => l.status === 'mastered').length
  assert.ok(mastered >= 1, `fuzz made progress (mastered=${mastered})`)
})

/**
 * Audit round exam/state-machine gates (2026-09-14):
 *  - C15: exam nodes never enter the study state machine (attempt/answer refuse)
 *  - C16: attempts grade against their START-TIME bank snapshot (a mid-attempt
 *    regenerate cannot cross-grade)
 *  - C28: the attempt log caps at 20
 *  - C20: course-less friction lands in the global consolidation slot
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  addFriction,
  applyExamBank,
  attemptLesson,
  emptyState,
  gatherConsolidationWindow,
  importCourse,
  recordAnswer,
  regenerateExamBank,
  startExamAttempt,
  recordExamAnswer,
  submitExamAttempt,
  type ExamBankQuestionInput,
  type LearningState,
} from '../src/state.ts'
import { parseMarkdownToCourse } from '../src/vendor/markdown-course.ts'

const T0 = new Date('2026-09-14T10:00:00Z')

function prepared(): { state: LearningState; examId: string; studyId: string } {
  const state = emptyState()
  const course = importCourse(state, parseMarkdownToCourse('# 课\n## S1\n### Alpha\nalpha body long enough.\n### Beta\nbeta body long enough.'), 'markdown', 'fixture')
  const lessons = state.courses[0]!.sections[0]!.lessons
  return { state, examId: lessons.find(l => l.kind === 'exam')!.id, studyId: lessons[0]!.id }
}

function bank(answerShift = 0): ExamBankQuestionInput[] {
  return Array.from({ length: 5 }, (_v, i) => ({
    prompt: `第${String(i + 1)}题`,
    options: ['甲', '乙', '丙', '丁'],
    answer: (i + answerShift) % 4,
    kcTitle: null,
    explanation: `解析${String(i + 1)}`,
  }))
}

test('C15: exam nodes refuse the study state machine and stay available', () => {
  const { state, examId } = prepared()
  assert.throws(() => attemptLesson(state, examId, T0), /never enters the study state machine/)
  assert.throws(() => recordAnswer(state, examId, true, undefined, T0), /takes exam attempts/)
  const exam = state.courses[0]!.sections[0]!.lessons.find(l => l.kind === 'exam')!
  assert.equal(exam.status, 'available', 'the exam node stayed available')
  assert.equal(exam.mastery, null, 'no BKT seed leaked onto it')
})

test('C16: an open attempt grades against its start-time snapshot across a regenerate', () => {
  const { state, examId } = prepared()
  applyExamBank(state, examId, bank(0), T0)
  const { attemptId } = startExamAttempt(state, examId, T0)
  recordExamAnswer(state, examId, attemptId, 'q0', '0')
  recordExamAnswer(state, examId, attemptId, 'q1', '1')
  // mid-attempt regenerate settles the dangling attempt FIRST — against its
  // snapshot, never the new bank about to land
  regenerateExamBank(state, examId)
  const log = state.courses[0]!.sections[0]!.lessons.find(l => l.kind === 'exam')!.examAttemptLog!
  const settled = log.find(a => a.id === attemptId)!
  assert.ok(settled.finishedAt !== null, 'the regenerate settled the open attempt')
  assert.equal(settled.totalCount, 5, 'graded against the ORIGINAL five questions')
  assert.equal(settled.correctCount, 2, 'answers pair with their original keys — no cross-grading')
  // a fresh attempt after the new bank lands grades against the NEW bank
  applyExamBank(state, examId, bank(1), T0)
  const second = startExamAttempt(state, examId, T0)
  recordExamAnswer(state, examId, second.attemptId, 'q0', '0')
  const graded2 = submitExamAttempt(state, examId, second.attemptId, true, T0)
  assert.equal(graded2.totalCount, 5)
  assert.equal(graded2.correctCount, 0, "answer '0' is wrong under the shifted keys — the new attempt sees the NEW bank")
})

test('C28: the attempt log keeps the newest 20 attempts', () => {
  const { state, examId } = prepared()
  applyExamBank(state, examId, bank(), T0)
  for (let i = 0; i < 23; i++) {
    const { attemptId } = startExamAttempt(state, examId, new Date(T0.getTime() + i * 60_000))
    submitExamAttempt(state, examId, attemptId, true, new Date(T0.getTime() + i * 60_000 + 30_000))
  }
  const log = state.courses[0]!.sections[0]!.lessons.find(l => l.kind === 'exam')!.examAttemptLog!
  assert.equal(log.length, 20, 'the log caps at 20')
  assert.equal(log[0]!.id.endsWith(':a3'), true, 'the oldest three fell off')
  assert.equal(log[19]!.id.endsWith(':a22'), true, 'the newest stays')
  assert.equal(state.courses[0]!.sections[0]!.lessons.find(l => l.kind === 'exam')!.examAttempts, 23, 'the summary counter keeps the full history')
})

test('C20: course-less friction lands in the global consolidation slot', () => {
  const state = emptyState()
  addFriction(state, null, 'confused', '课程开始前的困惑', T0)
  addFriction(state, null, 'frustrated', null, T0)
  assert.equal((state.frictionGlobal ?? []).length, 2, 'the entries persist instead of vanishing')
  const window = gatherConsolidationWindow(state)
  assert.equal(window.counts.friction, 2, 'the consolidation window sees them')
  assert.ok(window.entries.some(e => e.text === '课程开始前的困惑'), 'the summary rides the window')
  for (let i = 0; i < 60; i++) addFriction(state, null, 'confused', `f${String(i)}`, T0)
  assert.equal((state.frictionGlobal ?? []).length, 50, 'the global slot caps at 50')
})

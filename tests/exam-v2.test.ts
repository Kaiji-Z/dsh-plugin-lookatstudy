/**
 * SPEC D1/P12 — exam-v2 (the ExamView contract's state half):
 *  - bank lifecycle: begin → apply (validation + anti-hallucination KC union)
 *    → regenerate → idle; ready banks resist begin
 *  - attempt lifecycle: start (dangling graded dead first), incremental
 *    record, submit grading (unanswered = wrong, terminated keeps partial,
 *    best-of stars, self-contained snapshots survive regeneration)
 *  - study_exam_bank_apply: the tutor's validated landing (failure = tool
 *    error the tutor fixes conversationally)
 *  - attempt shuffle (vendored upstream exam-logic): same seed = same order,
 *    different attempt = both orders change, display↔original pairing
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { studyTools } from '../src/tools.ts'
import { emptyState, applyExamBank, beginExamGeneration, regenerateExamBank, settleDanglingAttempts, startExamAttempt, recordExamAnswer, submitExamAttempt, findLesson, importCourse, type LearningState, type ExamBankQuestionInput } from '../src/state.ts'
import { parseMarkdownToCourse } from '../src/vendor/markdown-course.ts'
import { buildAttemptShuffle, displayAnswerToOriginal } from '../src/vendor/exam-logic.ts'

const exec = { signal: new AbortController().signal } as unknown as ToolRunContext
const T0 = new Date('2026-09-07T10:00:00Z')

const COURSE_MD = ['# Bank Fixture', '## S1', '### Alpha', 'alpha body long enough to teach from.', '### Beta', 'beta body long enough to teach from.'].join('\n')

/** Import + define concepts on the first study lesson; returns { examId }. */
async function prepared(): Promise<{ state: LearningState; examId: string }> {
  const state = emptyState()
  const course = importCourse(state, parseMarkdownToCourse(COURSE_MD), 'markdown', 'fixture')
  const tools = studyTools({ get: () => state, save: () => {} })
  const define = tools.find(t => t.name === 'study_define_concepts')!
  await define.execute({ lessonId: `${course.id}:0:0`, concepts: [{ title: '概念A', description: 'a' }, { title: '概念B', description: 'b' }] }, exec)
  const exam = state.courses[0]!.sections[0]!.lessons.find(l => l.kind === 'exam')!
  return { state, examId: exam.id }
}

function bank(n = 5, kc: (i: number) => string | null = i => (i % 2 === 0 ? '概念A' : '概念B')): ExamBankQuestionInput[] {
  return Array.from({ length: n }, (_v, i) => ({
    prompt: `第${String(i + 1)}题:选出正确的一项`,
    options: ['甲', '乙', '丙', '丁'],
    answer: i % 4,
    kcTitle: kc(i),
    explanation: `解析${String(i + 1)}`,
  }))
}

test('bank lifecycle: begin → apply (validated, anti-hallucination) → regenerate → idle', async () => {
  const { state, examId } = await prepared()
  beginExamGeneration(state, examId)
  assert.equal(findLesson(state, examId).lesson.examBank?.status, 'generating')
  // ready banks resist a second begin (regeneration resets first)
  const applied = applyExamBank(state, examId, bank(), T0)
  assert.deepEqual(applied, { questionCount: 5, kcCount: 2 })
  beginExamGeneration(state, examId)
  assert.equal(findLesson(state, examId).lesson.examBank?.status, 'ready')
  // ids are plugin-assigned, kcTitle normalized
  const q0 = findLesson(state, examId).lesson.examBank!.questions[0]!
  assert.equal(q0.id, 'q0')
  assert.equal(q0.kcTitle, '概念A')
  // validation: count window (5-15)
  assert.throws(() => applyExamBank(state, examId, bank(4), T0), /5-15/)
  assert.throws(() => applyExamBank(state, examId, bank(16), T0), /5-15/)
  // validation: shape (pad to the 5-question floor so the count gate passes)
  const padded = (bad: ExamBankQuestionInput): ExamBankQuestionInput[] => [...bank(4), bad]
  assert.throws(() => applyExamBank(state, examId, padded({ prompt: '', options: ['a', 'b'], answer: 0 }), T0), /empty prompt/)
  assert.throws(() => applyExamBank(state, examId, padded({ prompt: 'p', options: ['only'], answer: 0 }), T0), /2\+ non-empty options/)
  assert.throws(() => applyExamBank(state, examId, padded({ prompt: 'p', options: ['a', 'b'], answer: 2 }), T0), /out of range/)
  // anti-hallucination: KC must exist in the section's concept union
  assert.throws(() => applyExamBank(state, examId, bank(5, () => '不存在的概念'), T0), /concept union/)
  // non-exam nodes are refused
  const studyId = state.courses[0]!.sections[0]!.lessons[0]!.id
  assert.throws(() => beginExamGeneration(state, studyId), /not an exam node/)
  // regenerate → idle; re-apply lands a fresh bank
  regenerateExamBank(state, examId)
  assert.equal(findLesson(state, examId).lesson.examBank?.status, 'idle')
  applyExamBank(state, examId, bank(), T0)
  assert.equal(findLesson(state, examId).lesson.examBank!.questions.length, 5)
})

test('attempt lifecycle: incremental record, grading unanswered=wrong, terminated partial, best-of stars', async () => {
  const { state, examId } = await prepared()
  applyExamBank(state, examId, bank(), T0)
  // start requires a ready bank
  const a = startExamAttempt(state, examId, T0)
  assert.equal(a.attemptId, `${examId}:a0`)
  assert.equal(a.questions.length, 5)
  assert.throws(() => startExamAttempt(state, 'ghost:0:0', T0), /unknown/)
  // answer q0 correct (q0.answer=0), q1 wrong (q1.answer=1, user picks 2), leave q2-q4 unanswered
  recordExamAnswer(state, examId, a.attemptId, 'q0', '0')
  recordExamAnswer(state, examId, a.attemptId, 'q1', '2')
  assert.throws(() => recordExamAnswer(state, examId, a.attemptId, 'q0', '9'), /not an option index/)
  assert.throws(() => recordExamAnswer(state, examId, a.attemptId, 'ghost', '0'), /not in the bank/)
  const r = submitExamAttempt(state, examId, a.attemptId, true, T0)
  assert.equal(r.correctCount, 1)
  assert.equal(r.totalCount, 5)
  assert.equal(r.stars, 0)
  assert.equal(r.terminated, true)
  assert.equal(r.bestStars, 0)
  // snapshots: unanswered marked, explanations carried
  const pq2 = r.perQuestion[2]!
  assert.equal(pq2.answered, false)
  assert.equal(pq2.correct, false)
  assert.equal(pq2.explanation, '解析3')
  // finished attempts refuse further writes
  assert.throws(() => recordExamAnswer(state, examId, a.attemptId, 'q3', '0'), /already finished/)
  assert.throws(() => submitExamAttempt(state, examId, a.attemptId, false, T0), /already finished/)
  // best-of: a perfect retry keeps the crown
  const b = startExamAttempt(state, examId, T0)
  assert.equal(b.attemptId, `${examId}:a1`)
  for (let i = 0; i < 5; i++) recordExamAnswer(state, examId, b.attemptId, `q${String(i)}`, String(i % 4))
  const r2 = submitExamAttempt(state, examId, b.attemptId, false, T0)
  assert.equal(r2.correctCount, 5)
  assert.equal(r2.stars, 3)
  assert.equal(r2.bestStars, 3)
  // lesson fields ride the same counters study_exam_result writes
  const lesson = findLesson(state, examId).lesson
  assert.equal(lesson.examStars, 3)
  assert.equal(lesson.examAttempts, 2)
})

test('dangling attempts are graded dead (start + explicit settle both work)', async () => {
  const { state, examId } = await prepared()
  applyExamBank(state, examId, bank(), T0)
  const a = startExamAttempt(state, examId, T0)
  recordExamAnswer(state, examId, a.attemptId, 'q0', '0')
  // leaving without submitting → the NEXT start settles it terminated
  const b = startExamAttempt(state, examId, T0)
  assert.notEqual(b.attemptId, a.attemptId)
  const settled = findLesson(state, examId).lesson.examAttemptLog!.find(x => x.id === a.attemptId)!
  assert.equal(settled.finishedAt !== null, true)
  assert.equal(settled.terminated, true)
  assert.equal(settled.correctCount, 1, 'partial credit kept on terminate')
  // the explicit settle (the dashboard GET path) sweeps every dangling attempt
  settleDanglingAttempts(state, examId)
  const open = findLesson(state, examId).lesson.examAttemptLog!.filter(x => x.finishedAt === null)
  assert.equal(open.length, 0, 'reading the exam status auto-settles dangling attempts (upstream: 悬挂的已被自动判死)')
})

test('review snapshots survive bank regeneration (self-contained settlement)', async () => {
  const { state, examId } = await prepared()
  applyExamBank(state, examId, bank(), T0)
  const a = startExamAttempt(state, examId, T0)
  recordExamAnswer(state, examId, a.attemptId, 'q0', '0')
  const r = submitExamAttempt(state, examId, a.attemptId, false, T0)
  // regenerate drops the bank but the OLD attempt's review is intact
  regenerateExamBank(state, examId)
  applyExamBank(state, examId, bank(6, () => null), T0)
  const again = findLesson(state, examId).lesson.examAttemptLog!.find(x => x.id === a.attemptId)!
  assert.equal(again.perQuestion!.length, 5)
  assert.equal(again.perQuestion![0]!.prompt, r.perQuestion[0]!.prompt)
  assert.equal(again.perQuestion![0]!.options!.length, 4)
})

test('study_exam_bank_apply lands the tutor bank; failures surface as tool errors', async () => {
  const { state, examId } = await prepared()
  const tools = studyTools({ get: () => state, save: () => {} })
  const byName = new Map<string, ToolDefinition>(tools.map(t => [t.name, t]))
  const tool = byName.get('study_exam_bank_apply')!
  assert.ok(tool, 'study_exam_bank_apply registered')
  const out = await tool.execute({ lessonId: examId, questions: bank() }, exec) as { questionCount: number; kcCount: number; status: string }
  assert.deepEqual(out, { lessonId: examId, questionCount: 5, kcCount: 2, status: 'ready' })
  await assert.rejects(
    () => tool.execute({ lessonId: examId, questions: bank(5, () => '幻觉概念') }, exec),
    /concept union/,
    'the anti-hallucination gate reaches the tutor as a fixable tool error',
  )
})

test('attempt shuffle: seeded determinism, per-attempt variance, display↔original pairing', () => {
  const items = [{ id: 'q0', optionCount: 4 }, { id: 'q1', optionCount: 4 }, { id: 'q2', optionCount: 3 }]
  const a = buildAttemptShuffle(items, 'attempt-1')
  const a2 = buildAttemptShuffle(items, 'attempt-1')
  const b = buildAttemptShuffle(items, 'attempt-2')
  assert.deepEqual(a, a2, 'same seed reproduces both orders')
  const differs = JSON.stringify(a.questionOrder) !== JSON.stringify(b.questionOrder)
    || JSON.stringify(a.optionPerms) !== JSON.stringify(b.optionPerms)
  assert.ok(differs, 'a new attempt reshuffles question AND option order')
  // the grading pairing: display position d renders options[perm[d]] — the
  // recorded answer must map back through the same perm
  for (const it of items) {
    const perm = a.optionPerms[it.id]!
    assert.equal(new Set(perm).size, perm.length, 'option perm is a real permutation')
    for (let d = 0; d < perm.length; d++) {
      assert.equal(displayAnswerToOriginal(perm, d), String(perm[d]))
    }
  }
  assert.equal(displayAnswerToOriginal([2, 0, 1], 0), '2')
})

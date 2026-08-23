/**
 * SPEC 1.4 — the exam system (upstream verify-exam / verify-post-quiz-actions
 * semantics on the plugin's conversational exam model):
 *  - pure logic: accuracyToStars thresholds, planExamQuota clamps, dynamic
 *    questionTimeLimitSec (v0.19 relaxation: length/code/formula aware)
 *  - study_exam_result: stars best-of across attempts, post-quiz action set
 *    (≥2 always; mark-mastered only when all-correct + high mastery), refusal
 *    on non-exam lessons
 *  - study_lesson on an exam node carries examGuide (quota + rules)
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { studyTools } from '../src/tools.ts'
import { emptyState, type LearningState } from '../src/state.ts'
import { accuracyToStars, planExamQuota, questionTimeLimitSec, getPostQuizActions } from '../src/vendor/exam-logic.ts'

const exec = { signal: new AbortController().signal } as unknown as ToolRunContext

function setup(): { byName: Map<string, ToolDefinition>; state: LearningState } {
  const state = emptyState()
  const tools = studyTools({ get: () => state, save: () => {} })
  return { byName: new Map(tools.map(t => [t.name, t])), state }
}

const COURSE_MD = [
  '# Exam Fixture',
  '## S1',
  '### Alpha', 'alpha body with enough substance to teach from.',
  '### Beta', 'beta body with enough substance to teach from.',
].join('\n')

async function run(map: Map<string, ToolDefinition>, name: string, args: Record<string, unknown>): Promise<any> {
  const tool = map.get(name)!
  assert.ok(tool, `tool ${name} registered`)
  return tool.execute(args, exec)
}

/** Import + define concepts on both study lessons; returns { examId, lessonId }. */
async function preparedCourse(): Promise<{ byName: Map<string, ToolDefinition>; state: LearningState; examId: string; lessonId: string }> {
  const { byName, state } = setup()
  const imported = await run(byName, 'study_import_markdown', { markdown: COURSE_MD })
  const first = imported.firstLessonId as string
  await run(byName, 'study_lesson', { lessonId: first })
  await run(byName, 'study_define_concepts', { lessonId: first, concepts: [{ title: '概念A', description: 'a' }, { title: '概念B', description: 'b' }] })
  const lessons = state.courses[0]!.sections[0]!.lessons
  const exam = lessons.find(l => l.kind === 'exam')!
  return { byName, state, examId: exam.id, lessonId: first }
}

test('pure exam logic mirrors upstream: stars, quota, dynamic time limits', () => {
  assert.equal(accuracyToStars(1), 3)
  assert.equal(accuracyToStars(0.95), 3)
  assert.equal(accuracyToStars(0.94), 2)
  assert.equal(accuracyToStars(0.8), 2)
  assert.equal(accuracyToStars(0.79), 1)
  assert.equal(accuracyToStars(0.6), 1)
  assert.equal(accuracyToStars(0.59), 0)
  assert.deepEqual(planExamQuota([]), [])
  assert.equal(planExamQuota(['a', 'b', 'c', 'd']).reduce((x, y) => x + y), 6)
  assert.equal(planExamQuota(Array.from({ length: 8 }, (_v, i) => `k${i}`)).reduce((x, y) => x + y), 12)
  assert.equal(planExamQuota(Array.from({ length: 12 }, (_v, i) => `k${i}`)).reduce((x, y) => x + y), 15)
  // dynamic relaxation: short base ≥60s; code and formulas push up; clamp at 300
  const short = questionTimeLimitSec('1+1=?')
  const withCode = questionTimeLimitSec('阅读代码:\n```\nconst x = 1\n```\n输出什么?')
  const withMath = questionTimeLimitSec('计算 $a^2+b^2$ 的值?')
  assert.ok(short >= 60 && short < 90, `short question base, got ${short}`)
  assert.ok(withCode >= short + 20, `code adds time: ${withCode} vs ${short}`)
  assert.ok(withMath >= short + 20, `formula adds time: ${withMath} vs ${short}`)
  assert.equal(questionTimeLimitSec('long word count '.repeat(300)), 300)
})

test('post-quiz actions: never a dead end; mark-mastered gated on all-correct + mastery', () => {
  const wrong = getPostQuizActions({ correct: 1, total: 3 }, 0.5)
  assert.ok(wrong.length >= 2)
  assert.equal(wrong[0]!.id, 'explain-wrong')
  assert.ok(wrong.some(a => a.id === 'retry'))
  assert.ok(!wrong.some(a => a.id === 'mark-mastered'))
  const mastered = getPostQuizActions({ correct: 3, total: 3 }, 0.92)
  assert.deepEqual(mastered.map(a => a.id), ['next-topic', 'go-deeper'])
  const near = getPostQuizActions({ correct: 3, total: 3 }, 0.86)
  assert.equal(near[0]!.id, 'mark-mastered')
  assert.ok((near[0] as { advancesMastery?: boolean }).advancesMastery === true)
  const low = getPostQuizActions({ correct: 3, total: 3 }, 0.3)
  assert.ok(low.length >= 2 && !low.some(a => a.id === 'mark-mastered'))
  const empty = getPostQuizActions({ correct: 0, total: 0 }, null)
  assert.ok(empty.length >= 2)
})

test('study_exam_result: stars best-of across attempts, actions surfaced, refuses non-exam lessons', async () => {
  const { byName, state, examId, lessonId } = await preparedCourse()
  await assert.rejects(() => run(byName, 'study_exam_result', { lessonId, correct: 1, total: 1 }), /not an exam node/)
  await assert.rejects(() => run(byName, 'study_exam_result', { lessonId: examId, correct: 5, total: 3 }), /invalid exam score/)

  const first = await run(byName, 'study_exam_result', { lessonId: examId, correct: 6, total: 10 })
  assert.equal(first.stars, 1) // 60% → 1★
  assert.equal(first.bestStars, 1)
  assert.equal(first.attempts, 1)
  assert.ok(first.actions.length >= 2)
  assert.equal(first.actions[0].id, 'explain-wrong') // has wrong answers

  const second = await run(byName, 'study_exam_result', { lessonId: examId, correct: 10, total: 10 })
  assert.equal(second.stars, 3)
  assert.equal(second.bestStars, 3, 'best-of retained')
  assert.equal(second.attempts, 2)
  // exam mastery seeds at 0.5 on open — all-correct but mastery low → no mark-mastered
  assert.ok(!second.actions.some((a: { id: string }) => a.id === 'mark-mastered'))
  assert.ok(typeof second.nextLessonId === 'string' || second.nextLessonId === null)

  const lesson = state.courses[0]!.sections[0]!.lessons.find(l => l.id === examId)!
  assert.equal(lesson.examStars, 3)
  assert.equal(lesson.examAttempts, 2)
})

test('study_lesson on an exam node carries examGuide (quota from section KCs + rules)', async () => {
  const { byName, examId } = await preparedCourse()
  const lesson = await run(byName, 'study_lesson', { lessonId: examId })
  assert.ok(lesson.examGuide, 'exam nodes carry the guide')
  // section KCs: 概念A+概念B on lesson one, none on the other → kcCount 2, quota ceil(2*1.5)=3 → clamp min 5
  assert.equal(lesson.examGuide.kcCount, 2)
  assert.equal(lesson.examGuide.questionCount, 5, 'quota clamps to the 5-question floor')
  assert.ok(lesson.examGuide.timeLimitRule.includes('clamp 60–300'))
  assert.ok(lesson.examGuide.starsRule.includes('≥95%'))
  // study lessons never carry it
  const studyLesson = await run(byName, 'study_lesson', { lessonId: (await preparedCourse()).lessonId })
  assert.equal(studyLesson.examGuide, undefined)
})

test('the rendered lesson text carries the examGuide (live-test defect fix: render omitted it)', async () => {
  const { byName, examId } = await preparedCourse()
  const tool = byName.get('study_lesson')!
  const value = await tool.execute({ lessonId: examId }, { signal: new AbortController().signal } as never)
  const rendered = tool.output!.render!({ lessonId: examId }, value).map(b => (b as { text: string }).text).join('\n')
  assert.ok(rendered.includes('exam: 5 questions'), `render must surface the guide: ${rendered.slice(0, 200)}`)
  assert.ok(rendered.includes('clamp 60–300'))
})

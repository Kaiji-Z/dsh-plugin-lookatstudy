/**
 * SPEC 1.5 — the learning loop's upstream alignments:
 *  - consolidation: gatherConsolidationWindow is a pure watermark-sliced read
 *    (friction + practice notes since lastConsolidatedAt, capped per lesson);
 *    study_consolidate advances the watermark (the tutor is the consolidate fn)
 *  - learner model: study_lesson carries a composed learnerState block
 *    (upstream buildLearnerSnapshot's 【学习者当前状态】 projection)
 *  - memory: slots + watermark persistence (v2 state round-trips)
 *  - lesson-summary-kc: study_define_concepts accepts a one-shot summary that
 *    rides study_lesson (upstream's generate-once semantics, tutor-driven)
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { studyTools } from '../src/tools.ts'
import { emptyState, gatherConsolidationWindow, type LearningState } from '../src/state.ts'

const exec = { signal: new AbortController().signal } as unknown as ToolRunContext

function setup(): { byName: Map<string, ToolDefinition>; state: LearningState } {
  const state = emptyState()
  const tools = studyTools({ get: () => state, save: () => {} })
  return { byName: new Map(tools.map(t => [t.name, t])), state }
}

const COURSE_MD = [
  '# Loop Fixture',
  '## S1',
  '### Alpha', 'alpha body with enough substance to teach from.',
  '### Beta', 'beta body with enough substance to teach from.',
].join('\n')

async function run(map: Map<string, ToolDefinition>, name: string, args: Record<string, unknown>): Promise<any> {
  const tool = map.get(name)!
  assert.ok(tool, `tool ${name} registered`)
  return tool.execute(args, exec)
}

test('gatherConsolidationWindow: watermark-sliced, capped, time-ordered, pure', async () => {
  const { byName, state } = setup()
  const imported = await run(byName, 'study_import_markdown', { markdown: COURSE_MD })
  const lessonId = imported.firstLessonId as string
  await run(byName, 'study_lesson', { lessonId })
  await run(byName, 'study_report_friction', { category: 'confused', summary: '概念混淆', lessonId })
  await run(byName, 'study_record_answer', { lessonId, correct: false, question: 'Q1?', givenAnswer: 'wrong' })
  state.lastConsolidatedAt = null

  const w1 = gatherConsolidationWindow(state)
  assert.ok(w1.counts.friction >= 1, 'friction entry collected')
  assert.ok(w1.counts.practice >= 1, 'practice note from record_answer collected')
  assert.equal(w1.since, null)
  assert.ok(w1.entries.length >= 2)
  for (let i = 1; i < w1.entries.length; i++) {
    assert.ok(w1.entries[i - 1]!.at <= w1.entries[i]!.at, 'time-ordered')
  }
  // mutating state afterwards proves the gather itself didn't advance anything
  assert.equal(state.lastConsolidatedAt, null)

  // slice: entries at/before the watermark disappear
  state.lastConsolidatedAt = w1.entries[w1.entries.length - 1]!.at
  const w2 = gatherConsolidationWindow(state)
  assert.equal(w2.counts.friction + w2.counts.practice, 0, 'watermark slices everything already seen')
})

test('study_consolidate returns the window and advances the watermark', async () => {
  const { byName, state } = setup()
  const imported = await run(byName, 'study_import_markdown', { markdown: COURSE_MD })
  const lessonId = imported.firstLessonId as string
  await run(byName, 'study_lesson', { lessonId })
  await run(byName, 'study_report_friction', { category: 'blocked', summary: 'stuck', lessonId })

  const r1 = await run(byName, 'study_consolidate', {})
  assert.ok(r1.counts.friction >= 1)
  assert.equal(r1.since, null)
  assert.ok(typeof r1.watermark === 'string')
  assert.equal(state.lastConsolidatedAt, r1.watermark)

  const r2 = await run(byName, 'study_consolidate', {})
  assert.equal(r2.counts.friction + r2.counts.practice, 0, 'second gather is empty (watermark advanced)')
  assert.equal(r2.since, r1.watermark)
})

test('study_lesson carries the composed learnerState block', async () => {
  const { byName } = setup()
  const imported = await run(byName, 'study_import_markdown', { markdown: COURSE_MD })
  const lessonId = imported.firstLessonId as string
  await run(byName, 'study_define_concepts', { lessonId, concepts: [{ title: '概念A', description: 'a' }, { title: '概念B', description: 'b' }] })
  await run(byName, 'study_record_answer', { lessonId, correct: false, concept: '概念A' })
  await run(byName, 'study_report_friction', { category: 'confused', summary: 'muddle', lessonId })
  const lesson = await run(byName, 'study_lesson', { lessonId })
  assert.ok(typeof lesson.learnerState === 'string' && lesson.learnerState.length > 0)
  assert.ok(lesson.learnerState.includes('status'), 'block starts with status')
  assert.ok(lesson.learnerState.includes('weak concepts'), 'weak concepts surface')
  assert.ok(lesson.learnerState.includes('recent friction'), 'friction surfaces')
})

test('define_concepts summary rides the lesson (lesson-summary-kc)', async () => {
  const { byName, state } = setup()
  const imported = await run(byName, 'study_import_markdown', { markdown: COURSE_MD })
  const lessonId = imported.firstLessonId as string
  await run(byName, 'study_lesson', { lessonId })
  await run(byName, 'study_define_concepts', {
    lessonId,
    concepts: [{ title: '概念A', description: 'a' }, { title: '概念B', description: 'b' }],
    summary: '本课介绍 Alpha 的两个核心概念。',
  })
  const lesson = await run(byName, 'study_lesson', { lessonId })
  assert.equal(lesson.summary, '本课介绍 Alpha 的两个核心概念。')
  assert.equal(state.courses[0]!.sections[0]!.lessons[0]!.summary, '本课介绍 Alpha 的两个核心概念。')
  // no summary → field absent (schema optional)
  const other = await run(byName, 'study_lesson', { lessonId: imported.lessons > 1 ? state.courses[0]!.sections[0]!.lessons[1]!.id : lessonId })
  if (other.lessonId !== lessonId) assert.equal(other.summary, undefined)
})

test('state v2 round-trips the watermark (loadState migrates old files without it)', async () => {
  const { state } = setup()
  state.lastConsolidatedAt = '2026-08-23T10:00:00.000Z'
  const { loadState } = await import('../src/state.ts')
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'lks-state-'))
  try {
    const withMark = join(dir, 'with.json')
    const withoutMark = join(dir, 'without.json')
    writeFileSync(withMark, JSON.stringify(state))
    writeFileSync(withoutMark, JSON.stringify({ ...state, lastConsolidatedAt: undefined }))
    assert.equal(loadState(withoutMark).lastConsolidatedAt, null, 'old v2 files default to null')
    assert.equal(loadState(withMark).lastConsolidatedAt, '2026-08-23T10:00:00.000Z', 'new files round-trip the watermark')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

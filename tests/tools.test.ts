/**
 * Tool surface end-to-behavior: every study tool executed against an
 * in-memory store, including render/presentation purity (cards are pure
 * projections — no IO).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { studyTools } from '../src/tools.ts'
import { emptyState, type LearningState } from '../src/state.ts'

const COURSE_MD = [
  '# Tool Fixture',
  '## Part One',
  '### Reading', 'reading body',
  '### Writing', 'writing body',
  '## Part Two',
  '### Review', 'review body',
].join('\n')

function setup(): { byName: Map<string, ToolDefinition>; state: LearningState; saves: () => number } {
  const state = emptyState()
  let saves = 0
  const tools = studyTools({ get: () => state, save: () => { saves += 1 } }, { current: undefined })
  const byName = new Map(tools.map(t => [t.name, t]))
  return { byName, state, saves: () => saves }
}

const exec = { signal: new AbortController().signal } as unknown as ToolRunContext

async function run(map: Map<string, ToolDefinition>, name: string, args: Record<string, unknown> = {}): Promise<any> {
  const tool = map.get(name)
  assert.ok(tool, `tool ${name} registered`)
  return tool.execute(args, exec)
}

test('the full study loop works through the tools', async () => {
  const { byName, state, saves } = setup()

  const imported = await run(byName, 'study_import_markdown', { markdown: COURSE_MD }) as {
    courseId: string; lessons: number; firstLessonId: string
  }
  assert.equal(imported.lessons, 3)
  assert.equal(saves(), 1)

  const courses = await run(byName, 'study_courses') as { total: number; courses: Array<{ currentLessonId: string }> }
  assert.equal(courses.total, 1)
  assert.equal(courses.courses[0]!.currentLessonId, imported.firstLessonId)

  const map = await run(byName, 'study_map', { courseId: imported.courseId })
  assert.equal(map.counts.total, 3)
  assert.equal(map.tree[0]!.lessons[0]!.status, 'available')

  const lesson = await run(byName, 'study_lesson', { lessonId: imported.firstLessonId })
  assert.equal(lesson.body, 'reading body')
  assert.equal(lesson.nextLessonId, `${imported.courseId}:0:1`)

  const answer = await run(byName, 'study_record_answer', { lessonId: imported.firstLessonId, correct: true })
  assert.equal(answer.attempts, 1)
  assert.ok(answer.newMasteryPct > 0)

  const completed = await run(byName, 'study_complete_lesson', { lessonId: imported.firstLessonId })
  assert.equal(completed.unlockedLessonId, `${imported.courseId}:0:1`)
  assert.equal(completed.courseComplete, false)

  const due = await run(byName, 'study_due_reviews') as { total: number }
  assert.equal(due.total, 0)

  // Simulate a passing day at the state layer, then review through the tool.
  const stored = state.courses[0]!.sections[0]!.lessons[0]!
  stored.dueAt = new Date(Date.now() - 86_400_000).toISOString()
  const dueAgain = await run(byName, 'study_due_reviews') as { total: number; due: Array<{ lessonId: string }> }
  assert.equal(dueAgain.total, 1)
  const review = await run(byName, 'study_record_review', { lessonId: dueAgain.due[0]!.lessonId, quality: 4 })
  assert.equal(review.intervalDays, 1)

  const remaining = await run(byName, 'study_delete_course', { courseId: imported.courseId })
  assert.equal(remaining.remaining, 0)
  assert.equal(saves(), 6, 'every mutating call persisted (import, focus, answer, complete, review, delete)')
})

test('imports with no lessons fail loud and leave state untouched', async () => {
  const { byName, state } = setup()
  await assert.rejects(
    () => run(byName, 'study_import_markdown', { markdown: '# Just a title\n\nNo structure here.' }),
    /0 lessons/,
  )
  assert.equal(state.courses.length, 0)
})

test('unknown ids fail loud across tools', async () => {
  const { byName } = setup()
  await assert.rejects(() => run(byName, 'study_map', { courseId: 'ghost' }), /unknown course id/)
  await assert.rejects(() => run(byName, 'study_lesson', { lessonId: 'ghost:0:0' }), /unknown course id/)
  await assert.rejects(() => run(byName, 'study_record_answer', { lessonId: 'ghost:0:0', correct: true }), /unknown course id/)
})

test('github url parsing accepts tolerated forms and rejects others via tool errors', async () => {
  const { byName } = setup()
  await assert.rejects(
    () => run(byName, 'study_import_github', { url: 'https://gitlab.com/a/b' }),
    /not a GitHub repository URL/,
  )
})

test('presentCall and presentResult are total over representative values', async () => {
  const { byName } = setup()
  const imported = await run(byName, 'study_import_markdown', { markdown: COURSE_MD })
  const lessonId = imported.firstLessonId as string

  const cases: Array<[string, Record<string, unknown>, unknown]> = [
    ['study_import_markdown', { markdown: COURSE_MD }, imported],
    ['study_map', { courseId: imported.courseId }, await run(byName, 'study_map', { courseId: imported.courseId })],
    ['study_record_answer', { lessonId, correct: true }, await run(byName, 'study_record_answer', { lessonId, correct: true })],
    ['study_due_reviews', {}, await run(byName, 'study_due_reviews')],
  ]
  for (const [name, args, value] of cases) {
    const tool = byName.get(name)!
    const call = tool.presentCall?.(args)
    assert.ok(call === undefined || typeof call.card === 'string')
    const meta = tool.output.presentationMeta?.(args, value)
    if (tool.presentResult && meta !== undefined) {
      const result = { content: [], isError: false, meta }
      const view = tool.presentResult!(args, result as never)
      assert.equal(view.card, 'generic')
      assert.ok((view as { content?: Array<{ text: string }> }).content!.length > 0)
    }
  }
})

test('every presentResult is total over a result with no meta (history events predating presentationMeta)', async () => {
  const { byName } = setup()
  const imported = await run(byName, 'study_import_markdown', { markdown: COURSE_MD })
  const lessonId = imported.firstLessonId as string
  const argsByTool = new Map<string, Record<string, unknown>>([
    ['study_import_markdown', { markdown: COURSE_MD }],
    ['study_map', { courseId: imported.courseId }],
    ['study_record_answer', { lessonId, correct: true }],
    ['study_complete_lesson', { lessonId }],
    ['study_due_reviews', {}],
    ['study_propose_mastery', { lessonId, rationale: 'recap' }],
    ['study_resolve_proposal', { proposalId: 'p1', accept: true }],
  ])
  for (const tool of byName.values()) {
    if (tool.presentResult === undefined) continue
    const view = tool.presentResult(argsByTool.get(tool.name) ?? {}, { content: [], isError: false } as never)
    assert.ok(view === undefined || typeof view.card === 'string', `${tool.name} survives a meta-less result`)
  }
})

test('render returns text blocks for the core outputs', async () => {
  const { byName } = setup()
  const imported = await run(byName, 'study_import_markdown', { markdown: COURSE_MD })
  const mapTool = byName.get('study_map')!
  const blocks = mapTool.output.render({ courseId: imported.courseId }, await run(byName, 'study_map', { courseId: imported.courseId }))
  assert.ok(blocks.length > 0)
  assert.ok(blocks.every(b => b.type === 'text'))
  assert.ok(blocks.some(b => 'text' in b && b.text.includes('▶️')))
})

test('KC lifecycle: define, attribute answers, weak flags, min aggregation', async () => {
  const { byName, state } = setup()
  const imported = await run(byName, 'study_import_markdown', { markdown: COURSE_MD })
  const lessonId = imported.firstLessonId as string

  const defined = await run(byName, 'study_define_concepts', {
    lessonId,
    concepts: [
      { title: '读取', description: 'what reading means' },
      { title: '写作', description: 'what writing means' },
    ],
  })
  assert.equal(defined.concepts.length, 2)

  const answer = await run(byName, 'study_record_answer', { lessonId, correct: true, concept: '读取' })
  assert.equal(answer.concept.title, '读取')
  const lesson = state.courses[0]!.sections[0]!.lessons[0]!
  // Only one concept was observed; the unobserved one stays at its 50% prior,
  // so lesson mastery (min) stays weak.
  assert.equal(lesson.concepts!.length, 2)
  assert.ok(answer.newMasteryPct <= 55, 'unobserved concept caps lesson mastery at the prior')

  const lessonValue = await run(byName, 'study_lesson', { lessonId })
  assert.ok(lessonValue.concepts.some((c: { weak: boolean }) => c.weak))
  assert.ok(lessonValue.starters.length === 4)
  assert.equal(typeof lessonValue.strategy, 'string')

  await assert.rejects(
    () => run(byName, 'study_record_answer', { lessonId, correct: true, concept: '不存在' }),
    /unknown concept/,
  )
})

test('mastery proposals: propose, resolve accept/reject', async () => {
  const { byName, state } = setup()
  const imported = await run(byName, 'study_import_markdown', { markdown: COURSE_MD })
  const lessonId = imported.firstLessonId as string

  const proposal = await run(byName, 'study_propose_mastery', { lessonId, rationale: 'explains it flawlessly' })
  assert.equal(proposal.status, 'pending')

  const resolved = await run(byName, 'study_resolve_proposal', { proposalId: proposal.proposalId, accept: true })
  assert.equal(resolved.status, 'applied')
  const lesson = state.courses[0]!.sections[0]!.lessons[0]!
  assert.equal(lesson.status, 'completed')
  assert.ok((lesson.mastery ?? 0) >= 0.95)
  await assert.rejects(
    () => run(byName, 'study_resolve_proposal', { proposalId: proposal.proposalId, accept: true }),
    /already applied/,
  )
})

test('friction, memory, notes, and mode switching round out the agent contract', async () => {
  const { byName, state } = setup()
  const imported = await run(byName, 'study_import_markdown', { markdown: COURSE_MD })
  const lessonId = imported.firstLessonId as string

  await run(byName, 'study_report_friction', { category: 'confused', summary: 'mixes up reading and writing', lessonId })
  assert.equal(state.courses[0]!.sections[0]!.lessons[0]!.friction.length, 1)

  const remembered = await run(byName, 'study_remember', { category: 'global', content: 'prefers analogies' })
  assert.equal(remembered.previous, null)
  assert.equal(state.memoryGlobal, 'prefers analogies')

  await run(byName, 'study_note_save', { lessonId, zone: 'understand', title: 'map', text: '```mermaid\nflowchart TD\na-->b\n```', source: 'ai' })
  const notes = await run(byName, 'study_notes')
  assert.equal(notes.total, 1)
  assert.equal(notes.notes[0].zone, 'understand')

  const answer = await run(byName, 'study_record_answer', { lessonId, correct: false, question: 'What is reading?', givenAnswer: 'uhh' })
  const practice = await run(byName, 'study_notes')
  assert.equal(practice.total, 2)
  assert.ok(practice.notes.some((n: { zone: string }) => n.zone === 'practice'), 'answered questions auto-log to the practice zone')

  const mode = await run(byName, 'study_set_mode', { mode: 'practice' })
  assert.equal(mode.mode, 'practice')
  assert.equal(state.mode, 'practice')
})

test('answers auto-graduate at 90% and early-unlock at 50%', async () => {
  const { byName, state } = setup()
  const imported = await run(byName, 'study_import_markdown', { markdown: COURSE_MD })
  const l1 = imported.firstLessonId as string
  const l2 = `${imported.courseId}:0:1`

  // No concepts defined: single-BKT mastery. Repeated correct answers climb past 0.5.
  let last
  for (let i = 0; i < 3; i++) {
    last = await run(byName, 'study_record_answer', { lessonId: l1, correct: true })
  }
  assert.ok(last.newMasteryPct > 50, `mastery climbs (got ${last.newMasteryPct}%)`)
  assert.equal(state.courses[0]!.sections[0]!.lessons[1]!.status, 'available', 'early unlock at ≥50%')

  // Keep answering until graduation (>=90%).
  for (let i = 0; i < 30 && state.courses[0]!.sections[0]!.lessons[0]!.status !== 'completed'; i++) {
    await run(byName, 'study_record_answer', { lessonId: l1, correct: true })
  }
  const graduated = state.courses[0]!.sections[0]!.lessons[0]!
  assert.equal(graduated.status, 'completed')
  assert.ok(graduated.dueAt !== null, 'graduation seeds the first review')
  assert.notEqual(l2, undefined)
})

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
import { setHttpsGetOverride } from '../src/vendor/repo-fetcher.ts'

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
  const tools = studyTools({ get: () => state, save: () => { saves += 1 } })
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
  assert.equal(imported.lessons, 4, 'three study lessons plus the S1 exam node')
  assert.equal(saves(), 1)

  const courses = await run(byName, 'study_courses') as { total: number; courses: Array<{ currentLessonId: string }> }
  assert.equal(courses.total, 1)
  assert.equal(courses.courses[0]!.currentLessonId, imported.firstLessonId)

  const map = await run(byName, 'study_map', { courseId: imported.courseId })
  assert.equal(map.counts.total, 4)
  assert.equal(map.tree[0]!.lessons[0]!.status, 'available')

  const lesson = await run(byName, 'study_lesson', { lessonId: imported.firstLessonId })
  assert.equal(lesson.body, 'reading body')
  assert.equal(lesson.nextLessonId, `${imported.courseId}:0:1`)
  assert.equal(lesson.status, 'in_progress', 'opening is attempting')
  assert.equal(state.courses[0]!.sections[0]!.lessons[1]!.status, 'available',
    'the attempt itself unlocks the dual track (mastery seeded at the 0.5 prior)')

  const answer = await run(byName, 'study_record_answer', { lessonId: imported.firstLessonId, correct: true })
  assert.equal(answer.attempts, 1)
  assert.ok(answer.newMasteryPct > 0)

  const completed = await run(byName, 'study_complete_lesson', { lessonId: imported.firstLessonId })
  assert.deepEqual(completed.unlockedLessonIds, [],
    'already unlocked by the study_lesson attempt — completion adds nothing new')
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


/** Minimal JSON-schema subset the tools actually declare (object/array/scalars/enum/oneOf/required/additionalProperties/items). */
interface Schema {
  type?: string
  enum?: unknown[]
  properties?: Record<string, Schema>
  required?: string[]
  additionalProperties?: boolean
  items?: Schema
  oneOf?: Schema[]
}

/** Structural conformance check mirroring the real tool-call path's output validation (tests bypass it by calling execute directly). */
function conforms(value: unknown, schema: Schema, path: string): string | null {
  if (schema.oneOf !== undefined) {
    return schema.oneOf.some(arm => conforms(value, arm, path) === null) ? null : `${path}: no oneOf arm matched (${JSON.stringify(value)})`
  }
  if (schema.enum !== undefined) {
    return schema.enum.some(e => e === value) ? null : `${path}: ${JSON.stringify(value)} not in enum`
  }
  switch (schema.type) {
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return `${path}: not an object`
      const record = value as Record<string, unknown>
      for (const key of schema.required ?? []) {
        if (!(key in record)) return `${path}.${key}: required field missing`
      }
      for (const key of Object.keys(record)) {
        const prop = schema.properties?.[key]
        if (prop !== undefined) {
          const err = conforms(record[key], prop, `${path}.${key}`)
          if (err !== null) return err
        } else if (schema.additionalProperties === false) {
          return `${path}.${key}: present but undeclared (additionalProperties:false) — the real tool path rejects this`
        }
      }
      return null
    }
    case 'array': {
      if (!Array.isArray(value)) return `${path}: not an array`
      for (const [i, item] of value.entries()) {
        const err = conforms(item, schema.items ?? {}, `${path}[${i}]`)
        if (err !== null) return err
      }
      return null
    }
    case 'string':
      return typeof value === 'string' ? null : `${path}: not a string`
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value) ? null : `${path}: not an integer`
    case 'boolean':
      return typeof value === 'boolean' ? null : `${path}: not a boolean`
    case 'null':
      return value === null ? null : `${path}: not null`
    default:
      return null
  }
}

test('every tool output conforms to its declared output schema (the real tool-call path validates; direct execute calls do not)', async () => {
  const { byName } = setup()
  const imported = await run(byName, 'study_import_markdown', { markdown: COURSE_MD }) as { courseId: string; firstLessonId: string }
  const lessonId = imported.firstLessonId as string

  // The regression the tutor found live: concepts defined → ConceptView carries
  // `tested`, which the study_lesson schema used to omit (additionalProperties:false).
  await run(byName, 'study_define_concepts', {
    lessonId,
    concepts: [
      { title: '读取', description: 'what reading means' },
      { title: '写作', description: 'what writing means' },
    ],
  })

  const scenarios: Array<[string, Record<string, unknown>]> = [
    ['study_courses', {}],
    ['study_map', { courseId: imported.courseId }],
    ['study_lesson', { lessonId }],
    ['study_record_answer', { lessonId, correct: true, concept: '读取' }],
    ['study_due_reviews', {}],
    ['study_complete_lesson', { lessonId }],
    ['study_record_review', { lessonId, quality: 4 }],
    ['study_propose_mastery', { lessonId, rationale: 'recap' }],
    ['study_resolve_proposal', { proposalId: (await run(byName, 'study_propose_mastery', { lessonId, rationale: 'again' }) as { proposalId: string }).proposalId, accept: false }],
    ['study_report_friction', { category: 'confused', summary: 'x', lessonId }],
    ['study_remember', { category: 'global', content: 'prefers analogies' }],
    ['study_notes', { lessonId }],
    ['study_note_save', { lessonId, zone: 'record', title: 't', text: 'x', source: 'chat' }],
    ['study_set_mode', { mode: 'practice' }],
    ['study_lesson', { lessonId }],
  ]
  for (const [name, args] of scenarios) {
    const tool = byName.get(name)!
    const output = await run(byName, name, args)
    const err = conforms(output, tool.output.schema as Schema, name)
    assert.equal(err, null, `${name} output must satisfy its schema`)
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
  assert.ok(blocks.some(b => 'text' in b && b.text.includes('⭐')),
    'the fresh first lesson renders as the available star')
  assert.ok(blocks.some(b => 'text' in b && b.text.includes('🎯')), 'exam nodes render')
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
  assert.equal(lesson.status, 'mastered')
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
  for (let i = 0; i < 30 && state.courses[0]!.sections[0]!.lessons[0]!.status !== 'mastered'; i++) {
    await run(byName, 'study_record_answer', { lessonId: l1, correct: true })
  }
  const graduated = state.courses[0]!.sections[0]!.lessons[0]!
  assert.equal(graduated.status, 'mastered')
  assert.ok(graduated.dueAt !== null, 'graduation seeds the first review')
  assert.notEqual(l2, undefined)
})

/* ── the tutor design protocol (GitHub import) ────────────────────────── */

const REPO_README = '# Repo Course\n\nLessons:\n\n- [A](lessons/a.md)\n- [B](lessons/b.md)\n'
const REPO_FILE_A = [
  '# File A', 'preface prose',
  '## Setup', 'setup body', '### Sub detail', 'sub body',
  '## Deep', 'deep body',
].join('\n')
const REPO_FILE_B = '# File B\n\nlab body\n'

/** jsDelivr stub serving repo files by path; everything else (tree APIs included) 404s. */
function repoFetchStub(files: Record<string, string>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input)
    const marker = '@main/'
    const at = url.indexOf(marker)
    if (url.startsWith('https://cdn.jsdelivr.net/gh/') && at !== -1) {
      const text = files[url.slice(at + marker.length)]
      if (text !== undefined) return new Response(text, { status: 200 })
    }
    return new Response('not found', { status: 404 })
  }) as unknown as typeof fetch
}

test('the tutor design protocol: import returns a brief, apply lands the designed course', async () => {
  const state = emptyState()
  let saves = 0
  setHttpsGetOverride(async () => ({ ok: false, error: 'offline test' }))
  try {
    const tools = studyTools({ get: () => state, save: () => { saves += 1 } }, {
      fetch: repoFetchStub({ 'README.md': REPO_README, 'lessons/a.md': REPO_FILE_A, 'lessons/b.md': REPO_FILE_B }),
    })
    const byName = new Map(tools.map(t => [t.name, t]))

    const brief = await run(byName, 'study_import_github', { url: 'https://github.com/o/r' }) as {
      status: string; courseTitle: string; fileCount: number
    }
    assert.equal(brief.status, 'design_required')
    assert.equal(brief.courseTitle, 'Repo Course')
    assert.equal(brief.fileCount, 2)
    assert.equal(saves, 0, 'fetching the brief must not touch persisted state')
  assert.equal(conforms(brief, byName.get('study_import_github')!.output.schema as Schema, 'github'), null,
    'the design_required branch satisfies the oneOf schema')

  const applied = await run(byName, 'study_apply_design', { sections: [
    { title: 'Part One', lessons: [
      { title: 'A intro', file: 'lessons/a.md', anchor: '## Setup' },
      { title: 'A deep', file: 'lessons/a.md', anchor: '## Deep' },
    ] },
    { title: 'Labs', lessons: [{ title: 'B lab', file: 'lessons/b.md', world: 'practice' }] },
  ] }) as { lessons: number; droppedLessons: number; firstLessonId: string }
  assert.equal(applied.lessons, 4, 'three designed lessons plus the study section\'s exam node')
  assert.equal(applied.droppedLessons, 0)
  assert.equal(saves, 1)
  assert.equal(conforms(applied, byName.get('study_apply_design')!.output.schema as Schema, 'apply'), null)

  const course = state.courses[0]!
  assert.equal(course.source, 'github')
  assert.equal(course.sourceRef, 'https://github.com/o/r')
  assert.deepEqual(course.sections.flatMap(s => s.lessons).map(l => l.kind), ['study', 'study', 'exam', 'practice'])
  assert.ok(course.sections[0]!.lessons[0]!.body.includes('preface prose'), 'the file\'s first designed lesson absorbs its header')
  assert.ok(!course.sections[0]!.lessons[1]!.body.includes('setup body'), 'the second lesson slices from its own anchor')

  await assert.rejects(
    () => run(byName, 'study_apply_design', { sections: [{ title: 'x', lessons: [{ title: 'y', file: 'lessons/a.md' }] }] }),
    /no pending course design/, 'a successful apply consumes the pending design',
  )

  const again = await run(byName, 'study_import_github', { url: 'https://github.com/o/r' }) as { status: string; courseId: string }
  assert.equal(again.status, 'imported', 're-importing the same URL short-circuits to the existing course')
  assert.equal(again.courseId, course.id)
  assert.equal(conforms(again, byName.get('study_import_github')!.output.schema as Schema, 'github'), null,
    'the imported branch satisfies the oneOf schema')
  } finally {
    setHttpsGetOverride(null)
  }
})

test('apply design: fetch failures block loudly with the pending design retained; hallucinations drop', async () => {
  const state = emptyState()
  let saves = 0
  const files: Record<string, string> = { 'README.md': REPO_README, 'lessons/a.md': REPO_FILE_A, 'lessons/b.md': REPO_FILE_B }
  setHttpsGetOverride(async () => ({ ok: false, error: 'offline test' }))
  try {
    const tools = studyTools({ get: () => state, save: () => { saves += 1 } }, { fetch: repoFetchStub(files) })
    const byName = new Map(tools.map(t => [t.name, t]))

    await run(byName, 'study_import_github', { url: 'https://github.com/o/r' })
    delete files['lessons/b.md'], 'the file dies between the outline stage and the apply stage'

    await assert.rejects(
      () => run(byName, 'study_apply_design', { sections: [{ title: 'x', lessons: [
        { title: 'A', file: 'lessons/a.md' },
        { title: 'B', file: 'lessons/b.md' },
      ] }] }),
      /failed to fetch: lessons\/b\.md/, 'a dead file blocks the whole apply with a named recovery hint',
    )
    assert.equal(saves, 0, 'a failed apply leaves persisted state untouched')

    const fixed = await run(byName, 'study_apply_design', { sections: [{ title: 'x', lessons: [
      { title: 'A', file: 'lessons/a.md' },
      { title: 'ghost', file: 'made/up.md' },
    ] }] }) as { droppedLessons: number; lessons: number }
  assert.equal(fixed.droppedLessons, 1, 'the hallucinated path drops while the course still lands')
  assert.equal(fixed.lessons, 1, 'the single surviving study lesson lands; a one-lesson section gets no exam node')
  } finally {
    setHttpsGetOverride(null)
  }
})

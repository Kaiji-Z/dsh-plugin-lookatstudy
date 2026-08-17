/**
 * The frozen acceptance path (VERIFICATION.md §4: "the happy path = acceptance
 * criteria, frozen into the regression set"): the core learning loop, linear,
 * through the TOOL surface — the same path a real tutor walks. Every phase
 * names the behavior it accepts; changing a phase means the product behavior
 * changed and this file changes with it, in the same commit.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { studyTools } from '../src/tools.ts'
import { loadState, saveState, type LearningState } from '../src/state.ts'
import { setHttpsGetOverride } from '../src/vendor/repo-fetcher.ts'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'

const COURSE_MD = [
  '# Acceptance Course',
  '## Foundations', '### Reading', 'reading body', '### Writing', 'writing body',
  '## Practice', '### Review', 'review body',
].join('\n')

const exec = { signal: new AbortController().signal } as unknown as ToolRunContext

/** Fresh tool surface over a temp state file — the same wiring apply() uses. */
function setup(): { byName: Map<string, ToolDefinition>; state: LearningState; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'lks-acceptance-'))
  const path = join(dir, 'state.json')
  const state = loadState(path)
  const store = { get: () => state, save: () => saveState(path, state) }
  const byName = new Map(studyTools(store).map(t => [t.name, t]))
  return { byName, state, dir }
}

async function run(byName: Map<string, ToolDefinition>, name: string, args: Record<string, unknown> = {}): Promise<any> {
  const tool = byName.get(name)
  assert.ok(tool, `tool ${name} registered`)
  return tool.execute(args, exec)
}

test('acceptance: the core learning loop, frozen', async () => {
  const { byName, state, dir } = setup()
  const T0 = new Date('2026-08-15T08:00:00Z')
  try {
    // Phase 1 — import: first study lesson available, rest locked, exam attached.
    const imported = await run(byName, 'study_import_markdown', { markdown: COURSE_MD }) as { courseId: string; firstLessonId: string }
    const l1 = imported.firstLessonId as string
    const l2 = `${imported.courseId}:0:1` as string
    assert.equal(state.courses[0]!.sections[0]!.lessons.at(-1)!.kind, 'exam')

    // Phase 2 — first open IS an attempt: in_progress, mastery seeded, dual-track unlock.
    const opened = await run(byName, 'study_lesson', { lessonId: l1 })
    assert.equal(opened.status, 'in_progress')
    assert.equal(state.courses[0]!.sections[0]!.lessons[1]!.status, 'available', 'in-section next unlocked')
    assert.equal(state.courses[0]!.sections[1]!.lessons[0]!.status, 'available', 'next section first unlocked')

    // Phase 3 — attributed quizzing: KC mastery moves, weakest concept gates the lesson.
    await run(byName, 'study_define_concepts', {
      lessonId: l1,
      concepts: [
        { title: '读取', description: 'reading' },
        { title: '写作', description: 'writing' },
      ],
    })
    for (let i = 0; i < 6; i++) {
      await run(byName, 'study_record_answer', { lessonId: l1, correct: true, concept: '读取' })
    }
    const answer = await run(byName, 'study_record_answer', { lessonId: l1, correct: true, concept: '读取' })
    assert.ok(answer.newMasteryPct <= 55, 'unquizzed 写作 stays at its 50% prior and caps the lesson (weakest KC)')

    // Phase 4 — proposal: ≥85% plus Feynman → pending; the learner accepts → 0.95 floor + graduation + review.
    for (let i = 0; i < 6; i++) {
      await run(byName, 'study_record_answer', { lessonId: l1, correct: true, concept: '写作' })
    }
    const proposal = await run(byName, 'study_propose_mastery', { lessonId: l1, rationale: 'taught it back flawlessly' })
    assert.equal(proposal.status, 'pending')
    const resolved = await run(byName, 'study_resolve_proposal', { proposalId: proposal.proposalId, accept: true })
    assert.equal(resolved.status, 'applied')
    const graduated = state.courses[0]!.sections[0]!.lessons[0]!
    assert.equal(graduated.status, 'mastered')
    assert.ok((graduated.mastery ?? 0) >= 0.95)

    // Phase 5 — spaced repetition: review due tomorrow; grading advances the interval.
    const tomorrow = new Date(T0.getTime() + 86_400_000)
    const stateTomorrow = loadState(join(dir, 'state.json'))
    // The tools write through the same state object; simulate the day passing via the review tool directly.
    const review = await run(byName, 'study_record_review', { lessonId: l1, quality: 5 })
    assert.ok(review.dueAt > new Date().toISOString(), 'a correct review pushes the due date out')
    assert.ok(stateTomorrow.courses[0]!.sections[0]!.lessons[0]!.dueAt !== null, 'the schedule is durable in state.json')

    // Phase 6 — course deletion cascades cleanly.
    await run(byName, 'study_delete_course', { courseId: imported.courseId })
    assert.equal(state.courses.length, 0)
    assert.equal(state.proposals.length, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/* ── acceptance: the tutor-designed GitHub import ──────────────────────── */

const GITHUB_README = '# Designed Course\n\n- [A](lessons/a.md)\n- [B](lessons/b.md)\n'
const GITHUB_FILE_A = '# File A\npreface\n## Setup\nsetup body\n### Detail\ndetail body\n## Deep\ndeep body\n'
const GITHUB_FILE_B = '# File B\n\nlab body\n'

test('acceptance: the tutor-designed GitHub import, frozen', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lks-acceptance-'))
  const path = join(dir, 'state.json')
  const state = loadState(path)
  const store = { get: () => state, save: () => saveState(path, state) }
  setHttpsGetOverride(async () => ({ ok: false, error: 'offline test' }))
  const stub = (async (input: RequestInfo | URL) => {
    const url = String(input)
    const at = url.indexOf('@main/')
    if (url.startsWith('https://cdn.jsdelivr.net/gh/') && at !== -1) {
      const files: Record<string, string> = {
        'README.md': GITHUB_README,
        'lessons/a.md': GITHUB_FILE_A,
        'lessons/b.md': GITHUB_FILE_B,
      }
      const text = files[url.slice(at + '@main/'.length)]
      if (text !== undefined) return new Response(text, { status: 200 })
    }
    return new Response('not found', { status: 404 })
  }) as unknown as typeof fetch
  const byName = new Map(studyTools(store, { fetch: stub }).map(t => [t.name, t]))
  try {
    // Phase 1 — the import returns a design brief, not a course.
    const brief = await run(byName, 'study_import_github', { url: 'https://github.com/o/r' }) as { status: string; fileCount: number }
    assert.equal(brief.status, 'design_required')
    assert.equal(brief.fileCount, 2)
    assert.equal(state.courses.length, 0, 'nothing persisted before the design applies')

    // Phase 2 — the tutor's design lands as a course with anchor-sliced bodies and worlds.
    const applied = await run(byName, 'study_apply_design', { sections: [
      { title: 'Part One', lessons: [
        { title: 'A intro', file: 'lessons/a.md', anchor: '## Setup' },
        { title: 'A deep', file: 'lessons/a.md', anchor: '## Deep' },
      ] },
      { title: 'Labs', lessons: [{ title: 'B lab', file: 'lessons/b.md', world: 'practice' }] },
    ] }) as { lessons: number; firstLessonId: string }
    assert.equal(applied.lessons, 4, 'three designed lessons plus the exam node')
    assert.equal(state.courses[0]!.source, 'github')
    assert.equal(state.courses[0]!.sourceRef, 'https://github.com/o/r')

    // Phase 3 — the designed course is a first-class course: opening IS attempting.
    const opened = await run(byName, 'study_lesson', { lessonId: applied.firstLessonId })
    assert.equal(opened.status, 'in_progress')
    assert.ok(opened.body.includes('preface'), 'the first designed lesson of a file absorbs its header')
    assert.equal(state.courses[0]!.sections[0]!.lessons[1]!.status, 'available', 'the attempt unlocks the dual track')
  } finally {
    setHttpsGetOverride(null)
    rmSync(dir, { recursive: true, force: true })
  }
})

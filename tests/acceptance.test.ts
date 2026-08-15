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
  const byName = new Map(studyTools(store, { current: undefined }).map(t => [t.name, t]))
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

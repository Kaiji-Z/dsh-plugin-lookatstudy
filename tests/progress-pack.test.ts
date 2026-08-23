/**
 * SPEC 1.6/1.7/1.8 — full-text search, XP/streak, course pack export:
 *  - searchLessons: multi-keyword AND over title+body, snippets, limit
 *  - study_courses?query= surfaces matches + the progress block
 *  - XP: +10 correct / +1 wrong / +50 graduation, daily rollover, quadratic
 *    level curve (upstream xp-service), streak check-in with freeze semantics
 *    (upstream streak-transition, vendored verbatim)
 *  - study_export: course → single markdown pack that re-imports through the
 *    existing study_import_markdown (zero new import path, upstream pack-export)
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { studyTools } from '../src/tools.ts'
import { emptyState, searchLessons, noteXpActivity, type LearningState } from '../src/state.ts'
import { computeStreakTransition } from '../src/vendor/streak-transition.ts'
import { levelFromTotalXp, XP_CORRECT, XP_WRONG, XP_MASTERED, DEFAULT_DAILY_GOAL } from '../src/vendor/xp.ts'

const exec = { signal: new AbortController().signal } as unknown as ToolRunContext

function setup(): { byName: Map<string, ToolDefinition>; state: LearningState } {
  const state = emptyState()
  const tools = studyTools({ get: () => state, save: () => {} })
  return { byName: new Map(tools.map(t => [t.name, t])), state }
}

const COURSE_MD = [
  '# Progress Fixture',
  '## S1',
  '### Gradient Descent', '梯度下降通过反复沿负梯度方向更新参数来最小化损失函数。learning rate controls the step size.',
  '### Backprop', '反向传播链式法则 computes gradients layer by layer.',
].join('\n')

async function run(map: Map<string, ToolDefinition>, name: string, args: Record<string, unknown>): Promise<any> {
  const tool = map.get(name)!
  assert.ok(tool, `tool ${name} registered`)
  return tool.execute(args, exec)
}

/* ---- 1.6 full-text search ---- */

test('searchLessons: multi-keyword AND over title and body, snippets carry the hit', async () => {
  const { byName, state } = setup()
  await run(byName, 'study_import_markdown', { markdown: COURSE_MD })
  // keyword only in a body
  const bodyHit = searchLessons(state, '损失函数')
  assert.equal(bodyHit.length, 1)
  assert.equal(bodyHit[0]!.lessonTitle, 'Gradient Descent')
  assert.ok(bodyHit[0]!.snippet.includes('损失函数'))
  // AND semantics: both keywords must hit (one in title, one in body)
  assert.equal(searchLessons(state, 'gradient 梯度').length, 1)
  assert.equal(searchLessons(state, 'gradient nonexistent').length, 0)
  // case-insensitive + substring ('gradients' contains 'gradient' → both lessons)
  assert.equal(searchLessons(state, 'gradient').length, 2)
  assert.equal(searchLessons(state, 'BACKPROP').length, 1)
  assert.deepEqual(searchLessons(state, '   '), [])
})

test('study_courses carries the progress block and surfaces query matches', async () => {
  const { byName } = setup()
  await run(byName, 'study_import_markdown', { markdown: COURSE_MD })
  const plain = await run(byName, 'study_courses', {})
  assert.ok(plain.progress)
  assert.equal(plain.progress.totalXp, 0)
  assert.equal(plain.progress.dailyGoal, DEFAULT_DAILY_GOAL)
  assert.equal(plain.matches, undefined)
  const searched = await run(byName, 'study_courses', { query: '链式法则' })
  assert.equal(searched.matches.length, 1)
  assert.equal(searched.matches[0].lessonTitle, 'Backprop')
})

/* ---- 1.7 XP + streak ---- */

test('XP constants and quadratic level curve mirror upstream', () => {
  assert.equal(XP_CORRECT, 10)
  assert.equal(XP_WRONG, 1)
  assert.equal(XP_MASTERED, 50)
  assert.deepEqual(levelFromTotalXp(0), { level: 0, pct: 0, intoLevel: 0, levelSpan: 50 })
  assert.equal(levelFromTotalXp(49).level, 0)
  assert.equal(levelFromTotalXp(50).level, 1)
  assert.equal(levelFromTotalXp(450).level, 3)
  assert.equal(levelFromTotalXp(450).pct, 0)
})

test('recordAnswer accrues XP (+10/+1), checks the streak in, and daily buckets roll over', async () => {
  const { byName, state } = setup()
  const imported = await run(byName, 'study_import_markdown', { markdown: COURSE_MD })
  const lessonId = imported.firstLessonId as string
  await run(byName, 'study_lesson', { lessonId })

  await run(byName, 'study_record_answer', { lessonId, correct: true })
  assert.equal(state.xp.total, XP_CORRECT)
  assert.equal(state.xp.todayXp, XP_CORRECT)
  assert.equal(state.streak.currentStreak, 1, 'first activity checks the streak in')

  await run(byName, 'study_record_answer', { lessonId, correct: false })
  assert.equal(state.xp.total, XP_CORRECT + XP_WRONG)

  // same-day idempotent streak, next-day increment (pure vendored state machine)
  const s1 = computeStreakTransition({ currentStreak: 1, longestStreak: 1, lastActiveDate: '2026-01-01', freezeCount: 2 }, new Date('2026-01-02T10:00:00'))
  assert.equal(s1.currentStreak, 2)
  const gap2 = computeStreakTransition({ currentStreak: 2, longestStreak: 2, lastActiveDate: '2026-01-01', freezeCount: 2 }, new Date('2026-01-03T10:00:00'))
  assert.equal(gap2.currentStreak, 3, 'gap=2 with a freeze continues the streak')
  assert.equal(gap2.freezeCount, 1)
  const gap3 = computeStreakTransition({ currentStreak: 3, longestStreak: 3, lastActiveDate: '2026-01-01', freezeCount: 2 }, new Date('2026-01-04T10:00:00'))
  assert.equal(gap3.currentStreak, 1, 'gap=3 resets even with freezes left')

  // daily rollover via the state hook
  const day1 = new Date('2026-05-01T09:00:00')
  const day2 = new Date('2026-05-02T09:00:00')
  noteXpActivity(state, 10, day1)
  noteXpActivity(state, 10, day1)
  assert.equal(state.xp.todayXp, 20)
  noteXpActivity(state, 10, day2)
  assert.equal(state.xp.todayXp, 10, 'new day resets the bucket')
  assert.equal(state.xp.total, 10 + 1 + 10 + 10 + 10)
})

/* ---- 1.8 pack export ---- */

test('study_export round-trips through study_import_markdown (zero new import path)', async () => {
  const { byName, state } = setup()
  const imported = await run(byName, 'study_import_markdown', { markdown: COURSE_MD })
  const pack = await run(byName, 'study_export', { courseId: imported.courseId })
  assert.equal(pack.lessonCount, 2)
  assert.ok(pack.markdown.includes('# Progress Fixture'))
  assert.ok(pack.markdown.includes('### Gradient Descent'))
  assert.ok(pack.markdown.includes('梯度下降'))

  // import the pack into a FRESH state — same lessons/bodies come back
  const fresh = setup()
  const reimported = await run(fresh.byName, 'study_import_markdown', { markdown: pack.markdown })
  assert.equal(reimported.lessons, 3, 'two study lessons + one exam node')
  const lesson = await run(fresh.byName, 'study_lesson', { lessonId: reimported.firstLessonId })
  assert.equal(lesson.title, 'Gradient Descent')
  assert.ok(lesson.body.includes('learning rate'))
  assert.equal(state.courses.length, 1, 'export is a pure read — no state change')
})

test('xp/streak/search-less state round-trips through loadState defaults', async () => {
  const { state } = setup()
  noteXpActivity(state, 42, new Date('2026-08-23T10:00:00'))
  const { loadState } = await import('../src/state.ts')
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'lks-xp-'))
  try {
    const withNew = join(dir, 'new.json')
    const old = join(dir, 'old.json')
    writeFileSync(withNew, JSON.stringify(state))
    writeFileSync(old, JSON.stringify({ ...state, xp: undefined, streak: undefined }))
    const loadedNew = loadState(withNew)
    assert.equal(loadedNew.xp.total, 42)
    assert.equal(loadedNew.streak.currentStreak, 1)
    const loadedOld = loadState(old)
    assert.equal(loadedOld.xp.total, 0, 'old v2 files default the ledger')
    assert.equal(loadedOld.streak.freezeCount, 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

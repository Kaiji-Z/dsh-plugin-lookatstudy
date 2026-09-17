/**
 * The upstream v0.34→v0.37.1 alignment round, frozen:
 *   - ① progression boundary: nextLessonAfter ordering + the boundary clause
 *   - ② mastery-write hardening: the sliding-window rate limiter, the
 *     completion proposal gate, the AI mastery cap + its human-graded lift,
 *     and the course-text isolation fence
 *   - ③ transient tool-error hiding (toolErrorVisibility fold)
 *   - ④ note highlights ride the CSS Custom Highlight API registry
 *   - ⑤ the learner profile: parse/patch/merge, motive exclusion, interests,
 *     the injection section, and stale arbitration
 * Each block cites the upstream commit that set the behavior.
 * @module tests/upstream-alignment
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  emptyState, importCourse, findCourse, findLesson, nextLessonAfter, markHumanGraded,
  recordAnswer, proposeProfilePatch, resolveProfileProposal, saveProfileEdit, AI_MASTERY_CAP,
  type CourseState, type LearningState,
} from '../src/state.ts'
import { parseMarkdownToCourse } from '../src/vendor/markdown-course.ts'
import {
  emptyProfile, hasProfileContent, parseProfile, applyProfilePatch, expandMbtiToStyle,
  parseInterestsInput, sanitizeInterests, profileSectionText, isValidMbti, INTERESTS_MAX,
} from '../src/learner-profile.ts'
import { studyTools } from '../src/tools.ts'
import { renderDesignBrief, type PendingDesign } from '../src/import-design.ts'
import { tutorCoreText, snapshotSectionText, profileSectionText as surfaceProfileSection } from '../src/surface.ts'
import { feedRows, type FeedWindow } from '../src/client/session-feed.ts'
import { supportsHighlightMarks, NOTE_HIGHLIGHT_NAME, locateInModel } from '../src/client/highlights.ts'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'

const exec = { signal: new AbortController().signal } as unknown as ToolRunContext

/** One-course fixture: 2 sections × 2 study lessons + the S1 exam node. */
function fixture(): { state: LearningState; course: CourseState } {
  const state = emptyState()
  const course = importCourse(state, parseMarkdownToCourse([
    '# Alignment Course',
    '## S1', '### L1', 'body one', '### L2', 'body two',
    '## S2', '### L3', 'body three',
  ].join('\n')), 'markdown', 'test')
  return { state, course }
}

function toolsFor(state: LearningState, deps: Parameters<typeof studyTools>[1] = {}): Map<string, ToolDefinition> {
  return new Map(studyTools({ get: () => state, save: () => {} }, deps).map(t => [t.name, t]))
}

async function run(byName: Map<string, ToolDefinition>, name: string, args: Record<string, unknown> = {}): Promise<any> {
  const tool = byName.get(name)
  assert.ok(tool, `tool ${name} registered`)
  return tool.execute(args, exec)
}

/* ── ① progression boundary: nextLessonAfter (upstream v0.37 shared/next-lesson.ts) ── */

test('nextLessonAfter: same-section successor, cross-section first, endpoint, unknown id', () => {
  const { course } = fixture()
  const [l1, l2] = course.sections[0]!.lessons
  const [l3] = course.sections[1]!.lessons
  assert.equal(nextLessonAfter(course, l1!.id)?.id, l2!.id, 'same-section successor skips the exam node')
  assert.equal(nextLessonAfter(course, l2!.id)?.id, l3!.id, 'section end hands to the next section FIRST study lesson')
  assert.equal(nextLessonAfter(course, l3!.id), null, 'the last lesson graduates into the endpoint card')
  assert.equal(nextLessonAfter(course, 'ghost:9:9'), null, 'unknown id (course-switch race) draws no card')
})

test('nextLessonAfter skips an empty section (upstream 跳空段)', () => {
  const { state } = fixture()
  const course = findCourse(state, 'alignment-course')
  const moved = course.sections[1]!.lessons
  course.sections[1] = { title: 'S2-empty', anchor: '#s2e', lessons: [] }
  course.sections.push({ title: 'S3', anchor: '#s3', lessons: moved })
  const l2 = course.sections[0]!.lessons[1]!
  const next = nextLessonAfter(findCourse(state, 'alignment-course'), l2.id)
  assert.equal(next?.title, 'L3', 'an empty section never gates the path')
})

test('progression-boundary directive is SCOPE-AWARE (0.23.0 course scope continues; lesson scope points)', () => {
  // Upstream e4f57c7's blanket "you cannot move the conversation" is TRUE only
  // under lesson scope. This plugin also has the 0.23.0 course scope — ONE
  // thread across lessons, where study_lesson(next) moves the focus and the
  // feed never rebinds, so a 继续 promise IS fulfillable there. The static
  // core therefore carries NO boundary claim; the per-turn snapshot renders
  // the directive for the CURRENT scope.
  const state = emptyState()
  state.active = true
  const core = tutorCoreText(state)
  assert.doesNotMatch(core, /课程推进边界/, 'no blanket clause in the static core')
  assert.doesNotMatch(core, /Never promise/)

  // Lesson scope: every lesson owns a thread — the hollow-promise ban holds.
  const { state: lessonState } = fixture()
  lessonState.active = true
  lessonState.focus = { lessonId: 'alignment-course:0:0' }
  const lessonScope = snapshotSectionText(lessonState)
  assert.match(lessonScope, /【课程推进边界】/)
  assert.match(lessonScope, /每课时一条对话线/)
  assert.match(lessonScope, /绝不承诺/, 'the hollow-promise ban holds per-lesson')

  // Course scope: the thread continues across lessons — point the tutor to
  // study_lesson + keep teaching in-line, never to the rail.
  const { state: courseState } = fixture()
  courseState.active = true
  findCourse(courseState, 'alignment-course').threadScope = 'course'
  courseState.focus = { lessonId: 'alignment-course:0:0' }
  const courseScopeSnap = snapshotSectionText(courseState)
  assert.match(courseScopeSnap, /【课程推进边界·跨课时线】/)
  assert.match(courseScopeSnap, /先调用 study_lesson 打开下一课/, 'the body loads before teaching on')
  assert.match(courseScopeSnap, /不要让学习者去课程栏换线/, 'the rail hand-off is wrong here')
})

/* ── ② mastery-write hardening (upstream v0.35 WP6 + IP3) ── */

test('record_answer rate limiter: limit per sliding window, honest error, window expiry recovers', async () => {
  const { state } = fixture()
  const lessonId = `${state.courses[0]!.id}:0:0`
  let now = 1_000_000
  const byName = toolsFor(state, { answerRate: { limit: 3, windowMs: 60_000 }, now: () => now })
  await run(byName, 'study_lesson', { lessonId })
  await run(byName, 'study_record_answer', { lessonId, correct: true })
  await run(byName, 'study_record_answer', { lessonId, correct: true })
  await run(byName, 'study_record_answer', { lessonId, correct: true })
  await assert.rejects(
    () => run(byName, 'study_record_answer', { lessonId, correct: true }),
    /rate limited/,
    'the window refuses the call past the limit',
  )
  now += 60_001
  await run(byName, 'study_record_answer', { lessonId, correct: true })
  await run(byName, 'study_record_answer', { lessonId, correct: true })
  await run(byName, 'study_record_answer', { lessonId, correct: true })
  await assert.rejects(() => run(byName, 'study_record_answer', { lessonId, correct: true }), /rate limited/, 'a fresh window re-arms')
})

test('AI mastery cap: tutor-only grading never graduates; human grading lifts the cap', () => {
  const { state, course } = fixture()
  const lessonId = `${course.id}:0:0`
  const T0 = new Date('2026-09-17T08:00:00Z')
  findLesson(state, lessonId) // exists
  recordAnswer(state, lessonId, true, undefined, T0) // seeds the 0.5 prior + unlock
  let last = recordAnswer(state, lessonId, true, undefined, T0)
  for (let i = 0; i < 12; i++) last = recordAnswer(state, lessonId, true, undefined, T0)
  assert.ok(last.newMastery <= AI_MASTERY_CAP + 1e-9, `ceiling respected (got ${String(last.newMastery)})`)
  assert.equal(findLesson(state, lessonId).lesson.status, 'in_progress', 'no auto-graduation below the cap')
  // Human grading (a completed practice card) lifts the flag → graduation reachable.
  markHumanGraded(state, lessonId)
  last = recordAnswer(state, lessonId, true, undefined, T0)
  assert.equal(findLesson(state, lessonId).lesson.status, 'mastered', 'human-graded lessons graduate again')
  assert.ok(findLesson(state, lessonId).lesson.dueAt !== null, 'graduation seeds the first review')
})

test('AI mastery cap: wrong answers still lower; a historical high raises the ceiling instead of regressing', () => {
  const { state, course } = fixture()
  const lesson = course.sections[0]!.lessons[0]!
  lesson.status = 'in_progress'
  const T0 = new Date('2026-09-17T08:00:00Z')
  // BKT evolves both ways under the ceiling: 0.5 → ~0.84 on correct → down on wrong.
  const up = recordAnswer(state, lesson.id, true, undefined, T0)
  const down = recordAnswer(state, lesson.id, false, undefined, T0)
  assert.ok(down.newMastery < up.newMastery, 'the cap is not a floor — wrong answers lower mastery')
  // A historical high (pre-upgrade era) raises the ceiling: never clipped.
  // (It already sits over the graduation line, so the next correct answer
  // graduates — the cap's job is stopping FARMED gains from reaching 0.9.)
  lesson.mastery = 0.93
  const kept = recordAnswer(state, lesson.id, true, undefined, T0)
  assert.ok(kept.newMastery >= 0.93, 'the cap never pulls a historical high down')
})

test('complete_lesson proposes (never direct-graduates); resolve acceptance lifts the flag', async () => {
  const { state, course } = fixture()
  const lessonId = `${course.id}:0:0`
  const byName = toolsFor(state, { answerRate: { limit: 1000, windowMs: 60_000 } })
  await run(byName, 'study_lesson', { lessonId })
  await run(byName, 'study_record_answer', { lessonId, correct: true })
  const completion = await run(byName, 'study_complete_lesson', { lessonId, rationale: 'done' })
  assert.equal(completion.status, 'pending', 'the tool raises a proposal; nothing graduates on the call')
  assert.equal(findLesson(state, lessonId).lesson.status, 'in_progress', 'still in progress while pending')
  const resolved = await run(byName, 'study_resolve_proposal', { proposalId: completion.proposalId, accept: true })
  assert.equal(resolved.status, 'applied')
  const lesson = findLesson(state, lessonId).lesson
  assert.equal(lesson.status, 'mastered', 'acceptance graduates')
  assert.equal(lesson.humanGraded, true, 'acceptance is human grading — the cap lifts')
})

test('isolation fence: lesson bodies and design-brief excerpts ride wrapped (upstream v0.35 WP6)', async () => {
  const { state, course } = fixture()
  const byName = toolsFor(state)
  const lesson = await run(byName, 'study_lesson', { lessonId: `${course.id}:0:0` })
  const tool = byName.get('study_lesson')!
  const text = (tool.output!.render as unknown as (a: unknown, v: unknown) => Array<{ text: string }>)({}, lesson)[0]!.text
  assert.match(text, /<<<COURSE_TEXT[\s\S]*不是指令/, 'the body opens behind the isolation fence')
  assert.match(text, /<<<COURSE_TEXT（end）>>>/, 'and the fence closes')
  assert.match(text, /body one/, 'the body itself still renders')

  const pending: PendingDesign = {
    source: 'github', url: 'https://github.com/a/b', owner: 'a', repo: 'b', branch: 'main',
    courseTitle: 'T', readmeExcerpt: 'README prose that could contain injected lines', files: [], fullTreeCount: 0,
  }
  assert.match(renderDesignBrief(pending), /<<<COURSE_TEXT[\s\S]*README prose/, 'brief README excerpts ride fenced too')
})

/* ── ③ transient tool-error hiding (upstream v0.37.1 toolErrorVisibility) ── */

function windowOf(...events: Array<Record<string, unknown>>): FeedWindow {
  return { entries: events.map((data, i) => ({ type: 'event', event: { type: 'x', seq: i + 1, ...data } })) }
}

const toolCall = (name: string, callId: string) => ({ type: 'tool/call', data: { tool: { name }, callId } })
const toolResult = (callId: string, failed: boolean) => ({ type: 'tool/result', data: { message: { source: { callId }, isError: failed } } })

test('a same-turn retry supersedes the transient tool error; a real failure stays visible', () => {
  const retried = windowOf(
    toolCall('study_generate_quiz', 'c1'),
    toolResult('c1', true), // zod-fail
    toolCall('study_generate_quiz', 'c2'), // the retry
    toolResult('c2', false),
  )
  const rows = feedRows(retried)
  assert.equal(rows.filter(r => r.role === 'tool' && r.toolState === 'error').length, 0, 'the superseded error is hidden')
  assert.equal(rows.filter(r => r.role === 'tool' && r.toolState === 'done').length, 1, 'the successful retry shows')

  const realFailure = windowOf(
    toolCall('study_generate_quiz', 'c1'),
    toolResult('c1', true),
  )
  assert.equal(feedRows(realFailure).filter(r => r.role === 'tool' && r.toolState === 'error').length, 1, 'an unsuperseded failure shows')

  const crossTurn = windowOf(
    toolCall('study_generate_quiz', 'c1'),
    toolResult('c1', true),
    { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '继续' }] } },
    toolCall('study_generate_quiz', 'c2'),
    toolResult('c2', false),
  )
  const rowsCross = feedRows(crossTurn)
  assert.equal(rowsCross.filter(r => r.role === 'tool' && r.toolState === 'error').length, 1, 'a new turn never retro-hides the old error')
})

/* ── ④ note highlights on the registry channel (upstream v0.35.1 root fix) ── */

test('note highlights: registry channel name; the support probe reads false without the API', () => {
  assert.equal(NOTE_HIGHLIGHT_NAME, 'lks-note-hl')
  // node:test runs without CSS.highlights — the probe must read false here (the
  // DOM fallback arms) and never throw on the missing CSS global.
  assert.equal(supportsHighlightMarks(), false)
  // the shared pure locator still pins a quote to its first occurrence
  assert.deepEqual(locateInModel({ text: 'alpha beta alpha', nodes: [{ node: null, start: 0, end: 16 }] }, 'alpha', undefined), { start: 0, end: 5 })
  assert.equal(isValidMbti('INTP'), true)
})

/* ── ⑤ the learner profile (upstream v0.36) ── */

test('profile parse/serialize tolerance: garbage in, typed defaults out', () => {
  const parsed = parseProfile({ name: '  小凯 ', mbti: 'INTP', style: { start: 'framework', interaction: 'bogus' }, interests: [' 天文 ', '天文', '', 42], freeNote: 'x', motiveStage: 'intrinsic', updatedAt: '2026-09-17T00:00:00Z' })
  assert.equal(parsed.name, '小凯')
  assert.equal(parsed.style.start, 'framework')
  assert.equal(parsed.style.interaction, null, 'an invalid dim is dropped, never thrown')
  assert.deepEqual(parsed.interests, ['天文'], 'dedup + trim + non-string filter')
  assert.equal(parseProfile('not an object').name, null)
  assert.equal(parseProfile(null).updatedAt, new Date(0).toISOString())
  assert.equal(hasProfileContent(emptyProfile()), false, 'the empty profile injects nothing')
  assert.equal(profileSectionText(emptyProfile()), '')
})

test('interests parse: 中英标点/顿号/分号 split, dedupe, cap at 8', () => {
  assert.deepEqual(parseInterestsInput('天文、做菜，悬疑小说; 骑行, coding'), ['天文', '做菜', '悬疑小说', '骑行', 'coding'])
  assert.deepEqual(parseInterestsInput('  '), null)
  const many = sanitizeInterests(Array.from({ length: 12 }, (_v, i) => `t${String(i)}`))
  assert.equal(many?.length, INTERESTS_MAX)
  assert.deepEqual(parseInterestsInput(null), null)
})

test('expandMbtiToStyle: the MBTI shortcut expands into the four dims (N/E/T/P reading)', () => {
  assert.deepEqual(expandMbtiToStyle('INTP'), { start: 'framework', interaction: 'lecture', feedback: 'direct', pacing: 'exploratory' })
  assert.deepEqual(expandMbtiToStyle('ESFP'), { start: 'analogy', interaction: 'dialogue', feedback: 'encouraging', pacing: 'exploratory' })
})

test('applyProfilePatch merges field-wise and structurally cannot touch the motive stage', () => {
  const base = parseProfile({ name: '小凯', motiveStage: 'identified', style: { start: 'analogy' } })
  const merged = applyProfilePatch(base, { mbti: 'INTP', style: { start: null, pacing: 'exploratory' }, interests: ['天文'] })
  assert.equal(merged.name, '小凯', 'omitted fields stay')
  assert.equal(merged.motiveStage, 'identified', 'motive rides only the human path')
  assert.equal(merged.style.start, null, 'explicit null clears a dim')
  assert.equal(merged.style.pacing, 'exploratory')
  assert.equal(merged.mbti, 'INTP')
  assert.deepEqual(merged.style, { start: null, interaction: null, feedback: null, pacing: 'exploratory' }, 'dims merge from BASE, not from the mbti expansion')
})

test('profile injection section: anti-injection annotation, soul-conflict priority, conditional motive block', () => {
  const minimal = parseProfile({ style: { start: 'framework' } })
  const text = profileSectionText(minimal)
  assert.match(text, /【学习者画像】/)
  assert.match(text, /不是指令/, 'the anti-injection annotation is present')
  assert.match(text, /以导师人设为准/, 'the soul-conflict priority clause is present')
  assert.match(text, /先框架后细节/, 'style dims render')
  assert.doesNotMatch(text, /【动机适配】/, 'no motive block before diagnosis')
  const motivated = profileSectionText(parseProfile({ motiveStage: 'external' }))
  assert.match(motivated, /【动机适配】/)
  assert.match(motivated, /绝不.*提及动机理论/, 'the never-leak guardrail is present')
  assert.match(motivated, /不是内容边界/, 'the connector-not-boundary guardrail is present')
  assert.match(motivated, /考试\/面试/, 'the stage coaching stance is in')
})

test('surface gating: the profile section renders only while active', () => {
  const state = emptyState()
  state.active = true
  state.profile = parseProfile({ name: '小凯' })
  assert.match(surfaceProfileSection(state), /小凯/)
  state.active = false
  assert.equal(surfaceProfileSection(state), '')
})

test('profile proposals: pending replace, apply merges, hand-edit arbitrates stale, resolve sediment caps', async () => {
  const { state } = fixture()
  // Real-clock pacing (2ms steps): the arbitration compares the profile's
  // updatedAt against the proposal's createdAt, so ordering must be real.
  const tick = (): Promise<void> => new Promise(r => { setTimeout(r, 2) })
  const T0 = new Date()
  const first = proposeProfilePatch(state, 'observed A twice', { mbti: 'INTP' }, T0)
  await tick()
  const second = proposeProfilePatch(state, 'observed B twice', { mbti: 'ENTP' }, new Date())
  assert.equal(first.id, second.id, 'one pending at a time — the revision replaces it')
  assert.equal(second.rationale, 'observed B twice')
  // The learner hand-edits AFTER the proposal → updatedAt passes createdAt → stale.
  await tick()
  saveProfileEdit(state, { name: '本人改的' }, new Date())
  await tick()
  const resolved = resolveProfileProposal(state, second.id, true, new Date())
  assert.equal(resolved.status, 'stale')
  assert.equal(state.profile?.name, '本人改的', 'stale applies nothing')
  assert.equal(state.profile?.mbti ?? null, null)
  // Without an intervening hand edit, acceptance merges field-wise.
  await tick()
  const third = proposeProfilePatch(state, 'style evidence', { style: { pacing: 'exploratory' } }, new Date())
  const applied = resolveProfileProposal(state, third.id, true, new Date())
  assert.equal(applied.status, 'applied')
  assert.equal(state.profile?.style.pacing, 'exploratory')
  assert.equal(state.profile?.name, '本人改的', 'merge is field-wise')
  assert.throws(() => resolveProfileProposal(state, third.id, false, new Date()), /already applied/)
  // Rejection changes nothing; unknown ids fail loud.
  await tick()
  const fourth = proposeProfilePatch(state, 'r', { freeNote: 'x' }, new Date())
  assert.equal(resolveProfileProposal(state, fourth.id, false, new Date()).status, 'rejected')
  assert.throws(() => resolveProfileProposal(state, 'ghost', true, T0), /unknown profile proposal id/)
})

test('saveProfileEdit (the human path) sets the motive stage — the one channel that can', () => {
  const { state } = fixture()
  saveProfileEdit(state, { motiveStage: 'intrinsic', interests: ['天文'] }, new Date())
  assert.equal(state.profile?.motiveStage, 'intrinsic')
  assert.deepEqual(state.profile?.interests, ['天文'])
  assert.ok((state.profile?.updatedAt ?? '') > new Date(0).toISOString(), 'updatedAt is the arbitration baseline')
})

test('study_update_profile: propose lands pending, invalid mbti fails loud, motivation structurally absent', async () => {
  const { state, course } = fixture()
  const byName = toolsFor(state, { answerRate: { limit: 1000, windowMs: 60_000 } })
  const lessonId = `${course.id}:0:0`
  // the schema rejects a non-16-type mbti at the args gate (defense in depth
  // also re-checks inside execute for any caller that bypasses the gate)
  await assert.rejects(
    () => run(byName, 'study_update_profile', { rationale: 'r', patch: { mbti: 'XYZP' } }),
    /patch\.mbti/,
  )
  const suggestion = await run(byName, 'study_update_profile', {
    rationale: 'learner misread code twice, prefers analogies',
    patch: { interests: ['天文', '天文', '游戏'], style: { pacing: 'exploratory' } },
  })
  assert.equal(suggestion.status, 'pending')
  assert.deepEqual(sanitizeInterests(['天文', '天文', '游戏']), ['天文', '游戏'])
  const pending = state.profileProposals!.find(p => p.id === suggestion.proposalId)!
  assert.equal('motiveStage' in pending.patch, false, 'the patch channel structurally excludes the motive stage')
  assert.equal(state.profileProposals!.length, 1)
})

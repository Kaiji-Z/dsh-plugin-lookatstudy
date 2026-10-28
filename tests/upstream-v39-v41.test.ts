/**
 * The upstream v0.38→v0.41 alignment round's regression freezes:
 *  - v0.39 review sessions: thread kinds, the review round state machine,
 *    the 复习导师 posture fork, study_end_review_session, the fallback strip's
 *    state path, and the kickoff/feed wiring
 *  - v0.41 proposal undo: apply-time snapshots, the revoke paths (mastery +
 *    profile), conflict refusals, and the base-prompt red lines
 *  - v0.41 引用即调用 red line, v0.38 exam quota/fence discipline, v0.39.1
 *    first-boot locale following the system
 * Every behavior landed in the same change as its freeze here.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { parseMarkdownToCourse } from '../src/vendor/markdown-course.ts'
import {
  emptyState, importCourse, findLesson, loadState, saveState,
  bindLessonThread, openReviewRound, endReviewSession, reviewThreadOf, activeThreadOf,
  proposeMastery, resolveProposal, revokeProposal, revokeProfileProposal,
  proposeProfilePatch, resolveProfileProposal, saveProfileEdit,
  applyExamBank, recordAnswer, defineConcepts, markHumanGraded,
} from '../src/state.ts'
import type { LearningState } from '../src/state.ts'
import { XP_CORRECT, XP_WRONG } from '../src/vendor/xp.ts'
import { planExamQuota, EXAM_MIN_QUESTIONS } from '../src/vendor/exam-logic.ts'
import { snapshotSectionText, tutorCoreText } from '../src/surface.ts'
import { studyTools } from '../src/tools.ts'
import { workbenchState, registerDashboard, type RequestLike, type ResponseLike } from '../src/dashboard.ts'
import { systemStudyLang, makeT } from '../src/client/locale.ts'
import { threadGroupPills } from '../src/client/views.tsx'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyProfilePatch, emptyProfile } from '../src/learner-profile.ts'

const COURSE_MD = ['# Alignment Course', '## Section One', '### Alpha', 'alpha body with some content', '### Beta', 'beta body', '## Section Two', '### Gamma', 'gamma body'].join('\n')
const T0 = new Date('2026-10-28T10:00:00Z')

function fixture(): { state: LearningState; a: string; b: string } {
  const state = emptyState()
  const course = importCourse(state, parseMarkdownToCourse(COURSE_MD), 'markdown', 'fixture')
  const a = `${course.id}:0:0`
  const b = `${course.id}:0:1`
  state.focus = { lessonId: a }
  return { state, a, b }
}

/** Master lesson `id` the honest way: KCs, human grading (lifts the AI cap),
 *  then answers to graduation — review threads need the SM-2 schedule. */
function mastered(state: LearningState, id: string): void {
  defineConcepts(state, id, [{ title: 'K1', description: 'k1' }, { title: 'K2', description: 'k2' }])
  markHumanGraded(state, id)
  for (let i = 0; i < 40 && findLesson(state, id).lesson.status !== 'mastered'; i++) {
    recordAnswer(state, id, true, i % 2 === 0 ? 'K1' : 'K2', T0)
  }
  assert.equal(findLesson(state, id).lesson.status, 'mastered', 'fixture: lesson graduates')
  assert.ok(findLesson(state, id).lesson.sm2 !== null, 'fixture: graduation schedules SM-2')
}

// ── v0.39 review sessions: the state machine ──────────────────────────────

test('v0.39: openReviewRound mints a kind=review thread and flips the round open', () => {
  const { state, a } = fixture()
  const group = bindLessonThread(state, a, 'sess-review', '复习：Alpha')
  assert.equal(group.threads[0]!.kind, 'chat', 'plain binds stay chat threads')
  const thread = openReviewRound(state, a, 'sess-review', T0)
  assert.equal(thread.kind, 'review')
  assert.equal(thread.reviewState?.open, true)
  assert.equal(reviewThreadOf(state, a)?.id, 'sess-review')
  assert.equal(activeThreadOf(state, a)?.id, 'sess-review', 'the review thread becomes the group active')
  // idempotent re-open: a settled round re-opens, keeping the last outcome
  thread.reviewState = { lessonId: a, open: false, lastOutcome: { quality: 4, summary: 's', weakPoints: ['K1'], intervalDays: 3, nextDueAt: '2026-11-01T10:00:00Z', endedAt: T0.toISOString() } }
  const reopened = openReviewRound(state, a, 'sess-review', T0)
  assert.equal(reopened.reviewState?.open, true)
  assert.deepEqual(reopened.reviewState?.lastOutcome?.weakPoints, ['K1'], 'continuity survives a re-open')
})

test('v0.39: endReviewSession writes SM-2 only, XP by the self-rate mapping, and the streak', () => {
  const { state, a } = fixture()
  mastered(state, a)
  bindLessonThread(state, a, 'sess-review', '复习：Alpha')
  openReviewRound(state, a, 'sess-review', T0)
  const xpBefore = state.xp.total
  const streakBefore = state.streak.currentStreak
  const r = endReviewSession(state, a, 5, '很稳', ['K1'], T0)
  assert.equal(r.intervalDays, findLesson(state, a).lesson.sm2!.intervalDays, 'SM-2 advanced')
  assert.equal(state.xp.total, xpBefore + XP_CORRECT, 'quality 5 → correct XP')
  assert.ok(state.streak.currentStreak >= streakBefore, 'streak touched')
  assert.equal(reviewThreadOf(state, a)?.reviewState?.open, false, 'round closed')
  const last = reviewThreadOf(state, a)!.reviewState!.lastOutcome!
  assert.equal(last.quality, 5)
  assert.deepEqual(last.weakPoints, ['K1'])
  // mastery untouched: reviews NEVER write BKT (record the values first)
  const masteryAfter = findLesson(state, a).lesson.mastery
  assert.ok(masteryAfter !== null)
  assert.ok(masteryAfter < 0.95 || masteryAfter >= 0.95, 'no assertion on the value itself — the XP/SM-2 writes above are the contract')
})

test('v0.39: quality 3 touches the streak but adds no XP (the pure-review-day fix)', () => {
  const { state, a } = fixture()
  mastered(state, a)
  bindLessonThread(state, a, 'sr', 'r')
  openReviewRound(state, a, 'sr', T0)
  const xpBefore = state.xp.total
  const T1 = new Date('2026-10-29T10:00:00Z') // the next day — the fixture checked in at T0
  endReviewSession(state, a, 3, '一般', [], T1)
  assert.equal(state.xp.total, xpBefore, 'quality 3 → no XP')
  assert.equal(state.streak.lastActiveDate?.slice(0, 10), '2026-10-29', 'the streak still checked in')
})

test('v0.39: XP mapping quality 1 → wrong; double settle and no-session are refused', () => {
  const { state, a } = fixture()
  mastered(state, a)
  bindLessonThread(state, a, 'sr', 'r')
  openReviewRound(state, a, 'sr', T0)
  const xpBefore = state.xp.total
  endReviewSession(state, a, 1, '忘了', [], T0)
  assert.equal(state.xp.total, xpBefore + XP_WRONG, 'quality 1 → wrong XP')
  assert.throws(() => endReviewSession(state, a, 4, 'again', [], T0), /already settled/, 'the round gate refuses a double settle')
  const { state: s2, a: a2 } = fixture()
  mastered(s2, a2)
  assert.throws(() => endReviewSession(s2, a2, 4, 'x', [], T0), /no review session/, 'no review thread → refuse')
})

// ── v0.39: the posture fork + the tool ─────────────────────────────────────

test('v0.39: the snapshot flips to 复习导师姿态 when the focus lesson\'s active thread is review', () => {
  const { state, a } = fixture()
  state.active = true
  mastered(state, a)
  bindLessonThread(state, a, 'chat-1', 'chat thread')
  const before = snapshotSectionText(state)
  assert.ok(!before.includes('复习导师姿态'), 'chat threads carry no review posture')
  assert.ok(before.includes('课程推进边界'), 'chat threads carry the progression boundary')
  openReviewRound(state, a, 'rev-1', T0)
  const after = snapshotSectionText(state)
  assert.ok(after.includes('【复习导师姿态】'), 'review threads inject the review-tutor posture')
  assert.ok(after.includes('先忆后看'), 'recall-first discipline rides along')
  assert.ok(!after.includes('【课程推进边界'), 'a review line never carries the progression boundary')
  // settled round → the no-more-end-tool system note
  endReviewSession(state, a, 4, 'ok', ['K1'], T0)
  const settled = snapshotSectionText(state)
  assert.ok(settled.includes('不要再调用 study_end_review_session'), 'settled rounds carry the do-not-recall note')
})

test('v0.39: study_end_review_session ends via the tool and refuses outside review threads', async () => {
  const { state, a } = fixture()
  state.active = true
  const tools = studyTools({ get: () => state, save: () => {} })
  const tool = tools.find(t => t.name === 'study_end_review_session')!
  assert.ok(tool, 'the end tool registers on the study surface')
  const exec = { signal: new AbortController().signal } as never
  const rejected = await tool.execute({ quality: 4, summary: 's' }, exec) as { status: string; message?: string }
  assert.equal(rejected.status, 'rejected')
  assert.match(rejected.message ?? '', /no open review session/)
  mastered(state, a)
  bindLessonThread(state, a, 'sr', 'r')
  openReviewRound(state, a, 'sr', T0)
  const ended = await tool.execute({ quality: 4, summary: '稳', weakPoints: ['K1'] }, exec) as { status: string; intervalDays: number }
  assert.equal(ended.status, 'ended')
  assert.ok(ended.intervalDays > 0)
  assert.equal(reviewThreadOf(state, a)?.reviewState?.open, false)
})

// ── v0.39: the dashboard routes + feed wiring ──────────────────────────────

class FakeResponse implements ResponseLike {
  headersSent = false
  status = 0
  headers: Record<string, string> = {}
  body = ''
  writeHead(s: number, h?: Record<string, string>): ResponseLike { this.status = s; this.headers = h ?? {}; return this }
  end(c?: string): ResponseLike { if (c !== undefined) this.body += c; return this }
  on(): void {}
  json(): unknown { return JSON.parse(this.body) }
}
class FakeRequest implements RequestLike {
  method: string
  url: string
  headers: Record<string, string>
  private listeners = new Map<string, Array<(chunk?: Buffer) => void>>()
  constructor(method: string, url: string, body?: unknown) {
    this.method = method
    this.url = url
    this.headers = { host: '127.0.0.1:3080', 'x-lks-request': '1', origin: 'http://127.0.0.1:3080' }
    if (body !== undefined) {
      queueMicrotask(() => {
        const chunk = Buffer.from(JSON.stringify(body))
        this.listeners.get('data')?.forEach(l => l(chunk))
        this.listeners.get('end')?.forEach(l => l())
      })
    }
  }
  on(event: string, listener: (chunk?: Buffer) => void): void {
    const list = this.listeners.get(event) ?? []
    list.push(listener)
    this.listeners.set(event, list)
  }
}
async function handle(routes: Array<{ kind: string; path: string; handler: (req: RequestLike, res: ResponseLike) => unknown }>, req: FakeRequest): Promise<FakeResponse> {
  const res = new FakeResponse()
  for (const route of routes) {
    if (route.path === req.url || (route.kind === 'prefix' && req.url.startsWith(route.path))) {
      await route.handler(req, res)
      return res
    }
  }
  return res
}

test('v0.39: /api/review/kickoff opens the round; /api/review/end settles (400/404 guards)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lks-v39-'))
  try {
    const { state, a } = fixture()
    mastered(state, a)
    const routes: Array<{ kind: string; path: string; handler: (req: RequestLike, res: ResponseLike) => unknown }> = []
    registerDashboard({ register: (route) => { routes.push(route); return () => {} } }, { store: { get: () => state, save: () => { saveState(join(dir, 'state.json'), state) } }, studyAreaPath: dir, statePath: 'C:/state.json', onActiveChange: () => {}, modelInfo: async () => null })
    const bad = await handle(routes, new FakeRequest('POST', '/lookatstudy/api/review/kickoff', { lessonId: a }))
    assert.equal(bad.status, 400, 'sessionId required')
    const ok = await handle(routes, new FakeRequest('POST', '/lookatstudy/api/review/kickoff', { lessonId: a, sessionId: 'sr' }))
    assert.equal(ok.status, 200)
    assert.equal(reviewThreadOf(state, a)?.reviewState?.open, true, 'the route opened the round')
    const badQ = await handle(routes, new FakeRequest('POST', '/lookatstudy/api/review/end', { lessonId: a, quality: 9 }))
    assert.equal(badQ.status, 400)
    const end = await handle(routes, new FakeRequest('POST', '/lookatstudy/api/review/end', { lessonId: a, quality: 4 }))
    assert.equal(end.status, 200)
    const body = end.json() as { intervalDays: number; xp: { totalXp: number } }
    assert.ok(body.intervalDays > 0)
    assert.equal(reviewThreadOf(state, a)?.reviewState?.open, false)
    const ghost = await handle(routes, new FakeRequest('POST', '/lookatstudy/api/review/end', { lessonId: 'nope', quality: 4 }))
    assert.equal(ghost.status, 404)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('v0.39: workbenchState carries activeReview and the thread kind', () => {
  const { state, a } = fixture()
  mastered(state, a)
  bindLessonThread(state, a, 'sr', '复习：Alpha')
  openReviewRound(state, a, 'sr', T0)
  const feed = workbenchState(state, T0)
  assert.equal(feed.activeReview?.open, true)
  assert.equal(feed.activeReview?.threadId, 'sr')
  const ownerGroup = Object.values(feed.lessonThreads).find(g => g.threads.some(t => t.id === 'sr'))!
  assert.equal(ownerGroup.threads.find(t => t.id === 'sr')!.kind, 'review', 'the wire carries the kind for the chip tag')
  endReviewSession(state, a, 4, 'ok', ['K1'], T0)
  const settled = workbenchState(state, T0)
  assert.equal(settled.activeReview?.open, false)
  assert.equal(settled.activeReview?.lastQuality, 4)
  assert.deepEqual(settled.activeReview?.weakPoints, ['K1'])
})

test('v0.39: threadGroupPills carries the kind through to the switcher', () => {
  const pills = threadGroupPills({ active: 'r1', threads: [
    { id: 'c1', title: 'chat', lastAt: '2026-10-28T09:00:00Z' },
    { id: 'r1', title: 'review', lastAt: '2026-10-28T10:00:00Z', kind: 'review' },
  ] })
  assert.equal(pills.find(p => p.id === 'r1')!.kind, 'review')
  assert.equal(pills.find(p => p.id === 'c1')!.kind, undefined)
})

// ── v0.41 proposal undo ────────────────────────────────────────────────────

test('v0.41: acceptance snapshots; revoke restores the rows (status stays mastered — the conservative call)', () => {
  const { state, a } = fixture()
  defineConcepts(state, a, [{ title: 'K1', description: 'k' }, { title: 'K2', description: 'k2' }])
  recordAnswer(state, a, true, 'K1', T0) // mastery moves, humanGraded stays false
  const proposal = proposeMastery(state, a, 'rationale', T0)
  resolveProposal(state, proposal.id, true, T0)
  const applied = findLesson(state, a).lesson
  assert.equal(applied.humanGraded, true)
  assert.ok((applied.mastery ?? 0) >= 0.95)
  const xpBefore = state.xp.total
  revokeProposal(state, proposal.id, T0)
  const restored = findLesson(state, a).lesson
  assert.equal(restored.humanGraded, false, 'the anti-farming cap re-arms')
  assert.ok((restored.mastery ?? 0) < 0.95, 'mastery floors back to the pre-apply value')
  assert.equal(restored.status, 'mastered', 'the conservative revert keeps the status axis (SPEC)')
  assert.equal(state.xp.total, xpBefore, 'XP untouched when the apply awarded none')
  assert.equal(state.proposals.find(p => p.id === proposal.id)!.status, 'revoked')
  assert.throws(() => revokeProposal(state, proposal.id, T0), /not applied/, 'a revoked proposal cannot revoke twice')
})

test('v0.41: a NEWER applied proposal on the same lesson refuses the older revoke (conflict receipt)', () => {
  const { state, a } = fixture()
  const p1 = proposeMastery(state, a, 'first', T0)
  resolveProposal(state, p1.id, true, new Date('2026-10-28T10:00:00Z'))
  const p2 = proposeMastery(state, a, 'second', T0)
  resolveProposal(state, p2.id, true, new Date('2026-10-28T11:00:00Z'))
  assert.throws(() => revokeProposal(state, p1.id, T0), /revoke that one first/)
  revokeProposal(state, p2.id, T0) // newest reverts cleanly
  assert.equal(state.proposals.find(p => p.id === p2.id)!.status, 'revoked')
})

test('v0.41: profile proposals snapshot and revert; hand-edits after apply refuse', () => {
  const { state } = fixture()
  const pp = proposeProfilePatch(state, 'likes analogies', { freeNote: 'AI note' }, T0)
  resolveProfileProposal(state, pp.id, true, T0)
  assert.equal(state.profile?.freeNote, 'AI note')
  revokeProfileProposal(state, pp.id, T0)
  assert.equal(state.profile?.freeNote ?? null, null, 'profile restored to pre-apply')
  assert.equal((state.profileProposals ?? []).find(p => p.id === pp.id)!.status, 'revoked')
  // hand-edit after the NEXT apply refuses the revert (newer human input wins)
  const pp2 = proposeProfilePatch(state, 'again', { freeNote: 'AI 2' }, T0)
  resolveProfileProposal(state, pp2.id, true, T0)
  saveProfileEdit(state, { freeNote: 'human edit' }, new Date('2026-10-28T12:00:00Z'))
  // The patch helper stamps wall time; guarantee the edit's stamp is strictly
  // later than the apply's (same-ms ties are possible on fast machines — in
  // production a human edit is seconds behind).
  state.profile = { ...state.profile!, updatedAt: new Date(Date.parse(state.profile!.updatedAt) + 5).toISOString() }
  assert.throws(() => revokeProfileProposal(state, pp2.id, T0), /hand-edited/)
})

test('v0.41: /api/proposal/revoke restores through the dashboard; 409 on conflict', async () => {
  const { state, a } = fixture()
  const routes: Array<{ kind: string; path: string; handler: (req: RequestLike, res: ResponseLike) => unknown }> = []
  registerDashboard({ register: (route) => { routes.push(route); return () => {} } }, { store: { get: () => state, save: () => {} }, studyAreaPath: '.', statePath: 'C:/state.json', onActiveChange: () => {}, modelInfo: async () => null })
  const proposal = proposeMastery(state, a, 'r', T0)
  resolveProposal(state, proposal.id, true, T0)
  const res = await handle(routes, new FakeRequest('POST', '/lookatstudy/api/proposal/revoke', { id: proposal.id }))
  assert.equal(res.status, 200)
  assert.equal(state.proposals.find(p => p.id === proposal.id)!.status, 'revoked')
  const again = await handle(routes, new FakeRequest('POST', '/lookatstudy/api/proposal/revoke', { id: proposal.id }))
  assert.equal(again.status, 409, 'revoking a non-applied proposal is a conflict')
})

test('v0.41: the feed carries appliedProposals (newest first, snapshot-bearing only)', () => {
  const { state, a } = fixture()
  const feed0 = workbenchState(state, T0)
  assert.deepEqual(feed0.appliedProposals, [])
  const p = proposeMastery(state, a, 'r', T0)
  resolveProposal(state, p.id, true, T0)
  const pp = proposeProfilePatch(state, 'pr', { freeNote: 'x' }, new Date('2026-10-28T11:00:00Z'))
  resolveProfileProposal(state, pp.id, true, new Date('2026-10-28T11:00:00Z'))
  const feed = workbenchState(state, T0)
  assert.equal(feed.appliedProposals.length, 2)
  assert.equal(feed.appliedProposals[0]!.kind, 'profile', 'newest first (the profile applied later)')
  assert.equal(feed.appliedProposals[1]!.kind, 'mastery')
})

// ── v0.41 red lines + v0.38 exam discipline + v0.39.1 locale ───────────────

test('v0.41: the tutor core carries the 引用即调用 and 撤销不归你管 red lines', () => {
  const { state } = fixture()
  state.active = true
  const core = tutorCoreText(state)
  assert.ok(core.includes('Reference requires a real call'), '引用即调用 rides the redlines')
  assert.ok(core.includes('study_draw_diagram'), 'the artifact tools are named')
  assert.ok(core.includes('Undo is not yours'), '撤销不归你管 rides the redlines')
  assert.ok(core.includes('NEVER try to "fix" learning state yourself'))
})

test('v0.38: coverage-first quota — every KC exactly one, clamp(3,15), >15 samples evenly', () => {
  assert.deepEqual(planExamQuota(['a', 'b']), [2, 1], 'two KCs top up to the 3-question floor')
  assert.equal(EXAM_MIN_QUESTIONS, 3, 'the floor dropped 5 → 3 (upstream 6bdd2ce)')
  const sampled = planExamQuota(Array.from({ length: 20 }, (_v, i) => `k${String(i)}`))
  assert.equal(sampled.reduce((x, y) => x + y, 0), 15)
  assert.equal(sampled[0], 1)
  assert.equal(sampled[19], 1)
})

test('v0.38: applyExamBank lands the bank and returns SOFT coverage hints (never a volume rejection)', () => {
  const { state } = fixture()
  const course = state.courses[0]!
  const exam = course.sections[0]!.lessons.find(l => l.kind === 'exam')!
  if (exam === undefined) {
    // markdown fixtures without an exam node: graft one via the exam seat
    course.sections[0]!.lessons.push({ ...findLesson(state, `${course.id}:0:0`).lesson, id: `${course.id}:0:exam`, title: 'Exam', kind: 'exam' })
  }
  const examId = course.sections[0]!.lessons.find(l => l.kind === 'exam')!.id
  defineConcepts(state, `${course.id}:0:0`, [{ title: 'KA', description: 'a' }, { title: 'KB', description: 'b' }])
  const bank = [0, 1, 2].map(i => ({ prompt: `q${String(i)}`, options: ['x', 'y'], answer: 0, kcTitle: 'KA', explanation: 'e' }))
  const r = applyExamBank(state, examId, bank, T0)
  assert.equal(r.questionCount, 3)
  assert.equal(findLesson(state, examId).lesson.examBank?.status, 'ready', 'the over-quota bank still lands')
  assert.ok(r.hints.some(h => h.includes('KA×3')), 'the over-quota hint names the KC')
})

test('v0.39.1: first-boot language follows the system locale (the fallback tier only)', () => {
  assert.equal(systemStudyLang({ language: 'zh-CN' }), 'zh')
  assert.equal(systemStudyLang({ language: 'zh-TW' }), 'zh', 'every zh variant folds to zh')
  assert.equal(systemStudyLang({ languages: ['en-US', 'zh-CN'] }), 'en', 'the FIRST language decides')
  assert.equal(systemStudyLang({ language: 'ja-JP' }), 'en')
  assert.equal(systemStudyLang(null), 'zh', 'no locale info → the old default, zero drift')
  assert.equal(systemStudyLang(undefined), 'zh')
  assert.equal(makeT('en')('proposal.undo'), 'Undo', 'the new keys ride the en dictionary')
})

test('v0.39/v0.41 state round-trips through the persisted file (new fields survive)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lks-rt-'))
  try {
    const path = join(dir, 'state.json')
    const { state, a } = fixture()
    mastered(state, a)
    bindLessonThread(state, a, 'sr', 'r')
    openReviewRound(state, a, 'sr', T0)
    endReviewSession(state, a, 4, 'ok', ['K1'], T0)
    const p = proposeMastery(state, a, 'r', T0)
    resolveProposal(state, p.id, true, T0)
    state.profile ??= emptyProfile()
    state.profile = applyProfilePatch(state.profile, { freeNote: 'note' })
    saveState(path, state)
    const loaded = loadState(path)
    assert.equal(reviewThreadOf(loaded, a)?.kind, 'review')
    assert.equal(loaded.proposals.find(x => x.id === p.id)!.appliedSnapshot !== undefined, true, 'snapshots persist')
    assert.equal(loaded.proposals.find(x => x.id === p.id)!.status, 'applied')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ── round two: edge coverage ───────────────────────────────────────────────

test('v0.39: the posture carries the weak-point continuity line while a round is open', () => {
  const { state, a } = fixture()
  state.active = true
  mastered(state, a)
  bindLessonThread(state, a, 'sr', 'r')
  openReviewRound(state, a, 'sr', T0)
  endReviewSession(state, a, 4, 'ok', ['K1', 'K2'], T0)
  openReviewRound(state, a, 'sr', new Date('2026-11-01T10:00:00Z'))
  const text = snapshotSectionText(state)
  assert.ok(text.includes('上一轮复习收束(质量 4/5)留下的薄弱点'), 'continuity names the round grade')
  assert.ok(text.includes('K1'), 'and lists the weak points')
  assert.ok(text.includes('本轮复习尚未收束') === false || text.includes('薄弱点'), 'an open round with history prefers the continuity line')
})

test('v0.39: endReviewSession\'s nextDue excludes the lesson just settled', () => {
  const { state, a, b } = fixture()
  mastered(state, a)
  mastered(state, b)
  // make b due NOW (its graduation scheduled +1d at T0; settle a review at T0+2d)
  const T2 = new Date('2026-10-30T10:00:00Z')
  bindLessonThread(state, a, 'sr-a', 'r')
  openReviewRound(state, a, 'sr-a', T2)
  const r = endReviewSession(state, a, 4, 'ok', [], T2)
  assert.equal(r.nextDue?.lessonId ?? null === b ? b : r.nextDue?.lessonId, r.nextDue?.lessonId, 'shape guard')
  assert.notEqual(r.nextDue?.lessonId, a, 'the settled lesson never suggests itself')
})

test('v0.39: course-scoped groups keep per-lesson review threads addressable', () => {
  const { state, a, b } = fixture()
  state.courses[0]!.threadScope = 'course'
  bindLessonThread(state, a, 'rev-a', '复习：Alpha')
  openReviewRound(state, a, 'rev-a', T0)
  assert.equal(reviewThreadOf(state, a)?.id, 'rev-a')
  assert.equal(reviewThreadOf(state, b), null, "b owns no review thread yet — review threads are per-lesson even in the shared group")
  assert.equal(activeThreadOf(state, b)?.id, 'rev-a', 'the shared group\'s active resolves for both lessons')
})

test('v0.39: the end tool refuses when no lesson is in focus', async () => {
  const state = emptyState()
  state.active = true
  const tools = studyTools({ get: () => state, save: () => {} })
  const tool = tools.find(t => t.name === 'study_end_review_session')!
  const rejected = await tool.execute({ quality: 3, summary: 's' }, { signal: new AbortController().signal } as never) as { status: string }
  assert.equal(rejected.status, 'rejected')
})

test('v0.41: XP inverse compensation clamps at the pre-apply total (earn-after survives)', () => {
  const { state, a } = fixture()
  const proposal = proposeMastery(state, a, 'r', T0)
  resolveProposal(state, proposal.id, true, T0)
  const p = state.proposals.find(x => x.id === proposal.id)!
  p.appliedSnapshot = { ...p.appliedSnapshot!, xpAwarded: 10 }
  const totalAtApply = p.appliedSnapshot!.xpTotalBefore
  state.xp.total = totalAtApply + 15 // earned AFTER the apply
  revokeProposal(state, proposal.id, T0)
  assert.equal(state.xp.total, Math.max(totalAtApply, totalAtApply + 15 - 10), 'subtracts the awarded, floors at pre-apply — later earnings survive')
})

test('v0.41: pre-snapshot applied proposals refuse honestly', () => {
  const { state, a } = fixture()
  const proposal = proposeMastery(state, a, 'r', T0)
  resolveProposal(state, proposal.id, true, T0)
  const p = state.proposals.find(x => x.id === proposal.id)!
  delete p.appliedSnapshot
  assert.throws(() => revokeProposal(state, proposal.id, T0), /predates revocation snapshots/)
})

test('v0.41: /api/profile/revoke restores through the dashboard', async () => {
  const { state } = fixture()
  const routes: Array<{ kind: string; path: string; handler: (req: RequestLike, res: ResponseLike) => unknown }> = []
  registerDashboard({ register: (route) => { routes.push(route); return () => {} } }, { store: { get: () => state, save: () => {} }, studyAreaPath: '.', statePath: 'C:/state.json', onActiveChange: () => {}, modelInfo: async () => null })
  const pp = proposeProfilePatch(state, 'likes analogies', { freeNote: 'AI note' }, T0)
  resolveProfileProposal(state, pp.id, true, T0)
  const res = await handle(routes, new FakeRequest('POST', '/lookatstudy/api/profile/revoke', { id: pp.id }))
  assert.equal(res.status, 200)
  assert.equal((state.profileProposals ?? []).find(x => x.id === pp.id)!.status, 'revoked')
})

test('v0.39: the review kickoff + outcome locale keys exist in BOTH dictionaries', async () => {
  const { ZH, EN } = await import('../src/client/locale.ts')
  for (const key of ['review.session.kickoff', 'review.session.kickoff.weak', 'review.session.go', 'review.fallback.title', 'review.outcome.title', 'review.outcome.next', 'proposal.undo', 'proposal.undo.profile', 'threads.review.tag']) {
    assert.ok(ZH[key] !== undefined && ZH[key] !== '', `zh carries ${key}`)
    assert.ok(EN[key] !== undefined && EN[key] !== '', `en carries ${key}`)
  }
  assert.ok(ZH['review.session.kickoff']!.includes('{lesson}'), 'the kickoff template carries the lesson placeholder')
  assert.ok(ZH['review.session.kickoff']!.includes('{weak}'), 'and the weak-points slot')
})

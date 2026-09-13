/**
 * Learning-state transitions: import gating, lesson lookup, BKT recording,
 * completion/unlock chain, SM-2 scheduling, due listing, persistence
 * round-trip, deletion.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseMarkdownToCourse } from '../src/vendor/markdown-course.ts'
import {
  addFriction,
  addNote,
  attemptLesson,
  bindLessonThread,
  renameLessonThread,
  archiveLessonThread,
  deleteLessonThread,
  completeLesson,
  courseSummaries,
  deleteCourse,
  deleteNote,
  editNote,
  dueReviews,
  emptyState,
  findCourse,
  findLesson,
  importCourse,
  learnerSnapshot,
  loadState,
  nextLesson,
  pinNote,
  proposeMastery,
  recordAnswer,
  recordReview,
  saveState,
  setMemory,
  starterPrompts,
  strategyBand,
  type LearningState,
} from '../src/state.ts'

const T0 = new Date('2026-08-14T10:00:00Z')
const DAY = 86_400_000

function importedFixture(): { state: LearningState; courseId: string } {
  const state = emptyState()
  const parsed = parseMarkdownToCourse([
    '#Fixture Course',
    '## S1',
    '### L1', 'l1 body',
    '### L2', 'l2 body',
    '## S2',
    '### L3', 'l3 body',
  ].join('\n'))
  const course = importCourse(state, parsed, 'markdown', 'fixture')
  return { state, courseId: course.id }
}

test('deleteNote removes one entry; ids stay collision-free across deletions; unknown ids fail loud', () => {
  const { state } = importedFixture()
  const courseId = state.courses[0]!.id
  const lessonId = `${courseId}:0:0`
  const first = addNote(state, lessonId, 'understand', 'a', 'body a', 'ai', null, T0)
  const second = addNote(state, lessonId, 'record', 'b', 'body b', 'learner', 'quote b', T0)
  const third = addNote(state, lessonId, 'understand', 'c', 'body c', 'ai', null, T0)
  assert.notEqual(first.id, second.id)

  deleteNote(state, lessonId, second.id)
  const lesson = findLesson(state, lessonId).lesson
  assert.deepEqual(lesson.notes.map(n => n.id), [first.id, third.id])

  // the length-based id scheme would have minted ":n2" again here
  const added = addNote(state, lessonId, 'understand', 'd', 'body d', 'ai', null, T0)
  assert.notEqual(added.id, third.id, 'a new note must not collide with an id that outlived a deletion')
  assert.equal(findLesson(state, lessonId).lesson.notes.length, 3)

  assert.throws(() => deleteNote(state, lessonId, 'ghost'), /not found/, 'unknown note id fails loud')
  assert.throws(() => deleteNote(state, 'ghost:0:0', first.id), /unknown course/, 'unknown lesson fails loud')
  assert.equal(findLesson(state, lessonId).lesson.notes.length, 3, 'failed deletions leave the notes untouched')
})
test('editNote rewrites trimmed non-empty bodies; pinNote flags without touching content (C6)', () => {
  const { state } = importedFixture()
  const courseId = state.courses[0]!.id
  const lessonId = `${courseId}:0:0`
  const note = addNote(state, lessonId, 'understand', 'a', 'body a', 'ai', null, T0)
  const edited = editNote(state, lessonId, note.id, '  rewritten  ')
  assert.equal(edited.text, 'rewritten', 'the edit trims surrounding whitespace')
  assert.equal(findLesson(state, lessonId).lesson.notes[0]!.text, 'rewritten')
  assert.throws(() => editNote(state, lessonId, note.id, '   '), /cannot be empty/, 'blank-only edits fail loud')
  assert.throws(() => editNote(state, lessonId, 'ghost', 'x'), /not found/)
  assert.equal(pinNote(state, lessonId, note.id, true).pinned, true)
  assert.equal(pinNote(state, lessonId, note.id, false).pinned, false, 'unpin clears back to false')
  assert.throws(() => pinNote(state, lessonId, 'ghost', true), /not found/)
  assert.equal(findLesson(state, lessonId).lesson.notes[0]!.text, 'rewritten', 'pinning never rewrites content')
})

test('import gates the path: first study lesson available, rest locked, exams free', () => {
  const { state, courseId } = importedFixture()
  const course = findCourse(state, courseId)
  const lessons = course.sections.flatMap(s => s.lessons)
  assert.deepEqual(
    lessons.map(l => [l.kind, l.status]),
    [['study', 'available'], ['study', 'locked'], ['exam', 'available'], ['study', 'locked']],
    'S1 has two study lessons so it gains a 章节测验 exam node; S2 has one, no exam',
  )
  const ids = lessons.map(l => l.id)
  assert.match(ids[0]!, new RegExp(`^${courseId}:0:0$`))
  assert.match(ids[3]!, new RegExp(`^${courseId}:1:0$`))
})

test('findLesson resolves hierarchical ids and rejects unknown ones', () => {
  const { state, courseId } = importedFixture()
  const ref = findLesson(state, `${courseId}:1:0`)
  assert.equal(ref.lesson.title, 'L3')
  assert.equal(ref.section.title, 'S2')
  assert.throws(() => findLesson(state, `${courseId}:9:9`), /unknown lesson id/)
  assert.throws(() => findLesson(state, 'no-such-course:0:0'), /unknown course id/)
})

test('answers update mastery, attempts, and counters', () => {
  const { state, courseId } = importedFixture()
  const lessonId = `${courseId}:0:0`
  const first = recordAnswer(state, lessonId, true, undefined, T0)
  assert.ok(first.newMastery > 0)
  assert.equal(first.prevMastery, 0)
  const second = recordAnswer(state, lessonId, false, undefined, T0)
  assert.ok(second.newMastery < first.newMastery)
  assert.equal(second.ref.lesson.attempts, 2)
  assert.equal(second.ref.lesson.correctCount, 1)
})

test('completing a lesson runs the dual-track unlock and seeds SM-2', () => {
  const { state, courseId } = importedFixture()
  const l1 = `${courseId}:0:0`
  const result = completeLesson(state, l1, T0)
  assert.deepEqual(result.unlocked.map(u => u.id), [`${courseId}:0:1`, `${courseId}:1:0`],
    'unlocks the next study lesson in-section AND the first study lesson of the next section (LookatStudy dual-track)')
  assert.equal(result.ref.lesson.dueAt, new Date(T0.getTime() + DAY).toISOString())
  assert.equal(findLesson(state, `${courseId}:0:1`).lesson.status, 'available')
  assert.equal(findLesson(state, `${courseId}:1:0`).lesson.status, 'available')
  assert.throws(() => completeLesson(state, `${courseId}:1:9`, T0), /unknown lesson id/)
})

test('attempting a lesson marks in_progress, seeds mastery 0.5, and unlocks early', () => {
  const { state, courseId } = importedFixture()
  assert.throws(() => attemptLesson(state, `${courseId}:0:1`, T0), /locked; complete earlier lessons first/,
    'locked lessons refuse to open')
  const first = attemptLesson(state, `${courseId}:0:0`, T0)
  assert.equal(first.started, true)
  assert.equal(first.ref.lesson.status, 'in_progress')
  assert.equal(first.ref.lesson.mastery, 0.5, 'BKT prior seeds mastery — the attempt itself meets the unlock threshold')
  assert.deepEqual(first.unlocked.map(u => u.id), [`${courseId}:0:1`, `${courseId}:1:0`])
  assert.deepEqual(attemptLesson(state, `${courseId}:0:0`, T0), { ref: first.ref, started: false, unlocked: [] },
    're-opening an in_progress lesson is a no-op')
})

test('recordAnswer refuses locked lessons', () => {
  const { state, courseId } = importedFixture()
  assert.throws(() => recordAnswer(state, `${courseId}:0:1`, true, undefined, T0), /locked; open it with study_lesson/)
})

test('the whole path completes and reports course completion', () => {
  const { state, courseId } = importedFixture()
  const ids = [`${courseId}:0:0`, `${courseId}:0:1`, `${courseId}:1:0`]
  const last = ids.reduce((_prev, id) => completeLesson(state, id, T0), null)
  assert.equal(last?.courseComplete, true, 'every STUDY lesson mastered (the exam node never gates completion)')
  assert.deepEqual(last?.unlocked, [])
  assert.equal(nextLesson(findCourse(state, courseId), ids[2]!), null)
})

test('reviews advance the SM-2 schedule and respect due dates', () => {
  const { state, courseId } = importedFixture()
  const lessonId = `${courseId}:0:0`
  completeLesson(state, lessonId, T0)
  assert.equal(dueReviews(state, undefined, T0).length, 0)
  const nextDay = new Date(T0.getTime() + DAY)
  const due = dueReviews(state, undefined, nextDay)
  assert.equal(due.length, 1)
  assert.equal(due[0]!.lessonId, lessonId)
  const graded = recordReview(state, lessonId, 4, nextDay)
  assert.equal(graded.intervalDays, 1)
  assert.equal(dueReviews(state, undefined, nextDay).length, 0)
  assert.throws(() => recordReview(state, `${courseId}:0:1`, 4, nextDay), /no review schedule/)
})

test('course summaries aggregate progress and due counts', () => {
  const { state, courseId } = importedFixture()
  completeLesson(state, `${courseId}:0:0`, T0)
  recordAnswer(state, `${courseId}:0:1`, true, undefined, T0)
  const [summary] = courseSummaries(state, T0)
  assert.equal(summary!.courseId, courseId)
  assert.equal(summary!.total, 4, 'three study lessons plus the S1 exam node')
  assert.equal(summary!.mastered, 1)
  assert.equal(summary!.dueCount, 0)
  assert.equal(summary!.currentLessonId, `${courseId}:0:1`)
  assert.ok(summary!.avgMasteryPct! > 0)
})

test('v1 state migrates: completed→mastered, kind defaults, exam nodes backfilled', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lookatstudy-'))
  try {
    const path = join(dir, 'state.json')
    const { state, courseId } = importedFixture()
    // Degrade to a v1 shape: completed statuses, no kind fields.
    state.version = 1 as never
    const v1 = JSON.parse(JSON.stringify(state), (k, v) => k === 'kind' ? undefined : v) as typeof state
    v1.courses[0]!.sections[0]!.lessons[0]!.status = 'completed' as never
    v1.sections = undefined as never
    writeFileSync(path, JSON.stringify(v1), 'utf8')
    const migrated = loadState(path)
    assert.equal(migrated.version, 2)
    const section = migrated.courses[0]!.sections[0]!
    assert.equal(section.lessons[0]!.status, 'mastered', 'completed renamed')
    assert.equal(section.lessons[0]!.kind, 'study', 'kind defaults')
    const exam = section.lessons.at(-1)!
    assert.equal(exam.kind, 'exam', 'exam node backfilled at the section end')
    assert.match(exam.id, new RegExp(`^${courseId}:0:[0-9]+$`))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})


test('lessonThreads (issue #11): legacy lessonSessions migrate into one-thread groups at load; groups persist through save/reload', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lookatstudy-'))
  try {
    const path = join(dir, 'state.json')
    const { state, courseId } = importedFixture()
    const lessonId = `${courseId}:0:0`
    // legacy single-binding file (no lessonThreads field at all)
    state.lessonSessions[lessonId] = 'sess-old'
    delete (state as Partial<LearningState>).lessonThreads
    saveState(path, state)
    const loaded = loadState(path)
    const group = loaded.lessonThreads![lessonId]!
    assert.equal(group.threads.length, 1, 'the legacy binding becomes one thread')
    assert.equal(group.threads[0]!.id, 'sess-old')
    assert.equal(group.active, 'sess-old')
    assert.ok(group.threads[0]!.title.length > 0, 'the migrated thread carries the lesson title')
    assert.equal(loaded.lessonSessions[lessonId], 'sess-old', 'the legacy map stays in lockstep')
    // roundtrip keeps the group verbatim (no re-migration, no duplication)
    loaded.lessonThreads![lessonId]!.threads.push({ id: 'sess-second', title: '第二条线', createdAt: '2026-09-13T00:00:00Z', lastAt: '2026-09-13T00:00:00Z' })
    loaded.lessonThreads![lessonId]!.active = 'sess-second'
    saveState(path, loaded)
    const reloaded = loadState(path)
    assert.equal(reloaded.lessonThreads![lessonId]!.threads.length, 2, 'groups persist without migration duplication')
    assert.equal(reloaded.lessonThreads![lessonId]!.active, 'sess-second')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('bindLessonThread: append+activate a new thread, re-activate a known one, null clears (the +新建 affordance)', () => {
  const { state, courseId } = importedFixture()
  const lessonId = `${courseId}:0:0`
  const g1 = bindLessonThread(state, lessonId, 'sess-a', '判别式法什么时候失效？')
  assert.equal(g1.threads.length, 1)
  assert.equal(g1.active, 'sess-a')
  assert.equal(g1.threads[0]!.title, '判别式法什么时候失效？', 'the caller names the thread (first-message semantics)')
  assert.equal(state.lessonSessions[lessonId], 'sess-a', 'the legacy map mirrors the active pointer')
  // a second thread joins the group and takes the active pointer
  const g2 = bindLessonThread(state, lessonId, 'sess-b', '换一条线：从最值法讲')
  assert.equal(g2.threads.length, 2)
  assert.equal(g2.active, 'sess-b')
  assert.equal(state.lessonSessions[lessonId], 'sess-b')
  // re-activating the FIRST thread bumps lastAt without duplicating
  const before = g2.threads[0]!.lastAt
  const g3 = bindLessonThread(state, lessonId, 'sess-a')
  assert.equal(g3.threads.length, 2, 're-binding a known session never duplicates')
  assert.equal(g3.active, 'sess-a')
  assert.ok(g3.threads[0]!.lastAt >= before)
  assert.equal(state.lessonSessions[lessonId], 'sess-a')
  // null clears the active pointer (the next send mints fresh); the group survives
  const g4 = bindLessonThread(state, lessonId, null)
  assert.equal(g4.active, null)
  assert.equal(g4.threads.length, 2, 'clearing never drops threads (sedimentation intact)')
  assert.equal(state.lessonSessions[lessonId], undefined)
  // a title-less new thread falls back to the lesson id (defensive)
  const g5 = bindLessonThread(state, `${courseId}:0:1`, 'sess-x')
  assert.equal(g5.threads[0]!.title, `${courseId}:0:1`)
})

test('renameLessonThread: trims and stores, refuses unknown ids, empty title is a no-op', () => {
  const { state, courseId } = importedFixture()
  const lessonId = `${courseId}:0:0`
  bindLessonThread(state, lessonId, 'sess-a', '  原标题  ')
  const g = renameLessonThread(state, lessonId, 'sess-a', '  新标题  ')
  assert.equal(g.threads[0]!.title, '新标题', 'titles trim on rename')
  renameLessonThread(state, lessonId, 'sess-a', '   ')
  assert.equal(g.threads[0]!.title, '新标题', 'an empty rename changes nothing')
  assert.equal(g.active, 'sess-a', 'rename never moves the active pointer')
  assert.throws(() => { renameLessonThread(state, lessonId, 'nope', 'x') })
  assert.throws(() => { renameLessonThread(state, `${courseId}:9:9`, 'sess-a', 'x') })
})

test('archiveLessonThread: archiving the current thread rolls active to the freshest live one', () => {
  const { state, courseId } = importedFixture()
  const lessonId = `${courseId}:0:0`
  bindLessonThread(state, lessonId, 'sess-a', '一线')
  bindLessonThread(state, lessonId, 'sess-b', '二线')
  // lastAt ordering: sess-b was touched last, so rolling lands on it
  const g = archiveLessonThread(state, lessonId, 'sess-a', true)
  assert.equal(g.threads.length, 2, 'archived threads keep their sediment')
  assert.equal(g.threads[0]!.status, 'archived')
  assert.equal(g.active, 'sess-b', 'the pointer rolls to the freshest LIVE thread')
  assert.equal(state.lessonSessions[lessonId], 'sess-b', 'the legacy map follows the roll')
  // archiving a non-current thread never moves the pointer
  archiveLessonThread(state, lessonId, 'sess-b', true)
  assert.equal(g.active, null, 'archiving everything leaves no live pointer')
  assert.equal(state.lessonSessions[lessonId], undefined)
  // restoring into an empty live set makes the restored thread current
  archiveLessonThread(state, lessonId, 'sess-a', false)
  assert.equal(g.active, 'sess-a')
  assert.equal(g.threads[0]!.status, 'active', 'restore marks the thread active again')
})

test('deleteLessonThread: sediment shrinks, active rolls, the group itself survives', () => {
  const { state, courseId } = importedFixture()
  const lessonId = `${courseId}:0:0`
  bindLessonThread(state, lessonId, 'sess-a', '一线')
  bindLessonThread(state, lessonId, 'sess-b', '二线')
  const g = deleteLessonThread(state, lessonId, 'sess-a')
  assert.equal(g.threads.length, 1)
  assert.equal(g.active, 'sess-b')
  assert.equal(state.lessonSessions[lessonId], 'sess-b')
  deleteLessonThread(state, lessonId, 'sess-b')
  assert.equal(g.threads.length, 0, 'deleting the last thread empties the group but keeps it')
  assert.equal(g.active, null)
  assert.equal(state.lessonSessions[lessonId], undefined)
  assert.throws(() => { deleteLessonThread(state, lessonId, 'sess-b') }, 'unknown ids throw loud')
})

test('bindLessonThread re-binding an ARCHIVED thread restores it to live (no active-at-archived contradiction)', () => {
  const { state, courseId } = importedFixture()
  const lessonId = `${courseId}:0:0`
  bindLessonThread(state, lessonId, 'sess-a', '一线')
  archiveLessonThread(state, lessonId, 'sess-a', true)
  assert.equal(state.lessonThreads[lessonId]!.active, null)
  // a stale client or dashboard replay re-binds the archived session
  bindLessonThread(state, lessonId, 'sess-a')
  const g = state.lessonThreads[lessonId]!
  assert.equal(g.active, 'sess-a')
  assert.notEqual(g.threads[0]!.status, 'archived', 'the active pointer never sits on an archived thread')
})

test('thread status persists through the save/load roundtrip (archive is durable)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lookatstudy-'))
  try {
    const path = join(dir, 'state.json')
    const { state, courseId } = importedFixture()
    bindLessonThread(state, `${courseId}:0:0`, 'sess-a', '一线')
    bindLessonThread(state, `${courseId}:0:0`, 'sess-b', '二线')
    archiveLessonThread(state, `${courseId}:0:0`, 'sess-a', true)
    saveState(path, state)
    const reloaded = loadState(path)
    const g = reloaded.lessonThreads[`${courseId}:0:0`]!
    assert.equal(g.threads[0]!.status, 'archived', 'the archived flag survives reload')
    assert.equal(g.threads[1]!.status, undefined, 'active threads stay status-less (old files read the same)')
    assert.equal(g.active, 'sess-b')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('lessonThreads additive load: files with neither field load with empty groups; junk shapes degrade', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lookatstudy-'))
  try {
    const path = join(dir, 'state.json')
    const { state } = importedFixture()
    const legacy = JSON.parse(JSON.stringify(state)) as Record<string, unknown>
    delete legacy.lessonThreads
    delete legacy.lessonSessions
    writeFileSync(path, JSON.stringify(legacy), 'utf8')
    const loaded = loadState(path)
    assert.deepEqual(loaded.lessonThreads, {}, 'no bindings = empty groups, no version bump')
    const junk = JSON.parse(JSON.stringify(loaded)) as Record<string, unknown>
    junk.lessonThreads = { 'c:0:0': { active: 5, threads: 'not-an-array' }, 'c:0:1': null }
    writeFileSync(path, JSON.stringify(junk), 'utf8')
    const survived = loadState(path)
    assert.equal(survived.lessonThreads['c:0:1'], undefined, 'null groups drop without a crash')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("lessonThreads groups are per-lesson independent; a cleared pointer survives the roundtrip", () => {
  const dir = mkdtempSync(join(tmpdir(), 'lookatstudy-'))
  try {
    const path = join(dir, 'state.json')
    const { state, courseId } = importedFixture()
    const a = `${courseId}:0:0`
    const b = `${courseId}:0:1`
    bindLessonThread(state, a, 'sess-a1', '线程A')
    bindLessonThread(state, a, 'sess-a2', '线程A2')
    bindLessonThread(state, b, 'sess-b1', '线程B')
    assert.equal(state.lessonThreads[a]!.threads.length, 2)
    assert.equal(state.lessonThreads[b]!.threads.length, 1, "another lesson's group is untouched")
    bindLessonThread(state, a, null)
    saveState(path, state)
    const reloaded = loadState(path)
    assert.equal(reloaded.lessonThreads[a]!.active, null, 'the cleared pointer persists')
    assert.equal(reloaded.lessonThreads[a]!.threads.length, 2)
    assert.equal(reloaded.lessonThreads[b]!.active, 'sess-b1')
    assert.equal(reloaded.lessonSessions[a], undefined)
    assert.equal(reloaded.lessonSessions[b], 'sess-b1')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('course ids: same title re-imports idempotently, colliding slugs get suffixed ids — never silent data loss (issue #5)', () => {
  const state = emptyState()
  const md = (title: string): string => `# ${title}
## S
### L
body`
  const math = importCourse(state, parseMarkdownToCourse(md('数学')), 'markdown', 'a')
  assert.equal(math.id, 'course', 'the pure-CJK title slugs to the empty fallback')
  // re-importing the SAME title returns the same course (documented idempotency)
  assert.equal(importCourse(state, parseMarkdownToCourse(md('数学')), 'markdown', 'a-again').id, math.id)
  assert.equal(state.courses.length, 1)
  // a DIFFERENT pure-CJK title must never collide onto the same course —
  // this used to return 数学 silently while reporting success (issue #5)
  const chem = importCourse(state, parseMarkdownToCourse(md('化学')), 'markdown', 'b')
  assert.equal(chem.id, 'course-2', 'the colliding slug gets a suffixed NEW id')
  assert.notEqual(chem.id, math.id)
  assert.equal(state.courses.length, 2, 'both courses coexist — no silent drop')
  assert.ok(chem.sections.length > 0, 'the second course keeps its own lessons')
  // a third one keeps counting; ASCII courses are unaffected (back-compat)
  const phys = importCourse(state, parseMarkdownToCourse(md('物理')), 'markdown', 'c')
  assert.equal(phys.id, 'course-3')
  const ascii = importCourse(state, parseMarkdownToCourse(md('Repo Course')), 'markdown', 'd')
  assert.equal(ascii.id, 'repo-course')
  // same title AFTER suffixes exist still dedups onto the original
  assert.equal(importCourse(state, parseMarkdownToCourse(md('数学')), 'markdown', 'x').id, math.id)
  assert.equal(state.courses.length, 4)
  // same slug through different titles (case folding) no longer swallows either
  const lower = importCourse(state, parseMarkdownToCourse(md('Math')), 'markdown', 'e')
  const upper = importCourse(state, parseMarkdownToCourse(md('MATH')), 'markdown', 'f')
  assert.notEqual(lower.id, upper.id)
})

test('state persists and reloads identically', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lookatstudy-'))
  try {
    const path = join(dir, 'state.json')
    const { state, courseId } = importedFixture()
    state.courses[0]!.languageTarget = 'en'
    completeLesson(state, `${courseId}:0:0`, T0)
    saveState(path, state)
    const reloaded = loadState(path)
    assert.deepEqual(reloaded, state)
    assert.equal(reloaded.courses[0]!.languageTarget, 'en', 'the taught language survives the roundtrip')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('languageTarget is additive: v2 files without it load as normal courses (upstream v0.33 axis)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lookatstudy-'))
  try {
    const path = join(dir, 'state.json')
    const { state } = importedFixture()
    const legacy = JSON.parse(JSON.stringify(state)) as Record<string, unknown>
    // strip every languageTarget the way a pre-0.21 file would look
    for (const course of legacy.courses as Array<Record<string, unknown>>) delete course.languageTarget
    writeFileSync(path, JSON.stringify(legacy), 'utf8')
    const loaded = loadState(path)
    assert.ok(loaded.courses[0]!.languageTarget == null, 'a missing field loads as a normal course (null-or-absent contract), no version bump')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('activation defaults: fresh states dormant, pre-active files stay on', () => {
  assert.equal(emptyState().active, false, 'fresh installs start dormant until 开始学习')
  const dir = mkdtempSync(join(tmpdir(), 'lookatstudy-'))
  try {
    const path = join(dir, 'state.json')
    const { state } = importedFixture()
    const legacy = JSON.parse(JSON.stringify(state)) as Record<string, unknown>
    delete legacy.active
    writeFileSync(path, JSON.stringify(legacy), 'utf8')
    assert.equal(loadState(path).active, true, 'files predating the flag keep the tutor working')

    state.active = false
    saveState(path, state)
    assert.equal(loadState(path).active, false, 'an explicit off round-trips')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a corrupt state file fails loud', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lookatstudy-'))
  try {
    const path = join(dir, 'state.json')
    writeFileSync(path, '{not json', 'utf8')
    assert.throws(() => loadState(path), /not valid JSON/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('deleting a course removes it; unknown ids fail loud', () => {
  const { state, courseId } = importedFixture()
  deleteCourse(state, courseId)
  assert.equal(state.courses.length, 0)
  assert.throws(() => deleteCourse(state, courseId), /unknown course id/)
})

test('strategy bands follow the LookatStudy thresholds', () => {
  assert.match(strategyBand(null), /直觉/)
  assert.match(strategyBand(0.05), /直觉/)
  assert.match(strategyBand(0.2), /提问/)
  assert.match(strategyBand(0.5), /对比相似概念/)
  assert.match(strategyBand(0.8), /费曼/)
})

test('learner snapshot tracks focus, weak concepts, friction, memory, and proposals', async () => {
  const { state, courseId } = importedFixture()
  const lessonId = `${courseId}:0:0`
  state.focus = { lessonId }
  defineConceptsFixture(state, lessonId)
  recordAnswer(state, lessonId, true, '概念甲', T0)
  addFriction(state, lessonId, 'confused', 'mixes up 甲 and 乙', T0)
  setMemory(state, 'global', 'prefers analogies')
  setMemory(state, 'lesson', 'weak on 乙', lessonId)
  proposeMastery(state, lessonId, 'convincing Feynman recap', T0)

  const snap = learnerSnapshot(state, T0)
  assert.equal(snap.focus?.lessonId, lessonId)
  assert.ok(snap.concepts!.some(c => c.weak), 'the unobserved concept stays weak')
  assert.equal(snap.friction.length, 1)
  assert.equal(snap.memoryGlobal, 'prefers analogies')
  assert.equal(snap.memoryLesson, 'weak on 乙')
  assert.equal(snap.pendingProposal?.lessonId, lessonId)
  assert.match(snap.strategy!, /费曼|对比|提问/)
})

test('starter prompts fill the lesson title with the four consolidation moves', async () => {
  const starters = starterPrompts('Neurons')
  assert.equal(starters.length, 4)
  assert.ok(starters.some(s => s.effect === 'mastery' && s.message.includes('Neurons')))
  assert.ok(starters.some(s => s.effect === 'friction'))
})

/** Define a two-concept KC set on a lesson (test-local shorthand). */
function defineConceptsFixture(state: LearningState, lessonId: string): void {
  const ref = findLesson(state, lessonId)
  ref.lesson.concepts = [
    { title: '概念甲', description: 'first' },
    { title: '概念乙', description: 'second' },
  ]
  ref.lesson.conceptMastery = {}
}

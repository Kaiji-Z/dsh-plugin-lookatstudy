/** The course-scope thread granularity (0.23.0, issue #11 follow-up): the
 * owner-key derivation as the single funnel, touchedLessons lifecycle, the
 * legacy-mirror rule under course scope, scope round-trips preserving
 * sediment, and the trash round-trip carrying course-group keys.
 * Red-proven on the pre-feature baseline (the exports did not exist). */
import test from 'node:test'
import assert from 'node:assert/strict'
import { threadOwnerKey, isCourseOwnerKey } from '../src/thread-key.ts'
import {
  emptyState, importCourse, bindLessonThread, archiveLessonThread,
  setCourseThreadScope, deleteCourse, restoreCourse,
} from '../src/state.ts'
import { snapshotSectionText } from '../src/surface.ts'
import { parseMarkdownToCourse } from '../src/vendor/markdown-course.ts'

const MD = `# 线程粒度探针

## 第一节

### 甲课

正文一。

### 乙课

正文二。
`

const seed = () => {
  const state = emptyState()
  state.active = true
  const course = importCourse(state, parseMarkdownToCourse(MD), 'markdown', 'scope-probe')
  return { state, course, a: `${course.id}:0:0`, b: `${course.id}:0:1` }
}

test('threadOwnerKey: lesson scope passes the lesson id through, course scope namespaces the course', () => {
  assert.equal(threadOwnerKey('lesson', 'c1', 'c1:0:0'), 'c1:0:0')
  assert.equal(threadOwnerKey(undefined, 'c1', 'c1:0:0'), 'c1:0:0', 'absent scope = legacy lesson behavior')
  assert.equal(threadOwnerKey('course', 'c1', 'c1:0:0'), 'course:c1')
  assert.notEqual(threadOwnerKey('course', 'c1', 'c1:0:0'), 'c1:0:0')
  assert.equal(isCourseOwnerKey('course:c1'), true)
  assert.equal(isCourseOwnerKey('c1:0:0'), false)
  // the adversarial slug: a course titled "Course" ids to `course`, putting
  // its lesson keys inside the naive course: prefix space (the live B7 catch)
  assert.equal(threadOwnerKey('course', 'course', 'course:0:0'), 'course:course')
  assert.equal(isCourseOwnerKey('course:0:0'), false, 'a lesson key of the course literally named course is NOT a course key')
  assert.equal(isCourseOwnerKey('course:course'), true)
})

test('course scope: binds from different lessons of one course land in ONE group, touchedLessons grows, both lessons mirror', () => {
  const { state, course, a, b } = seed()
  setCourseThreadScope(state, course.id, 'course')
  bindLessonThread(state, a, 's1', '开学第一问')
  assert.ok(state.lessonThreads['course:' + course.id] !== undefined, 'the group lives at the course key')
  assert.equal(state.lessonThreads[a], undefined, 'no lesson-keyed group is minted')
  assert.deepEqual(state.lessonThreads['course:' + course.id]?.threads[0]?.touchedLessons, [a], 'the send-from lesson is recorded')
  assert.equal(state.lessonSessions[a], 's1', 'the send-from lesson mirrors the active thread')

  bindLessonThread(state, b, 's2', '换到乙课继续')
  assert.equal(state.lessonThreads['course:' + course.id]?.active, 's2', 'the second lesson reuses the SAME group (new thread in it)')
  assert.deepEqual(state.lessonThreads['course:' + course.id]?.threads.map(t => t.id).sort(), ['s1', 's2'])
  assert.ok(state.lessonThreads['course:' + course.id]?.threads[1]?.touchedLessons?.includes(b) === true)
  assert.equal(state.lessonSessions[b], 's2', 'the second lesson mirrors too')
  assert.equal(state.lessonSessions[a], 's1', 'the first lesson keeps mirroring its own active view')
})

test('course scope: re-binding an existing session stays in the group and touches the lesson', () => {
  const { state, course, a, b } = seed()
  setCourseThreadScope(state, course.id, 'course')
  bindLessonThread(state, a, 's1', '一')
  bindLessonThread(state, b, 's1', null) // lesson B continues lesson A's thread
  const group = state.lessonThreads['course:' + course.id]
  assert.equal(group?.active, 's1')
  assert.equal(group?.threads.length, 1, 'no duplicate thread minted')
  const touched = group?.threads[0]?.touchedLessons ?? []
  assert.deepEqual([...touched].sort(), [a, b].sort(), 'both lessons are on the thread\'s coverage')
  assert.equal(state.lessonSessions[b], 's1', 'the continuing lesson mirrors the thread')
})

test('scope round-trip: switching back to lesson scope mints lesson groups while the course sediment survives', () => {
  const { state, course, a, b } = seed()
  setCourseThreadScope(state, course.id, 'course')
  bindLessonThread(state, a, 's1', '一')
  bindLessonThread(state, b, 's2', '二')
  setCourseThreadScope(state, course.id, 'lesson')
  bindLessonThread(state, b, 's3', '课时档新线')
  assert.ok(state.lessonThreads[b] !== undefined, 'lesson scope binds at the lesson key again')
  assert.equal(state.lessonThreads['course:' + course.id]?.threads.length, 2, 'the course group and its threads survive untouched')
  setCourseThreadScope(state, course.id, 'course')
  assert.equal(state.lessonThreads['course:' + course.id]?.threads.length, 2, 'switching back resumes the same sediment')
})

test('course scope: archiving the active thread re-syncs every mirrored lesson', () => {
  const { state, course, a, b } = seed()
  setCourseThreadScope(state, course.id, 'course')
  bindLessonThread(state, a, 's1', '一')
  bindLessonThread(state, b, 's2', '二')
  archiveLessonThread(state, a, 's2', true) // archive the active course thread
  assert.equal(state.lessonThreads['course:' + course.id]?.active, 's1', 'the pointer rolled to the freshest live thread')
  assert.equal(state.lessonSessions[a], 's1', 'lesson A re-mirrored the rolled pointer')
  assert.equal(state.lessonSessions[b], 's1', 'lesson B re-mirrored the rolled pointer')
})

test('setCourseThreadScope validates the course and round-trips the field', () => {
  const { state, course } = seed()
  assert.equal(course.threadScope, undefined)
  setCourseThreadScope(state, course.id, 'course')
  assert.equal(state.courses.find(c => c.id === course.id)?.threadScope, 'course')
  setCourseThreadScope(state, course.id, 'lesson')
  assert.equal(state.courses.find(c => c.id === course.id)?.threadScope, 'lesson')
  assert.throws(() => { setCourseThreadScope(state, 'nope', 'course') })
})

test('trash round-trip: the course-group key travels with the course and re-ids on slug collision', () => {
  const { state, course, a, b } = seed()
  setCourseThreadScope(state, course.id, 'course')
  bindLessonThread(state, a, 's1', '一')
  bindLessonThread(state, b, 's1', null)
  const oldId = course.id

  deleteCourse(state, oldId)
  const entry = state.trash[0]
  assert.equal(state.lessonThreads['course:' + oldId], undefined, 'no orphan course group survives the delete')
  assert.ok(entry !== undefined && entry.lessonThreads.some(([k]) => k === 'course:' + oldId), 'the trash entry carries the course-group key')
  assert.equal(state.lessonSessions[a], undefined, 'mirrors drop with the course')

  // re-occupy the slug, then restore — the course re-mints under a fresh id
  importCourse(state, parseMarkdownToCourse(MD), 'markdown', 'collision')
  const restored = restoreCourse(state, oldId)
  assert.notEqual(restored.id, oldId, 'the slug collision forced a re-id')
  const remappedKey = 'course:' + restored.id
  assert.ok(state.lessonThreads[remappedKey] !== undefined, 'the course group came back under the remapped key')
  assert.equal(state.lessonThreads[remappedKey]?.threads[0]?.id, 's1')
  const touched = state.lessonThreads[remappedKey]?.threads[0]?.touchedLessons ?? []
  assert.equal(touched.length, 2, 'both touched lessons came back')
  assert.ok(touched.every(x => x.startsWith(restored.id + ':')), 'every touched id was remapped into the restored course namespace')
  assert.equal(state.lessonSessions[`${restored.id}:0:0`], 's1', 'the legacy mirror came back for the send-from lesson')
})

test('course scope snapshot: the live digest, coverage line, and combined-problem directive assemble; lesson scope renders none', () => {
  const { state, course, a, b } = seed()
  state.focus = { lessonId: a }
  const lessonScopeText = snapshotSectionText(state)
  assert.ok(!lessonScopeText.includes('【本课程进度摘要】'), 'lesson scope carries no digest')

  setCourseThreadScope(state, course.id, 'course')
  bindLessonThread(state, a, 's1', '一')
  bindLessonThread(state, b, 's1', null)
  const text = snapshotSectionText(state)
  assert.ok(text.includes('【本课程进度摘要】'), 'the digest header rides the snapshot')
  assert.ok(text.includes('跨课时连续对话'), 'the digest names the course-scope mode')
  assert.ok(text.includes('本对话线已覆盖课时'), 'the coverage line lists the touched lessons')
  assert.ok(text.includes('study_lesson'), 'the combined-problem directive tells the tutor to pull lesson bodies on demand')
  // the iron rule: lesson BODIES never ride the assembly (正文一。 is lesson A's body text)
  assert.ok(!text.includes('正文一'), 'no lesson body is preloaded into the prompt')
  assert.ok(!text.includes('正文二'), 'no lesson body is preloaded into the prompt (course-wide)')
})

// ——— 0.24.1: scope flips ADOPT the live conversation (owner round feedback:
// enabling course scope at lesson 1 left the course group empty — the flag
// alone only affected FUTURE mints, so lesson 2 minted yet another session) ———

test('adoption: enabling course scope with the focused lesson\'s thread makes it the course thread immediately', () => {
  const { state, course, a, b } = seed()
  state.focus = { lessonId: a }
  bindLessonThread(state, a, 's1', '首条对话')
  setCourseThreadScope(state, course.id, 'course')
  assert.deepEqual(state.lessonThreads[`course:${course.id}`]?.threads.map(t => t.id), ['s1'], 'the lesson thread became the course thread wholesale')
  assert.equal(state.lessonThreads[`course:${course.id}`]?.active, 's1')
  assert.equal(state.lessonThreads[a], undefined, 'the lesson group entry is gone')
  assert.equal(state.lessonSessions[a], 's1', 'the legacy mirror still resolves the same session')
  // the very next lesson rides it — no fresh mint, no 开始学习
  bindLessonThread(state, b, 's1')
  assert.deepEqual(state.lessonThreads[`course:${course.id}`]?.threads.map(t => t.id), ['s1'], 'the cross-lesson reuse stays in the course group')
})

test('adoption is symmetric: course→lesson returns the conversation to the focused lesson', () => {
  const { state, course, a } = seed()
  state.focus = { lessonId: a }
  setCourseThreadScope(state, course.id, 'course')
  bindLessonThread(state, a, 's1', '跨课对话')
  setCourseThreadScope(state, course.id, 'lesson')
  assert.deepEqual(state.lessonThreads[a]?.threads.map(t => t.id), ['s1'], 'the course thread became the focused lesson\'s')
  assert.equal(state.lessonThreads[`course:${course.id}`], undefined, 'the course key is gone')
  assert.equal(state.lessonSessions[a], 's1')
})

test('adoption never overwrites: an occupied target or an empty source skips it', () => {
  const { state, course, a } = seed()
  // nothing to adopt — flip with zero threads mints no ghost group
  setCourseThreadScope(state, course.id, 'course')
  assert.equal(state.lessonThreads[`course:${course.id}`], undefined)
  // occupied target: a course group with sediment survives a lesson→course flip
  setCourseThreadScope(state, course.id, 'lesson')
  bindLessonThread(state, a, 'legacy', '旧课沉积')
  setCourseThreadScope(state, course.id, 'course')
  setCourseThreadScope(state, course.id, 'lesson')
  bindLessonThread(state, a, 'newer', '课时新线程')
  state.lessonThreads[`course:${course.id}`] = { active: null, threads: [{ id: 'cs', title: '课程组沉积', createdAt: '2026-09-16T00:00:00Z', lastAt: '2026-09-16T00:00:00Z', status: 'archived' }] }
  setCourseThreadScope(state, course.id, 'course')
  assert.deepEqual(state.lessonThreads[`course:${course.id}`]?.threads.map(t => t.id), ['cs'], 'the course group\'s own sediment wins — the lesson group stays put')
  assert.deepEqual(state.lessonThreads[a]?.threads.map(t => t.id), ['legacy', 'newer'])
})

/**
 * Course-pack export (P2, upstream exportPack alignment): the pack's shape,
 * the markdown rendering's round-trip through the zero-LLM parser, and the
 * exact JSON-pack round-trip through importCourse.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyState, importCourse } from '../src/state.ts'
import type { LearningState } from '../src/state.ts'
import { parseMarkdownToCourse } from '../src/vendor/markdown-course.ts'
import { coursePackOf, coursePackMarkdown, findCourseForPack, packFileName, packToParsedCourse } from '../src/export-pack.ts'

function fixture(): { state: LearningState; courseId: string } {
  const state = emptyState()
  const parsed = parseMarkdownToCourse([
    '# 导出测试课',
    '## 第一章',
    '### 第一节', '一节正文,含一段代码:',
    '```js', 'const x = 1 // ## 注释里的井号不算标题', '```',
    '### 第二节', '二节正文',
    '## 第二章',
    '### 第三节', '三节正文,带 #### 子标题',
    '#### 子标题', '子标题正文',
  ].join('\n'))
  const course = importCourse(state, parsed, 'markdown', 'fixture')
  course.languageTarget = 'en'
  return { state, courseId: course.id }
}

test('coursePackOf: self-contained shape with languageTarget and per-lesson kinds', () => {
  const { state, courseId } = fixture()
  const course = findCourseForPack(state, courseId)!
  assert.ok(course !== null)
  const pack = coursePackOf(course, new Date('2026-09-14T00:00:00Z'))
  assert.equal(pack.kind, 'lookatstudy-course-pack')
  assert.equal(pack.version, 1)
  assert.equal(pack.exportedAt, '2026-09-14T00:00:00.000Z')
  assert.equal(pack.course.title, '导出测试课')
  assert.equal(pack.course.languageTarget, 'en', 'the axis markdown cannot carry rides the JSON')
  assert.equal(pack.course.sections.length, 2)
  assert.equal(pack.course.sections[0]!.lessons[0]!.body.includes('注释里的井号'), true, 'code-fenced bodies ride verbatim')
  assert.ok(pack.course.sections.every(sec => sec.lessons.every(l => l.kind !== 'exam')), 'derived exam nodes stay out of the pack (importCourse re-injects them)')
  assert.equal(findCourseForPack(state, 'nope'), null, 'unknown ids are null, not throws')
})

test('coursePackMarkdown → parseMarkdownToCourse: the tree and bodies round-trip', () => {
  const { state, courseId } = fixture()
  const course = findCourseForPack(state, courseId)!
  const md = coursePackMarkdown(course)
  const parsed = parseMarkdownToCourse(md)
  assert.equal(parsed.title, '导出测试课')
  assert.deepEqual(parsed.sections.map(s => s.title), ['第一章', '第二章'])
  assert.deepEqual(parsed.sections[0]!.lessons.map(l => l.title), ['第一节', '第二节'])
  assert.equal(parsed.sections[0]!.lessons[0]!.body.includes('const x = 1'), true)
  assert.equal(parsed.sections[1]!.lessons[0]!.body.includes('#### 子标题'), true, 'H4+ sub-headings stay inside the lesson body')
})

test('packToParsedCourse → importCourse: the JSON pack restores the course exactly', () => {
  const { state, courseId } = fixture()
  const course = findCourseForPack(state, courseId)!
  const pack = coursePackOf(course, new Date('2026-09-14T00:00:00Z'))
  const restored = importCourse(emptyState(), packToParsedCourse(pack), 'markdown', packFileName(course), pack.course.languageTarget)
  assert.equal(restored.title, course.title)
  assert.equal(restored.languageTarget, 'en', 'the language axis survives the pack round-trip')
  assert.deepEqual(
    restored.sections.flatMap(s => s.lessons.map(l => [l.title, l.body])),
    course.sections.flatMap(s => s.lessons.map(l => [l.title, l.body])),
    'every lesson title and body restores verbatim',
  )
})

test('packFileName: sanitized title with the pack suffix', () => {
  const { state, courseId } = fixture()
  const course = findCourseForPack(state, courseId)!
  assert.equal(packFileName(course), '导出测试课.lookatstudy-pack.md')
})

test('pack round-trip is idempotent: re-importing the same pack returns the existing course (no duplicates)', () => {
  const { state, courseId } = fixture()
  const course = findCourseForPack(state, courseId)!
  const pack = coursePackOf(course)
  const first = importCourse(emptyState(), packToParsedCourse(pack), 'markdown', packFileName(course))
  const again = importCourse(emptyState(), packToParsedCourse(pack), 'markdown', packFileName(course))
  assert.equal(again.id, first.id, 'same title re-import dedups (issue #5 semantics)')
})

test('a lesson-less course exports a header-only markdown that still round-trips', () => {
  const state = emptyState()
  const parsed = parseMarkdownToCourse('# 空课程标题')
  const course = importCourse(state, parsed, 'markdown', 'fixture')
  const md = coursePackMarkdown(course)
  assert.ok(md.startsWith('# 空课程标题'))
  const back = parseMarkdownToCourse(md)
  assert.equal(back.title, '空课程标题')
  assert.equal(back.sections.length, 0)
})

test('packFileName: an all-special-chars title falls back to the bare suffix', () => {
  const state = emptyState()
  const course = importCourse(state, parseMarkdownToCourse('# ???'), 'markdown', 'f')
  assert.equal(packFileName(course), 'course.lookatstudy-pack.md')
})

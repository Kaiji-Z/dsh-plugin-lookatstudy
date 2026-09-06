/**
 * The artifact channel (P1): sanitization, content-hash idempotency, state
 * recording, and the practice card's pure logic (progress, score, post-quiz
 * exits) — upstream artifacts + canvas_items + post-quiz-actions ports.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { artifactId, contentHash, sanitizeQuiz, stableStringify } from '../src/artifacts.ts'
import { deleteCourse, emptyState, importCourse, recordArtifact } from '../src/state.ts'
import { parseMarkdownToCourse } from '../src/vendor/markdown-course.ts'
import type { StudyArtifact } from '../src/artifacts.ts'

test('stableStringify is key-order independent and round-trips', () => {
  assert.equal(stableStringify({ b: 1, a: { y: [1, 2], x: 's' } }), stableStringify({ a: { x: 's', y: [1, 2] }, b: 1 }))
  assert.equal(stableStringify({ u: undefined, k: 0 }), stableStringify({ k: 0 }), 'undefined values drop')
  assert.notEqual(stableStringify({ a: 1 }), stableStringify({ a: 2 }))
})

test('contentHash is stable and short', () => {
  assert.equal(contentHash('abc'), contentHash('abc'))
  assert.match(contentHash('abc'), /^[0-9a-f]{16}$/)
})

test('sanitizeQuiz passes clean input and collects warnings for junk questions', () => {
  const clean = sanitizeQuiz({ title: '小测', questions: [
    { prompt: '读取是什么？', options: ['读', '写'], answer: 0, explanation: '输入' },
  ] })
  assert.deepEqual(clean.warnings, [])
  assert.deepEqual(clean.data.questions, [{ prompt: '读取是什么？', options: ['读', '写'], answer: 0, explanation: '输入' }])

  const dirty = sanitizeQuiz({ questions: [
    { prompt: 'ok', options: ['a', 'b'], answer: 0, explanation: '' }, // valid: empty explanation allowed
    { prompt: '', options: ['a', 'b'], answer: 0, explanation: '' }, // empty prompt dropped
    { prompt: 'x', options: ['only'], answer: 0, explanation: '' }, // <2 options dropped
    { prompt: 'y', options: ['a', 'b'], answer: 5, explanation: '' }, // answer out of range dropped
  ] })
  assert.equal((dirty.data.questions as unknown[]).length, 1)
  assert.equal(dirty.warnings.length, 3)

  assert.throws(() => sanitizeQuiz({ questions: [{ prompt: '', options: [], answer: 0 }] }),
    /no usable questions/, 'nothing usable fails loud — the card never renders an unjudgeable question')
})

const COURSE_MD = '# 测试课程\n\n## 第一节\n\n### 第一课\n\n正文内容足够长。\n'

test('recordArtifact is idempotent by content hash and purges with the course', () => {
  const state = emptyState()
  const course = importCourse(state, parseMarkdownToCourse(COURSE_MD), 'markdown', 'fixture')
  const lessonId = course.sections[0]!.lessons[0]!.id
  const data = { artifactType: 'quiz', title: '练习', questions: [{ prompt: 'q', options: ['a', 'b'], answer: 0, explanation: 'e' }] }
  const make = (): StudyArtifact => ({
    id: artifactId('quiz', data),
    artifactType: 'quiz',
    title: '练习',
    createdAt: new Date().toISOString(),
    hash: artifactId('quiz', data).slice('quiz-'.length),
    data,
  })
  const first = recordArtifact(state, lessonId, make())
  assert.equal(first.created, true)
  const second = recordArtifact(state, lessonId, make())
  assert.equal(second.created, false, 'same content → the existing row, never a duplicate')
  assert.equal(state.artifacts[lessonId]!.length, 1)
  const other = recordArtifact(state, lessonId, { ...make(), data: { ...data, title: '另一张' }, id: artifactId('quiz', { ...data, title: '另一张' }), hash: artifactId('quiz', { ...data, title: '另一张' }).slice('quiz-'.length) })
  assert.equal(other.created, true, 'different content records separately')
  assert.equal(state.artifacts[lessonId]!.length, 2)

  deleteCourse(state, course.id)
  assert.equal(state.artifacts[lessonId], undefined, 'deleting the course drops its artifacts')

  assert.throws(() => recordArtifact(state, 'nope:0:0', make()), /unknown (course|lesson) id/, 'artifacts anchor to real lessons')
})

test('fresh state carries an empty artifact map (additive field, no version bump)', () => {
  assert.deepEqual(emptyState().artifacts, {})
})

test('getPostQuizActions: never fewer than two exits, mastery-gated', async () => {
  const { getPostQuizActions } = await import('../src/client/quizcard.tsx')
  // wrong answers → patch the hole first
  assert.deepEqual(getPostQuizActions({ correct: 2, total: 4 }, null).map(a => a.id), ['explain-wrong', 'retry'])
  // perfect + unknown mastery → deepen, no mastery exit (avoid false positives)
  assert.deepEqual(getPostQuizActions({ correct: 4, total: 4 }, null).map(a => a.id), ['go-deeper', 'retry'])
  // perfect + near (0.85) → mastery exit offered
  const near = getPostQuizActions({ correct: 4, total: 4 }, 0.86)
  assert.deepEqual(near.map(a => a.id), ['mark-mastered', 'go-deeper'])
  assert.equal(near[0]!.advancesMastery, true)
  // perfect + graduated (0.9+) → move on
  assert.deepEqual(getPostQuizActions({ correct: 4, total: 4 }, 0.93).map(a => a.id), ['next-topic', 'go-deeper'])
  // degenerate empty card still yields two safe exits
  assert.equal(getPostQuizActions({ correct: 0, total: 0 }, null).length, 2)
})

test('quiz progress persists and scores over recorded answers', async () => {
  const { quizProgressKey, loadQuizProgress, saveQuizProgress, quizScore } = await import('../src/client/quizcard.tsx')
  const data = { questions: [
    { prompt: 'a', options: ['x', 'y'], answer: 0, explanation: '' },
    { prompt: 'b', options: ['x', 'y'], answer: 1, explanation: '' },
  ] }
  const store = new Map<string, string>()
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) } }
  const key = quizProgressKey('c:0:0', 'quiz-abc')
  assert.match(key, /^dsh-plugin-lookatstudy:quiz:c:0:0:quiz-abc$/)
  let progress = loadQuizProgress('c:0:0', 'quiz-abc', 2, storage)
  assert.deepEqual(progress, { answers: [-1, -1], done: false }, 'no stored progress starts blank')
  progress = { answers: [0, -1], done: false }
  saveQuizProgress('c:0:0', 'quiz-abc', progress, storage)
  assert.deepEqual(loadQuizProgress('c:0:0', 'quiz-abc', 2, storage).answers, [0, -1], 'progress survives a reload')
  assert.deepEqual(loadQuizProgress('c:0:0', 'quiz-abc', 2, storage).done, false)
  // junk storage degrades to a blank card, never throws
  store.set(key, '{not json')
  assert.deepEqual(loadQuizProgress('c:0:0', 'quiz-abc', 2, storage).answers, [-1, -1])
  assert.deepEqual(quizScore(data, [0, 1]), { correct: 2, total: 2 })
  assert.deepEqual(quizScore(data, [1, -1]), { correct: 0, total: 1 }, 'unanswered questions do not count')
})

test('the four artifact sanitizers validate their shapes and fail loud', async () => {
  const { sanitizeGuess, sanitizeCompareTable, sanitizeDiagram, sanitizeCodeWalkthrough } = await import('../src/artifacts.ts')
  // guess: exactly 2 labeled options; junk labels dropped
  assert.deepEqual(sanitizeGuess({ prompt: '哪个快？', options: [{ id: 'a', label: '递归' }, { id: 'b', label: '循环' }] }).data.options, [
    { id: 'a', label: '递归' }, { id: 'b', label: '循环' },
  ])
  assert.throws(() => sanitizeGuess({ prompt: 'x', options: [{ id: 'a', label: 'only' }] }), /exactly 2 options/)
  assert.throws(() => sanitizeGuess({ options: [] }), /needs a prompt/)
  // compare_table: rows must match header width
  const table = sanitizeCompareTable({ title: '读 vs 写', headers: ['维度', '读', '写'], rows: [['方向', '输入', '输出'], ['两列', '只有']] })
  assert.equal((table.data.rows as unknown[]).length, 1)
  assert.equal(table.warnings.length, 1, 'the 2-cell row was dropped with a warning')
  assert.throws(() => sanitizeCompareTable({ headers: ['只有一列'], rows: [['x']] }), /at least 2 headers/)
  // diagram: type coerced to the safe default, code required
  assert.equal(sanitizeDiagram({ title: 't', diagramType: 'weird', mermaid: 'flowchart TD' }).data.diagramType, 'flowchart')
  assert.throws(() => sanitizeDiagram({ title: 't' }), /needs mermaid code/)
  // code_walkthrough: annotations must reference real lines
  const walk = sanitizeCodeWalkthrough({ title: 'w', language: 'python', code: 'a = 1' + String.fromCharCode(10) + 'b = 2', annotations: [
    { lineStart: 1, lineEnd: 2, note: '赋值' },
    { lineStart: 5, lineEnd: 9, note: '越界' },
  ] })
  assert.equal((walk.data.annotations as unknown[]).length, 1)
  assert.equal(walk.warnings.length, 1)
  assert.throws(() => sanitizeCodeWalkthrough({ code: 'x', annotations: [{ lineStart: 0, lineEnd: 0, note: 'n' }] }), /no usable annotations/)
})

test('seen-artifact tracking: unseen computed purely, marking is idempotent', async () => {
  const { unseenArtifacts, markArtifactsSeen, seenArtifactsKey } = await import('../src/client/artifact-cards.tsx')
  const store = new Map<string, string>()
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) } }
  const arts = [
    { id: 'compare_table-1', artifactType: 'compare_table', title: 't', data: {} },
    { id: 'diagram-2', artifactType: 'diagram', title: 't', data: {} },
  ]
  assert.deepEqual(unseenArtifacts('c:0:0', arts, storage), ['compare_table-1', 'diagram-2'])
  markArtifactsSeen('c:0:0', ['compare_table-1'], storage)
  assert.deepEqual(unseenArtifacts('c:0:0', arts, storage), ['diagram-2'])
  markArtifactsSeen('c:0:0', ['compare_table-1'], storage)
  const stored = JSON.parse(store.get(seenArtifactsKey('c:0:0')) ?? '[]') as string[]
  assert.equal(stored.length, 1, 're-marking never duplicates')
  store.set(seenArtifactsKey('c:0:0'), '{junk')
  assert.deepEqual(unseenArtifacts('c:0:0', arts, storage), arts.map(a => a.id), 'junk storage degrades to all-unseen')
})

/**
 * Vendored-engine fidelity: SM-2 sequence, BKT mastery updates, markdown
 * course parsing. These pin the vendored algorithms' observable behavior.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { computeSm2 } from '../src/vendor/sm2.ts'
import { masteryToCrown, updateMastery } from '../src/vendor/bkt.ts'
import { detectLabType, parseMarkdownToCourse, titleToAnchor } from '../src/vendor/markdown-course.ts'

const NOW = new Date('2026-08-14T10:00:00Z')
const DAY = 86_400_000

test('sm2 advances 1d → 6d → interval×ease', () => {
  let state = { easeFactor: 2.5, intervalDays: 0, repetitions: 0 }
  const first = computeSm2(state, 4, NOW)
  assert.equal(first.intervalDays, 1)
  assert.equal(first.repetitions, 1)

  const second = computeSm2({ easeFactor: first.easeFactor, intervalDays: first.intervalDays, repetitions: first.repetitions }, 4, new Date(NOW.getTime() + DAY))
  assert.equal(second.intervalDays, 6)
  assert.equal(second.repetitions, 2)

  const third = computeSm2({ easeFactor: second.easeFactor, intervalDays: second.intervalDays, repetitions: second.repetitions }, 5, new Date(NOW.getTime() + 7 * DAY))
  assert.equal(third.repetitions, 3)
  assert.equal(third.intervalDays, Math.round(6 * second.easeFactor))
})

test('sm2 resets on a wrong answer', () => {
  const state = { easeFactor: 2.5, intervalDays: 6, repetitions: 2 }
  const result = computeSm2(state, 1, NOW)
  assert.equal(result.repetitions, 0)
  assert.equal(result.intervalDays, 1)
})

test('bkt raises mastery on correct answers and lowers it on wrong ones', () => {
  let mastery: number | null = null
  mastery = updateMastery(mastery, true)
  const afterFirst = mastery
  mastery = updateMastery(mastery, true)
  assert.ok(mastery > afterFirst)
  const beforeWrong = mastery
  mastery = updateMastery(mastery, false)
  assert.ok(mastery < beforeWrong)
})

test('crown maps mastery bands', () => {
  assert.equal(masteryToCrown(null), 0)
  assert.equal(masteryToCrown(0.2), 1)
  assert.equal(masteryToCrown(0.45), 2)
  assert.equal(masteryToCrown(0.65), 3)
  assert.equal(masteryToCrown(0.85), 4)
  assert.equal(masteryToCrown(0.95), 5)
})

test('markdown parses into H1/H2/H3 course tree and guards code fences', () => {
  const md = [
    '# My Course',
    'intro text',
    '## Section One',
    '### Lesson A',
    'body of A',
    '```bash',
    '### not a lesson',
    '```',
    '### Lesson B',
    'body of B',
    '## Section Two',
    '### Lesson C',
    'body of C',
  ].join('\n')
  const course = parseMarkdownToCourse(md)
  assert.equal(course.title, 'My Course')
  assert.equal(course.sections.length, 2)
  assert.deepEqual(
    course.sections.map(s => [s.title, s.lessons.map(l => l.title)]),
    [['Section One', ['Lesson A', 'Lesson B']], ['Section Two', ['Lesson C']]],
  )
  assert.ok(course.sections[0]!.lessons[0]!.body.startsWith('body of A'))
  assert.ok(course.sections[0]!.lessons[0]!.body.includes('### not a lesson'))
  assert.equal(detectLabType(md), 'doc')
})

test('github-style anchors keep unicode and per-space dashes', () => {
  assert.equal(titleToAnchor('Hello World'), 'hello-world')
  assert.equal(titleToAnchor('中文 标题'), '中文-标题')
})

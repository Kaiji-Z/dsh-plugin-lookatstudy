/**
 * The course-design stage of GitHub import, offline: anchor-slicing
 * semantics (the upstream verify-section-extract rules), design validation
 * (anti-hallucination + coercion), brief rendering, and the
 * validated-design → ParsedCourse assembly.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCourseFromDesign,
  buildPendingDesign,
  extractHeadings,
  findTitleIndex,
  renderDesignBrief,
  sliceLessonBody,
  validateDesign,
} from '../src/import-design.ts'
import { importCourse, emptyState } from '../src/state.ts'
import type { RepoInventory } from '../src/vendor/repo-fetcher.ts'

const FILE = [
  '# Lesson File',
  'preface prose',
  '## Setup',
  'setup body',
  '### Sub detail',
  'sub body',
  '## Deep',
  'deep body',
  '## Quiz',
  'quiz body',
  '',
  '```',
  '## Not A Heading',
  '```',
].join('\n')

test('extractHeadings skips code fences and records levels/lines', () => {
  const headings = extractHeadings(FILE)
  assert.deepEqual(headings.map(h => h.title), ['Setup', 'Sub detail', 'Deep', 'Quiz'])
  assert.deepEqual(headings.map(h => h.level), [2, 3, 2, 2])
})

test('findTitleIndex matches bidirectionally, ignoring case and leading #s', () => {
  const headings = extractHeadings(FILE)
  assert.equal(findTitleIndex(headings, '## Setup'), 0)
  assert.equal(findTitleIndex(headings, 'setup'), 0)
  assert.equal(findTitleIndex(headings, 'Sub detail'), 1)
  assert.equal(findTitleIndex(headings, 'nonexistent heading'), -1)
  assert.equal(findTitleIndex(headings, '##   '), -1, 'a blank anchor matches nothing')
})

test('slicing: the file\'s first lesson absorbs the header, preface, and leading attached content', () => {
  const headings = extractHeadings(FILE)
  const body = sliceLessonBody(FILE, headings, findTitleIndex(headings, '## Setup'), true)
  assert.ok(body.includes('# Lesson File'), 'starts at line 0: the H1 rides along')
  assert.ok(body.includes('preface prose'))
  assert.ok(body.includes('setup body'))
  assert.ok(body.includes('sub body'), 'an H2 anchor swallows its H3 subsections')
  assert.ok(!body.includes('deep body'), 'stops at the next same-level heading')
})

test('slicing: a later H2 lesson starts at its own heading and stops at the next sibling', () => {
  const headings = extractHeadings(FILE)
  const body = sliceLessonBody(FILE, headings, findTitleIndex(headings, '## Deep'), false)
  assert.ok(body.includes('deep body'))
  assert.ok(!body.includes('# Lesson File'))
  assert.ok(!body.includes('setup body'))
  assert.ok(!body.includes('quiz body'), 'a trailing sibling (attached quiz) terminates the slice')
})

test('slicing: an H3 anchor stops at the very next heading; misses and -1 degrade to the whole file', () => {
  const headings = extractHeadings(FILE)
  const sub = sliceLessonBody(FILE, headings, findTitleIndex(headings, 'Sub detail'), false)
  assert.ok(sub.includes('sub body'))
  assert.ok(!sub.includes('setup body'))
  const missed = sliceLessonBody(FILE, headings, -1, false)
  assert.ok(missed.includes('quiz body') && missed.includes('# Lesson File'), 'anchor miss degrades to the whole file')
})

test('validateDesign: drops hallucinated files, coerces worlds, defaults titles, drops empty sections', () => {
  const valid = new Set(['lessons/a.md', 'lessons/b.md'])
  const validated = validateDesign({
    sections: [
      {
        title: '  ',
        lessons: [
          { title: 'A', file: 'lessons/a.md', anchor: '## Setup' },
          { title: '', file: 'lessons/b.md', world: 'PRactice' },
          { title: 'ghost', file: 'made/up/path.md' },
        ],
      },
      { title: 'Only ghosts', lessons: [{ title: 'x', file: 'nope.md' }] },
    ],
  }, valid)
  assert.equal(validated.droppedLessons, 2)
  assert.equal(validated.sections.length, 1, 'the all-hallucination section is dropped')
  const [section] = validated.sections!
  assert.equal(section!.title, 'Untitled section', 'blank section titles get a fallback')
  assert.equal(section!.lessons[0]!.anchor, '## Setup')
  assert.equal(section!.lessons[0]!.world, 'study')
  assert.equal(section!.lessons[1]!.title, 'Untitled lesson')
  assert.equal(section!.lessons[1]!.world, 'study', 'only exactly "practice" is practice — anything else coerces to study')
  assert.throws(() => validateDesign({ sections: [{ title: 's', lessons: [{ title: 'x', file: 'nope.md' }] }] }, valid), /0 usable lessons/)
})

test('buildCourseFromDesign assembles a course the state layer accepts with kinds and exams right', () => {
  const fileA = FILE
  const fileB = '# Lab File\n\nlab body\n'
  const validated = validateDesign({
    sections: [
      {
        title: 'Part One',
        lessons: [
          { title: 'A intro', file: 'a.md', anchor: '## Setup' },
          { title: 'A deep', file: 'a.md', anchor: '## Deep' },
        ],
      },
      { title: 'Labs', lessons: [{ title: 'B lab', file: 'b.md', world: 'practice' }] },
    ],
  }, new Set(['a.md', 'b.md']))
  const parsed = buildCourseFromDesign('Designed Course', validated, new Map([['a.md', fileA], ['b.md', fileB]]))
  assert.equal(parsed.sections.length, 2)
  assert.equal(parsed.sections[0]!.world, 'study')
  assert.equal(parsed.sections[1]!.world, 'practice', 'an all-practice section is marked so no exam node is injected')
  const [intro, deep] = parsed.sections[0]!.lessons
  assert.ok(intro!.body.includes('preface prose'), 'the first designed lesson of a file absorbs its header')
  assert.ok(deep!.body.includes('deep body') && !deep!.body.includes('setup body'))
  assert.equal(intro!.world, 'study')
  assert.equal(parsed.sections[1]!.lessons[0]!.world, 'practice')

  const state = emptyState()
  const course = importCourse(state, parsed, 'github', 'https://github.com/o/r')
  assert.equal(course.id, 'designed-course')
  const kinds = course.sections.flatMap(s => s.lessons).map(l => l.kind)
  assert.deepEqual(kinds, ['study', 'study', 'exam', 'practice'], 'exam injected for the study section only')
})

test('buildPendingDesign derives title, role hints, and README excerpt from the inventory', () => {
  const inventory = {
    readmeMd: '# Repo Course\n\n- [A](lessons/a.md)\n- [B](lessons/b.ipynb)\n',
    fileList: [
      { path: 'lessons/a.md', title: 'A', kind: 'md' },
      { path: 'lessons/b.ipynb', title: 'B', kind: 'ipynb' },
    ],
    fullTree: ['lessons/a.md', 'lessons/b.ipynb', 'images/x.png'],
    branch: 'main',
  } as unknown as RepoInventory
  const outlines = new Map([
    ['lessons/a.md', { h1: 'A', totalChars: 100, headings: [{ level: 2, title: 'Setup', chars: 60 }] }],
    ['lessons/b.ipynb', { h1: 'B', totalChars: 200, headings: [] }],
  ])
  const pending = buildPendingDesign('https://github.com/o/r', 'o', 'r', inventory, outlines)
  assert.equal(pending.courseTitle, 'Repo Course')
  assert.equal(pending.files.length, 2)
  assert.deepEqual(pending.files.map(f => f.role), ['original', 'practice'], 'ipynb carries the practice hint')
  assert.equal(pending.fullTreeCount, 3)

  const brief = renderDesignBrief(pending)
  assert.ok(brief.includes('3000-8000'), 'the pacing rule rides the brief')
  assert.ok(brief.includes('study_apply_design'), 'the JSON contract names the apply tool')
  assert.ok(brief.includes('lessons/b.ipynb'), 'file paths appear verbatim')
  assert.ok(brief.includes('## Setup [60]'), 'per-heading char counts appear')
  assert.ok(brief.includes('# Repo Course'), 'the README excerpt rides the brief')
})

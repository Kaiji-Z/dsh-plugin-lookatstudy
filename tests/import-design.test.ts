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
  // upstream v0.33 language-course axis: the brief tells the tutor to decide
  assert.ok(brief.includes('Language-course check'), 'the judgment instruction rides the brief')
  assert.ok(brief.includes('writing language is NOT the taught language'), 'the tell-vs-carrier distinction is explicit')
  assert.ok(brief.includes('"languageTarget"'), 'the apply JSON shape names the field')
})

// ——— 0.23.1 issue 5: the pacing gate ———
// The brief has carried the 3000-8000 pacing rules since the beginning, but
// nothing ENFORCED them on the applied design (a flash-tier tutor 1:1
// file→lesson shipped 45k-char lessons from generative-ai-for-beginners).
// buildCourseFromDesign now measures every sliced body: over the cap with
// splittable in-span headings → loud, actionable rejection the tutor can fix
// conversationally; monoliths without sub-headings stay accepted (upstream's
// "accept one long lesson").

const pacingLong = (n: number) => Array.from({ length: n }, (_, i) => `explanatory prose line ${i} — padded so each block crosses a pacing threshold for the gate`).join('\n')
const BIG_FILE = ['# Generated Course', '## Warmup', pacingLong(50), '## Core', pacingLong(80), '### Part One', pacingLong(80), '### Part Two', pacingLong(80)].join('\n')

test('pacing gate: an over-long whole-file lesson with H2/H3 structure is rejected with split guidance', () => {
  const validated = validateDesign({
    sections: [{ title: 'S', lessons: [{ title: 'Big File wholesale', file: 'big.md' }] }],
  }, new Set(['big.md']))
  assert.throws(
    () => buildCourseFromDesign('Big', validated, new Map([['big.md', BIG_FILE]])),
    (err: Error) => err.message.includes('8000') && err.message.includes('anchor') && err.message.includes('big.md'),
    'the rejection names the cap, the split remedy (anchors), and the offending file',
  )
})

test('pacing gate: an over-long H2 lesson with H3 children is rejected (the upstream per-H3 split rule)', () => {
  const validated = validateDesign({
    sections: [{ title: 'S', lessons: [{ title: 'Core in one bite', file: 'big.md', anchor: '## Core' }] }],
  }, new Set(['big.md']))
  assert.throws(() => buildCourseFromDesign('Big', validated, new Map([['big.md', BIG_FILE]])), /8000/)
})

test('pacing gate: properly split designs and heading-less monoliths pass untouched', () => {
  const split = validateDesign({
    sections: [{
      title: 'S',
      lessons: [
        { title: 'Warmup', file: 'big.md', anchor: '## Warmup' },
        { title: 'Part One', file: 'big.md', anchor: '### Part One' },
        { title: 'Part Two', file: 'big.md', anchor: '### Part Two' },
      ],
    }],
  }, new Set(['big.md']))
  const parsed = buildCourseFromDesign('Big', split, new Map([['big.md', BIG_FILE]]))
  for (const lesson of parsed.sections[0]!.lessons) {
    assert.ok(lesson.body.length < 8000, `the split lesson 「${lesson.title}」 lands under the cap (${lesson.body.length} chars)`)
  }
  const monolith = validateDesign({
    sections: [{ title: 'S', lessons: [{ title: 'Monolith', file: 'mono.md' }] }],
  }, new Set(['mono.md']))
  const parsedMono = buildCourseFromDesign('Mono', monolith, new Map([['mono.md', `# Mono\n${pacingLong(160)}`]]))
  assert.ok(parsedMono.sections[0]!.lessons[0]!.body.length > 8000, 'the heading-less monolith rode through at full length (upstream: accept one long lesson)')
})

test('pacing gate: coarse-mode briefs (>80 files) keep the over-8000 anchor-split rule alive', () => {
  const files = Array.from({ length: 85 }, (_, i) => ({
    path: `lessons/${i}/README.md`,
    role: 'original' as const,
    outline: { h1: `Lesson ${i}`, totalChars: 5000, headings: [{ level: 2, title: 'Body', chars: 4000 }] },
  }))
  const brief = renderDesignBrief({
    source: 'github', url: 'https://github.com/o/r', owner: 'o', repo: 'r', branch: 'main',
    courseTitle: 'Coarse Repo', readmeExcerpt: 'readme', fullTreeCount: 200, files,
  })
  const coarseLine = brief.split('\n').find(l => l.includes('This part is large')) ?? ''
  assert.notEqual(coarseLine, '', 'the coarse-mode line is present at >80 files')
  assert.ok(coarseLine.includes('8000'), 'the coarse-mode instruction still requires anchor splitting for over-8000-char files')
})

// ——— 0.24.0: interface-language → translation matching ———

test('matchTranslationLang: exact first, then base-prefix (zh-CN ↔ zh-cn), never a wrong family', async () => {
  const { matchTranslationLang } = await import('../src/import-design.ts')
  const available = [
    { code: 'zh-cn', name: '中文（简体）' },
    { code: 'en', name: 'English' },
    { code: 'pt-br', name: 'Português (Brasil)' },
  ]
  assert.deepEqual(matchTranslationLang('zh-CN', available), { code: 'zh-cn', name: '中文（简体）' }, 'host zh-CN matches the zh-cn mirror family')
  assert.deepEqual(matchTranslationLang('zh', available), { code: 'zh-cn', name: '中文（简体）' }, 'bare zh matches by base too')
  assert.deepEqual(matchTranslationLang('en-US', available), { code: 'en', name: 'English' }, 'en-US falls back to the en base')
  assert.deepEqual(matchTranslationLang('pt-PT', available), { code: 'pt-br', name: 'Português (Brasil)' }, 'pt-PT still finds the pt family')
  assert.equal(matchTranslationLang('ja', available), null, 'no family → no translation, original behavior')
  assert.equal(matchTranslationLang(undefined, available), null, 'no interface lang recorded → feature off')
  assert.equal(matchTranslationLang('zh-CN', []), null, 'no translations in the repo → off')
})

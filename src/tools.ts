/**
 * The `study_*` tool surface, ported from LookatStudy's agent contract:
 * import (markdown / folder / GitHub), course map, lesson content with
 * concepts/starters/memory, KC-attributed answer recording with
 * mastery-driven progression, spaced reviews, mastery proposals, friction
 * logging, learner memory, Cornell notes, and soul switching. All state
 * mutations persist synchronously through the shared store.
 * @module dsh-plugin-lookatstudy/tools
 */

import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { parseMarkdownToCourse } from './vendor/markdown-course.ts'
import type { ParsedCourse } from './vendor/markdown-course.ts'
import { scanFolder } from './vendor/local-folder-scanner.ts'
import { buildCourseFromFiles, importRepoToParsedCourse } from './vendor/repo-fetcher.ts'
import type { FetchedFile } from './vendor/repo-fetcher.ts'
import type { ReviewQuality } from './vendor/sm2.ts'
import { masteryToCrown } from './vendor/bkt.ts'
import * as cards from './cards.ts'
import {
  NEAR_MASTERED_THRESHOLD,
  addFriction,
  addNote,
  attemptLesson,
  completeLesson,
  conceptViews,
  courseSummaries,
  deleteCourse,
  dueReviews,
  findCourse,
  findLesson,
  importCourse,
  nextLesson,
  proposeMastery,
  recordAnswer,
  recordReview,
  resolveProposal,
  setMemory,
  starterPrompts,
  defineConcepts as defineConceptsState,
  strategyBand,
  type CourseState,
  type LearningState,
  type LessonRef,
} from './state.ts'

/** State access handed in by `apply`; every mutation persists via {@link StudyStore.save}. */
export interface StudyStore {
  /** Live learning state. */
  get(): LearningState
  /** Persist the current state to disk. */
  save(): void
}

/** SM-2 quality grades, shared by the parameter enum and the state layer. */
const QUALITIES = [0, 1, 2, 3, 4, 5] as const
const LESSON_STATUSES = ['locked', 'available', 'in_progress', 'mastered'] as const
const LESSON_KINDS = ['study', 'practice', 'exam'] as const
const FRICTION_CATEGORIES = ['confused', 'blocked', 'frustrated'] as const
const MEMORY_CATEGORIES = ['global', 'pattern', 'lesson'] as const
const NOTE_ZONES = ['understand', 'record', 'practice'] as const
const NOTE_SOURCES = ['ai', 'content', 'chat'] as const
const MODES = ['direct', 'guide', 'practice'] as const

const nullableInteger = { oneOf: [{ type: 'integer' as const }, { type: 'null' as const }] }
const nullableString = { oneOf: [{ type: 'string' as const }, { type: 'null' as const }] }

/**
 * Fail loud when an importer produced no lessons — a course with an empty
 * path is useless and hides upstream parsing problems. Runs before any state
 * mutation so a failed import leaves persisted state untouched.
 * @param parsed - parsed course about to be imported.
 */
function requireParsedLessons(parsed: ParsedCourse): void {
  const count = parsed.sections.reduce((n, s) => n + s.lessons.length, 0)
  if (count === 0) {
    throw new Error(
      'lookatstudy-plugin: import produced 0 lessons — the source needs ## sections containing ### lessons, or lesson-like files in a folder',
    )
  }
}

/** Canonical value shared by the three import tools. */
function toImportValue(course: CourseState): cards.ImportValue {
  const lessons = course.sections.flatMap(s => s.lessons)
  const first = lessons.find(l => l.status === 'available') ?? lessons[0]!
  return {
    courseId: course.id,
    title: course.title,
    sections: course.sections.length,
    lessons: lessons.length,
    firstLessonId: first.id,
    firstLessonTitle: first.title,
  }
}

/** Canonical value of `study_map`. */
function toMapValue(course: CourseState): cards.MapValue {
  const lessons = course.sections.flatMap(s => s.lessons)
  return {
    courseId: course.id,
    title: course.title,
    counts: {
      total: lessons.length,
      mastered: lessons.filter(l => l.status === 'mastered').length,
      available: lessons.filter(l => l.status === 'available').length,
    },
    tree: course.sections.map(section => ({
      title: section.title,
      lessons: section.lessons.map(lesson => ({
        id: lesson.id,
        title: lesson.title,
        kind: lesson.kind,
        status: lesson.status,
        masteryPct: lesson.mastery === null ? null : Math.round(lesson.mastery * 100),
        crown: masteryToCrown(lesson.mastery),
        weakConcepts: (conceptViews(lesson) ?? []).filter(c => c.weak).length,
        frictionCount: lesson.friction.length,
      })),
    })),
  }
}

/** Canonical value of `study_lesson`. */
function toLessonValue(ref: LessonRef, state: LearningState) {
  const next = nextLesson(ref.course, ref.lesson.id)
  const pending = state.proposals.find(p => p.lessonId === ref.lesson.id && p.status === 'pending')
  return {
    lessonId: ref.lesson.id,
    courseId: ref.course.id,
    courseTitle: ref.course.title,
    sectionTitle: ref.section.title,
    title: ref.lesson.title,
    kind: ref.lesson.kind,
    status: ref.lesson.status,
    body: ref.lesson.body,
    masteryPct: ref.lesson.mastery === null ? null : Math.round(ref.lesson.mastery * 100),
    crown: masteryToCrown(ref.lesson.mastery),
    attempts: ref.lesson.attempts,
    correctCount: ref.lesson.correctCount,
    strategy: strategyBand(ref.lesson.mastery),
    concepts: conceptViews(ref.lesson),
    starters: starterPrompts(ref.lesson.title),
    memory: {
      lesson: ref.lesson.memory,
      global: state.memoryGlobal,
      pattern: state.memoryPatterns[ref.course.id] ?? null,
    },
    noteCount: ref.lesson.notes.length,
    pendingProposal: pending === undefined ? null : { id: pending.id, rationale: pending.rationale },
    nextLessonId: next?.id ?? null,
  }
}

/**
 * Parse a GitHub repository URL into owner/repo.
 * @param url - `https://github.com/<owner>/<repo>` (`.git` suffix and subpaths tolerated).
 * @returns owner and repo.
 */
function parseGithubUrl(url: string): { owner: string; repo: string } {
  const match = url.match(/^(?:https?:\/\/)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:[/?#].*)?$/)
  if (!match) {
    throw new Error(`lookatstudy-plugin: not a GitHub repository URL: ${JSON.stringify(url)} (expected https://github.com/<owner>/<repo>)`)
  }
  return { owner: match[1]!, repo: match[2]! }
}

/** Wrap `fetch` so cancellation of the tool call aborts in-flight repo fetches. */
function signalFetch(signal: AbortSignal): typeof fetch {
  return (input, init) => fetch(input, { ...init, signal })
}

/** Total over a missing `meta` (events logged before a presentationMeta existed): renders nothing instead of throwing into the presenter fallback. */
const textBlocks = (lines: readonly string[] | undefined | null): Array<{ type: 'text'; text: string }> => (lines ?? []).map(text => ({ type: 'text', text }) as const)

/**
 * Build the full study tool set over one store.
 * @param store - state store owned by `apply`.
 * @returns tool definitions ready for `ctx.tools.register`.
 */
export function studyTools(store: StudyStore): ToolDefinition[] {
  /** Run a mutating state operation and persist. */
  const mutate = <T>(fn: (state: LearningState) => T): T => {
    const result = fn(store.get())
    store.save()
    return result
  }

  const importOutput = {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        courseId: { type: 'string', required: true },
        title: { type: 'string', required: true },
        sections: { type: 'integer', required: true },
        lessons: { type: 'integer', required: true },
        firstLessonId: { type: 'string', required: true },
        firstLessonTitle: { type: 'string', required: true },
      },
    },
  }
  const importPresent = {
    presentationMeta: (_args: unknown, value: cards.ImportValue) => cards.importLines(value),
    presentResult: (_args: unknown, result: { meta: unknown }) => ({
      card: 'generic',
      content: textBlocks(result.meta as string[]),
    }),
  }

  const importMarkdown = defineTool({
    name: 'study_import_markdown',
    description:
      'Import pasted markdown as a structured course: H2 (##) becomes a section, H3 (###) a lesson. '
      + 'Use for notes, single long documents, or content fetched by other means.',
    parameters: {
      markdown: { type: 'string', required: true, description: 'The full markdown source of the course.' },
      title: { type: 'string', description: 'Optional course title overriding the first H1.' },
    },
    output: {
      ...importOutput,
      render: (_args, value) => [{
        type: 'text',
        text: `Imported course “${value.title}” (${value.sections} sections, ${value.lessons} lessons). `
          + `First lesson: “${value.firstLessonTitle}” (id ${value.firstLessonId}).`,
      }],
    },
    async execute(args) {
      const parsed = parseMarkdownToCourse(args.markdown)
      if (args.title !== undefined) parsed.title = args.title
      requireParsedLessons(parsed)
      return mutate(state => toImportValue(importCourse(state, parsed, 'markdown', 'pasted markdown')))
    },
    presentCall: args => ({ card: 'generic', title: `Import markdown course${args.title === undefined ? '' : `: ${args.title}`}`, kind: 'read' }),
    ...importPresent,
  })

  const importFolder = defineTool({
    name: 'study_import_folder',
    description:
      'Import a local folder as a course: markdown, txt, html, Jupyter notebooks, rst/Rmd/org/adoc, '
      + 'and 30+ code file types become lessons grouped into sections by directory (code is teaching material too). '
      + 'PDF/PPTX are not supported in this edition.',
    parameters: {
      path: { type: 'string', required: true, description: 'Absolute path of the folder to scan.' },
      title: { type: 'string', description: 'Optional course title overriding the folder name.' },
    },
    output: {
      ...importOutput,
      render: (_args, value) => [{
        type: 'text',
        text: `Imported folder course “${value.title}” (${value.sections} sections, ${value.lessons} lessons). `
          + `First lesson: “${value.firstLessonTitle}” (id ${value.firstLessonId}).`,
      }],
    },
    async execute(args) {
      if (!existsSync(args.path)) {
        throw new Error(`lookatstudy-plugin: folder does not exist: ${args.path}`)
      }
      const docs = await scanFolder(args.path)
      const files: FetchedFile[] = docs.map(doc => ({ path: doc.path, title: doc.title, md: doc.content }))
      const title = args.title ?? basename(args.path.replaceAll('\\', '/'))
      const parsed = buildCourseFromFiles(title, files)
      requireParsedLessons(parsed)
      return mutate(state => toImportValue(importCourse(state, parsed, 'folder', args.path)))
    },
    timeoutMs: 60_000,
    presentCall: args => ({ card: 'generic', title: `Scan folder: ${args.path}`, kind: 'read', rawInput: args.path }),
    ...importPresent,
  })

  const importGithub = defineTool({
    name: 'study_import_github',
    description:
      'Import a GitHub learning repository as a course. Discovery follows the README outline, files are '
      + 'fetched through the jsDelivr CDN (works where github.com is unreachable). Best for curated '
      + 'curricula (e.g. microsoft/AI-For-Beginners); awesome-lists are rejected.',
    parameters: {
      url: { type: 'string', required: true, description: 'Repository URL, e.g. https://github.com/microsoft/AI-For-Beginners.' },
      branch: { type: 'string', description: 'Branch to read (main tried, then master); defaults to main.' },
    },
    output: {
      ...importOutput,
      render: (_args, value) => [{
        type: 'text',
        text: `Imported GitHub course “${value.title}” (${value.sections} sections, ${value.lessons} lessons). `
          + `First lesson: “${value.firstLessonTitle}” (id ${value.firstLessonId}).`,
      }],
    },
    async execute(args, exec) {
      const { owner, repo } = parseGithubUrl(args.url)
      const branch = args.branch ?? 'main'
      const result = await importRepoToParsedCourse(owner, repo, branch, signalFetch(exec.signal))
      requireParsedLessons(result.course)
      return mutate(state => toImportValue(importCourse(state, result.course, 'github', args.url)))
    },
    timeoutMs: 180_000,
    presentCall: args => ({ card: 'generic', title: `Import GitHub course: ${args.url}`, kind: 'fetch' }),
    ...importPresent,
  })

  const listCourses = defineTool({
    name: 'study_courses',
    description: 'List imported courses with progress, average mastery, due reviews, and the current lesson id.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          total: { type: 'integer', required: true },
          courses: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                courseId: { type: 'string', required: true },
                title: { type: 'string', required: true },
                source: { type: 'string', required: true, enum: ['markdown', 'folder', 'github'] },
                total: { type: 'integer', required: true },
                mastered: { type: 'integer', required: true },
                avgMasteryPct: { ...nullableInteger, required: true },
                dueCount: { type: 'integer', required: true },
                currentLessonId: { ...nullableString, required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.courses.length === 0
          ? 'No courses imported yet. Import one with study_import_markdown, study_import_folder, or study_import_github.'
          : value.courses.map(c =>
              `“${c.title}” (${c.source}) — ${c.mastered}/${c.total} lessons mastered`
              + `${c.avgMasteryPct === null ? '' : `, avg mastery ${c.avgMasteryPct}%`}`
              + `${c.dueCount === 0 ? '' : `, ${c.dueCount} reviews due`}`
              + `${c.currentLessonId === null ? '' : `, current lesson ${c.currentLessonId}`}`,
            ).join('\n'),
      }],
    },
    async execute() {
      const summaries = courseSummaries(store.get(), new Date())
      return {
        total: summaries.length,
        courses: summaries.map(s => ({
          courseId: s.courseId,
          title: s.title,
          source: s.source,
          total: s.total,
          mastered: s.mastered,
          avgMasteryPct: s.avgMasteryPct,
          dueCount: s.dueCount,
          currentLessonId: s.currentLessonId,
        })),
      }
    },
    isConcurrencySafe: () => true,
    presentCall: () => ({ card: 'generic', title: 'List courses', kind: 'read' }),
  })

  const courseMap = defineTool({
    name: 'study_map',
    description:
      'Show one course\'s skill tree: sections, lessons with locked/available/in_progress/mastered status, mastery, '
      + 'weak-concept count (⚡), and friction count — the weak spots to target.',
    parameters: {
      courseId: { type: 'string', required: true, description: 'Course id from an import result or study_courses.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          courseId: { type: 'string', required: true },
          title: { type: 'string', required: true },
          counts: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              total: { type: 'integer', required: true },
              mastered: { type: 'integer', required: true },
              available: { type: 'integer', required: true },
            },
          },
          tree: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                title: { type: 'string', required: true },
                lessons: {
                  type: 'array',
                  required: true,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      id: { type: 'string', required: true },
                      title: { type: 'string', required: true },
                      kind: { type: 'string', required: true, enum: [...LESSON_KINDS] },
                      status: { type: 'string', required: true, enum: [...LESSON_STATUSES] },
                      masteryPct: { ...nullableInteger, required: true },
                      crown: { type: 'integer', required: true },
                      weakConcepts: { type: 'integer', required: true },
                      frictionCount: { type: 'integer', required: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
      render: (_args, value) => textBlocks(cards.mapLines(value)),
    },
    async execute(args) {
      return toMapValue(findCourse(store.get(), args.courseId))
    },
    isConcurrencySafe: () => true,
    presentCall: args => ({ card: 'generic', title: `Course map: ${args.courseId}`, kind: 'read' }),
    presentationMeta: (_args, value) => cards.mapLines(value),
    presentResult: (_args, result) => ({ card: 'generic', content: textBlocks(result.meta as string[]) }),
  })

  const lessonContent = defineTool({
    name: 'study_lesson',
    description:
      'Open one lesson and make it the focus: returns its markdown content (the source of truth to teach '
      + 'from), teaching strategy band, knowledge concepts with mastery/weak flags, four consolidation '
      + 'starters, memory slots, and any pending mastery proposal.',
    parameters: {
      lessonId: { type: 'string', required: true, description: 'Lesson id from a map, import, or courses call.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          lessonId: { type: 'string', required: true },
          courseId: { type: 'string', required: true },
          courseTitle: { type: 'string', required: true },
          sectionTitle: { type: 'string', required: true },
          title: { type: 'string', required: true },
          kind: { type: 'string', required: true, enum: [...LESSON_KINDS] },
          status: { type: 'string', required: true, enum: [...LESSON_STATUSES] },
          body: { type: 'string', required: true },
          masteryPct: { ...nullableInteger, required: true },
          crown: { type: 'integer', required: true },
          attempts: { type: 'integer', required: true },
          correctCount: { type: 'integer', required: true },
          strategy: { type: 'string', required: true },
          concepts: { oneOf: [{ type: 'null' }, {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                title: { type: 'string', required: true },
                masteryPct: { type: 'integer', required: true },
                weak: { type: 'boolean', required: true },
                /** 1 once this concept has been quizzed at least once, else 0 (ConceptView.tested). */
                tested: { type: 'integer', required: true },
              },
            },
          }], required: true },
          starters: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                label: { type: 'string', required: true },
                message: { type: 'string', required: true },
                effect: { type: 'string', required: true, enum: ['mastery', 'friction', 'none'] },
              },
            },
          },
          memory: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              lesson: { ...nullableString, required: true },
              global: { ...nullableString, required: true },
              pattern: { ...nullableString, required: true },
            },
          },
          noteCount: { type: 'integer', required: true },
          pendingProposal: { oneOf: [{ type: 'null' }, {
            type: 'object',
            additionalProperties: false,
            properties: { id: { type: 'string', required: true }, rationale: { type: 'string', required: true } },
          }], required: true },
          nextLessonId: { ...nullableString, required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Lesson “${value.title}” — ${value.courseTitle} / ${value.sectionTitle}\n`
          + `status ${value.status}${value.masteryPct === null ? '' : `, mastery ${value.masteryPct}%`}, `
          + `${value.correctCount}/${value.attempts} answers correct\n`
          + `strategy: ${value.strategy}\n`
          + (value.concepts === null ? '' : `concepts: ${value.concepts.map(c => `${c.title} ${c.masteryPct}%${c.weak ? ' ⚡weak' : ''}`).join(' · ')}\n`)
          + `starters: ${value.starters.map(s => s.label).join(' / ')}\n\n${value.body}`
          + `${value.nextLessonId === null ? '\n\n(this is the last lesson)' : `\n\n(next lesson: ${value.nextLessonId})`}`,
      }],
    },
    async execute(args) {
      return mutate((state) => {
        // Opening IS attempting (LookatStudy markNodeAttempted): first open
        // marks in_progress, seeds mastery 0.5, and runs the dual-track unlock.
        const { ref } = attemptLesson(state, args.lessonId, new Date())
        state.focus = { lessonId: ref.lesson.id }
        return toLessonValue(ref, state)
      })
    },
    presentCall: args => ({ card: 'generic', title: `Open lesson: ${args.lessonId}`, kind: 'read' }),
  })

  const recordAnswerTool = defineTool({
    name: 'study_record_answer',
    description:
      'Record one graded answer and update mastery — call after EVERY learner answer to a scored question. '
      + 'Name the `concept` the question tested (from study_lesson / study_define_concepts) so per-concept '
      + 'mastery stays accurate; lesson mastery is the WEAKEST concept. Mastery ≥50% unlocks the next lesson '
      + 'early; ≥90% graduates automatically and schedules the first review. Also pass the question text and '
      + 'the learner\'s answer to keep a practice log.',
    parameters: {
      lessonId: { type: 'string', required: true, description: 'Lesson the question tested.' },
      correct: { type: 'boolean', required: true, description: 'Whether the learner answered correctly.' },
      concept: { type: 'string', description: 'Concept title the question tested (required once concepts are defined).' },
      rationale: { type: 'string', description: 'One line: why you graded it this way.' },
      question: { type: 'string', description: 'The question text, for the practice log.' },
      givenAnswer: { type: 'string', description: 'The learner\'s answer, for the practice log.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          lessonId: { type: 'string', required: true },
          lessonTitle: { type: 'string', required: true },
          correct: { type: 'boolean', required: true },
          concept: { oneOf: [{ type: 'null' }, {
            type: 'object',
            additionalProperties: false,
            properties: { title: { type: 'string', required: true }, masteryPct: { type: 'integer', required: true }, weak: { type: 'boolean', required: true } },
          }], required: true },
          prevMasteryPct: { type: 'integer', required: true },
          newMasteryPct: { type: 'integer', required: true },
          crown: { type: 'integer', required: true },
          mastered: { type: 'boolean', required: true },
          attempts: { type: 'integer', required: true },
          correctCount: { type: 'integer', required: true },
          graduated: { type: 'boolean', required: true },
          unlockedLessonIds: { type: 'array', required: true, items: { type: 'string' } },
          reviewDueAt: { ...nullableString, required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: cards.answerLine(value)
          + (value.concept === null ? '' : `\nconcept: ${value.concept.title} ${value.concept.masteryPct}%${value.concept.weak ? ' ⚡weak' : ''}`)
          + (value.graduated ? '\n🎓 mastery ≥90% — lesson graduated, first review scheduled.' : '')
          + (value.unlockedLessonIds.length === 0 ? '' : `\n🔓 unlocked: ${value.unlockedLessonIds.join(', ')}`),
      }],
    },
    async execute(args) {
      return mutate((state) => {
        const r = recordAnswer(state, args.lessonId, args.correct, args.concept, new Date())
        if (args.question !== undefined) {
          addNote(
            state,
            args.lessonId,
            'practice',
            args.question.slice(0, 80),
            `${args.question}\n\nlearner answered: ${args.givenAnswer ?? '(not recorded)'} — ${args.correct ? '✓ correct' : '✗ incorrect'}${args.rationale === undefined ? '' : `\nrationale: ${args.rationale}`}`,
            'ai',
            null,
            new Date(),
          )
        }
        return {
          lessonId: r.ref.lesson.id,
          lessonTitle: r.ref.lesson.title,
          correct: args.correct,
          concept: r.concept === null ? null : {
            title: r.concept.title,
            masteryPct: Math.round(r.concept.mastery * 100),
            weak: r.concept.mastery < 0.7,
          },
          prevMasteryPct: Math.round(r.prevMastery * 100),
          newMasteryPct: Math.round(r.newMastery * 100),
          crown: r.crown,
          mastered: r.mastered,
          attempts: r.ref.lesson.attempts,
          correctCount: r.ref.lesson.correctCount,
          graduated: r.progression.graduated,
          unlockedLessonIds: r.progression.unlocked.map(u => u.id),
          reviewDueAt: r.progression.nextDue,
        }
      })
    },
    presentCall: args => ({
      card: 'generic',
      title: `Record answer (${args.correct ? 'correct' : 'incorrect'}): ${args.lessonId}`,
    }),
    presentationMeta: (_args, value) => [cards.answerLine(value)],
    presentResult: (_args, result) => ({ card: 'generic', content: textBlocks(result.meta as string[]) }),
  })

  const completeLessonTool = defineTool({
    name: 'study_complete_lesson',
    description:
      'Mark a lesson mastered manually (graduation at 90% mastery is the automatic path — this is the '
      + 'override). Unlocks the next lesson and schedules the first spaced review for tomorrow. Call only '
      + 'when the learner has genuinely worked through the lesson.',
    parameters: {
      lessonId: { type: 'string', required: true, description: 'Lesson to complete.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          lessonId: { type: 'string', required: true },
          lessonTitle: { type: 'string', required: true },
          unlockedLessonIds: { type: 'array', required: true, items: { type: 'string' } },
          unlockedLessonTitles: { type: 'array', required: true, items: { type: 'string' } },
          reviewDueAt: { type: 'string', required: true },
          courseComplete: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: cards.completeLines(value).join('\n'),
      }],
    },
    async execute(args) {
      return mutate((state) => {
        const r = completeLesson(state, args.lessonId, new Date())
        return {
          lessonId: r.ref.lesson.id,
          lessonTitle: r.ref.lesson.title,
          unlockedLessonIds: r.unlocked.map(u => u.id),
          unlockedLessonTitles: r.unlocked.map(u => u.title),
          reviewDueAt: r.dueAt,
          courseComplete: r.courseComplete,
        }
      })
    },
    presentCall: args => ({ card: 'generic', title: `Complete lesson: ${args.lessonId}` }),
    presentationMeta: (_args, value) => cards.completeLines(value),
    presentResult: (_args, result) => ({ card: 'generic', content: textBlocks(result.meta as string[]) }),
  })

  const dueReviewsTool = defineTool({
    name: 'study_due_reviews',
    description: 'List mastered lessons whose spaced-repetition review is due (optionally within one course), oldest first. Start every session here.',
    parameters: {
      courseId: { type: 'string', description: 'Restrict to one course; omit to scan all courses.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          total: { type: 'integer', required: true },
          due: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                lessonId: { type: 'string', required: true },
                courseTitle: { type: 'string', required: true },
                lessonTitle: { type: 'string', required: true },
                dueAt: { type: 'string', required: true },
                overdueDays: { type: 'integer', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => textBlocks(cards.dueLines(value)),
    },
    async execute(args) {
      const due = dueReviews(store.get(), args.courseId, new Date())
      return {
        total: due.length,
        due: due.map(d => ({
          lessonId: d.lessonId,
          courseTitle: d.courseTitle,
          lessonTitle: d.lessonTitle,
          dueAt: d.dueAt,
          overdueDays: d.overdueDays,
        })),
      }
    },
    isConcurrencySafe: () => true,
    presentCall: () => ({ card: 'generic', title: 'List due reviews', kind: 'search' }),
    presentationMeta: (_args, value) => cards.dueLines(value),
    presentResult: (_args, result) => ({ card: 'generic', content: textBlocks(result.meta as string[]) }),
  })

  const recordReviewTool = defineTool({
    name: 'study_record_review',
    description:
      'Record an SM-2 review grade for a mastered lesson and advance its schedule. Grade how well the '
      + 'learner recalled the material: 5 perfect, 4 hesitant, 3 recalled with effort, 2 incorrect but '
      + 'recognized, 1 incorrect, 0 complete blackout. Target weak concepts (⚡) first.',
    parameters: {
      lessonId: { type: 'string', required: true, description: 'Lesson being reviewed.' },
      quality: { type: 'integer', required: true, enum: [...QUALITIES], description: 'SM-2 recall quality, 0 (blackout) to 5 (perfect).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          lessonId: { type: 'string', required: true },
          lessonTitle: { type: 'string', required: true },
          quality: { type: 'integer', required: true },
          intervalDays: { type: 'integer', required: true },
          repetitions: { type: 'integer', required: true },
          easeFactor: { type: 'number', required: true },
          dueAt: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: cards.reviewLine(value) }],
    },
    async execute(args) {
      return mutate((state) => {
        const r = recordReview(state, args.lessonId, args.quality as ReviewQuality, new Date())
        return {
          lessonId: r.ref.lesson.id,
          lessonTitle: r.ref.lesson.title,
          quality: args.quality,
          intervalDays: r.intervalDays,
          repetitions: r.repetitions,
          easeFactor: r.easeFactor,
          dueAt: r.dueAt,
        }
      })
    },
    presentCall: args => ({ card: 'generic', title: `Record review (quality ${args.quality}): ${args.lessonId}` }),
    presentationMeta: (_args, value) => [cards.reviewLine(value)],
    presentResult: (_args, result) => ({ card: 'generic', content: textBlocks(result.meta as string[]) }),
  })

  const deleteCourseTool = defineTool({
    name: 'study_delete_course',
    description: 'Delete one course and all its progress. Ask the learner before calling.',
    parameters: {
      courseId: { type: 'string', required: true, description: 'Course to delete.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          deletedCourseId: { type: 'string', required: true },
          remaining: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Deleted course ${value.deletedCourseId}. ${value.remaining} courses remain.`,
      }],
    },
    async execute(args) {
      return mutate((state) => {
        findCourse(state, args.courseId)
        deleteCourse(state, args.courseId)
        return { deletedCourseId: args.courseId, remaining: state.courses.length }
      })
    },
    presentCall: args => ({ card: 'generic', title: `Delete course: ${args.courseId}`, kind: 'delete', rawInput: args.courseId }),
  })

  const defineConceptsTool = defineTool({
    name: 'study_define_concepts',
    description:
      'Define a lesson\'s knowledge components — the 2–7 independently quizzable units mastery tracks. '
      + 'Call this the FIRST time you teach a lesson, derived from its content. Titles ≤10 characters; '
      + 'descriptions say what understanding this concept means. Lesson mastery is the WEAKEST concept; '
      + 'cover weak ones (⚡) first when quizzing.',
    parameters: {
      lessonId: { type: 'string', required: true, description: 'Lesson to describe.' },
      concepts: {
        type: 'array',
        required: true,
        description: '2–7 concepts.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            title: { type: 'string', required: true, description: 'Short concept title (≤10 chars).' },
            description: { type: 'string', required: true, description: 'What understanding this concept means.' },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          lessonId: { type: 'string', required: true },
          concepts: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: { title: { type: 'string', required: true }, masteryPct: { type: 'integer', required: true } },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Concepts defined: ${value.concepts.map(c => `${c.title} (${c.masteryPct}%)`).join(' · ')}. Attribute quiz answers with the \`concept\` parameter.`,
      }],
    },
    async execute(args) {
      return mutate((state) => {
        defineConceptsState(state, args.lessonId, args.concepts)
        const ref = findLesson(state, args.lessonId)
        return {
          lessonId: ref.lesson.id,
          concepts: (conceptViews(ref.lesson) ?? []).map(c => ({ title: c.title, masteryPct: c.masteryPct })),
        }
      })
    },
    presentCall: args => ({ card: 'generic', title: `Define concepts: ${args.lessonId}` }),
  })

  const proposeMasteryTool = defineTool({
    name: 'study_propose_mastery',
    description:
      'Propose graduating a lesson as mastered ahead of the 90% threshold — use when mastery is ≥85% and '
      + 'the learner has convincingly demonstrated understanding (e.g. a Feynman-style explanation back to '
      + 'you). Creates a PENDING proposal: present it with your rationale and WAIT for the learner\'s '
      + 'decision, then resolve with study_resolve_proposal. Never apply it yourself.',
    parameters: {
      lessonId: { type: 'string', required: true, description: 'Lesson judged mastered.' },
      rationale: { type: 'string', required: true, description: 'Why you believe it is mastered — the learner reads this.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          proposalId: { type: 'string', required: true },
          lessonTitle: { type: 'string', required: true },
          status: { type: 'string', required: true, enum: ['pending', 'applied', 'rejected'] },
          rationale: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Proposal ${value.proposalId} (${value.status}): “${value.lessonTitle}” — ${value.rationale}\nPresent this to the learner and wait; resolve via study_resolve_proposal.`,
      }],
    },
    async execute(args) {
      return mutate((state) => {
        const ref = findLesson(state, args.lessonId)
        const proposal = proposeMastery(state, args.lessonId, args.rationale, new Date())
        return { proposalId: proposal.id, lessonTitle: ref.lesson.title, status: proposal.status, rationale: proposal.rationale }
      })
    },
    presentCall: args => ({ card: 'generic', title: `Propose mastery: ${args.lessonId}` }),
    presentationMeta: (_args, value) => ({
      kind: 'study-proposal-created',
      proposalId: value.proposalId,
      lessonTitle: value.lessonTitle,
      rationale: value.rationale,
    }),
    presentResult: (_args, result) => ({
      card: 'generic',
      content: textBlocks([`🎓 Proposed mastery for “${(result.meta as { lessonTitle?: string } | undefined)?.lessonTitle ?? 'lesson'}”: ${(result.meta as { rationale?: string } | undefined)?.rationale ?? ''}`]),
    }),
  })

  const resolveProposalTool = defineTool({
    name: 'study_resolve_proposal',
    description:
      'Resolve a pending mastery proposal with the learner\'s explicit decision (they said yes / no in chat). '
      + 'Accepting floors every concept to 95%, graduates the lesson, and unlocks the next one.',
    parameters: {
      proposalId: { type: 'string', required: true, description: 'Proposal id from study_propose_mastery.' },
      accept: { type: 'boolean', required: true, description: 'The learner\'s decision.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          proposalId: { type: 'string', required: true },
          lessonId: { type: 'string', required: true },
          status: { type: 'string', required: true, enum: ['applied', 'rejected'] },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.status === 'applied'
          ? `🎓 Proposal applied — lesson ${value.lessonId} mastered (all concepts ≥95%), next lesson unlocked, review scheduled.`
          : `Proposal rejected — continuing practice on ${value.lessonId}.`,
      }],
    },
    async execute(args) {
      return mutate((state) => {
        const proposal = resolveProposal(state, args.proposalId, args.accept, new Date())
        return { proposalId: proposal.id, lessonId: proposal.lessonId, status: proposal.status }
      })
    },
    presentCall: args => ({ card: 'generic', title: `Resolve proposal: ${args.proposalId}` }),
    presentationMeta: (_args, value) => ({
      kind: 'study-proposal-resolved',
      proposalId: value.proposalId,
      status: value.status,
    }),
    presentResult: (_args, result) => ({
      card: 'generic',
      content: textBlocks([`Proposal ${(result.meta as { proposalId?: string } | undefined)?.proposalId ?? '?'} ${(result.meta as { status?: string } | undefined)?.status ?? ''}.`]),
    }),
  })

  const reportFrictionTool = defineTool({
    name: 'study_report_friction',
    description:
      'SILENTLY log a learning-friction moment — call when the learner seems confused (糊涂), stuck (卡住), '
      + 'or frustrated (受挫), or when they say "我没太懂". One short line. Never mention that you logged it; '
      + 'it feeds the weak-spot map and adapts difficulty.',
    parameters: {
      category: { type: 'string', required: true, enum: [...FRICTION_CATEGORIES], description: 'confused | blocked | frustrated.' },
      summary: { type: 'string', description: 'One short line: what specifically is hard.' },
      lessonId: { type: 'string', description: 'Lesson it happened on, when known.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { logged: { type: 'boolean', required: true } },
      },
      render: () => [{ type: 'text', text: 'Noted.' }],
    },
    async execute(args) {
      return mutate((state) => {
        addFriction(state, args.lessonId ?? null, args.category, args.summary ?? null, new Date())
        return { logged: true }
      })
    },
    presentCall: () => ({ card: 'generic', title: 'Log friction' }),
  })

  const rememberTool = defineTool({
    name: 'study_remember',
    description:
      'Write a learner-memory slot — call only when you learn something worth keeping across sessions '
      + '(how they best learn, a recurring pattern, a specific gap). NOT for transient chat. To merge: '
      + 'read the current slot first (study_lesson\'s memory field), then send the merged 1–3 sentence '
      + 'version — this REPLACES the slot.',
    parameters: {
      category: { type: 'string', required: true, enum: [...MEMORY_CATEGORIES], description: 'global (cross-course style) | pattern (per-course recurring pattern) | lesson (this lesson\'s specific gap).' },
      content: { type: 'string', required: true, description: 'The merged 1–3 sentence slot content.' },
      lessonId: { type: 'string', description: 'Lesson (for the lesson slot) or any lesson of the course (for the pattern slot).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          previous: { ...nullableString, required: true },
          stored: { type: 'string', required: true },
        },
      },
      render: () => [{ type: 'text', text: 'Remembered.' }],
    },
    async execute(args) {
      return mutate(state => ({
        previous: setMemory(state, args.category, args.content, args.lessonId),
        stored: args.content,
      }))
    },
    presentCall: () => ({ card: 'generic', title: 'Update learner memory' }),
  })

  const noteSaveTool = defineTool({
    name: 'study_note_save',
    description:
      'Save an entry to the learner\'s Cornell notebook. Zones: `understand` (knowledge structures you '
      + 'generated — concept maps as mermaid, compare tables, diagrams; sediment your best structures here '
      + 'after showing them), `record` (the learner\'s own words — when they ask to take a note, or when '
      + 'they write something worth keeping, with the verbatim `quote`), `practice` (quiz log — normally '
      + 'written automatically by study_record_answer).',
    parameters: {
      lessonId: { type: 'string', required: true, description: 'Lesson the note belongs to.' },
      zone: { type: 'string', required: true, enum: [...NOTE_ZONES], description: 'understand | record | practice.' },
      title: { type: 'string', required: true, description: 'Short entry title.' },
      text: { type: 'string', required: true, description: 'Entry body — markdown for the understand zone.' },
      source: { type: 'string', required: true, enum: [...NOTE_SOURCES], description: 'ai (you generated) | content (quoted from lesson) | chat (quoted from conversation).' },
      quote: { type: 'string', description: 'Verbatim source quote, for record-zone notes.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { noteId: { type: 'string', required: true }, zone: { type: 'string', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: `Saved ${value.zone}-zone note ${value.noteId}.` }],
    },
    async execute(args) {
      return mutate((state) => {
        const note = addNote(state, args.lessonId, args.zone, args.title, args.text, args.source, args.quote ?? null, new Date())
        return { noteId: note.id, zone: note.zone }
      })
    },
    presentCall: args => ({ card: 'generic', title: `Save ${args.zone} note: ${args.title}` }),
  })

  const notesTool = defineTool({
    name: 'study_notes',
    description: 'Read the learner\'s Cornell notebook: three zones per lesson (understand structures, learner records, practice log).',
    parameters: {
      lessonId: { type: 'string', description: 'One lesson\'s notes; omit for all lessons (most recent last).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          total: { type: 'integer', required: true },
          notes: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                lessonTitle: { type: 'string', required: true },
                zone: { type: 'string', required: true, enum: [...NOTE_ZONES] },
                title: { type: 'string', required: true },
                text: { type: 'string', required: true },
                source: { type: 'string', required: true, enum: [...NOTE_SOURCES] },
                quote: { ...nullableString, required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.total === 0
          ? 'Notebook is empty.'
          : value.notes.map(n => `[${n.zone}] ${n.lessonTitle} — ${n.title}${n.quote === null ? '' : ` (quote: “${n.quote.slice(0, 60)}”)`}`).join('\n'),
      }],
    },
    async execute(args) {
      const state = store.get()
      const lessons = args.lessonId === undefined
        ? state.courses.flatMap(c => c.sections.flatMap(s => s.lessons))
        : [findLesson(state, args.lessonId).lesson]
      const notes = lessons.flatMap(l => l.notes.map(n => ({
        id: n.id,
        lessonTitle: l.title,
        zone: n.zone,
        title: n.title,
        text: n.text,
        source: n.source,
        quote: n.quote,
      })))
      return { total: notes.length, notes }
    },
    isConcurrencySafe: () => true,
    presentCall: () => ({ card: 'generic', title: 'Read notebook', kind: 'read' }),
  })

  const setModeTool = defineTool({
    name: 'study_set_mode',
    description:
      'Switch the tutoring soul when the learner asks for a different style: `direct` 精讲 (explain first, '
      + 'then verify), `guide` 引导 (questions first, hand over steps), `practice` 实战 (learn inside real, '
      + 'messy problems). Takes effect from the next reply.',
    parameters: {
      mode: { type: 'string', required: true, enum: [...MODES], description: 'direct | guide | practice.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { mode: { type: 'string', required: true, enum: [...MODES] } },
      },
      render: (_args, value) => [{ type: 'text', text: `Tutoring soul switched to ${value.mode} (effective next reply).` }],
    },
    async execute(args) {
      return mutate((state) => {
        state.mode = args.mode
        return { mode: state.mode }
      })
    },
    presentCall: args => ({ card: 'generic', title: `Switch soul: ${args.mode}` }),
  })

  return [
    importMarkdown,
    importFolder,
    importGithub,
    listCourses,
    courseMap,
    lessonContent,
    recordAnswerTool,
    completeLessonTool,
    dueReviewsTool,
    recordReviewTool,
    deleteCourseTool,
    defineConceptsTool,
    proposeMasteryTool,
    resolveProposalTool,
    reportFrictionTool,
    rememberTool,
    noteSaveTool,
    notesTool,
    setModeTool,
  ]
}

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
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { parseMarkdownToCourse } from './vendor/markdown-course.ts'
import type { ParsedCourse } from './vendor/markdown-course.ts'
import { scanFolder, buildLocalInventory } from './vendor/local-folder-scanner.ts'
import { downloadToBuffer, fetchFileOutlines, fetchRepoInventory, fetchSingleFileContent } from './vendor/repo-fetcher.ts'
import { routeImportUrl, normalizeUrlIdentity } from './vendor/url-route.ts'
import { parsePdfText } from './vendor/pdf-text.ts'
import { prepareSingleDoc } from './vendor/text-chunk.ts'
import { extractArticle } from './vendor/html-article.ts'
import { fetchBilibiliMeta } from './vendor/video-meta.ts'
import {
  buildCourseFromDesign,
  buildPendingDesign,
  buildPendingDesignFromFolder,
  buildPendingDesignFromUrl,
  collectTranslations,
  rewriteGithubImageRefs,
  inlineLocalImages,
  planBriefParts,
  renderDesignBrief,
  validateDesign,
  type PendingDesign,
} from './import-design.ts'
import type { ReviewQuality } from './vendor/sm2.ts'
import { masteryToCrown } from './vendor/bkt.ts'
import { getPostQuizActions, planExamQuota } from './vendor/exam-logic.ts'
import { DEFAULT_DAILY_GOAL, levelFromTotalXp } from './vendor/xp.ts'
import * as cards from './cards.ts'
import {
  courseToPackMarkdown,
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
  recordExamResult,
  applyExamBank,
  recordReview,
  resolveProposal,
  searchLessons,
  setMemory,
  starterPrompts,
  defineConcepts as defineConceptsState,
  gatherConsolidationWindow,
  recordArtifact,
  strategyBand,
  type CourseState,
  type LearningState,
  type LessonRef,
} from './state.ts'
import {
  artifactId, sanitizeCodeWalkthrough, sanitizeCompareTable, sanitizeDiagram, sanitizeGuess, sanitizeQuiz,
  type SanitizeResult, type StudyArtifact,
} from './artifacts.ts'

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
/** The learner-state block (upstream learner-model buildLearnerSnapshot): one
 *  composed projection of mastery/status/weak concepts/friction/memory that the
 *  tutor consumes whole instead of re-deriving from scattered fields. */
function learnerStateLine(ref: LessonRef, state: LearningState): string {
  const l = ref.lesson
  const parts: string[] = []
  parts.push(`status ${l.status}, mastery ${l.mastery === null ? 'untracked' : `${Math.round(l.mastery * 100)}%`}, strategy ${strategyBand(l.mastery)}`)
  const weak = (l.concepts ?? []).filter((_c, i) => (l.conceptMastery?.[i] ?? 0.5) < 0.7)
  if (weak.length > 0) parts.push(`weak concepts: ${weak.map(c => c.title).join('、')}`)
  const frictionCats = [...new Set(l.friction.slice(-5).map(f => f.category))]
  if (frictionCats.length > 0) parts.push(`recent friction: ${frictionCats.join('/')}`)
  if (l.memory !== null) parts.push(`lesson memory: ${l.memory}`)
  if (state.memoryGlobal !== null) parts.push(`global memory: ${state.memoryGlobal}`)
  return parts.join(' | ')
}

function toLessonValue(ref: LessonRef, state: LearningState) {
  const next = nextLesson(ref.course, ref.lesson.id)
  const pending = state.proposals.find(p => p.lessonId === ref.lesson.id && p.status === 'pending')
  /** Exam design guide (upstream exam-logic): question quota from the section's
   *  KC union, per-question time rule, star thresholds — only on exam nodes. */
  const examGuide = ref.lesson.kind === 'exam'
    ? (() => {
        const kcTitles = [...new Set(ref.section.lessons
          .filter(l => l.kind !== 'exam' && l.concepts !== null)
          .flatMap(l => l.concepts!.map(c => c.title)))]
        const quota = planExamQuota(kcTitles)
        const questionCount = quota.reduce((a, b) => a + b, 0)
        return {
          questionCount,
          kcCount: kcTitles.length,
          timeLimitRule: 'per-question seconds = 45 + cjkChars/5 + words/3 + options×8, +25 code block, +25 formula, clamp 60–300 (questionTimeLimitSec)',
          starsRule: '≥95%→3★, ≥80%→2★, ≥60%→1★, below→0 (best-of kept; report with study_exam_result)',
          bestStars: ref.lesson.examStars ?? 0,
          examAttempts: ref.lesson.examAttempts ?? 0,
        }
      })()
    : null
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
    learnerState: learnerStateLine(ref, state),
    ...(ref.lesson.summary !== undefined ? { summary: ref.lesson.summary } : {}),
    ...(examGuide !== null ? { examGuide } : {}),
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

/** Wrap a fetch transport so cancellation of the tool call aborts in-flight repo fetches. */
function signalFetch(signal: AbortSignal, baseFetch: typeof fetch): typeof fetch {
  return (input, init) => baseFetch(input, { ...init, signal })
}

/** Total over a missing `meta` (events logged before a presentationMeta existed): renders nothing instead of throwing into the presenter fallback. */
const textBlocks = (lines: readonly string[] | undefined | null): Array<{ type: 'text'; text: string }> => (lines ?? []).map(text => ({ type: 'text', text }) as const)

/** Optional wiring for tests: a stubbable network transport. */
export interface StudyToolsDeps {
  /** Fetch transport for repo fetches; defaults to the global fetch. */
  fetch?: typeof fetch
}

/**
 * Build the full study tool set over one store.
 * @param store - state store owned by `apply`.
 * @param deps - test seams (fetch stub); production leaves it default.
 * @returns tool definitions ready for `ctx.tools.register`.
 */
export function studyTools(store: StudyStore, deps: StudyToolsDeps = {}): ToolDefinition[] {
  const baseFetch: typeof fetch = deps.fetch ?? fetch
  /**
   * The pending course design between study_import_github (design_required)
   * and study_apply_design. Memory-only on purpose: it is cheap to re-fetch
   * and state.json should not carry bulk inventories; a later import
   * replaces an unconsumed one.
   */
  let pendingDesign: PendingDesign | null = null
  /** Which context-budget part of the pending brief the tutor last asked for. */
  let pendingPart = 1
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

  /** Shared output for the two design-protocol import tools: already imported, or a brief is pending. */
  const designOrImportedOutput = {
    schema: {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            status: { type: 'string', enum: ['imported'], required: true },
            courseId: { type: 'string', required: true },
            title: { type: 'string', required: true },
            sections: { type: 'integer', required: true },
            lessons: { type: 'integer', required: true },
            firstLessonId: { type: 'string', required: true },
            firstLessonTitle: { type: 'string', required: true },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            status: { type: 'string', enum: ['design_required'], required: true },
            repo: { type: 'string', required: true },
            branch: { type: 'string', required: true },
            courseTitle: { type: 'string', required: true },
            fileCount: { type: 'integer', required: true },
            fullTreeCount: { type: 'integer', required: true },
            part: { type: 'integer', description: 'Brief part this call rendered (context-budget batching).' },
            partCount: { type: 'integer', description: 'Total brief parts; >1 means design+apply per part.' },
          },
        },
      ],
    },
  }
  /** Shared render: the brief rides the design_required branch; imported stays the old summary. */
  const designOrImportedRender = (_args: unknown, value: { status: string; title?: string; sections?: number; lessons?: number; firstLessonId?: string; firstLessonTitle?: string }) => [{
    type: 'text' as const,
    text: value.status === 'design_required'
      ? (pendingDesign === null
          ? 'Course design required — the brief is no longer pending; call the import tool again to re-fetch it.'
          : renderDesignBrief(pendingDesign, pendingPart))
      : `Imported course “${value.title}” (${value.sections} sections, ${value.lessons} lessons). `
        + `First lesson: “${value.firstLessonTitle}” (id ${value.firstLessonId}).`,
  }]
  const designOrImportedPresent = {
    presentationMeta: (_args: unknown, value: { status: string }) =>
      value.status === 'design_required' ? cards.designBriefLines(value as cards.DesignBriefValue) : cards.importLines(value as cards.ImportValue),
    presentResult: (_args: unknown, result: { meta: unknown }) => ({
      card: 'generic',
      content: textBlocks(result.meta as string[]),
    }),
  }

  const importFolder = defineTool({
    name: 'study_import_folder',
    description:
      'Start importing a local folder: scans markdown, txt, html, Jupyter notebooks, rst/Rmd/org/adoc, and 30+ '
      + 'code file types (PDF/PPTX unsupported), then returns a design brief — the TUTOR designs the course '
      + 'structure from it and applies the result with study_apply_design (fully offline). Re-importing an '
      + 'already-imported path returns the existing course directly.',
    parameters: {
      path: { type: 'string', required: true, description: 'Absolute path of the folder to scan.' },
      title: { type: 'string', description: 'Optional course title overriding the folder name / README H1.' },
      part: { type: 'integer', description: 'Which context-budget brief part to render (1-based); relevant only when the folder is huge.' },
    },
    output: { ...designOrImportedOutput, render: designOrImportedRender },
    async execute(args) {
      if (!existsSync(args.path)) {
        throw new Error(`lookatstudy-plugin: folder does not exist: ${args.path}`)
      }
      const part = args.part ?? 1
      const existing = part <= 1 ? store.get().courses.find(c => c.source === 'folder' && c.sourceRef === args.path) : undefined
      if (existing !== undefined) {
        return { status: 'imported' as const, ...toImportValue(existing) }
      }
      const inventory = await buildLocalInventory(args.path)
      const docs = inventory.docs
      if (docs.length === 0) {
        throw new Error(`lookatstudy-plugin: no importable files found in ${args.path}`)
      }
      const title = args.title ?? basename(args.path.replaceAll('\\', '/'))
      pendingDesign = buildPendingDesignFromFolder(args.path, title, docs, { translations: inventory.translations, images: inventory.images })
      // Inline local images as data URLs (upstream scanner-images, 200KB cap per image)
      const localImages = new Map<string, string>()
      for (const img of inventory.images) {
        if (img.absPath === '' || img.source === 'pdf_page') continue
        try {
          const buf = await readFile(img.absPath)
          if (buf.length > 200_000) continue
          localImages.set(img.path, `data:${img.mime};base64,${buf.toString('base64')}`)
        } catch { /* unreadable image skipped */ }
      }
      if (localImages.size > 0) pendingDesign.localImages = localImages
      pendingPart = part
      return designRequiredValue(pendingDesign, part)
    },
    timeoutMs: 60_000,
    presentCall: args => ({ card: 'generic', title: `Scan folder: ${args.path}`, kind: 'read', rawInput: args.path }),
    ...designOrImportedPresent,
  })

  /** Stamp the requested brief part onto the pending design and build the design_required value. */
  const designRequiredValue = (pd: PendingDesign, part: number) => {
    const partCount = planBriefParts(pd.files).length
    pd.part = part
    pd.partCount = partCount
    return {
      status: 'design_required' as const,
      repo: pd.repo,
      branch: pd.branch,
      courseTitle: partCount > 1 ? `${pd.courseTitle} (part ${part})` : pd.courseTitle,
      fileCount: planBriefParts(pd.files)[Math.min(part, partCount) - 1]!.length,
      fullTreeCount: pd.fullTreeCount,
      ...(partCount > 1 ? { part, partCount } : {}),
    }
  }

  /** Shared GitHub import flow — study_import_github's core, reused verbatim by
   *  study_import_url's github branch (routing is the only difference). */
  const runGithubImport = async (url: string, branch: string | undefined, exec: { signal: AbortSignal }, part = 1) => {
    const { owner, repo } = parseGithubUrl(url)
    const resolvedBranch = branch ?? 'main'
    const fetchFn = signalFetch(exec.signal, baseFetch)
    const existing = part <= 1 ? store.get().courses.find(c => c.source === 'github' && c.sourceRef === url) : undefined
    if (existing !== undefined) {
      return { status: 'imported' as const, ...toImportValue(existing) }
    }
    const inventory = await fetchRepoInventory(owner, repo, resolvedBranch, fetchFn, undefined, exec.signal)
    const outlines = await fetchFileOutlines(inventory.fileList.map(f => f.path), owner, repo, inventory.branch, fetchFn, undefined, exec.signal)
    pendingDesign = buildPendingDesign(url, owner, repo, inventory, outlines)
    if (pendingDesign.files.length === 0) {
      throw new Error('lookatstudy-plugin: course files were discovered but no outlines could be fetched (CDN unreachable?)')
    }
    pendingPart = part
    return designRequiredValue(pendingDesign, part)
  }

  const importGithub = defineTool({
    name: 'study_import_github',
    description:
      'Start importing a GitHub learning repository: fetches the README outline and every course file\'s '
      + 'heading outline (with char counts) through the jsDelivr CDN, then returns a design brief — '
      + 'the TUTOR designs the course structure (sections/lessons/anchors/worlds) from it and applies '
      + 'the result with study_apply_design. Re-importing an already-imported URL returns the existing '
      + 'course directly. Awesome-lists are rejected.',
    parameters: {
      url: { type: 'string', required: true, description: 'Repository URL, e.g. https://github.com/microsoft/AI-For-Beginners.' },
      branch: { type: 'string', description: 'Branch to read (main tried, then master); defaults to main.' },
      part: { type: 'integer', description: 'Which context-budget brief part to render (1-based); relevant only for huge repos.' },
    },
    output: { ...designOrImportedOutput, render: designOrImportedRender },
    execute: (args, exec) => runGithubImport(args.url, args.branch, exec, args.part ?? 1),
    timeoutMs: 180_000,
    presentCall: args => ({ card: 'generic', title: `Import GitHub course: ${args.url}`, kind: 'fetch' }),
    ...designOrImportedPresent,
  })

  const importUrl = defineTool({
    name: 'study_import_url',
    description:
      'Import any learning URL by auto-routing: GitHub repos reuse the repository import; arXiv papers '
      + 'download the PDF and extract its text layer; other http(s) pages get web-article extraction '
      + '(nav/ads stripped, honest failure on non-article pages). All routes return the same design '
      + 'brief the tutor designs against (apply with study_apply_design). Video links (B站/YouTube/抖音) '
      + 'are classified with title metadata but cannot be transcribed here — ask the learner to paste '
      + 'the transcript/subtitles and use study_import_markdown instead.',
    parameters: {
      url: { type: 'string', required: true, description: 'The URL to import: github.com repo, arxiv.org paper, or any web article page.' },
      part: { type: 'integer', description: 'Which context-budget brief part to render (1-based); relevant only for enormous documents.' },
    },
    output: { ...designOrImportedOutput, render: designOrImportedRender },
    async execute(args, exec) {
      const route = routeImportUrl(args.url)
      if (route === null) {
        throw new Error(`lookatstudy-plugin: ${JSON.stringify(args.url)} is not a recognizable import URL (github repo / arxiv paper / web article / video link)`)
      }
      if (route.kind === 'github') {
        return runGithubImport(args.url, undefined, exec, args.part ?? 1)
      }
      const fetchFn = signalFetch(exec.signal, baseFetch)
      if (route.kind === 'video') {
        // 分类与元数据(SPEC 1.2):字幕拉取需 yt-dlp spawn、音频转写需模型客户端——
        // 两条路都在插件禁区,诚实报元数据 + 指路粘贴文稿。
        if (route.source === 'bilibili') {
          const meta = await fetchBilibiliMeta(route.url, fetchFn, exec.signal)
          const parts = meta.parts.length > 0 ? `, ${meta.parts.length} 分P` : ''
          throw new Error(
            `lookatstudy-plugin: B站视频《${meta.title}》(UP:${meta.owner}${parts})已识别,但插件内无字幕拉取与音频转写能力。`
            + '请让学习者把字幕/文稿粘贴进来,用 study_import_markdown 导入。',
          )
        }
        throw new Error(
          `lookatstudy-plugin: ${route.url} 是视频链接(YouTube/抖音需要 yt-dlp,插件环境不可用)。`
          + '请让学习者把字幕/文稿粘贴进来,用 study_import_markdown 导入。',
        )
      }
      if (route.flavor === 'arxiv') {
        const buf = await downloadToBuffer(route.pdfUrl, fetchFn, { signal: exec.signal })
        const text = parsePdfText(buf)
        if (!text || text.replace(/\s+/g, '').length < 200) {
          throw new Error('lookatstudy-plugin: arXiv PDF has no extractable text layer (scanned/image PDF) — try the HTML version or paste the abstract as markdown')
        }
        const docs = prepareSingleDoc(`arxiv-${route.arxivId}`, `# arXiv:${route.arxivId}\n\n${text}`)
        if (docs.length === 0) throw new Error('lookatstudy-plugin: arXiv PDF text was empty after chunking')
        const part = args.part ?? 1
        const existing = part <= 1 ? store.get().courses.find(c => c.source === 'url' && c.sourceRef === route.url) : undefined
        if (existing !== undefined) return { status: 'imported' as const, ...toImportValue(existing) }
        pendingDesign = buildPendingDesignFromUrl(route.url, `arXiv:${route.arxivId}`, docs)
        pendingPart = part
        return designRequiredValue(pendingDesign, part)
      }
      // article:网页正文抽取
      const part = args.part ?? 1
      const identity = normalizeUrlIdentity(route.url)
      const existing = part <= 1 ? store.get().courses.find(c => c.source === 'url' && c.sourceRef === identity) : undefined
      if (existing !== undefined) return { status: 'imported' as const, ...toImportValue(existing) }
      const resp = await fetchFn(route.url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LookatStudyPlugin/0.9)' } })
      if (!resp.ok) throw new Error(`lookatstudy-plugin: page fetch failed (HTTP ${resp.status}): ${route.url}`)
      const html = await resp.text()
      const article = extractArticle(html, route.url)
      if (article === null) {
        throw new Error(`lookatstudy-plugin: ${route.url} does not look like an article page (no readable body found) — login walls, indexes and app shells are rejected honestly rather than imported as noise`)
      }
      const docs = prepareSingleDoc(article.title.slice(0, 60), article.markdown)
      if (docs.length === 0) throw new Error('lookatstudy-plugin: article body was empty after chunking')
      pendingDesign = buildPendingDesignFromUrl(identity, article.title, docs)
      pendingPart = part
      return designRequiredValue(pendingDesign, part)
    },
    timeoutMs: 120_000,
    presentCall: args => ({ card: 'generic', title: `Import URL: ${args.url}`, kind: 'fetch' }),
    ...designOrImportedPresent,
  })

  const applyDesign = defineTool({
    name: 'study_apply_design',
    description:
      'Apply the tutor-designed course structure to the pending import (the one study_import_github or '
      + 'study_import_folder returned design_required for). Every lesson\'s file must come from the design '
      + 'brief — unknown paths are dropped (anti-hallucination); lesson bodies are sliced by their anchor '
      + 'heading and the course is imported. On a validation or fetch error the tutor fixes the design and '
      + 'simply calls again.',
    parameters: {
      languageTarget: {
        type: 'string',
        description:
          'Set ONLY when this course teaches a language ITSELF (vocabulary, grammar, reading/writing of English/Japanese/Chinese/…) '
          + 'rather than being a knowledge/tech course that merely happens to be written in some language: the taught '
          + 'language as a BCP-47 tag ("en", "ja", "zh-CN", …). The writing language is NOT the taught language — a Chinese-written '
          + 'English-textbook repo has languageTarget "en". Typical tells: vocab lists, grammar points, dialogues/readings, '
          + 'sentence-translation pairs, level markers (N5/N1, TOEFL, HSK, JLPT), pronunciation content. When unsure, omit it — '
          + 'a normal course misflagged as a language course is worse than the reverse.',
      },
      sections: {
        type: 'array',
        required: true,
        description: 'Designed sections in learning order.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            title: { type: 'string', required: true, description: 'Section title (in the learner\'s language).' },
            lessons: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  title: { type: 'string', required: true, description: 'Lesson title.' },
                  file: { type: 'string', required: true, description: 'Exact file path from the design brief.' },
                  anchor: { type: 'string', description: 'Full H2/H3 heading text the lesson body starts at; omit for whole-file lessons.' },
                  world: { type: 'string', description: '"study" (explanation) or "practice" (exercise/lab/notebook); anything else is treated as study.' },
                },
              },
            },
          },
        },
      },
    },
    output: {
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
          droppedLessons: { type: 'integer', required: true },
          languageTarget: { type: 'string', description: 'Present only when the course teaches a language itself (BCP-47); the tutor then keeps quiz material in the target language.' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Imported designed course “${value.title}” (${value.sections} sections, ${value.lessons} lessons`
          + `${value.droppedLessons > 0 ? `, ${value.droppedLessons} hallucinated lesson(s) dropped` : ''})`
          + `${typeof value.languageTarget === 'string' ? ` — language course (${value.languageTarget}): keep reading passages, example sentences, and quiz language material in the target language` : ''}. `
          + `First lesson: “${value.firstLessonTitle}” (id ${value.firstLessonId}). Present the course map to the learner.`,
      }],
    },
    async execute(args, exec) {
      const pd = pendingDesign
      if (pd === null) {
        throw new Error('lookatstudy-plugin: no pending course design — call study_import_github or study_import_folder first (a dsh restart also clears it)')
      }
      const validated = validateDesign(args, new Set(pd.files.map(f => f.path)))
      const uniqueFiles = [...new Set(validated.sections.flatMap(s => s.lessons.map(l => l.file)))]
      const contents = new Map<string, string>()
      if (pd.localContents !== undefined) {
        // Folder imports carry their bodies inline — apply is fully offline.
        for (const file of uniqueFiles) {
          const text = pd.localContents.get(file)
          if (text === undefined) {
            throw new Error(`lookatstudy-plugin: designed file ${JSON.stringify(file)} is not in the scanned folder — use only paths from the design brief`)
          }
          contents.set(file, pd.localImages === undefined ? text : inlineLocalImages(text, file, pd.localImages))
        }
      } else {
        // GitHub imports fetch each designed file exactly once, five in flight, abort-aware.
        const failed: string[] = []
        const fetchFn = signalFetch(exec.signal, baseFetch)
        for (let i = 0; i < uniqueFiles.length; i += 5) {
          if (exec.signal.aborted) throw new Error('lookatstudy-plugin: import aborted')
          const batch = uniqueFiles.slice(i, i + 5)
          const texts = await Promise.all(batch.map(f => fetchSingleFileContent(f, pd.owner, pd.repo, pd.branch, fetchFn)))
          for (let j = 0; j < batch.length; j++) {
            if (texts[j] === null) failed.push(batch[j]!)
            else contents.set(batch[j]!, rewriteGithubImageRefs(texts[j]!, batch[j]!, pd.owner, pd.repo, pd.branch))
          }
        }
        if (contents.size === 0) {
          throw new Error(`lookatstudy-plugin: every designed file failed to fetch (${failed.length}) — the CDN path is unreachable; retry or re-import`)
        }
        if (failed.length > 0) {
          throw new Error(`lookatstudy-plugin: ${failed.length} designed file(s) failed to fetch: ${failed.join(', ')} — drop or fix them and call study_apply_design again`)
        }
      }
      const parsed = buildCourseFromDesign(
        pd.part !== undefined && pd.partCount !== undefined && pd.partCount > 1 ? `${pd.courseTitle} (part ${pd.part})` : pd.courseTitle,
        validated,
        contents,
        pd.translations,
      )
      requireParsedLessons(parsed)
      // upstream v0.33 parse discipline: only a non-empty string counts
      // (empty/null/other types → null = normal course, zero behavior change)
      const languageTarget = typeof args.languageTarget === 'string' && args.languageTarget.trim() !== ''
        ? args.languageTarget.trim().slice(0, 35)
        : null
      const value = mutate(state => toImportValue(importCourse(state, parsed, pd.source, pd.url, languageTarget)))
      pendingDesign = null
      pendingPart = 1
      return { ...value, droppedLessons: validated.droppedLessons, ...(languageTarget !== null ? { languageTarget } : {}) }
    },
    timeoutMs: 180_000,
    presentCall: () => ({ card: 'generic', title: 'Apply course design', kind: 'edit' }),
    presentationMeta: (_args, value) => [
      ...cards.importLines(value),
      ...(value.droppedLessons > 0 ? [`${value.droppedLessons} dropped (files outside the brief)`] : []),
    ],
    presentResult: (_args, result) => ({ card: 'generic', content: textBlocks(result.meta as string[]) }),
  })

  const listCourses = defineTool({
    name: 'study_courses',
    description:
      'List imported courses with progress, average mastery, due reviews, and the current lesson id — plus the '
      + 'learner\'s XP/level/streak block (upstream xp-service + streak). With `query`, runs a full-text '
      + 'multi-keyword AND search over every lesson title AND body (upstream course-tree-filter extended) '
      + 'and returns the hits alongside the course list.',
    parameters: {
      query: { type: 'string', description: 'Optional full-text search: space-separated keywords, all must hit title or body.' },
    },
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
                source: { type: 'string', required: true, enum: ['markdown', 'folder', 'github', 'url'] },
                total: { type: 'integer', required: true },
                mastered: { type: 'integer', required: true },
                avgMasteryPct: { ...nullableInteger, required: true },
                dueCount: { type: 'integer', required: true },
                currentLessonId: { ...nullableString, required: true },
              },
            },
          },
          progress: {
            type: 'object',
            required: true,
            additionalProperties: false,
            description: 'XP + streak block (upstream xp-service/streak semantics).',
            properties: {
              totalXp: { type: 'integer', required: true },
              level: { type: 'integer', required: true },
              levelPct: { type: 'integer', required: true },
              todayXp: { type: 'integer', required: true },
              dailyGoal: { type: 'integer', required: true },
              streak: { type: 'integer', required: true },
              longestStreak: { type: 'integer', required: true },
              freezeCount: { type: 'integer', required: true },
            },
          },
          matches: {
            type: 'array',
            description: 'Full-text hits (present only when query was given).',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                courseId: { type: 'string', required: true },
                courseTitle: { type: 'string', required: true },
                lessonId: { type: 'string', required: true },
                lessonTitle: { type: 'string', required: true },
                snippet: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: (value.courses as Array<{ courseId: string; title: string; source: string; mastered: number; total: number; avgMasteryPct: number | null; dueCount: number; currentLessonId: string | null }>).length === 0
          ? 'No courses imported yet. Import one with study_import_markdown, study_import_folder, study_import_github, or study_import_url.'
          : (value.courses as Array<{ courseId: string; title: string; source: string; mastered: number; total: number; avgMasteryPct: number | null; dueCount: number; currentLessonId: string | null }>).map(c =>
              `[courseId ${c.courseId}] “${c.title}” (${c.source}) — ${c.mastered}/${c.total} lessons mastered`
              + `${c.avgMasteryPct === null ? '' : `, avg mastery ${c.avgMasteryPct}%`}`
              + `${c.dueCount === 0 ? '' : `, ${c.dueCount} reviews due`}`
              + `${c.currentLessonId === null ? '' : `, current lesson ${c.currentLessonId}`}`,
            ).join('\n')
            + `\nXP ${value.progress.totalXp} (Lv${value.progress.level} ${value.progress.levelPct}%), today ${value.progress.todayXp}/${value.progress.dailyGoal}`
            + `, streak ${value.progress.streak}d (best ${value.progress.longestStreak}d, ${value.progress.freezeCount} freeze left)`
            + (Array.isArray(value.matches) && value.matches.length > 0
              ? `\nsearch hits (use study_lesson with the lessonId):\n${(value.matches as Array<{ lessonId: string; lessonTitle: string; courseTitle: string; snippet: string }>).map(m => `- ${m.lessonTitle} [lessonId ${m.lessonId}] (${m.courseTitle}): ${m.snippet}`).join('\n')}`
              : ''),
      }],
    },
    async execute(args) {
      const state = store.get()
      const summaries = courseSummaries(state, new Date())
      const xp = levelFromTotalXp(state.xp.total)
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
        progress: {
          totalXp: state.xp.total,
          level: xp.level,
          levelPct: xp.pct,
          todayXp: state.xp.todayXp,
          dailyGoal: DEFAULT_DAILY_GOAL,
          streak: state.streak.currentStreak,
          longestStreak: state.streak.longestStreak,
          freezeCount: state.streak.freezeCount,
        },
        ...(args.query !== undefined ? { matches: searchLessons(state, args.query) } : {}),
      }
    },
    isConcurrencySafe: () => true,
    presentCall: args => ({ card: 'generic', title: args.query === undefined ? 'List courses' : `Search lessons: ${args.query}`, kind: 'read' }),
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
          examGuide: {
            type: 'object',
            description: 'Exam nodes only: question quota, time-limit rule, star thresholds.',
            additionalProperties: false,
            properties: {
              questionCount: { type: 'integer', required: true },
              kcCount: { type: 'integer', required: true },
              timeLimitRule: { type: 'string', required: true },
              starsRule: { type: 'string', required: true },
              bestStars: { type: 'integer', required: true },
              examAttempts: { type: 'integer', required: true },
            },
          },
          nextLessonId: { ...nullableString, required: true },
          learnerState: { type: 'string', required: true, description: 'Composed learner snapshot (status/mastery/weak/friction/memory).' },
          summary: { type: 'string', description: '1–2 sentence lesson summary (defined with the concepts).' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Lesson “${value.title}” — ${value.courseTitle} / ${value.sectionTitle}\n`
          + `status ${value.status}${value.masteryPct === null ? '' : `, mastery ${value.masteryPct}%`}, `
          + `${value.correctCount}/${value.attempts} answers correct\n`
          + `strategy: ${value.strategy}\n`
          + (value.concepts === null ? '' : `concepts: ${value.concepts.map(c => `${c.title} ${c.masteryPct}%${c.weak ? ' ⚡weak' : ''}`).join(' · ')}\n`)
          + (value.examGuide === undefined ? '' : `exam: ${value.examGuide.questionCount} questions (${value.examGuide.kcCount} KCs); per-question time ${value.examGuide.timeLimitRule}; stars ${value.examGuide.starsRule}\n`)
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

  const examResultTool = defineTool({
    name: 'study_exam_result',
    description:
      'Record one graded section-exam attempt: stars from accuracy (≥95%→3★, ≥80%→2★, ≥60%→1★, '
      + 'below→0; best-of retained across attempts) plus the post-quiz action set the learner should '
      + 'be offered next (explain-wrong / retry / go-deeper / mark-mastered→study_propose_mastery / '
      + 'next-topic). Call once per exam attempt after grading all questions.',
    parameters: {
      lessonId: { type: 'string', required: true, description: 'The exam lesson node id.' },
      correct: { type: 'integer', required: true, description: 'Questions answered correctly.' },
      total: { type: 'integer', required: true, description: 'Questions asked in this attempt (must be > 0).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          lessonId: { type: 'string', required: true },
          lessonTitle: { type: 'string', required: true },
          stars: { type: 'integer', required: true },
          bestStars: { type: 'integer', required: true },
          attempts: { type: 'integer', required: true },
          masteryPct: { type: 'integer', required: true },
          actions: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', enum: ['explain-wrong', 'retry', 'go-deeper', 'mark-mastered', 'next-topic'], required: true },
                label: { type: 'string', required: true },
                advancesMastery: { type: 'boolean' },
              },
            },
          },
          nextLessonId: { ...nullableString, required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Exam result: ${value.stars}★ (best ${value.bestStars}★, attempt ${value.attempts}). `
          + `Offer the learner: ${value.actions.map(a => a.label).join(' / ')}.`
          + (value.nextLessonId === null ? '' : ` Next topic: ${value.nextLessonId}.`),
      }],
    },
    execute(args) {
      return mutate((state) => {
        const r = recordExamResult(state, args.lessonId, args.correct, args.total)
        const actions = getPostQuizActions({ correct: args.correct, total: args.total }, r.ref.lesson.mastery)
        // next-topic: the next non-exam lesson after this exam in course order that is not locked
        const flat = r.ref.course.sections.flatMap(s => s.lessons)
        const idx = flat.findIndex(l => l.id === args.lessonId)
        const next = flat.slice(idx + 1).find(l => l.kind !== 'exam' && l.status !== 'locked') ?? null
        const labels: Record<string, string> = {
          'explain-wrong': '讲解错题',
          retry: '再来一组',
          'go-deeper': '深入这个主题',
          'mark-mastered': '标记掌握 (study_propose_mastery)',
          'next-topic': next === null ? '下一课' : `下一课 (${next.title})`,
        }
        return {
          lessonId: r.ref.lesson.id,
          lessonTitle: r.ref.lesson.title,
          stars: r.stars,
          bestStars: r.bestStars,
          attempts: r.attempts,
          masteryPct: Math.round((r.ref.lesson.mastery ?? 0) * 100),
          actions: actions.map(a => ({ id: a.id, label: labels[a.id] ?? a.id, ...(a.advancesMastery ? { advancesMastery: true } : {}) })),
          nextLessonId: next === null ? null : next.id,
        }
      })
    },
    presentCall: args => ({ card: 'generic', title: `Exam result: ${args.correct}/${args.total}` }),
    presentationMeta: (_args, value) => [`${value.stars}★`],
    presentResult: (_args, result) => ({ card: 'generic', content: textBlocks(result.meta as string[]) }),
  })

  const examBankApplyTool = defineTool({
    name: 'study_exam_bank_apply',
    description:
      'Author the question bank for a section exam node (exam-v2). The exam page asks for a bank when the learner '
      + 'opens it; call this once with the full multiple-choice set. Question count follows planExamQuota on the '
      + 'section\'s KC union (clamp 5-15); each kcTitle MUST be one of the section lessons\' concept titles '
      + '(anti-hallucination — unknown KC titles are rejected; read the section with study_view first). On a '
      + 'validation error the tutor fixes the bank and simply calls again. The learner answers in the exam page; '
      + 'grading is automatic (unanswered = wrong, best-of stars kept).',
    parameters: {
      lessonId: { type: 'string', required: true, description: 'The exam lesson node id.' },
      questions: {
        type: 'array',
        required: true,
        description: 'The full question set (5-15; planExamQuota on the KC union).',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            prompt: { type: 'string', required: true, description: 'Question text (self-contained).' },
            options: { type: 'array', required: true, items: { type: 'string' }, description: 'Answer options (2+).' },
            answer: { type: 'integer', required: true, description: 'Index of the correct option (0-based, original order — the exam page reshuffles).' },
            kcTitle: { type: 'string', description: 'Concept title this question tests; must exist in the section\'s KC union.' },
            explanation: { type: 'string', description: 'One-line why (shown in the per-question review).' },
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
          questionCount: { type: 'integer', required: true },
          kcCount: { type: 'integer', required: true },
          status: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Exam bank ready: ${value.questionCount} questions across ${value.kcCount} knowledge components. `
          + `The exam page settles into its ready state — tell the learner to hit 开始考试.`,
      }],
    },
    execute(args) {
      return mutate((state) => {
        const r = applyExamBank(state, args.lessonId, args.questions, new Date())
        return { lessonId: args.lessonId, questionCount: r.questionCount, kcCount: r.kcCount, status: 'ready' }
      })
    },
    presentCall: args => ({ card: 'generic', title: `Exam bank: ${Array.isArray(args.questions) ? String(args.questions.length) : '?'} questions` }),
    presentationMeta: (_args, value) => [`${value.questionCount}Q`],
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
            title: { type: 'string', required: true, description: 'Short concept title.' },
            description: { type: 'string', required: true, description: 'One line: what understanding this concept means.' },
          },
        },
      },
      summary: { type: 'string', description: 'Optional 1–2 sentence lesson summary (upstream lesson-summary-kc: generated once alongside the concepts).' },
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
        defineConceptsState(state, args.lessonId, args.concepts, args.summary)
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

  const translateLessonTool = defineTool({
    name: 'study_translate_lesson',
    description:
      'Write your translation of one lesson (the tutor IS the translator — upstream runs a model '
      + 'client, the plugin has none). The stored translation renders as a bilingual interleaved '
      + 'blackboard: each original paragraph followed by its translation. Translate faithfully at '
      + 'paragraph granularity so the pairing reads tightly.',
    parameters: {
      lessonId: { type: 'string', required: true, description: 'Lesson to translate.' },
      markdown: { type: 'string', required: true, description: 'The full translated lesson body (markdown, paragraph-aligned with the original).' },
      lang: { type: 'string', required: true, description: 'Language code or name, e.g. zh-CN / 中文.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          lessonId: { type: 'string', required: true },
          lessonTitle: { type: 'string', required: true },
          lang: { type: 'string', required: true },
          chars: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Translation stored for “${value.lessonTitle}” (${value.lang}, ${value.chars} chars) — the blackboard now interleaves the original with it.`,
      }],
    },
    execute(args) {
      return mutate((state) => {
        const ref = findLesson(state, args.lessonId)
        if (args.markdown.trim() === '') throw new Error('lookatstudy-plugin: translation markdown is empty')
        ref.lesson.translation = args.markdown
        ref.lesson.translationLang = args.lang
        return { lessonId: ref.lesson.id, lessonTitle: ref.lesson.title, lang: args.lang, chars: args.markdown.length }
      })
    },
    presentCall: args => ({ card: 'generic', title: `Translate lesson: ${args.lessonId} → ${args.lang}` }),
  })

  const consolidateTool = defineTool({
    name: 'study_consolidate',
    description:
      'Gather the consolidation window — friction entries and practice notes recorded since the last '
      + 'consolidation — and advance the watermark. You are the consolidation function (upstream runs an '
      + 'LLM call; here the tutor IS it): distill the window into 0–3 durable memory writes via '
      + 'study_remember (global style / per-course pattern / lesson-specific gaps), then tell the learner '
      + 'in one short line what you took away. Call when a session accumulates friction or after heavy '
      + 'quizzing — not every turn.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          since: { ...nullableString, required: true },
          entries: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                lessonId: { type: 'string', required: true },
                lessonTitle: { type: 'string', required: true },
                kind: { type: 'string', required: true, enum: ['friction', 'practice'] },
                category: { type: 'string' },
                text: { type: 'string', required: true },
                at: { type: 'string', required: true },
              },
            },
          },
          counts: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: { friction: { type: 'integer', required: true }, practice: { type: 'integer', required: true } },
          },
          watermark: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Consolidation window since ${value.since ?? '(beginning)'}: ${value.counts.friction} friction, ${value.counts.practice} practice entries.`
          + (value.entries.length === 0 ? ' Nothing to distill — tell the learner their memory is up to date.' : ' Distill these into 0–3 study_remember writes (global / pattern / lesson), then summarize in one line.'),
      }],
    },
    execute() {
      return mutate((state) => {
        const window = gatherConsolidationWindow(state)
        const watermark = new Date().toISOString()
        state.lastConsolidatedAt = watermark
        return { since: window.since, entries: window.entries, counts: window.counts, watermark }
      })
    },
    presentCall: () => ({ card: 'generic', title: 'Consolidate learner memory' }),
  })

  const exportTool = defineTool({
    name: 'study_export',
    description:
      'Export one course as a single markdown learning pack (upstream pack-export, zero-LLM): sections and '
      + 'lesson bodies verbatim. The receiver imports it anywhere through study_import_markdown — same plugin, '
      + 'fresh machine, no network. Present the pack to the learner (a copyable block) or save it into the study '
      + 'workspace when they ask for a file.',
    parameters: {
      courseId: { type: 'string', required: true, description: 'Course id to export.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          courseId: { type: 'string', required: true },
          title: { type: 'string', required: true },
          lessonCount: { type: 'integer', required: true },
          chars: { type: 'integer', required: true },
          markdown: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Course pack “${value.title}” — ${value.lessonCount} lessons, ${value.chars} chars. `
          + 'Give the learner the markdown below (copyable); importing it goes through study_import_markdown.\n\n'
          + value.markdown,
      }],
    },
    execute(args) {
      const course = findCourse(store.get(), args.courseId)
      const markdown = courseToPackMarkdown(course)
      const lessonCount = course.sections.reduce((n, sec) => n + sec.lessons.filter(l => l.kind !== 'exam').length, 0)
      return { courseId: course.id, title: course.title, lessonCount, chars: markdown.length, markdown }
    },
    isConcurrencySafe: () => true,
    presentCall: args => ({ card: 'generic', title: `Export course: ${args.courseId}`, kind: 'read' }),
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

  const generateQuizTool = defineTool({
    name: 'study_generate_quiz',
    description:
      'Generate an interactive practice card (quiz artifact) for the focus lesson: 3-4 questions (5 max), '
      + 'each with 2-6 options, the 0-based correct `answer` index, and an `explanation` of why it is right. '
      + 'The learner answers on the card itself (locally judged, progress kept); when they finish, a summary '
      + 'hook arrives in the conversation — acknowledge it, address wrong answers, do NOT re-grade these '
      + 'through study_record_answer. Use for practice blocks and review consolidation; single conversational '
      + 'questions stay as prose A-D options.',
    parameters: {
      lessonId: { type: 'string', required: true, description: 'Lesson the practice card belongs to.' },
      title: { type: 'string', description: 'Card title (defaults to 练习).' },
      questions: {
        type: 'array',
        required: true,
        description: 'The questions, in answering order.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            prompt: { type: 'string', required: true },
            options: { type: 'array', required: true, items: { type: 'string' } },
            answer: { type: 'integer', required: true, description: '0-based index into options.' },
            explanation: { type: 'string', required: true, description: 'Why the right answer is right.' },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          artifactType: { type: 'string', required: true, enum: ['quiz'] },
          artifactId: { type: 'string', required: true },
          created: { type: 'boolean', required: true },
          title: { type: 'string', required: true },
          questions: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                prompt: { type: 'string', required: true },
                options: { type: 'array', required: true, items: { type: 'string' } },
                answer: { type: 'integer', required: true },
                explanation: { type: 'string', required: true },
              },
            },
          },
          warnings: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Practice card (${value.questions.length} questions): ${value.title}${value.created ? '' : ' (already recorded)'}${value.warnings === undefined || value.warnings.length === 0 ? '' : ` — warnings: ${value.warnings.join('; ')}`}`,
      }],
    },
    async execute(args) {
      const sanitized = sanitizeQuiz(args)
      return mutate((state) => {
        const id = artifactId('quiz', sanitized.data)
        const artifact: StudyArtifact = {
          id,
          artifactType: 'quiz',
          title: typeof sanitized.data.title === 'string' ? sanitized.data.title : '练习',
          createdAt: new Date().toISOString(),
          hash: id.slice('quiz-'.length),
          data: sanitized.data,
        }
        const result = recordArtifact(state, args.lessonId, artifact)
        return {
          artifactType: 'quiz',
          artifactId: result.artifact.id,
          created: result.created,
          title: result.artifact.title,
          questions: (result.artifact.data.questions ?? []) as Array<{ prompt: string; options: string[]; answer: number; explanation: string }>,
          warnings: (result.artifact.data.warnings ?? []) as string[],
        }
      })
    },
    presentCall: args => ({ card: 'generic', title: `Generate practice card: ${typeof args.title === 'string' ? args.title : '练习'} (${args.questions?.length ?? 0} questions)` }),
  })

  /** Record one sanitized artifact on its lesson (shared by the artifact tools). */
  const recordSanitized = (lessonId: string, result: SanitizeResult, type: StudyArtifact['artifactType']): Promise<Record<string, unknown>> =>
    mutate((state) => {
      const id = artifactId(type, result.data)
      const artifact: StudyArtifact = {
        id,
        artifactType: type,
        title: typeof result.data.title === 'string' ? result.data.title : type,
        createdAt: new Date().toISOString(),
        hash: id.slice(type.length + 1),
        data: result.data,
      }
      const stored = recordArtifact(state, lessonId, artifact)
      return { artifactType: type, artifactId: stored.artifact.id, created: stored.created, ...stored.artifact.data }
    })

  const poseGuessTool = defineTool({
    name: 'study_pose_guess',
    description:
      'Pose the opening two-option guess (the curiosity hook): one or two sentences of prose first '
      + '(counter-intuitive, everyday-related), then this tool with exactly 2 short options. The learner '
      + 'picks one; you reveal the answer NEXT turn and teach the lesson\'s core point. Iron rules: '
      + 'unscored, never touches mastery, never say 答对/答错 — this is a hook, not a quiz.',
    parameters: {
      lessonId: { type: 'string', required: true, description: 'Lesson the guess belongs to.' },
      prompt: { type: 'string', required: true, description: 'e.g. 你觉得：递归算阶乘会比循环——更慢，还是差不多？' },
      options: {
        type: 'array', required: true, description: 'Exactly 2 options.',
        items: {
          type: 'object', additionalProperties: false,
          properties: { id: { type: 'string', required: true }, label: { type: 'string', required: true } },
        },
      },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          artifactType: { type: 'string', required: true, enum: ['guess'] },
          artifactId: { type: 'string', required: true },
          created: { type: 'boolean', required: true },
          prompt: { type: 'string', required: true },
          options: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: { id: { type: 'string', required: true }, label: { type: 'string', required: true } },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Guess posed: ${value.prompt}` }],
    },
    async execute(args) {
      return recordSanitized(args.lessonId, sanitizeGuess(args), 'guess')
    },
    presentCall: args => ({ card: 'generic', title: `Pose guess: ${typeof args.prompt === 'string' ? args.prompt.slice(0, 40) : ''}` }),
  })

  const compareTableTool = defineTool({
    name: 'study_compare_table',
    description:
      'Generate a compare table for two or more concepts/solutions/technologies — when the learner asks '
      + 'A 和 B 有什么区别 or a horizontal comparison helps. Rendered as a table artifact card.',
    parameters: {
      lessonId: { type: 'string', required: true, description: 'Lesson the table belongs to.' },
      title: { type: 'string', required: true, description: 'e.g. SQL vs NoSQL' },
      headers: { type: 'array', required: true, items: { type: 'string' }, description: 'Column names (first is usually the dimension).' },
      rows: { type: 'array', required: true, items: { type: 'array', items: { type: 'string' } }, description: 'Rows; each row has headers.length cells.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          artifactType: { type: 'string', required: true, enum: ['compare_table'] },
          artifactId: { type: 'string', required: true },
          created: { type: 'boolean', required: true },
          title: { type: 'string', required: true },
          headers: { type: 'array', required: true, items: { type: 'string' } },
          rows: { type: 'array', required: true, items: { type: 'array', items: { type: 'string' } } },
          warnings: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Compare table: ${value.title} (${(value.rows as unknown[]).length} rows)` }],
    },
    async execute(args) {
      return recordSanitized(args.lessonId, sanitizeCompareTable(args), 'compare_table')
    },
    presentCall: args => ({ card: 'generic', title: `Compare table: ${typeof args.title === 'string' ? args.title : ''}` }),
  })

  const drawDiagramTool = defineTool({
    name: 'study_draw_diagram',
    description:
      'Draw a structured mermaid diagram: steps/decisions/causality → flowchart TD (or LR for short '
      + 'chains); multi-party interactions → sequenceDiagram; states/transitions → stateDiagram-v2. '
      + 'Return valid mermaid syntax only (no outer fences). Rendered as a diagram artifact card.',
    parameters: {
      lessonId: { type: 'string', required: true, description: 'Lesson the diagram belongs to.' },
      title: { type: 'string', required: true },
      diagramType: { type: 'string', required: true, enum: ['flowchart', 'sequence', 'state'] },
      mermaid: { type: 'string', required: true, description: 'Mermaid code without fences.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          artifactType: { type: 'string', required: true, enum: ['diagram'] },
          artifactId: { type: 'string', required: true },
          created: { type: 'boolean', required: true },
          title: { type: 'string', required: true },
          diagramType: { type: 'string', required: true },
          mermaid: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Diagram: ${value.title} (${value.diagramType})` }],
    },
    async execute(args) {
      return recordSanitized(args.lessonId, sanitizeDiagram(args), 'diagram')
    },
    presentCall: args => ({ card: 'generic', title: `Draw diagram: ${typeof args.title === 'string' ? args.title : ''}` }),
  })

  const codeWalkthroughTool = defineTool({
    name: 'study_code_walkthrough',
    description:
      'Walk through a piece of code line-by-line / segment-by-segment — when the learner asks what the '
      + 'code means or the lesson contains code needing teardown. Rendered with line numbers + per-segment notes.',
    parameters: {
      lessonId: { type: 'string', required: true, description: 'Lesson the walkthrough belongs to.' },
      title: { type: 'string', required: true },
      language: { type: 'string', required: true, description: 'e.g. typescript / python' },
      code: { type: 'string', required: true },
      annotations: {
        type: 'array', required: true, description: 'Per-segment notes.',
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            lineStart: { type: 'integer', required: true },
            lineEnd: { type: 'integer', required: true },
            note: { type: 'string', required: true },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          artifactType: { type: 'string', required: true, enum: ['code_walkthrough'] },
          artifactId: { type: 'string', required: true },
          created: { type: 'boolean', required: true },
          title: { type: 'string', required: true },
          language: { type: 'string', required: true },
          code: { type: 'string', required: true },
          annotations: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                lineStart: { type: 'integer', required: true },
                lineEnd: { type: 'integer', required: true },
                note: { type: 'string', required: true },
              },
            },
          },
          warnings: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Code walkthrough: ${value.title} (${(value.annotations as unknown[]).length} segments)` }],
    },
    async execute(args) {
      return recordSanitized(args.lessonId, sanitizeCodeWalkthrough(args), 'code_walkthrough')
    },
    presentCall: args => ({ card: 'generic', title: `Code walkthrough: ${typeof args.title === 'string' ? args.title : ''}` }),
  })

  return [
    importMarkdown,
    importFolder,
    importGithub,
    importUrl,
    applyDesign,
    listCourses,
    courseMap,
    lessonContent,
    recordAnswerTool,
    examResultTool,
    examBankApplyTool,
    completeLessonTool,
    dueReviewsTool,
    recordReviewTool,
    deleteCourseTool,
    defineConceptsTool,
    proposeMasteryTool,
    resolveProposalTool,
    reportFrictionTool,
    rememberTool,
    consolidateTool,
    translateLessonTool,
    exportTool,
    noteSaveTool,
    notesTool,
    generateQuizTool,
    poseGuessTool,
    compareTableTool,
    drawDiagramTool,
    codeWalkthroughTool,
    setModeTool,
  ]
}

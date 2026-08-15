/**
 * Learning state: courses → sections → lessons with mastery-driven gating,
 * per-concept (KC) BKT tracking aggregated as the weakest concept, SM-2
 * spaced repetition, pending mastery proposals, friction log, learner
 * memory, and Cornell-style notes. Persisted as one JSON file; every
 * mutation is saved synchronously.
 * @module dsh-plugin-lookatstudy/state
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { computeSm2, type ReviewQuality, type Sm2State } from './vendor/sm2.ts'
import { masteryToCrown, updateMastery } from './vendor/bkt.ts'
import type { ParsedCourse } from './vendor/markdown-course.ts'

/** Lesson position on the mastery-gated path (LookatStudy NodeStatus). */
export type LessonStatus = 'locked' | 'available' | 'in_progress' | 'mastered'

/** Lesson role: gated teaching material, free practice material (LookatStudy's 实操 world), or a section exam node gated on sibling mastery. */
export type LessonKind = 'study' | 'practice' | 'exam'

/** Tutoring persona (soul), switchable at runtime. */
export type StudyMode = 'direct' | 'guide' | 'practice'

/** Friction categories the tutor silently logs (ported from LookatStudy). */
export type FrictionCategory = 'confused' | 'blocked' | 'frustrated'

/** Memory slot: cross-course style, per-course pattern, or per-lesson note. */
export type MemoryCategory = 'global' | 'pattern' | 'lesson'

/** Cornell notebook zone: structures (AI) / learner records / practice log. */
export type NoteZone = 'understand' | 'record' | 'practice'

/** Where a note's content came from. */
export type NoteSource = 'ai' | 'content' | 'chat'

/** One knowledge component a lesson can be quizzed on independently. */
export interface ConceptDef {
  title: string
  description: string
}

/** One learner-facing note in the notebook zones. */
export interface LessonNote {
  id: string
  zone: NoteZone
  title: string
  text: string
  source: NoteSource
  /** Quoted source text the note refers to (record zone), verbatim. */
  quote: string | null
  at: string
}

/** One logged friction event. */
export interface FrictionEntry {
  category: FrictionCategory
  summary: string | null
  at: string
}

/** A tutor-proposed state change awaiting the learner's decision in chat. */
export interface MasteryProposal {
  id: string
  lessonId: string
  rationale: string
  status: 'pending' | 'applied' | 'rejected'
  createdAt: string
}

/** One lesson: content plus the learner's tracked state. */
export interface LessonState {
  /** Stable id of the form `${courseId}:${sectionIndex}:${lessonIndex}`. */
  id: string
  title: string
  anchor: string
  /** Lesson markdown body (verbatim from import). */
  body: string
  /** Teaching node or section exam node (exams gate on sibling mastery in the UI). */
  kind: LessonKind
  status: LessonStatus
  /** Knowledge components defined by the tutor (null until defined). */
  concepts: ConceptDef[] | null
  /** Per-concept BKT P(known), keyed by concept index. */
  conceptMastery: Record<number, number> | null
  /** Lesson-level BKT P(known); equals min(concepts) once KCs exist. */
  mastery: number | null
  attempts: number
  correctCount: number
  lastAnsweredAt: string | null
  completedAt: string | null
  /** SM-2 scheduling state; null until the lesson is completed. */
  sm2: Sm2State | null
  /** Next SM-2 review due time (ISO); null until the lesson is completed. */
  dueAt: string | null
  /** Silent friction log for this lesson (most recent last, capped). */
  friction: FrictionEntry[]
  /** Per-lesson memory slot ("what specifically is missing here"). */
  memory: string | null
  /** Cornell notebook entries across the three zones. */
  notes: LessonNote[]
}

/** A section holding an ordered list of lessons. */
export interface SectionState {
  title: string
  anchor: string
  lessons: LessonState[]
}

/** Where a course came from. */
export type CourseSource = 'markdown' | 'folder' | 'github'

/** One imported course. */
export interface CourseState {
  id: string
  title: string
  source: CourseSource
  /** Markdown text, folder path, or repo URL the course was imported from. */
  sourceRef: string
  createdAt: string
  sections: SectionState[]
}

/** Whole persisted state; `version` gates migrations (v1 → v2 renamed completed→mastered and added lesson.kind). */
export interface LearningState {
  version: 2
  courses: CourseState[]
  /** Active tutoring soul. */
  mode: StudyMode
  /** Lesson the learner last opened (snapshot focus), or null. */
  focus: { lessonId: string } | null
  /** Cross-course style memory. */
  memoryGlobal: string | null
  /** Per-course friction-pattern memory. */
  memoryPatterns: Record<string, string>
  /** Mastery proposals across courses. */
  proposals: MasteryProposal[]
}

/** A lesson located inside its course, for mutation results. */
export interface LessonRef {
  course: CourseState
  section: SectionState
  lesson: LessonState
}

const DAY_MS = 86_400_000
/** Mastery at or above this graduates the lesson automatically (LookatStudy MASTERED_MASTERY_THRESHOLD). */
export const MASTERED_THRESHOLD = 0.9
/** Mastery at or above this makes the next lesson available early (LookatStudy UNLOCK_MASTERY_THRESHOLD). */
export const UNLOCK_THRESHOLD = 0.5
/** Mastery near this lets the tutor propose early graduation (LookatStudy NEAR_MASTERED_THRESHOLD). */
export const NEAR_MASTERED_THRESHOLD = 0.85
/** Concepts below this mastery are flagged weak (LookatStudy kcContext). */
export const WEAK_CONCEPT_THRESHOLD = 0.7
const FRICTION_CAP = 10

/** Fresh empty state for a first run. */
export function emptyState(): LearningState {
  return { version: 2, courses: [], mode: 'guide', focus: null, memoryGlobal: null, memoryPatterns: {}, proposals: [] }
}

/**
 * Resolve the state-file location: explicit config path wins, otherwise
 * `$DSH_HOME ?? ~/.dsh` under a plugin-named subdirectory.
 * @param configured - Config `statePath` (empty means default).
 * @returns absolute state-file path.
 */
export function resolveStatePath(configured: string): string {
  if (configured !== '') return configured
  const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(dshHome, 'lookatstudy-plugin', 'state.json')
}

/**
 * Load persisted state; a missing file yields empty state, a corrupt file fails loud.
 * v1 → v2 migration: `completed` lessons become `mastered`, lessons gain `kind`
 * (default `study`). Newer files than this code knows are rejected.
 * @param path - state-file path.
 * @returns the loaded state.
 */
export function loadState(path: string): LearningState {
  if (!existsSync(path)) return emptyState()
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`lookatstudy-plugin: state file is not valid JSON: ${path} (${String(error)})`)
  }
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as LearningState).courses)) {
    throw new Error(`lookatstudy-plugin: state file has an unexpected shape: ${path}`)
  }
  const raw = parsed as Partial<LearningState> & { version?: number }
  if (raw.version !== undefined && raw.version > 2) {
    throw new Error(`lookatstudy-plugin: state file version ${raw.version} is newer than this plugin supports: ${path}`)
  }
  const courses = raw.courses!.map(course => ({
    ...course,
    sections: course.sections.map(section => ({
      ...section,
      lessons: section.lessons.map(lesson => ({
        ...lesson,
        kind: lesson.kind ?? 'study',
        status: lesson.status === ('completed' as LessonStatus) ? 'mastered' : lesson.status,
      })),
    })),
  }))
  for (const course of courses) {
    // LookatStudy's ensureExamNodesForExistingCourses: courses imported before
    // exam nodes existed gain them at load (appended per section end, so
    // existing lesson ids never move).
    course.sections.forEach((section, si) => {
      const hasExam = section.lessons.some(l => l.kind === 'exam')
      const studyCount = section.lessons.filter(l => l.kind === 'study').length
      if (!hasExam && studyCount >= 2) {
        section.lessons.push({
          ...freshLesson(`${section.title} · 章节测验`, `${section.anchor}#exam`, '', 'exam'),
          id: `${course.id}:${si}:${section.lessons.length}`,
          status: 'available',
        })
      }
    })
  }
  return {
    version: 2,
    courses,
    mode: raw.mode ?? 'guide',
    focus: raw.focus ?? null,
    memoryGlobal: raw.memoryGlobal ?? null,
    memoryPatterns: raw.memoryPatterns ?? {},
    proposals: raw.proposals ?? [],
  }
}

/**
 * Persist state atomically (write a sibling temp file, then rename).
 * @param path - state-file path.
 * @param state - state to persist.
 */
export function saveState(path: string, state: LearningState): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  renameSync(tmp, path)
}

/**
 * Slugify a course title into an id prefix: lowercase alphanumerics joined by `-`.
 * @param title - course title.
 * @returns slug, at least `course`.
 */
function slugify(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug === '' ? 'course' : slug
}

function freshLesson(title: string, anchor: string, body: string, kind: LessonKind = 'study'): LessonState {
  return {
    id: '',
    title,
    anchor,
    body,
    kind,
    status: 'locked',
    concepts: null,
    conceptMastery: null,
    mastery: null,
    attempts: 0,
    correctCount: 0,
    lastAnsweredAt: null,
    completedAt: null,
    sm2: null,
    dueAt: null,
    friction: [],
    memory: null,
    notes: [],
  }
}

/**
 * Import a parsed course. Idempotent: the id is the title slug, so importing
 * the same source again returns the existing course unchanged (LookatStudy's
 * pasted-markdown contract, applied to every source). Study lessons are gated
 * (first available, rest locked); every study section with ≥2 lessons also
 * gets a 章节测验 exam node (available in state, gated on sibling mastery in
 * the UI — LookatStudy's rule).
 * @param state - state to mutate.
 * @param parsed - course tree from an importer.
 * @param source - import origin.
 * @param sourceRef - markdown/folder/repo reference for display.
 * @returns the imported (or pre-existing) course.
 */
export function importCourse(
  state: LearningState,
  parsed: ParsedCourse,
  source: CourseSource,
  sourceRef: string,
): CourseState {
  const id = slugify(parsed.title)
  const existing = state.courses.find(c => c.id === id)
  if (existing) return existing
  const course: CourseState = {
    id,
    title: parsed.title,
    source,
    sourceRef,
    createdAt: new Date().toISOString(),
    sections: parsed.sections.map(section => {
      const lessons = section.lessons.map(lesson =>
        freshLesson(lesson.title, lesson.anchor, lesson.body, lesson.world === 'practice' ? 'practice' : 'study'))
      if (section.world !== 'practice' && lessons.filter(l => l.kind === 'study').length >= 2) {
        lessons.push(freshLesson(`${section.title} · 章节测验`, `${section.anchor}#exam`, section.examBody ?? '', 'exam'))
      }
      return { title: section.title, anchor: section.anchor, lessons }
    }),
  }
  let first = true
  for (let si = 0; si < course.sections.length; si++) {
    const lessons = course.sections[si]!.lessons
    for (let li = 0; li < lessons.length; li++) {
      const lesson = lessons[li]!
      lesson.id = `${id}:${si}:${li}`
      if (lesson.kind === 'exam' || lesson.kind === 'practice') {
        lesson.status = 'available'
      } else if (first) {
        lesson.status = 'available'
        first = false
      }
    }
  }
  state.courses.push(course)
  return course
}

/**
 * Drop a course from state; unknown ids fail loud.
 * @param state - state to mutate.
 * @param courseId - course to remove.
 */
export function deleteCourse(state: LearningState, courseId: string): void {
  const i = state.courses.findIndex(c => c.id === courseId)
  if (i < 0) throw new Error(`lookatstudy-plugin: unknown course id ${JSON.stringify(courseId)}`)
  state.courses.splice(i, 1)
  state.proposals = state.proposals.filter(p => !p.lessonId.startsWith(`${courseId}:`))
}

/**
 * Locate a course; unknown ids fail loud.
 * @param state - state to search.
 * @param courseId - course id.
 * @returns the course.
 */
export function findCourse(state: LearningState, courseId: string): CourseState {
  const course = state.courses.find(c => c.id === courseId)
  if (!course) throw new Error(`lookatstudy-plugin: unknown course id ${JSON.stringify(courseId)}`)
  return course
}

/**
 * Locate a lesson by its hierarchical id; unknown ids fail loud.
 * @param state - state to search.
 * @param lessonId - lesson id (`courseId:sectionIndex:lessonIndex`).
 * @returns course/section/lesson references.
 */
export function findLesson(state: LearningState, lessonId: string): LessonRef {
  const parts = lessonId.split(':')
  const li = parts.pop()
  const si = parts.pop()
  const courseId = parts.join(':')
  const course = findCourse(state, courseId)
  const sectionIndex = Number.parseInt(si ?? '', 10)
  const lessonIndex = Number.parseInt(li ?? '', 10)
  if (Number.isInteger(sectionIndex) && Number.isInteger(lessonIndex)) {
    const section = course.sections[sectionIndex]
    const lesson = section?.lessons[lessonIndex]
    if (lesson && lesson.id === lessonId) {
      return { course, section: section!, lesson }
    }
  }
  throw new Error(`lookatstudy-plugin: unknown lesson id ${JSON.stringify(lessonId)}`)
}

/**
 * Find the next STUDY lesson after the given one in flat course order
 * (practice/exam nodes never gate the path).
 * @param course - course to walk.
 * @param lessonId - current lesson id.
 * @returns the next study lesson, or null at the end of the path.
 */
export function nextLesson(course: CourseState, lessonId: string): LessonState | null {
  const flat = course.sections.flatMap(s => s.lessons)
  const i = flat.findIndex(l => l.id === lessonId)
  for (let j = i + 1; j < flat.length; j++) {
    if (flat[j]!.kind === 'study') return flat[j]!
  }
  return null
}

/**
 * LookatStudy's dual-track unlock, fired whenever the current lesson reaches
 * mastery ≥0.5 (which includes the 0.5 seed from the first attempt): unlock
 * (1) the next locked study lesson later in the same section AND (2) the
 * first study lesson of the next section. Only `locked` nodes ever change;
 * nothing re-locks.
 * @param ref - the lesson that reached the threshold.
 * @returns the lessons unlocked by this call.
 */
function unlockAfter(ref: LessonRef): Array<{ id: string; title: string }> {
  const unlocked: Array<{ id: string; title: string }> = []
  const lessons = ref.section.lessons
  const li = lessons.indexOf(ref.lesson)
  for (let i = li + 1; i < lessons.length; i++) {
    const next = lessons[i]!
    if (next.kind !== 'study') continue
    if (next.status === 'locked') {
      next.status = 'available'
      unlocked.push({ id: next.id, title: next.title })
    }
    break
  }
  const si = ref.course.sections.indexOf(ref.section)
  const nextSection = ref.course.sections[si + 1]
  if (nextSection !== undefined) {
    const first = nextSection.lessons.find(l => l.kind === 'study')
    if (first !== undefined && first.status === 'locked') {
      first.status = 'available'
      unlocked.push({ id: first.id, title: first.title })
    }
  }
  return unlocked
}

/** Recompute lesson mastery as the weakest concept once KCs exist. */
function aggregateMastery(lesson: LessonState): void {
  if (lesson.concepts === null || lesson.conceptMastery === null) return
  const values = lesson.concepts.map((_, i) => lesson.conceptMastery![i] ?? 0.5)
  lesson.mastery = Math.min(...values)
}

/**
 * Graduate a lesson: mark mastered, seed its SM-2 schedule if absent (first
 * review due tomorrow), and run the dual-track unlock.
 */
function graduate(lesson: LessonState, course: CourseState, now: Date): Array<{ id: string; title: string }> {
  if (lesson.status !== 'mastered') {
    lesson.status = 'mastered'
    lesson.completedAt = now.toISOString()
    if (lesson.sm2 === null) {
      lesson.sm2 = { easeFactor: 2.5, intervalDays: 1, repetitions: 0 }
      lesson.dueAt = new Date(now.getTime() + DAY_MS).toISOString()
    }
  }
  const si = course.sections.findIndex(s => s.lessons.includes(lesson))
  return unlockAfter({ course, section: course.sections[si]!, lesson })
}

/** Outcome details shared by answer recording and proposal application. */
export interface Progression {
  graduated: boolean
  unlocked: Array<{ id: string; title: string }>
  nextDue: string | null
  courseComplete: boolean
}

/** Whether every study lesson of the course is mastered. */
function courseComplete(course: CourseState): boolean {
  return course.sections.every(s => s.lessons.every(l => l.kind !== 'study' || l.status === 'mastered'))
}

/** Describe the path effects of a mastery change (early unlock, graduation). */
function applyProgression(ref: LessonRef, now: Date): Progression {
  const before = ref.lesson.status
  const graduated = ref.lesson.mastery !== null && ref.lesson.mastery >= MASTERED_THRESHOLD
  let unlocked: Array<{ id: string; title: string }> = []
  if (graduated && before !== 'mastered') {
    unlocked = graduate(ref.lesson, ref.course, now)
  } else if (ref.lesson.mastery !== null && ref.lesson.mastery >= UNLOCK_THRESHOLD) {
    unlocked = unlockAfter(ref)
  }
  return {
    graduated: graduated && before !== 'mastered',
    unlocked,
    nextDue: ref.lesson.dueAt,
    courseComplete: courseComplete(ref.course),
  }
}

/** Full result of recording one graded answer. */
export interface AnswerResult {
  ref: LessonRef
  concept: { title: string; mastery: number } | null
  prevMastery: number
  newMastery: number
  crown: number
  mastered: boolean
  progression: Progression
}

/**
 * Open a lesson for study (LookatStudy markNodeAttempted): locked lessons
 * fail loud; the first open of an `available` lesson marks it `in_progress`,
 * seeds mastery at the BKT prior (0.5), and — because 0.5 already meets the
 * unlock threshold — runs the dual-track unlock, so merely starting a lesson
 * lights up the next ones.
 * @param state - state to mutate.
 * @param lessonId - lesson to open.
 * @param now - current time.
 * @returns the lesson ref, whether this open started it, and what unlocked.
 */
export function attemptLesson(
  state: LearningState,
  lessonId: string,
  now: Date,
): { ref: LessonRef; started: boolean; unlocked: Array<{ id: string; title: string }> } {
  const ref = findLesson(state, lessonId)
  if (ref.lesson.status === 'locked') {
    throw new Error(`lookatstudy-plugin: lesson ${JSON.stringify(lessonId)} is locked; complete earlier lessons first`)
  }
  if (ref.lesson.status !== 'available') {
    return { ref, started: false, unlocked: [] }
  }
  ref.lesson.status = 'in_progress'
  ref.lesson.lastAnsweredAt = now.toISOString()
  if (ref.lesson.mastery === null) ref.lesson.mastery = 0.5
  return { ref, started: true, unlocked: unlockAfter(ref) }
}

/**
 * Record one graded answer against a lesson: attribute it to one knowledge
 * component when named, update BKT (per-KC, aggregated as the weakest),
 * nudge the SM-2 schedule when one exists, and apply mastery-driven
 * progression (early unlock at 0.5, graduation at 0.9). Locked lessons fail
 * loud — open the lesson first (study_lesson does).
 * @param state - state to mutate.
 * @param lessonId - lesson to update.
 * @param correct - whether the learner answered correctly.
 * @param concept - concept title the question tested, when attributable.
 * @param now - current time.
 * @returns mastery transition, KC attribution, and progression effects.
 */
export function recordAnswer(
  state: LearningState,
  lessonId: string,
  correct: boolean,
  concept: string | undefined,
  now: Date,
): AnswerResult {
  const ref = findLesson(state, lessonId)
  if (ref.lesson.status === 'locked') {
    throw new Error(`lookatstudy-plugin: lesson ${JSON.stringify(lessonId)} is locked; open it with study_lesson first`)
  }
  if (ref.lesson.status === 'available') ref.lesson.status = 'in_progress'
  const kcIndex = concept === undefined
    ? undefined
    : ref.lesson.concepts?.findIndex(c => c.title === concept)
  if (concept !== undefined && (ref.lesson.concepts === null || kcIndex === undefined || kcIndex < 0)) {
    throw new Error(
      `lookatstudy-plugin: unknown concept ${JSON.stringify(concept)} on lesson ${JSON.stringify(lessonId)} — define concepts with study_define_concepts first`,
    )
  }
  const prev = ref.lesson.mastery
  if (ref.lesson.concepts !== null && kcIndex !== undefined) {
    const masteries = ref.lesson.conceptMastery ?? {}
    masteries[kcIndex] = updateMastery(masteries[kcIndex], correct)
    ref.lesson.conceptMastery = masteries
    aggregateMastery(ref.lesson)
  } else if (ref.lesson.concepts !== null) {
    // No attribution: conservatively update every concept (LookatStudy semantics).
    const masteries = ref.lesson.conceptMastery ?? {}
    ref.lesson.concepts.forEach((_, i) => {
      masteries[i] = updateMastery(masteries[i], correct)
    })
    ref.lesson.conceptMastery = masteries
    aggregateMastery(ref.lesson)
  } else {
    ref.lesson.mastery = updateMastery(prev, correct)
  }
  ref.lesson.attempts += 1
  if (correct) ref.lesson.correctCount += 1
  ref.lesson.lastAnsweredAt = now.toISOString()
  // BKT↔SRS loop: a graded answer nudges the review schedule (correct→5, wrong→2).
  if (ref.lesson.sm2 !== null) {
    const result = computeSm2(ref.lesson.sm2, (correct ? 5 : 2) as ReviewQuality, now)
    ref.lesson.sm2 = { easeFactor: result.easeFactor, intervalDays: result.intervalDays, repetitions: result.repetitions }
    ref.lesson.dueAt = result.dueAt
  }
  const progression = applyProgression(ref, now)
  return {
    ref,
    concept: kcIndex === undefined ? null : { title: concept!, mastery: ref.lesson.conceptMastery![kcIndex]! },
    prevMastery: prev ?? 0,
    newMastery: ref.lesson.mastery ?? 0,
    crown: masteryToCrown(ref.lesson.mastery),
    mastered: (ref.lesson.mastery ?? 0) >= MASTERED_THRESHOLD,
    progression,
  }
}

/**
 * Complete a lesson explicitly (the manual path; mastery graduation is the
 * automatic one). Locked lessons fail loud.
 * @param state - state to mutate.
 * @param lessonId - lesson to complete.
 * @param now - current time.
 * @returns completion result including the unlocked lessons.
 */
export function completeLesson(
  state: LearningState,
  lessonId: string,
  now: Date,
): { ref: LessonRef; unlocked: Array<{ id: string; title: string }>; dueAt: string; courseComplete: boolean } {
  const ref = findLesson(state, lessonId)
  if (ref.lesson.status === 'locked') {
    throw new Error(`lookatstudy-plugin: lesson ${JSON.stringify(lessonId)} is locked; complete earlier lessons first`)
  }
  const unlocked = graduate(ref.lesson, ref.course, now)
  return {
    ref,
    unlocked,
    dueAt: ref.lesson.dueAt ?? new Date(now.getTime() + DAY_MS).toISOString(),
    courseComplete: courseComplete(ref.course),
  }
}

/**
 * Define (or replace) a lesson's knowledge components — the independently
 * quizzable units per-KC mastery tracks. Existing per-KC mastery resets.
 * @param state - state to mutate.
 * @param lessonId - lesson to describe.
 * @param concepts - 2–7 short concepts.
 */
export function defineConcepts(state: LearningState, lessonId: string, concepts: ConceptDef[]): void {
  const ref = findLesson(state, lessonId)
  if (concepts.length < 2 || concepts.length > 7) {
    throw new Error(`lookatstudy-plugin: define 2–7 concepts (got ${concepts.length})`)
  }
  for (const def of concepts) {
    if (def.title.trim() === '' || def.description.trim() === '') {
      throw new Error('lookatstudy-plugin: every concept needs a non-empty title and description')
    }
  }
  ref.lesson.concepts = concepts.map(c => ({ title: c.title.trim(), description: c.description.trim() }))
  ref.lesson.conceptMastery = {}
  aggregateMastery(ref.lesson)
}

/**
 * Log one silent friction event (confusion / block / frustration).
 * @param state - state to mutate.
 * @param lessonId - lesson it happened on, when attributable.
 * @param category - friction category.
 * @param summary - optional one-line description.
 * @param now - current time.
 */
export function addFriction(
  state: LearningState,
  lessonId: string | null,
  category: FrictionCategory,
  summary: string | null,
  now: Date,
): void {
  const entry: FrictionEntry = { category, summary, at: now.toISOString() }
  if (lessonId === null) {
    // Course-less friction still counts toward the global pattern slot material.
    return
  }
  const ref = findLesson(state, lessonId)
  ref.lesson.friction.push(entry)
  if (ref.lesson.friction.length > FRICTION_CAP) ref.lesson.friction.splice(0, ref.lesson.friction.length - FRICTION_CAP)
}

/**
 * Set a memory slot. The tutor merges mentally before writing (read the
 * current slot, then send the merged 1–3 sentence text).
 * @param state - state to mutate.
 * @param category - which slot.
 * @param lessonId - lesson for the `lesson` slot.
 * @param content - merged slot content.
 * @returns the previous content, for the tutor's merge flow.
 */
export function setMemory(
  state: LearningState,
  category: MemoryCategory,
  content: string,
  lessonId?: string,
): string | null {
  if (category === 'global') {
    const prev = state.memoryGlobal
    state.memoryGlobal = content
    return prev
  }
  if (category === 'pattern') {
    const course = findCourse(state, lessonId === undefined ? '' : lessonId.slice(0, lessonId.lastIndexOf(':')))
    const prev = state.memoryPatterns[course.id] ?? null
    state.memoryPatterns[course.id] = content
    return prev
  }
  if (lessonId === undefined) {
    throw new Error('lookatstudy-plugin: the lesson memory slot needs a lessonId')
  }
  const ref = findLesson(state, lessonId)
  const prev = ref.lesson.memory
  ref.lesson.memory = content
  return prev
}

/**
 * Add one notebook entry to a lesson's Cornell zones.
 * @param state - state to mutate.
 * @param lessonId - lesson the note belongs to (required: notes anchor to material).
 * @param zone - Cornell zone.
 * @param title - short entry title.
 * @param text - entry body (markdown for the understand zone).
 * @param source - where the content came from.
 * @param quote - verbatim source quote for record-zone notes.
 * @param now - current time.
 * @returns the created note.
 */
export function addNote(
  state: LearningState,
  lessonId: string,
  zone: NoteZone,
  title: string,
  text: string,
  source: NoteSource,
  quote: string | null,
  now: Date,
): LessonNote {
  const ref = findLesson(state, lessonId)
  const note: LessonNote = {
    id: `${lessonId}:n${ref.lesson.notes.length}`,
    zone,
    title,
    text,
    source,
    quote,
    at: now.toISOString(),
  }
  ref.lesson.notes.push(note)
  return note
}

/**
 * Propose early mastery graduation for the learner to accept or reject in chat.
 * @param state - state to mutate.
 * @param lessonId - lesson judged mastered.
 * @param rationale - why the tutor believes it is mastered.
 * @param now - current time.
 * @returns the pending proposal.
 */
export function proposeMastery(state: LearningState, lessonId: string, rationale: string, now: Date): MasteryProposal {
  const ref = findLesson(state, lessonId)
  if (ref.lesson.status === 'locked') {
    throw new Error(`lookatstudy-plugin: lesson ${JSON.stringify(lessonId)} is locked`)
  }
  const pending = state.proposals.find(p => p.lessonId === lessonId && p.status === 'pending')
  if (pending) return pending
  const proposal: MasteryProposal = {
    id: `prop-${randomBytes(3).toString('hex')}`,
    lessonId,
    rationale,
    status: 'pending',
    createdAt: now.toISOString(),
  }
  state.proposals.push(proposal)
  return proposal
}

/**
 * Resolve a pending proposal: acceptance floors every concept (and the
 * lesson) to 0.95 and graduates; rejection changes nothing.
 * @param state - state to mutate.
 * @param proposalId - proposal to resolve.
 * @param accept - learner's decision.
 * @param now - current time.
 * @returns the resolved proposal.
 */
export function resolveProposal(state: LearningState, proposalId: string, accept: boolean, now: Date): MasteryProposal {
  const proposal = state.proposals.find(p => p.id === proposalId)
  if (!proposal) throw new Error(`lookatstudy-plugin: unknown proposal id ${JSON.stringify(proposalId)}`)
  if (proposal.status !== 'pending') {
    throw new Error(`lookatstudy-plugin: proposal ${JSON.stringify(proposalId)} is already ${proposal.status}`)
  }
  if (accept) {
    const ref = findLesson(state, proposal.lessonId)
    if (ref.lesson.concepts !== null && ref.lesson.conceptMastery !== null) {
      for (let i = 0; i < ref.lesson.concepts.length; i++) {
        ref.lesson.conceptMastery[i] = Math.max(ref.lesson.conceptMastery[i] ?? 0, 0.95)
      }
      aggregateMastery(ref.lesson)
    } else {
      ref.lesson.mastery = Math.max(ref.lesson.mastery ?? 0, 0.95)
    }
    graduate(ref.lesson, ref.course, now)
    // LookatStudy's manual-apply side effect: the graduation also counts as a
    // correct SM-2 review when a schedule already exists.
    if (ref.lesson.sm2 !== null) {
      const review = computeSm2(ref.lesson.sm2, 5, now)
      ref.lesson.sm2 = { easeFactor: review.easeFactor, intervalDays: review.intervalDays, repetitions: review.repetitions }
      ref.lesson.dueAt = review.dueAt
    }
  }
  proposal.status = accept ? 'applied' : 'rejected'
  return proposal
}

/**
 * Record an SM-2 review grade and advance the schedule.
 * @param state - state to mutate.
 * @param lessonId - lesson being reviewed.
 * @param quality - SM-2 quality grade 0–5.
 * @param now - current time.
 * @returns the advanced schedule.
 */
export function recordReview(
  state: LearningState,
  lessonId: string,
  quality: ReviewQuality,
  now: Date,
): { ref: LessonRef; intervalDays: number; repetitions: number; easeFactor: number; dueAt: string } {
  const ref = findLesson(state, lessonId)
  if (!ref.lesson.sm2) {
    throw new Error(`lookatstudy-plugin: lesson ${JSON.stringify(lessonId)} has no review schedule; complete it first`)
  }
  const result = computeSm2(ref.lesson.sm2, quality, now)
  ref.lesson.sm2 = { easeFactor: result.easeFactor, intervalDays: result.intervalDays, repetitions: result.repetitions }
  ref.lesson.dueAt = result.dueAt
  return {
    ref,
    intervalDays: result.intervalDays,
    repetitions: result.repetitions,
    easeFactor: result.easeFactor,
    dueAt: result.dueAt,
  }
}

/** One due review item, flattened for tool output. */
export interface DueReview {
  lessonId: string
  courseId: string
  courseTitle: string
  lessonTitle: string
  dueAt: string
  overdueDays: number
}

/**
 * List mastered lessons whose SM-2 review is due, oldest first.
 * @param state - state to scan.
 * @param courseId - restrict to one course when provided.
 * @param now - current time.
 * @returns due items across the requested scope.
 */
export function dueReviews(state: LearningState, courseId: string | undefined, now: Date): DueReview[] {
  const courses = courseId ? [findCourse(state, courseId)] : state.courses
  const due: DueReview[] = []
  for (const course of courses) {
    for (const lesson of course.sections.flatMap(s => s.lessons)) {
      if (lesson.status !== 'mastered' || lesson.dueAt === null) continue
      if (Date.parse(lesson.dueAt) > now.getTime()) continue
      due.push({
        lessonId: lesson.id,
        courseId: course.id,
        courseTitle: course.title,
        lessonTitle: lesson.title,
        dueAt: lesson.dueAt,
        overdueDays: Math.floor((now.getTime() - Date.parse(lesson.dueAt)) / DAY_MS),
      })
    }
  }
  due.sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))
  return due
}

/** Aggregate course progress for listings. */
export interface CourseSummary {
  courseId: string
  title: string
  source: CourseSource
  createdAt: string
  total: number
  mastered: number
  available: number
  avgMasteryPct: number | null
  dueCount: number
  currentLessonId: string | null
}

/**
 * Summarize every course: counts, average mastery, due reviews, and the
 * current (first not-yet-mastered study) lesson.
 * @param state - state to summarize.
 * @param now - current time.
 * @returns one summary per course, in import order.
 */
export function courseSummaries(state: LearningState, now: Date): CourseSummary[] {
  return state.courses.map((course) => {
    const lessons = course.sections.flatMap(s => s.lessons)
    const answered = lessons.filter(l => l.mastery !== null)
    const due = dueReviews({ ...emptyState(), courses: [course] }, course.id, now)
    const current = lessons.find(l => l.kind === 'study' && l.status !== 'mastered') ?? null
    const avg = answered.length === 0
      ? null
      : answered.reduce((sum, l) => sum + (l.mastery ?? 0), 0) / answered.length
    return {
      courseId: course.id,
      title: course.title,
      source: course.source,
      createdAt: course.createdAt,
      total: lessons.length,
      mastered: lessons.filter(l => l.status === 'mastered').length,
      available: lessons.filter(l => l.status === 'available').length,
      avgMasteryPct: avg === null ? null : Math.round(avg * 100),
      dueCount: due.length,
      currentLessonId: current?.id ?? null,
    }
  })
}

/**
 * Teaching-strategy band for a mastery level (LookatStudy learner-model bands).
 * @param mastery - lesson mastery, null before any answer.
 * @returns the strategy instruction for the tutor.
 */
export function strategyBand(mastery: number | null): string {
  if (mastery === null || mastery < 0.1) {
    return '先建立直觉再讲细节:用类比引入概念,分步骤引导,不堆术语。'
  }
  if (mastery < 0.4) {
    return '用提问检验理解,发现误解时立即纠正,多给实际例子。'
  }
  if (mastery < 0.7) {
    return '深化理解:对比相似概念的区别,考察边界情况,可以出有迷惑性的问题。'
  }
  return '综合应用阶段:让学习者尝试用自己的话教回来(费曼技巧),考虑提议标记掌握。'
}

/** Weak-concept view of one lesson for maps and snapshots. */
export interface ConceptView {
  title: string
  masteryPct: number
  weak: boolean
  tested: number
}

/**
 * Project a lesson's concepts with mastery and weak flags.
 * @param lesson - lesson to project.
 * @returns concept views in definition order, or null before concepts exist.
 */
export function conceptViews(lesson: LessonState): ConceptView[] | null {
  if (lesson.concepts === null) return null
  return lesson.concepts.map((c, i) => {
    const mastery = lesson.conceptMastery?.[i] ?? 0.5
    return {
      title: c.title,
      masteryPct: Math.round(mastery * 100),
      weak: mastery < WEAK_CONCEPT_THRESHOLD,
      tested: lesson.conceptMastery !== null && i in lesson.conceptMastery ? 1 : 0,
    }
  })
}

/** The four consolidation starters attached to a lesson (LookatStudy templates). */
export function starterPrompts(lessonTitle: string): Array<{ label: string; message: string; effect: 'mastery' | 'friction' | 'none' }> {
  return [
    { label: '🔬 深入这点', message: `帮我深入讲讲「${lessonTitle}」刚才那个核心点——展开它的结构、细节和容易忽略的边界。`, effect: 'none' },
    { label: '💡 举个例子', message: `给我一个「${lessonTitle}」的实际例子或用法,让我更具体地理解。`, effect: 'none' },
    { label: '📝 考考我', message: `出一道关于「${lessonTitle}」的应用题考考我,看我是否真懂了——我答完请判断对错。`, effect: 'mastery' },
    { label: '🤔 我没太懂', message: `关于「${lessonTitle}」,我有地方不太懂,帮我理一理——先问我是哪里不清楚。`, effect: 'friction' },
  ]
}

/** Structured learner snapshot for prompt injection (one home, pure read). */
export interface LearnerSnapshot {
  focus: { lessonId: string; courseTitle: string; lessonTitle: string; masteryPct: number | null; status: LessonStatus } | null
  strategy: string | null
  concepts: ConceptView[] | null
  friction: FrictionEntry[]
  memoryGlobal: string | null
  memoryLesson: string | null
  memoryPattern: string | null
  dueCount: number
  pendingProposal: MasteryProposal | null
}

/**
 * Compose the learner snapshot for the focused lesson (or course-wide when
 * no focus): strategy band, weak concepts, recent friction, memory slots,
 * due count, pending proposal. The tutor persona's volatile tail.
 * @param state - state to read.
 * @param now - current time.
 * @returns the snapshot value.
 */
export function learnerSnapshot(state: LearningState, now: Date): LearnerSnapshot {
  let ref: LessonRef | null = state.focus === null ? null : tryFindLesson(state, state.focus.lessonId)
  if (ref === null && state.courses.length > 0) {
    const lessons = state.courses[0]!.sections.flatMap(s => s.lessons)
    const current = lessons.find(l => l.kind === 'study' && l.status === 'in_progress')
      ?? lessons.find(l => l.kind === 'study' && l.status === 'available')
      ?? null
    ref = current === null ? null : { course: state.courses[0]!, section: state.courses[0]!.sections.find(s => s.lessons.includes(current))!, lesson: current }
  }
  return {
    focus: ref === null ? null : {
      lessonId: ref.lesson.id,
      courseTitle: ref.course.title,
      lessonTitle: ref.lesson.title,
      masteryPct: ref.lesson.mastery === null ? null : Math.round(ref.lesson.mastery * 100),
      status: ref.lesson.status,
    },
    strategy: ref === null ? null : strategyBand(ref.lesson.mastery),
    concepts: ref === null ? null : conceptViews(ref.lesson),
    friction: ref === null ? [] : ref.lesson.friction.slice(-5),
    memoryGlobal: state.memoryGlobal,
    memoryLesson: ref?.lesson.memory ?? null,
    memoryPattern: ref === null ? null : (state.memoryPatterns[ref.course.id] ?? null),
    dueCount: dueReviews(state, undefined, now).length,
    pendingProposal: state.proposals.find(p => p.status === 'pending') ?? null,
  }
}

/** findLesson that returns null instead of throwing (snapshot focus may be stale). */
function tryFindLesson(state: LearningState, lessonId: string): LessonRef | null {
  try {
    return findLesson(state, lessonId)
  } catch {
    return null
  }
}

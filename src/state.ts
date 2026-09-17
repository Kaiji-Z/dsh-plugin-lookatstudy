/**
 * Learning state: courses → sections → lessons with mastery-driven gating,
 * per-concept (KC) BKT tracking aggregated as the weakest concept, SM-2
 * spaced repetition, pending mastery proposals, friction log, learner
 * memory, and Cornell-style notes. Persisted as one JSON file; every
 * mutation is saved synchronously.
 * @module dsh-plugin-lookatstudy/state
 */

import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { computeSm2, type ReviewQuality, type Sm2State } from './vendor/sm2.ts'
import { masteryToCrown, updateMastery } from './vendor/bkt.ts'
import { accuracyToStars, EXAM_MAX_QUESTIONS, EXAM_MIN_QUESTIONS } from './vendor/exam-logic.ts'
import { computeStreakTransition } from './vendor/streak-transition.ts'
import { XP_CORRECT, XP_WRONG, XP_MASTERED } from './vendor/xp.ts'
import { emptyProfile, applyProfilePatch, parseProfile, type LearnerProfile, type LearnerProfilePatch, type MotiveStage } from './learner-profile.ts'
import type { StudyArtifact } from './artifacts.ts'
import type { ParsedCourse } from './vendor/markdown-course.ts'
import { isCourseOwnerKey, threadOwnerKey, type ThreadScope } from './thread-key.ts'

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
  /** C11b/C6: pinned notes ride first inside their zone (additive, v2-safe). */
  pinned?: boolean
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

/**
 * A tutor-proposed learner-profile patch awaiting the learner's decision in
 * the settings page (upstream v0.36: profile proposals live OUTSIDE the chat
 * stream — the learning flow is never interrupted). `stale` = the learner
 * hand-edited the profile after this proposal was raised; applying it would
 * overwrite the newer human input, so it is dropped untouched.
 */
export interface ProfileProposal {
  id: string
  rationale: string
  patch: LearnerProfilePatch
  status: 'pending' | 'applied' | 'rejected' | 'stale'
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
  /** Exam nodes only: best star result (0-3, upstream accuracyToStars). */
  examStars?: number
  /** Exam nodes only: graded exam attempts recorded. */
  examAttempts?: number
  /** Exam nodes only: the exam-v2 question bank (P12; generation rides the tutor). */
  examBank?: ExamBank
  /** Exam nodes only: full attempt history for the settlement view (newest last). */
  examAttemptLog?: ExamAttempt[]
  /** 1–2 sentence lesson summary (upstream lesson-summary-kc: generated once with the concepts). */
  summary?: string
  /** Paired translation body (bilingual blackboard rendering). */
  translation?: string
  /** Translation language code when translation is present. */
  translationLang?: string
  /** Human-graded evidence flag (upstream v0.35 anti-farming): set when the
   *  LEARNER (not the tutor) graded work here — a completed practice card or
   *  an accepted mastery proposal. Until then `recordAnswer` writes cap at
   *  {@link AI_MASTERY_CAP} and can never auto-graduate the lesson. Additive. */
  humanGraded?: boolean
}

/** One bank question (tutor-authored, applied through study_exam_bank_apply). */
export interface ExamBankQuestion {
  id: string
  prompt: string
  options: string[]
  answer: number
  kcTitle: string | null
  explanation: string | null
}

/** The exam-v2 bank lifecycle (upstream exam-generation-store, persisted here). */
export interface ExamBank {
  status: 'idle' | 'generating' | 'ready' | 'failed'
  questions: ExamBankQuestion[]
  error?: string
  generatedAt?: string
}

/** Per-question settlement snapshot (self-contained: review survives regen). */
export interface ExamAttemptPerQuestion {
  exerciseId: string
  kcTitle: string | null
  correct: boolean
  answered: boolean
  userAnswer: string
  correctAnswer: string
  explanation: string | null
  prompt: string | null
  options: string[] | null
}

/** One answering session against a bank (id doubles as the shuffle seed). */
export interface ExamAttempt {
  id: string
  startedAt: string
  finishedAt: string | null
  answers: Record<string, string>
  correctCount: number | null
  totalCount: number | null
  stars: number | null
  terminated: boolean
  perQuestion: ExamAttemptPerQuestion[] | null
  /** Audit C16: the bank snapshot this attempt is graded against — a
   *  regenerate mid-attempt must not cross-grade old answers onto new
   *  questions. Absent on pre-snapshot attempts (graded against the live
   *  bank, the old behavior). */
  snapshot?: ExamBankQuestion[]
}

/** A section holding an ordered list of lessons. */
export interface SectionState {
  title: string
  anchor: string
  lessons: LessonState[]
}

/** Where a course came from. */
export type CourseSource = 'markdown' | 'folder' | 'github' | 'url'

/** One thread (a dsh session) inside a lesson's group — upstream's Thread row
 *  (title auto-set from the first message, upstream sendMessage semantics). */
export interface LessonThreadMeta {
  /** The dsh session id. */
  id: string
  /** Upstream: the user's first full input (button-triggered messages store
   *  the short action label); UI truncates via CSS, storage keeps it whole. */
  title: string
  createdAt: string
  lastAt: string
  /** Upstream gear-menu archive: archived threads keep their sediment but
   *  leave the switcher list (and the active pointer). Absent = active. */
  status?: 'active' | 'archived'
  /** The lessons this thread has been sent from (0.23.0 course scope): the
   *  coverage label's source and the mirror-sync set. Order-preserving,
   *  deduped; absent on pre-0.23 entries. */
  touchedLessons?: string[]
}

/** A lesson's thread group (upstream v0.5: 节点 = 会话组 — many threads, one active). */
export interface LessonThreadGroup {
  active: string | null
  threads: LessonThreadMeta[]
}

/** One deleted course held for recovery (audit B7: deletes never hard-splice —
 *  the course lands here with every associated sediment so study_restore_course
 *  can bring the whole thing back). */
export interface TrashedCourse {
  deletedAt: string
  course: CourseState
  proposals: MasteryProposal[]
  artifacts: Array<[string, StudyArtifact[]]>
  lessonThreads: Array<[string, LessonThreadGroup]>
  lessonSessions: Array<[string, string]>
  memoryPattern: [string, string] | null
  focusLessonId: string | null
}

/** One imported course. */
export interface CourseState {
  id: string
  title: string
  source: CourseSource
  /** Markdown text, folder path, or repo URL the course was imported from. */
  sourceRef: string
  createdAt: string
  sections: SectionState[]
  /** The language this course TEACHES (BCP-47, e.g. "en"), decided by the
   *  tutor at design-apply time — upstream v0.33's language-course axis.
   *  null/absent = the course teaches knowledge, not a language itself.
   *  Additive; v2 files without it load as a normal course. */
  languageTarget?: string | null
  /** Thread-group granularity (0.23.0, issue #11 follow-up): 'lesson'
   *  (default; absent = the 0.22 model, each lesson owns a group) or
   *  'course' (one group per course — the active thread runs continuously
   *  across lessons). Additive; old files load as lesson-scoped. */
  threadScope?: ThreadScope
}

/** Whole persisted state; `version` gates migrations (v1 → v2 renamed completed→mastered and added lesson.kind). */
export interface LearningState {
  version: 2
  courses: CourseState[]
  /** Whether the study surface (tools + tutor persona) is exposed to the model. */
  active: boolean
  /** Active tutoring soul. */
  mode: StudyMode
  /** E2: history-budget trimming directive (the tutor layer executes the trim;
   *  additive in 0.18.0 — v2 files without it load as off). */
  historyBudget?: boolean
  /** Host interface language the client pushed (0.24.0, additive) — the
   *  source study_apply_design matches against a repo's translation mirrors
   *  (zh-CN pairs the zh-cn mirror). Absent = feature off, original-only. */
  interfaceLang?: string
  /** Lesson the learner last opened (snapshot focus), or null. */
  focus: { lessonId: string } | null
  /** Cross-course style memory. */
  memoryGlobal: string | null
  /** Per-course friction-pattern memory. */
  memoryPatterns: Record<string, string>
  /** Course-less friction the tutor logs before any lesson is open (audit
   *  C20, additive): the global consolidation slot's material, capped at 50. */
  frictionGlobal: FrictionEntry[]
  /** Mastery proposals across courses. */
  proposals: MasteryProposal[]
  /** Lesson id → dsh session id (the legacy single-binding thread system —
   *  superseded by `lessonThreads`; kept readable for pre-0.22 files and kept
   *  in lockstep with the group's ACTIVE pointer while both exist). */
  lessonSessions: Record<string, string>
  /** The thread-group system (upstream v0.5 节点组 model, ported 2026-09-13):
   *  every lesson owns a GROUP of dsh sessions — one active, many parallel,
   *  auto-created on first send, auto-titled from the first message.
   *  Additive; v2 files without it load with empty groups (and any legacy
   *  lessonSessions binding migrates into a one-thread group at load). */
  lessonThreads: Record<string, LessonThreadGroup>
  /** Lesson id → recorded artifacts (upstream canvas_items: the panel's
   *  interactive cards — practice quizzes, compare tables, walkthroughs).
   *  Additive in 0.15.0; v2 files without it load with {}. */
  artifacts: Record<string, StudyArtifact[]>
  /** Deleted courses awaiting recovery (audit B7, additive): the 10 most
   *  recent deletes ride here; v2 files without it load with []. */
  trash: TrashedCourse[]
  /** Consolidation watermark (ISO): study_consolidate gathers friction/notes
   *  after this instant and advances it (upstream memory-service watermark). */
  lastConsolidatedAt: string | null
  /** XP ledger (upstream xp-service): cumulative total + today's bucket. */
  xp: { total: number; todayKey: string; todayXp: number }
  /** Streak state (upstream streak-transition: freeze semantics included). */
  streak: { currentStreak: number; longestStreak: number; lastActiveDate: string | null; freezeCount: number }
  /** Learner-declared profile (upstream v0.36; additive — absent loads as empty). */
  profile?: LearnerProfile
  /** Tutor-proposed profile patches awaiting the learner in settings (additive). */
  profileProposals?: ProfileProposal[]
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

/**
 * Tutor-only mastery ceiling (upstream v0.35 "AI 观测掌握度封顶"): until the
 * lesson carries human-grading evidence (a completed practice card or an
 * accepted mastery proposal), `recordAnswer` writes cap here and can never
 * reach the 0.9 graduation line — injected course content cannot farm
 * mastery into auto-graduation. Historical high values never regress: the
 * clamp only limits gains. Human grading lifts the flag and the cap.
 */
export const AI_MASTERY_CAP = 0.85

/** Fresh empty state for a first run: dormant until the learner clicks 开始学习. */
export function emptyState(): LearningState {
  return {
    version: 2, courses: [], active: false, mode: 'guide', focus: null, memoryGlobal: null, memoryPatterns: {}, frictionGlobal: [], artifacts: {},
    proposals: [], lessonSessions: {}, lessonThreads: {}, trash: [], lastConsolidatedAt: null,
    xp: { total: 0, todayKey: '', todayXp: 0 },
    streak: { currentStreak: 0, longestStreak: 0, lastActiveDate: null, freezeCount: 2 },
    profile: emptyProfile(),
    profileProposals: [],
  }
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
 * Load persisted state; a missing file yields empty state, and an unusable
 * file (torn bytes, future version) recovers from `.bak` or degrades to a
 * fresh state instead of throwing out of the host's apply() (audit A3).
 * v1 → v2 migration: `completed` lessons become `mastered`, lessons gain `kind`
 * (default `study`).
 * @param path - state-file path.
 * @returns the loaded state.
 */
export function loadState(path: string): LearningState {
  if (existsSync(path)) {
    try {
      return parseStateFile(path)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const backup = loadBackup(path)
      if (backup !== null) {
        console.error(`lookatstudy-plugin: state file unusable (${message}); recovered from ${path}.bak`)
        return backup
      }
      console.error(`lookatstudy-plugin: state file unusable (${message}) and no backup survived — quarantining it and starting fresh (${path})`)
      quarantine(path)
      return emptyState()
    }
  }
  // Crash window between the .bak copy and the rename: the backup holds the
  // last durable generation.
  return loadBackup(path) ?? emptyState()
}

function loadBackup(path: string): LearningState | null {
  const bak = `${path}.bak`
  if (!existsSync(bak)) return null
  try {
    return parseStateFile(bak)
  } catch {
    return null
  }
}

function quarantine(path: string): void {
  try {
    renameSync(path, `${path}.corrupt-${Date.now().toString(36)}`)
  } catch (error) {
    console.error(`lookatstudy-plugin: could not quarantine the unusable state file (${String(error)})`)
  }
}

/** Parse + migrate one state file; malformed bytes, shapes, and future versions throw. */
function parseStateFile(path: string): LearningState {
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
    // Pre-`active` files predate on-demand activation: keep those learners'
    // tutor working (default true), while fresh installs start dormant.
    active: raw.active ?? true,
    mode: raw.mode ?? 'guide',
    focus: raw.focus ?? null,
    memoryGlobal: raw.memoryGlobal ?? null,
    memoryPatterns: raw.memoryPatterns ?? {},
    frictionGlobal: raw.frictionGlobal ?? [],
    proposals: raw.proposals ?? [],
    lessonSessions: raw.lessonSessions ?? {},
    // the thread-group system: existing groups load verbatim; every legacy
    // single-binding (lessonSessions) without a group migrates into a
    // one-thread group titled by the lesson (issue #11 alignment, additive)
    lessonThreads: (() => {
      const groups: Record<string, LessonThreadGroup> = {}
      for (const [lessonId, group] of Object.entries(raw.lessonThreads ?? {})) {
        if (group !== null && typeof group === 'object' && Array.isArray(group.threads)) {
          groups[lessonId] = { active: typeof group.active === 'string' ? group.active : null, threads: group.threads }
        }
      }
      for (const [lessonId, sessionId] of Object.entries(raw.lessonSessions ?? {})) {
        if (typeof sessionId !== 'string' || groups[lessonId] !== undefined) continue
        let title = lessonId
        for (const course of courses) {
          for (const section of course.sections) {
            const hit = section.lessons.find(l => l.id === lessonId)
            if (hit !== undefined) { title = hit.title; break }
          }
        }
        const now = new Date().toISOString()
        groups[lessonId] = { active: sessionId, threads: [{ id: sessionId, title, createdAt: now, lastAt: now }] }
      }
      return groups
    })(),
    artifacts: raw.artifacts ?? {},
    trash: raw.trash ?? [],
    lastConsolidatedAt: raw.lastConsolidatedAt ?? null,
    xp: raw.xp ?? { total: 0, todayKey: '', todayXp: 0 },
    streak: raw.streak ?? { currentStreak: 0, longestStreak: 0, lastActiveDate: null, freezeCount: 2 },
    profile: parseProfile(raw.profile),
    profileProposals: Array.isArray(raw.profileProposals) ? raw.profileProposals : [],
  }
}

/**
 * Persist state atomically. The tmp file carries pid + random bytes so
 * processes sharing one state.json (multi-profile installs) never interleave
 * on the same temp path — a fixed name let one writer rename the other's
 * half-written bytes into place; the previous generation is kept one deep as
 * `.bak` for loadState recovery; the rename retries through the Windows
 * AV/indexer EPERM window (audit A3).
 * @param path - state-file path.
 * @param state - state to persist.
 */
export function saveState(path: string, state: LearningState): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}-${randomBytes(4).toString('hex')}.tmp`
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  try {
    const fd = openSync(tmp, 'r+')
    try { fsyncSync(fd) } finally { closeSync(fd) }
  } catch { /* best-effort durability; the rename is atomic either way */ }
  if (existsSync(path)) {
    try { copyFileSync(path, `${path}.bak`) } catch { /* best-effort recovery generation */ }
  }
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(tmp, path)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if ((code === 'EPERM' || code === 'EACCES' || code === 'EBUSY') && attempt < 5) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * (attempt + 1))
        continue
      }
      throw error
    }
  }
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
 * @param languageTarget - the taught language (BCP-47) when the course IS a
 *  language course (design-apply path only; markdown imports stay undefined).
 * @returns the imported (or pre-existing) course.
 */
export function importCourse(
  state: LearningState,
  parsed: ParsedCourse,
  source: CourseSource,
  sourceRef: string,
  languageTarget?: string | null,
): CourseState {
  const base = slugify(parsed.title)
  // Audit B8: idempotency keys on IDENTITY for sourced imports —
  // (source, sourceRef, title): a re-import of the same source returns the
  // existing course (updates require deleting first — never a silent
  // swallow), two different sources sharing a title mint separate courses,
  // and multi-part imports (arXiv parts, folder parts) that share one
  // sourceRef with distinct titles still mint one course per part. Markdown
  // keeps LookatStudy's pasted-title contract: same title = same course.
  if (source !== 'markdown') {
    const sameIdentity = state.courses.find(c => c.source === source && c.sourceRef === sourceRef && c.title === parsed.title)
    if (sameIdentity !== undefined) return sameIdentity
  } else {
    const sameTitle = state.courses.find(c => c.source === 'markdown' && c.title === parsed.title)
    if (sameTitle !== undefined) return sameTitle
  }
  let id = base
  for (let n = 2; state.courses.some(c => c.id === id); n++) id = `${base}-${String(n)}`
  const course: CourseState = {
    id,
    title: parsed.title,
    source,
    sourceRef,
    createdAt: new Date().toISOString(),
    languageTarget: languageTarget ?? null,
    sections: parsed.sections.map(section => {
      const lessons = section.lessons.map(lesson =>
        (() => {
          const st = freshLesson(lesson.title, lesson.anchor, lesson.body, lesson.world === 'practice' ? 'practice' : 'study')
          if (lesson.translation !== undefined) { st.translation = lesson.translation; st.translationLang = lesson.translationLang ?? '' }
          return st
        })())
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
 * Delete one course — into the restorable trash (audit B7), carrying its
 * proposals, artifacts, thread groups, legacy bindings, pattern memory, and
 * focus so a restore is total (this also leaves no orphan sediment behind —
 * audit C17). Unknown ids fail loud.
 * @param state - state to mutate.
 * @param courseId - course to remove.
 */
export function deleteCourse(state: LearningState, courseId: string): void {
  const i = state.courses.findIndex(c => c.id === courseId)
  if (i < 0) throw new Error(`lookatstudy-plugin: unknown course id ${JSON.stringify(courseId)}`)
  const [course] = state.courses.splice(i, 1)
  const prefix = `${courseId}:`
  const lessonThreads: Array<[string, LessonThreadGroup]> = []
  for (const key of Object.keys(state.lessonThreads)) {
    if (key.startsWith(prefix) || key === `course:${courseId}`) {
      lessonThreads.push([key, state.lessonThreads[key]!])
      delete state.lessonThreads[key]
    }
  }
  const lessonSessions: Array<[string, string]> = []
  for (const key of Object.keys(state.lessonSessions)) {
    if (key.startsWith(prefix)) {
      lessonSessions.push([key, state.lessonSessions[key]!])
      delete state.lessonSessions[key]
    }
  }
  const artifacts: Array<[string, StudyArtifact[]]> = []
  for (const key of Object.keys(state.artifacts)) {
    if (key.startsWith(prefix)) {
      artifacts.push([key, state.artifacts[key]!])
      delete state.artifacts[key]
    }
  }
  const proposals = state.proposals.filter(p => p.lessonId.startsWith(prefix))
  state.proposals = state.proposals.filter(p => !p.lessonId.startsWith(prefix))
  const pattern = state.memoryPatterns[courseId]
  const memoryPattern: [string, string] | null = pattern !== undefined ? [courseId, pattern] : null
  if (pattern !== undefined) delete state.memoryPatterns[courseId]
  const focusLessonId = state.focus !== null && state.focus.lessonId.startsWith(prefix) ? state.focus.lessonId : null
  if (focusLessonId !== null) state.focus = null
  state.trash = [{ deletedAt: new Date().toISOString(), course, proposals, artifacts, lessonThreads, lessonSessions, memoryPattern, focusLessonId }, ...(state.trash ?? [])].slice(0, 10)
}

/**
 * Restore one course from the trash with all its sediment. The slug may have
 * been re-taken while trashed — the tree is re-id'd and every carried key
 * remapped in that case. Unknown ids fail loud with the restorable list.
 * @param state - state to mutate.
 * @param courseId - trashed course to restore.
 * @returns the restored course.
 */
export function restoreCourse(state: LearningState, courseId: string): CourseState {
  state.trash ??= []
  const i = state.trash.findIndex(t => t.course.id === courseId)
  if (i < 0) {
    throw new Error(`lookatstudy-plugin: no trashed course ${JSON.stringify(courseId)} (restorable: ${state.trash.map(t => t.course.id).join(', ') || 'none'})`)
  }
  const entry = state.trash.splice(i, 1)[0]!
  const course = entry.course
  const oldId = course.id
  let id = oldId
  for (let n = 2; state.courses.some(c => c.id === id); n++) id = `${oldId}-${String(n)}`
  if (id !== oldId) {
    course.id = id
    const remap = (key: string): string => (key.startsWith(`${oldId}:`) ? `${id}${key.slice(oldId.length)}` : key)
    course.sections.forEach((section, si) => section.lessons.forEach((lesson, li) => { lesson.id = `${id}:${si}:${li}` }))
    for (const p of entry.proposals) p.lessonId = remap(p.lessonId)
    entry.artifacts = entry.artifacts.map(([k, v]) => [remap(k), v])
    // 0.23.0 course-scope groups ride along: the course key re-ids, and the
    // touchedLessons coverage inside every thread remaps into the new namespace
    entry.lessonThreads = entry.lessonThreads.map(([k, v]) => {
      if (!isCourseOwnerKey(k)) return [remap(k), v]
      for (const t of v.threads) {
        if (t.touchedLessons !== undefined) t.touchedLessons = t.touchedLessons.map(remap)
      }
      return [`course:${id}`, v]
    })
    entry.lessonSessions = entry.lessonSessions.map(([k, v]) => [remap(k), v])
    if (entry.focusLessonId !== null) entry.focusLessonId = remap(entry.focusLessonId)
  }
  state.courses.push(course)
  for (const p of entry.proposals) state.proposals.push(p)
  for (const [key, list] of entry.artifacts) state.artifacts[key] = [...(state.artifacts[key] ?? []), ...list]
  for (const [key, group] of entry.lessonThreads) state.lessonThreads[key] = group
  for (const [key, sessionId] of entry.lessonSessions) state.lessonSessions[key] = sessionId
  if (entry.memoryPattern !== null) state.memoryPatterns[course.id] = entry.memoryPattern[1]
  if (entry.focusLessonId !== null && state.focus === null) state.focus = { lessonId: entry.focusLessonId }
  return course
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
 * The next STUDY lesson after a graduation (upstream v0.37 shared/next-lesson.ts,
 * the progression-boundary card's ordering truth — the system owns the order,
 * the agent never participates): same-section successor, else the next
 * section's FIRST study lesson (empty sections skipped), else null (the
 * endpoint card). An unknown completedId (course switch race, cross-course
 * event) returns null — no card. Unlike {@link nextLesson} this never wraps
 * to the course's first lesson.
 * @param course - course to walk.
 * @param lessonId - the lesson that just graduated.
 * @returns the next study lesson, or null.
 */
export function nextLessonAfter(course: CourseState, lessonId: string): LessonState | null {
  const si = course.sections.findIndex(s => s.lessons.some(l => l.id === lessonId))
  if (si < 0) return null
  const section = course.sections[si]!
  const li = section.lessons.findIndex(l => l.id === lessonId)
  for (let j = li + 1; j < section.lessons.length; j++) {
    if (section.lessons[j]!.kind === 'study') return section.lessons[j]!
  }
  for (let s = si + 1; s < course.sections.length; s++) {
    const first = course.sections[s]!.lessons.find(l => l.kind === 'study')
    if (first !== undefined) return first
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
  /** XP ledger after this answer (C23: the runtime shape always carried it). */
  xp: ReturnType<typeof noteXpActivity>
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
  // Audit C15: exam nodes never enter the study state machine — they stay
  // 'available' forever and are gated on sibling mastery in the UI only.
  if (ref.lesson.kind === 'exam') {
    throw new Error(`lookatstudy-plugin: exam node ${JSON.stringify(lessonId)} never enters the study state machine (it stays available; the exam surface is the bank + attempt flow)`)
  }
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
 * Record one graded exam attempt on an exam node: stars from accuracy
 * (upstream accuracyToStars thresholds), best-of retained across attempts
 * (upstream crownLevel-takes-max semantics). Study/practice lessons are
 * refused — this is the exam surface only.
 */
export function recordExamResult(
  state: LearningState,
  lessonId: string,
  correct: number,
  total: number,
): { ref: LessonRef; stars: number; bestStars: number; attempts: number } {
  const ref = findLesson(state, lessonId)
  if (ref.lesson.kind !== 'exam') {
    throw new Error(`lookatstudy-plugin: lesson ${JSON.stringify(lessonId)} is not an exam node — study_exam_result is for section exams`)
  }
  if (!Number.isInteger(correct) || !Number.isInteger(total) || total <= 0 || correct < 0 || correct > total) {
    throw new Error(`lookatstudy-plugin: invalid exam score ${correct}/${total}`)
  }
  const stars = accuracyToStars(correct / total)
  const prevBest = ref.lesson.examStars ?? -1
  ref.lesson.examStars = Math.max(prevBest, stars)
  ref.lesson.examAttempts = (ref.lesson.examAttempts ?? 0) + 1
  ref.lesson.lastAnsweredAt = new Date().toISOString()
  return { ref, stars, bestStars: ref.lesson.examStars, attempts: ref.lesson.examAttempts }
}

/**
 * ── Exam v2 (P12): the bank + attempt lifecycle, upstream exam-service
 * semantics on state.json instead of SQLite. Generation rides the tutor
 * (the panel asks, study_exam_bank_apply lands the validated bank); grading
 * is pure (unanswered = wrong, terminated attempts keep partial credit).
 */

/** The section's KC-title union (anti-hallucination anchor for bank applies). */
function sectionKcTitles(ref: LessonRef): Set<string> {
  const titles = new Set<string>()
  for (const lesson of ref.section.lessons) {
    if (lesson.kind === 'exam') continue
    for (const concept of lesson.concepts ?? []) titles.add(concept.title)
  }
  return titles
}

/** Flip the bank to generating (a ready bank stays — regeneration resets it first). */
export function beginExamGeneration(state: LearningState, lessonId: string): void {
  const ref = findLesson(state, lessonId)
  if (ref.lesson.kind !== 'exam') {
    throw new Error(`lookatstudy-plugin: lesson ${JSON.stringify(lessonId)} is not an exam node`)
  }
  if (ref.lesson.examBank?.status === 'ready') return
  ref.lesson.examBank = { status: 'generating', questions: [] }
}

/** A tutor-authored bank question before the plugin assigns ids. */
export interface ExamBankQuestionInput {
  prompt: string
  options: string[]
  answer: number
  kcTitle?: string | null
  explanation?: string | null
}

/** Validate and land the tutor's question bank (anti-hallucination: KC titles must exist). */
export function applyExamBank(state: LearningState, lessonId: string, questions: ExamBankQuestionInput[], now: Date): { questionCount: number; kcCount: number } {
  const ref = findLesson(state, lessonId)
  if (ref.lesson.kind !== 'exam') {
    throw new Error(`lookatstudy-plugin: lesson ${JSON.stringify(lessonId)} is not an exam node`)
  }
  if (!Array.isArray(questions) || questions.length < EXAM_MIN_QUESTIONS || questions.length > EXAM_MAX_QUESTIONS) {
    throw new Error(`lookatstudy-plugin: exam bank needs ${String(EXAM_MIN_QUESTIONS)}-${String(EXAM_MAX_QUESTIONS)} questions (planExamQuota on the section's KC union), got ${String(Array.isArray(questions) ? questions.length : 'non-array')}`)
  }
  const kcUnion = sectionKcTitles(ref)
  const bank: ExamBankQuestion[] = questions.map((q, i) => {
    if (typeof q?.prompt !== 'string' || q.prompt.trim() === '') {
      throw new Error(`lookatstudy-plugin: question ${String(i)} has an empty prompt`)
    }
    if (!Array.isArray(q.options) || q.options.length < 2 || q.options.some(o => typeof o !== 'string' || o.trim() === '')) {
      throw new Error(`lookatstudy-plugin: question ${String(i)} needs 2+ non-empty options`)
    }
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length) {
      throw new Error(`lookatstudy-plugin: question ${String(i)} answer index ${String(q.answer)} is out of range`)
    }
    if (q.kcTitle !== undefined && q.kcTitle !== null && q.kcTitle !== '' && !kcUnion.has(q.kcTitle)) {
      throw new Error(`lookatstudy-plugin: question ${String(i)} kcTitle ${JSON.stringify(q.kcTitle)} is not in the section's concept union ${JSON.stringify([...kcUnion])} — read the section lessons with study_lesson before authoring`)
    }
    return {
      id: `q${String(i)}`,
      prompt: q.prompt,
      options: q.options,
      answer: q.answer,
      kcTitle: q.kcTitle === undefined || q.kcTitle === null || q.kcTitle === '' ? null : q.kcTitle,
      explanation: q.explanation === undefined || q.explanation === null || q.explanation === '' ? null : q.explanation,
    }
  })
  ref.lesson.examBank = { status: 'ready', questions: bank, generatedAt: now.toISOString() }
  return { questionCount: bank.length, kcCount: new Set(bank.map(q => q.kcTitle).filter(k => k !== null)).size }
}

/** Drop the bank back to idle (regenerate; open attempts settle against their
 * snapshots first — audit C16: never cross-grade a live attempt). */
export function regenerateExamBank(state: LearningState, lessonId: string): void {
  const ref = findLesson(state, lessonId)
  if (ref.lesson.kind !== 'exam') {
    throw new Error(`lookatstudy-plugin: lesson ${JSON.stringify(lessonId)} is not an exam node`)
  }
  settleDanglingAttempts(state, lessonId)
  ref.lesson.examBank = { status: 'idle', questions: [] }
}

/** Settle every dangling attempt of the lesson (grade dead — unanswered = wrong). */
export function settleDanglingAttempts(state: LearningState, lessonId: string): boolean {
  const ref = findLesson(state, lessonId)
  let changed = false
  for (const attempt of ref.lesson.examAttemptLog ?? []) {
    if (attempt.finishedAt === null) {
      submitExamAttempt(state, lessonId, attempt.id, true, new Date())
      changed = true
    }
  }
  return changed
}

/** Open a new attempt against the ready bank (dangling ones are graded dead first). */
export function startExamAttempt(state: LearningState, lessonId: string, now: Date): { attemptId: string; questions: ExamBankQuestion[] } {
  const ref = findLesson(state, lessonId)
  if (ref.lesson.kind !== 'exam') {
    throw new Error(`lookatstudy-plugin: lesson ${JSON.stringify(lessonId)} is not an exam node`)
  }
  if (ref.lesson.examBank?.status !== 'ready') {
    throw new Error(`lookatstudy-plugin: exam bank on ${JSON.stringify(lessonId)} is not ready (${String(ref.lesson.examBank?.status ?? 'idle')})`)
  }
  settleDanglingAttempts(state, lessonId)
  const log = ref.lesson.examAttemptLog ?? []
  let n = log.length
  while (log.some(a => a.id === `${lessonId}:a${String(n)}`)) n++
  const attempt: ExamAttempt = {
    id: `${lessonId}:a${String(n)}`,
    startedAt: now.toISOString(),
    finishedAt: null,
    answers: {},
    correctCount: null,
    totalCount: null,
    stars: null,
    terminated: false,
    perQuestion: null,
    // C16: grading runs against THIS snapshot. C28: snapshots are the heaviest
    // persisted state — the log keeps only the newest 20 attempts.
    snapshot: ref.lesson.examBank.questions.map(q => ({ ...q, options: [...q.options] })),
  }
  const kept = [...log, attempt]
  ref.lesson.examAttemptLog = kept.length > 20 ? kept.slice(kept.length - 20) : kept
  return { attemptId: attempt.id, questions: ref.lesson.examBank.questions }
}

/** Persist one answer incrementally (open attempts only; original option index as string). */
export function recordExamAnswer(state: LearningState, lessonId: string, attemptId: string, questionId: string, answer: string): void {
  const ref = findLesson(state, lessonId)
  const attempt = ref.lesson.examAttemptLog?.find(a => a.id === attemptId)
  if (attempt === undefined) {
    throw new Error(`lookatstudy-plugin: exam attempt ${JSON.stringify(attemptId)} not found on ${JSON.stringify(lessonId)}`)
  }
  if (attempt.finishedAt !== null) {
    throw new Error(`lookatstudy-plugin: exam attempt ${JSON.stringify(attemptId)} already finished`)
  }
  // C16: answers validate against the attempt's snapshot when one exists.
  const question = (attempt.snapshot ?? (ref.lesson.examBank?.status === 'ready' ? ref.lesson.examBank.questions : [])).find(q => q.id === questionId)
  if (question === undefined) {
    throw new Error(`lookatstudy-plugin: exam question ${JSON.stringify(questionId)} not in the bank`)
  }
  if (answer !== '' && (!/^\d+$/.test(answer) || Number(answer) >= question.options.length)) {
    throw new Error(`lookatstudy-plugin: exam answer ${JSON.stringify(answer)} is not an option index of ${JSON.stringify(questionId)}`)
  }
  attempt.answers = { ...attempt.answers, [questionId]: answer }
}

/** Grade and close an attempt: unanswered = wrong, snapshots self-contained, best-of stars kept. */
export function submitExamAttempt(state: LearningState, lessonId: string, attemptId: string, terminated: boolean, now: Date): {
  correctCount: number
  totalCount: number
  stars: number
  bestStars: number
  terminated: boolean
  perQuestion: ExamAttemptPerQuestion[]
} {
  const ref = findLesson(state, lessonId)
  const attempt = ref.lesson.examAttemptLog?.find(a => a.id === attemptId)
  if (attempt === undefined) {
    throw new Error(`lookatstudy-plugin: exam attempt ${JSON.stringify(attemptId)} not found on ${JSON.stringify(lessonId)}`)
  }
  if (attempt.finishedAt !== null) {
    throw new Error(`lookatstudy-plugin: exam attempt ${JSON.stringify(attemptId)} already finished`)
  }
  // Audit C16: grade against the attempt-time snapshot — a mid-attempt
  // regenerate must not cross-grade old answers onto new questions.
  const questions = attempt.snapshot ?? (ref.lesson.examBank?.status === 'ready' ? ref.lesson.examBank.questions : [])
  const perQuestion: ExamAttemptPerQuestion[] = questions.map(q => {
    const user = attempt.answers[q.id] ?? ''
    return {
      exerciseId: q.id,
      kcTitle: q.kcTitle,
      correct: user === String(q.answer),
      answered: user !== '',
      userAnswer: user,
      correctAnswer: String(q.answer),
      explanation: q.explanation,
      prompt: q.prompt,
      options: q.options,
    }
  })
  const correctCount = perQuestion.filter(p => p.correct).length
  const totalCount = perQuestion.length
  attempt.finishedAt = now.toISOString()
  attempt.correctCount = correctCount
  attempt.totalCount = totalCount
  attempt.stars = totalCount > 0 ? accuracyToStars(correctCount / totalCount) : 0
  attempt.terminated = terminated
  attempt.perQuestion = perQuestion
  // best-of stars + attempt counter ride the same fields study_exam_result writes
  const prevBest = ref.lesson.examStars ?? -1
  ref.lesson.examStars = Math.max(prevBest, attempt.stars)
  ref.lesson.examAttempts = (ref.lesson.examAttempts ?? 0) + 1
  ref.lesson.lastAnsweredAt = now.toISOString()
  return { correctCount, totalCount, stars: attempt.stars, bestStars: ref.lesson.examStars, terminated, perQuestion }
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
  // Audit C15: exam mastery is the bank/attempt surface, never recordAnswer's.
  if (ref.lesson.kind === 'exam') {
    throw new Error(`lookatstudy-plugin: exam node ${JSON.stringify(lessonId)} takes exam attempts (start/submit), not study_record_answer`)
  }
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
  // Anti-farming cap (upstream v0.35): without human-grading evidence the
  // tutor's writes ceiling at AI_MASTERY_CAP — short of the 0.9 graduation
  // line. BKT still evolves BOTH ways under the ceiling (a wrong answer
  // lowers); a historical value already above the cap raises the ceiling
  // instead of being clipped (the cap limits gains, never lowers anything).
  const capped = ref.lesson.humanGraded !== true
  const lift = (prevV: number | null | undefined, updated: number): number =>
    capped ? Math.min(updated, Math.max(prevV ?? 0, AI_MASTERY_CAP)) : updated
  if (ref.lesson.concepts !== null && kcIndex !== undefined) {
    const masteries = ref.lesson.conceptMastery ?? {}
    masteries[kcIndex] = lift(masteries[kcIndex], updateMastery(masteries[kcIndex], correct))
    ref.lesson.conceptMastery = masteries
    aggregateMastery(ref.lesson)
  } else if (ref.lesson.concepts !== null) {
    // No attribution: conservatively update every concept (LookatStudy semantics).
    const masteries = ref.lesson.conceptMastery ?? {}
    ref.lesson.concepts.forEach((_, i) => {
      masteries[i] = lift(masteries[i], updateMastery(masteries[i], correct))
    })
    ref.lesson.conceptMastery = masteries
    aggregateMastery(ref.lesson)
  } else {
    ref.lesson.mastery = lift(prev, updateMastery(prev, correct))
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
  // XP (upstream xp-service): +10 correct / +1 wrong / +50 on graduation; every event checks the streak in.
  const xpEvent = progression.graduated ? XP_MASTERED : correct ? XP_CORRECT : XP_WRONG
  const xp = noteXpActivity(state, xpEvent, now)
  return {
    ref,
    concept: kcIndex === undefined ? null : { title: concept!, mastery: ref.lesson.conceptMastery![kcIndex]! },
    prevMastery: prev ?? 0,
    newMastery: ref.lesson.mastery ?? 0,
    crown: masteryToCrown(ref.lesson.mastery),
    mastered: (ref.lesson.mastery ?? 0) >= MASTERED_THRESHOLD,
    progression,
    xp,
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
/**
 * Set a course's thread granularity (0.23.0). Switching never touches the
 * sediment: both sides' groups stay put and are resumed when the scope flips
 * back. Unknown ids fail loud.
 */
export function setCourseThreadScope(state: LearningState, courseId: string, scope: ThreadScope): void {
  const course = state.courses.find(c => c.id === courseId)
  if (course === undefined) throw new Error(`lookatstudy-plugin: unknown course id ${JSON.stringify(courseId)}`)
  const prev: ThreadScope = course.threadScope === 'course' ? 'course' : 'lesson'
  if (prev === scope) return
  course.threadScope = scope
  // 0.24.1: ADOPT the live conversation across the flip (owner round — the
  // flag alone only affected FUTURE mints, so enabling course scope at the
  // first lesson left the course group empty and the second lesson minted
  // yet another session). The focused lesson's group moves wholesale into
  // the course key (and symmetrically back), carrying titles, sediment, and
  // touchedLessons; an occupied target or an empty source skips the move.
  const courseKey = `course:${courseId}`
  const focusLessonId = state.focus?.lessonId ?? null
  if (focusLessonId === null || !course.sections.some(s => s.lessons.some(l => l.id === focusLessonId))) return
  const lessonKey = focusLessonId
  const src = scope === 'course' ? state.lessonThreads[lessonKey] : state.lessonThreads[courseKey]
  const dst = scope === 'course' ? state.lessonThreads[courseKey] : state.lessonThreads[lessonKey]
  if (src === undefined || src.threads.length === 0) return
  if (dst !== undefined && (dst.active !== null || dst.threads.length > 0)) return
  state.lessonThreads[scope === 'course' ? courseKey : lessonKey] = src
  delete state.lessonThreads[scope === 'course' ? lessonKey : courseKey]
}

/**
 * Resolve the thread-group map key a send from `lessonId` belongs to — the
 * 0.23.0 granularity funnel: lesson scope keeps legacy lessonId keys, course
 * scope namespaces the course. Every thread-group access in this module goes
 * through here (or through an ownerKey already derived from it).
 */
function ownerKeyFor(state: LearningState, lessonId: string): { key: string; scope: ThreadScope } {
  const ref = findLesson(state, lessonId)
  const scope: ThreadScope = ref.course.threadScope === 'course' ? 'course' : 'lesson'
  return { key: threadOwnerKey(scope, ref.course.id, lessonId), scope }
}

/**
 * Under course scope, mirrors drift per lesson (each remembers the last
 * thread IT used) — drift onto a LIVE thread is fine. The moment a thread
 * leaves the live set (archived, deleted, or rolled off the active pointer),
 * every mirror still naming it is a dead reference — re-point them at the
 * group's current active thread (or drop them when none is left). Lesson
 * scope keeps the legacy exact-mirror behavior at its own key.
 */
function repointMirrorsOff(state: LearningState, key: string, threadId: string | null, group: LessonThreadGroup): void {
  if (threadId === null || !isCourseOwnerKey(key)) return
  for (const lessonId of Object.keys(state.lessonSessions)) {
    if (state.lessonSessions[lessonId] === threadId) {
      if (group.active === null) delete state.lessonSessions[lessonId]
      else state.lessonSessions[lessonId] = group.active
    }
  }
}

/**
 * Bind a dsh session into a lesson's thread group (the issue-#11 write, the
 * upstream sendMessage/ensureThreadForSend translation): an UNKNOWN session id
 * appends a new thread (titled by the caller — the first message's text or a
 * short action label) and becomes active; a KNOWN id re-activates it (bumping
 * lastAt); `null` clears the active pointer (the ＋新建 affordance — the next
 * send mints a fresh thread). The legacy lessonSessions map stays in lockstep
 * with the active pointer so pre-0.22 readers never disagree. Under course
 * scope (0.23.0) the group is the course's, the send-from lesson joins the
 * thread's touchedLessons coverage, and mirrors sync per
 * {@link repointRolledMirrors}.
 */
export function bindLessonThread(state: LearningState, lessonId: string, sessionId: string | null, title?: string | null): LessonThreadGroup {
  // Audit C26: every other mutator validates existence first — an
  // unauthenticated route must not mint orphan groups for arbitrary strings.
  const { key, scope } = ownerKeyFor(state, lessonId)
  state.lessonThreads ??= {}
  const group = state.lessonThreads[key] ?? { active: null, threads: [] }
  if (sessionId === null) {
    group.active = null
    state.lessonThreads[key] = group
    if (scope === 'lesson') delete state.lessonSessions[lessonId]
    // course scope: the threads stay live, so drifting mirrors onto them
    // remain valid — nothing to re-point (the next send rebinds its lesson)
    return group
  }
  const existing = group.threads.find(t => t.id === sessionId)
  if (existing === undefined) {
    const now = new Date().toISOString()
    group.threads.push({ id: sessionId, title: (title ?? '').trim() !== '' ? title!.trim() : lessonId, createdAt: now, lastAt: now, touchedLessons: [lessonId] })
  } else {
    existing.lastAt = new Date().toISOString()
    // an active pointer at an archived thread is a contradiction — re-binding
    // (a stale client, a dashboard replay) restores the thread to live
    if (existing.status === 'archived') existing.status = 'active'
    const touched = existing.touchedLessons ??= []
    if (!touched.includes(lessonId)) touched.push(lessonId)
  }
  group.active = sessionId
  state.lessonThreads[key] = group
  state.lessonSessions[lessonId] = sessionId
  return group
}

/** Roll the group's active pointer to the freshest ACTIVE thread (or null)
 *  and keep the legacy lessonSessions mirror in lockstep. Shared by the
 *  archive/delete operations when they take out the current thread. */
function rollActiveToFresh(state: LearningState, key: string, group: LessonThreadGroup): void {
  const prev = group.active
  const live = group.threads.filter(t => t.status !== 'archived')
  group.active = live.length > 0
    ? live.reduce((a, b) => (a.lastAt > b.lastAt ? a : b)).id
    : null
  if (isCourseOwnerKey(key)) {
    repointMirrorsOff(state, key, prev, group)
  } else {
    if (group.active !== null) state.lessonSessions[key] = group.active
    else delete state.lessonSessions[key]
  }
}

/** Rename a thread's stored title (issue #11 management: upstream gear menu).
 *  The dsh session's own title is renamed host-side by the client (best
 *  effort) — this is the durable plugin-side half. Throws on unknown ids. */
export function renameLessonThread(state: LearningState, lessonId: string, sessionId: string, title: string): LessonThreadGroup {
  const key = ownerKeyFor(state, lessonId).key
  const group = state.lessonThreads?.[key]
  if (group === undefined) throw new Error(`lookatstudy-plugin: lesson ${JSON.stringify(lessonId)} has no thread group`)
  const thread = group.threads.find(t => t.id === sessionId)
  if (thread === undefined) throw new Error(`lookatstudy-plugin: lesson ${JSON.stringify(lessonId)} has no thread ${JSON.stringify(sessionId)}`)
  const clean = title.trim()
  if (clean !== '') thread.title = clean
  return group
}

/** Archive (or restore) a thread. Archiving the current thread rolls the
 *  active pointer to the freshest remaining live thread — upstream's archived
 *  threads leave the switcher list entirely (no unarchive entry there; the
 *  state API keeps `archived: false` for symmetry/future UI). */
export function archiveLessonThread(state: LearningState, lessonId: string, sessionId: string, archived: boolean): LessonThreadGroup {
  const key = ownerKeyFor(state, lessonId).key
  const group = state.lessonThreads?.[key]
  if (group === undefined) throw new Error(`lookatstudy-plugin: lesson ${JSON.stringify(lessonId)} has no thread group`)
  const thread = group.threads.find(t => t.id === sessionId)
  if (thread === undefined) throw new Error(`lookatstudy-plugin: lesson ${JSON.stringify(lessonId)} has no thread ${JSON.stringify(sessionId)}`)
  thread.status = archived ? 'archived' : 'active'
  if (archived && group.active === sessionId) rollActiveToFresh(state, key, group)
  if (archived) repointMirrorsOff(state, key, sessionId, group)
  if (!archived && group.active === null) {
    // restoring into an empty live set: the restored thread becomes current
    group.active = sessionId
    state.lessonSessions[lessonId] = sessionId
  }
  return group
}

/** Remove a thread from its group (sediment discipline: the OTHER threads and
 *  the group itself survive). The dsh session itself cannot be deleted through
 *  the host session face (no delete primitive) — it stays in the host's session
 *  list; the UI discloses this. Throws on unknown ids. */
export function deleteLessonThread(state: LearningState, lessonId: string, sessionId: string): LessonThreadGroup {
  const key = ownerKeyFor(state, lessonId).key
  const group = state.lessonThreads?.[key]
  if (group === undefined) throw new Error(`lookatstudy-plugin: lesson ${JSON.stringify(lessonId)} has no thread group`)
  const idx = group.threads.findIndex(t => t.id === sessionId)
  if (idx < 0) throw new Error(`lookatstudy-plugin: lesson ${JSON.stringify(lessonId)} has no thread ${JSON.stringify(sessionId)}`)
  group.threads.splice(idx, 1)
  if (group.active === sessionId) rollActiveToFresh(state, key, group)
  repointMirrorsOff(state, key, sessionId, group)
  return group
}

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
export function defineConcepts(state: LearningState, lessonId: string, concepts: ConceptDef[], summary?: string): void {
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
  if (summary !== undefined && summary.trim() !== '') ref.lesson.summary = summary.trim()
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
    // Audit C20: course-less friction lands in the global slot — the comment
    // used to claim this while the entry silently vanished.
    state.frictionGlobal = [...(state.frictionGlobal ?? []), entry].slice(-50)
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
    // Audit B5: lesson ids are courseId:sectionIdx:lessonIdx — the course id
    // ends at the FIRST colon. (lastIndexOf sliced 'courseId:si', which
    // findCourse always rejected, killing every pattern-slot write.)
    const cut = lessonId === undefined ? -1 : lessonId.indexOf(':')
    const course = findCourse(state, cut === -1 ? (lessonId ?? '') : lessonId!.slice(0, cut))
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
  // Ids survive deletion: length-based ids would collide once a note is
  // deleted and a new one added ([n0,n2] + add → length 2 → ":n2" again).
  const maxSuffix = ref.lesson.notes.reduce((max, n) => {
    const m = /:n(\d+)$/.exec(n.id)
    return m !== null ? Math.max(max, Number(m[1])) : max
  }, -1)
  const note: LessonNote = {
    id: `${lessonId}:n${maxSuffix + 1}`,
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
 * Delete one notebook entry from a lesson's Cornell zones.
 * @param state - state to mutate.
 * @param lessonId - lesson the note belongs to.
 * @param noteId - id of the note to remove.
 * @throws when the lesson or the note id is unknown (fail loud, like every id lookup).
 */
/**
 * Record one artifact on its lesson, idempotently: the key is the content
 * hash (type + stable-stringified data) — re-importing or re-generating the
 * same artifact returns the existing row instead of duplicating it (upstream
 * learned this the hard way with message-id keys).
 * @returns the stored artifact and whether this call created it.
 */
export function recordArtifact(state: LearningState, lessonId: string, artifact: StudyArtifact): { artifact: StudyArtifact; created: boolean } {
  findLesson(state, lessonId)
  const existing = state.artifacts[lessonId] ?? []
  const hit = existing.find(a => a.hash === artifact.hash)
  if (hit !== undefined) return { artifact: hit, created: false }
  // Audit C28: one lesson keeps its 100 newest artifacts — content-hash dedup
  // bounds duplicates, not volume.
  const next = [...existing, artifact]
  state.artifacts[lessonId] = next.length > 100 ? next.slice(next.length - 100) : next
  return { artifact, created: true }
}

export function deleteNote(state: LearningState, lessonId: string, noteId: string): void {
  const ref = findLesson(state, lessonId)
  const index = ref.lesson.notes.findIndex(n => n.id === noteId)
  if (index === -1) {
    throw new Error(`lookatstudy-plugin: note ${JSON.stringify(noteId)} not found on lesson ${JSON.stringify(lessonId)}`)
  }
  ref.lesson.notes.splice(index, 1)
}

/** Edit a note's body text in place (C6 learner comment editing). */
export function editNote(state: LearningState, lessonId: string, noteId: string, text: string): LessonNote {
  const ref = findLesson(state, lessonId)
  const note = ref.lesson.notes.find(n => n.id === noteId)
  if (note === undefined) {
    throw new Error(`lookatstudy-plugin: note ${JSON.stringify(noteId)} not found on lesson ${JSON.stringify(lessonId)}`)
  }
  const trimmed = text.trim()
  if (trimmed === '') throw new Error('lookatstudy-plugin: note text cannot be empty')
  note.text = trimmed
  return note
}

/** Pin or unpin a note (pinned notes sort first within their zone). */
export function pinNote(state: LearningState, lessonId: string, noteId: string, pinned: boolean): LessonNote {
  const ref = findLesson(state, lessonId)
  const note = ref.lesson.notes.find(n => n.id === noteId)
  if (note === undefined) {
    throw new Error(`lookatstudy-plugin: note ${JSON.stringify(noteId)} not found on lesson ${JSON.stringify(lessonId)}`)
  }
  note.pinned = pinned
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
    // The learner's explicit acceptance IS human grading — it lifts the
    // tutor-only mastery cap on this lesson (upstream v0.35 anti-farming).
    ref.lesson.humanGraded = true
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
  // Audit C28: resolved proposals are sediment — keep the newest 20 plus every
  // pending one, so state.json does not grow monotonically with the campaign.
  const resolved = state.proposals.filter(p => p.status !== 'pending')
  if (resolved.length > 20) {
    const keep = new Set(resolved.slice(resolved.length - 20).map(p => p.id))
    state.proposals = state.proposals.filter(p => p.status === 'pending' || keep.has(p.id))
  }
  return proposal
}

/**
 * Record human-grading evidence on a lesson (upstream v0.35 "人工判分发生，
 * 封顶解除"): a completed practice card (the panel's locally-judged quiz) or
 * any other learner-graded surface. Idempotent. Unknown or exam ids fail
 * loud — exam nodes live outside the mastery machine.
 * @param state - state to mutate.
 * @param lessonId - lesson the learner graded work on.
 */
export function markHumanGraded(state: LearningState, lessonId: string): void {
  const ref = findLesson(state, lessonId)
  if (ref.lesson.kind === 'exam') {
    throw new Error(`lookatstudy-plugin: exam node ${JSON.stringify(lessonId)} takes exam attempts, not human-grading marks`)
  }
  ref.lesson.humanGraded = true
}

/**
 * Raise a profile patch proposal for the learner to accept or ignore in the
 * settings page (upstream update_learner_profile's apply side). One pending
 * proposal at a time: a second proposal while one is pending replaces its
 * patch and rationale (the tutor revised its suggestion before the learner
 * looked). The learner's own edits are the stale-arbitration baseline —
 * see {@link resolveProfileProposal}.
 * @param state - state to mutate.
 * @param rationale - why the tutor believes the patch fits (evidence-cited).
 * @param patch - the fields to change (motiveStage structurally absent).
 * @param now - current time.
 * @returns the pending proposal.
 */
export function proposeProfilePatch(state: LearningState, rationale: string, patch: LearnerProfilePatch, now: Date): ProfileProposal {
  state.profile ??= emptyProfile()
  const pending = (state.profileProposals ?? []).find(p => p.status === 'pending')
  state.profileProposals ??= []
  if (pending !== undefined) {
    pending.rationale = rationale
    pending.patch = patch
    pending.createdAt = now.toISOString()
    return pending
  }
  const proposal: ProfileProposal = {
    id: `pprop-${randomBytes(3).toString('hex')}`,
    rationale,
    patch,
    status: 'pending',
    createdAt: now.toISOString(),
  }
  state.profileProposals.push(proposal)
  return proposal
}

/**
 * Resolve a pending profile proposal. Acceptance runs the stale arbitration
 * first (upstream v0.36 SPEC §4): a learner hand-edit after the proposal was
 * raised bumps `profile.updatedAt` past `createdAt` — the proposal goes
 * `stale` and applies NOTHING (never overwrite newer human input). Otherwise
 * the patch merges field-wise. Rejection changes nothing.
 * @param state - state to mutate.
 * @param proposalId - proposal to resolve.
 * @param accept - learner's decision.
 * @param now - current time.
 * @returns the resolved proposal (status applied/rejected/stale).
 */
export function resolveProfileProposal(state: LearningState, proposalId: string, accept: boolean, now: Date): ProfileProposal {
  const proposal = (state.profileProposals ?? []).find(p => p.id === proposalId)
  if (proposal === undefined) throw new Error(`lookatstudy-plugin: unknown profile proposal id ${JSON.stringify(proposalId)}`)
  if (proposal.status !== 'pending') {
    throw new Error(`lookatstudy-plugin: profile proposal ${JSON.stringify(proposalId)} is already ${proposal.status}`)
  }
  if (accept) {
    if ((state.profile ?? emptyProfile()).updatedAt > proposal.createdAt) {
      proposal.status = 'stale'
      return proposal
    }
    state.profile = applyProfilePatch(state.profile ?? emptyProfile(), proposal.patch)
  }
  proposal.status = accept ? 'applied' : 'rejected'
  // Sediment discipline (mirrors resolveProposal): resolved entries keep the
  // newest 20 so the array does not grow with the campaign.
  state.profileProposals ??= []
  const resolved = state.profileProposals.filter(p => p.status !== 'pending')
  if (resolved.length > 20) {
    const keep = new Set(resolved.slice(resolved.length - 20).map(p => p.id))
    state.profileProposals = state.profileProposals.filter(p => p.status === 'pending' || keep.has(p.id))
  }
  return proposal
}

/**
 * Merge a learner's OWN profile edit (the settings page write). This is the
 * human path: unlike the tool-proposal channel it MAY set the motivation
 * stage (only the learner can), and it bumps `updatedAt` — which is what
 * makes any older pending proposal resolve stale.
 * @param state - state to mutate.
 * @param patch - the fields the learner changed.
 * @param now - current time.
 * @returns the updated profile.
 */
export function saveProfileEdit(state: LearningState, patch: LearnerProfilePatch & { motiveStage?: MotiveStage | null }, now: Date): LearnerProfile {
  const merged = applyProfilePatch(state.profile ?? emptyProfile(), patch)
  state.profile = patch.motiveStage !== undefined ? { ...merged, motiveStage: patch.motiveStage } : merged
  return state.profile
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
  focus: { lessonId: string; courseId: string; courseTitle: string; lessonTitle: string; masteryPct: number | null; status: LessonStatus } | null
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
      courseId: ref.course.id,
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

/**
 * The consolidation window (upstream memory-service gatherConsolidationWindow,
 * dsh-adapted): timestamped raw material since the watermark — friction entries
 * and practice-zone notes — for the TUTOR to distill into memory slots. The
 * conversation half of upstream's window lives in the dsh session log (the
 * tutor already sees it), so state contributes the persisted traces only.
 * Pure read; the caller advances the watermark on gather.
 */
export interface ConsolidationWindow {
  since: string | null
  entries: Array<{ lessonId: string; lessonTitle: string; kind: 'friction' | 'practice'; category?: string; text: string; at: string }>
  counts: { friction: number; practice: number }
}

export function gatherConsolidationWindow(state: LearningState, capPerLesson = 10): ConsolidationWindow {
  const since = state.lastConsolidatedAt
  const entries: ConsolidationWindow['entries'] = []
  let frictionCount = 0
  let practiceCount = 0
  // Audit C20: course-less friction joins the window (the global pattern slot's material).
  for (const f of state.frictionGlobal ?? []) {
    if (since !== null && f.at <= since) continue
    entries.push({ lessonId: '', lessonTitle: '(课级)', kind: 'friction', category: f.category, text: f.summary ?? '(no summary)', at: f.at })
    frictionCount++
  }
  for (const course of state.courses) {
    for (const section of course.sections) {
      for (const lesson of section.lessons) {
        let perLesson = 0
        const collect = (kind: 'friction' | 'practice', at: string, push: () => void) => {
          if (since !== null && at <= since) return
          if (perLesson >= capPerLesson) return
          perLesson++
          push()
        }
        for (const f of lesson.friction) {
          collect('friction', f.at, () => {
            entries.push({ lessonId: lesson.id, lessonTitle: lesson.title, kind: 'friction', category: f.category, text: f.summary ?? '(no summary)', at: f.at })
            frictionCount++
          })
        }
        for (const n of lesson.notes) {
          if (n.zone !== 'practice') continue
          collect('practice', n.at, () => {
            entries.push({ lessonId: lesson.id, lessonTitle: lesson.title, kind: 'practice', text: n.text.slice(0, 200), at: n.at })
            practiceCount++
          })
        }
      }
    }
  }
  entries.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
  return { since, entries, counts: { friction: frictionCount, practice: practiceCount } }
}

/**
 * Record one XP event + advance the streak (upstream xp-service addXp +
 * streak.ts applyStreak, state-ified). New-day rollover resets the today
 * bucket first. The streak transition runs on every XP event — activity IS
 * the check-in (upstream 打卡 semantics).
 */
export function noteXpActivity(
  state: LearningState,
  xp: number,
  now: Date,
): { totalXp: number; todayXp: number; streak: LearningState['streak'] } {
  const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  if (state.xp.todayKey !== key) {
    state.xp.todayKey = key
    state.xp.todayXp = 0
  }
  state.xp.total += xp
  state.xp.todayXp += xp
  state.streak = computeStreakTransition({ ...state.streak, lastActiveDate: state.streak.lastActiveDate ?? null }, now)
  return { totalXp: state.xp.total, todayXp: state.xp.todayXp, streak: { ...state.streak } }
}

/**
 * Full-text lesson search (upstream course-tree-filter's multi-keyword AND,
 * extended to bodies): every keyword must hit the title OR body (case-insensitive).
 * Returns matches with a snippet around the first keyword hit in the body.
 * Pure read.
 */
export interface LessonSearchHit {
  courseId: string
  courseTitle: string
  lessonId: string
  lessonTitle: string
  snippet: string
}

export function searchLessons(state: LearningState, query: string, limit = 20): LessonSearchHit[] {
  const keys = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (keys.length === 0) return []
  const hits: LessonSearchHit[] = []
  for (const course of state.courses) {
    for (const section of course.sections) {
      for (const lesson of section.lessons) {
        const title = lesson.title.toLowerCase()
        const body = lesson.body.toLowerCase()
        if (!keys.every(k => title.includes(k) || body.includes(k))) continue
        let snippet = lesson.body.replace(/\s+/g, ' ').trim()
        for (const k of keys) {
          const idx = snippet.toLowerCase().indexOf(k)
          if (idx >= 0) {
            const start = Math.max(0, idx - 30)
            snippet = (start > 0 ? '…' : '') + snippet.slice(start, start + 100) + (start + 100 < snippet.length ? '…' : '')
            break
          }
        }
        hits.push({ courseId: course.id, courseTitle: course.title, lessonId: lesson.id, lessonTitle: lesson.title, snippet: snippet.slice(0, 120) })
        if (hits.length >= limit) return hits
      }
    }
  }
  return hits
}

/**
 * Serialize one course into a single markdown learning pack (upstream
 * pack-export's zero-LLS sharing semantics, dsh-adapted: the receiver imports
 * through the existing study_import_markdown — no new import path, no network).
 * Sections become ##, lessons ###, bodies verbatim; exam nodes keep their intro.
 * Pure.
 */
export function courseToPackMarkdown(course: CourseState): string {
  const parts: string[] = [`# ${course.title}`]
  for (const section of course.sections) {
    parts.push(`## ${section.title}`)
    for (const lesson of section.lessons) {
      if (lesson.kind === 'exam') continue // import re-creates exam nodes per section
      parts.push(`### ${lesson.title}`)
      parts.push(lesson.body)
    }
  }
  return parts.join('\n\n').trim() + '\n'
}

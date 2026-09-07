import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
/**
 * The study tab's HTTP API under `/lookatstudy/api/*`: the polled state feed
 * and the tab's write actions (focus, mode, lesson-session binding, course
 * deletion, study-workspace path), reading the same live plugin state the
 * tutor tools write. The v0.3 standalone workbench page and its reverse
 * message channel were removed once the in-client study tab superseded them.
 * @module dsh-plugin-lookatstudy/dashboard
 */

import { renderMarkdown } from './markdown.ts'
import { normalizeMathNotation } from './vendor/math-normalize.ts'
import { renderBilingual } from './markdown.ts'
import { DEFAULT_DAILY_GOAL, levelFromTotalXp } from './vendor/xp.ts'
import { normalizeSpeechText } from './vendor/speech-text.ts'
import { cachedTtsMp3, normalizeVoice } from './tts.ts'
import {
  searchLessons,
  conceptViews,
  deleteCourse,
  addNote,
  deleteNote,
  recordReview,
  dueReviews,
  findCourse,
  findLesson,
  learnerSnapshot,
  starterPrompts,
  strategyBand,
  type LearningState,
  editNote,
  pinNote,
} from './state.ts'

/** State access shared with the tools (same live object). */
export interface DashboardStore {
  get(): LearningState
  save(): void
}

/** Wiring handed in by `apply`. */
/**
 * The plugin's own version, read from the package.json sitting beside the
 * running module (src in dev, lib in install) — strictly the installed build,
 * no build-time inlining that could drift. Upstream v0.24.0 port (settings
 * About row); empty string on any read failure (display degrades, never throws).
 */
function pluginVersion(): string {
  try {
    return String(JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')).version ?? '')
  } catch { return '' }
}

export interface DashboardDeps {
  store: DashboardStore
  /** Directory the one-click starter adopts as the study workspace (apply ensures it exists). */
  studyAreaPath: string
  /** Applies an activation flip to the host surface (tool registry sync). */
  onActiveChange: (active: boolean) => void
  /** Absolute state-file path (read-only display in the settings page). */
  statePath: string
  /** Read-aloud synthesis seam: real Edge TTS by default, faked in tests. */
  tts?: {
    /** Overrides synthesis entirely (the cache still short-circuits first). */
    synthesize?: (text: string, voice: string) => Promise<Buffer>
  }
}

/** Structural slice of the dsh `webServer` service, for testability. */
export interface RouteRegistry {
  register(route: { kind: 'exact' | 'prefix'; path: string; handler: (req: RequestLike, res: ResponseLike) => void | Promise<void> }): () => void
}

/** Structural `IncomingMessage`. */
export interface RequestLike {
  method?: string
  url?: string
}

/** Structural `ServerResponse` the handlers write to. */
export interface ResponseLike {
  headersSent: boolean
  writeHead(status: number, headers?: Record<string, string>): ResponseLike
  end(chunk?: string | Uint8Array): ResponseLike
  on(event: 'data', listener: (chunk: Buffer) => void): void
  on(event: 'end', listener: () => void): void
}

/** One course's map for the left rail. */
export interface WorkbenchCourse {
  courseId: string
  title: string
  mastered: number
  total: number
  avgMasteryPct: number | null
  sections: Array<{
    title: string
    index: number
    lessons: Array<{
      id: string
      title: string
      kind: string
      status: string
      masteryPct: number | null
      weakConcepts: number
      frictionCount: number
      due: boolean
      focus: boolean
    }>
  }>
}

/** The focus lesson's 讲解 view. */
export interface WorkbenchLesson {
  lessonId: string
  courseTitle: string
  sectionTitle: string
  title: string
  status: string
  masteryPct: number | null
  strategy: string
  concepts: Array<{ title: string; masteryPct: number; weak: boolean }>
  starters: Array<{ label: string; message: string }>
  notes: Array<{ id: string; zone: string; title: string; text: string; source: string; quote: string | null; pinned: boolean }>
  /** Recorded artifacts (0.15.0 P1): the panel's interactive cards. */
  artifacts: Array<{ id: string; artifactType: string; title: string; data: Record<string, unknown> }>
  /** Whether this lesson has a review due now (the self-rating card shows). */
  due: boolean
  html: string
  /** Raw lesson body (the read-aloud control and the settings page speak from this). */
  markdown: string
  /** Markdown stripped to speakable plain text (code removed, layout markers off) — the read-aloud feed. */
  speechText: string
}

/** Whole workbench state for the page. */
export interface WorkbenchState {
  /** Whether the study surface (tools + tutor persona) is currently exposed. */
  active: boolean
  mode: string
  courses: WorkbenchCourse[]
  focusLessonId: string | null
  lesson: WorkbenchLesson | null
  dueCount: number
  due: Array<{ lessonId: string; lessonTitle: string; courseTitle: string; overdueDays: number }>
  pendingProposals: Array<{ id: string; lessonTitle: string; rationale: string }>
  memory: { global: string | null; lesson: string | null; pattern: string | null }
  /** Lesson id → dsh session id (one session per lesson node). */
  lessonSessions: Record<string, string>
  /** XP + streak block (same shape as study_courses; feeds the dock pill and the settings page). */
  progress: {
    totalXp: number
    level: number
    levelPct: number
    todayXp: number
    dailyGoal: number
    streak: number
    longestStreak: number
    freezeCount: number
  }
}

/**
 * Assemble the whole workbench state (pure read; the lesson HTML is rendered
 * server-side from the sanitized markdown pipeline).
 * @param state - live learning state.
 * @param now - current time.
 * @returns the page's data contract.
 */
export function workbenchState(state: LearningState, now: Date): WorkbenchState {
  const focusId = state.focus?.lessonId ?? null
  const dueIds = new Set(dueReviews(state, undefined, now).map(d => d.lessonId))
  const courses: WorkbenchCourse[] = state.courses.map((course) => {
    const lessons = course.sections.flatMap(s => s.lessons)
    const answered = lessons.filter(l => l.mastery !== null)
    return {
      courseId: course.id,
      title: course.title,
      mastered: lessons.filter(l => l.status === 'mastered').length,
      total: lessons.length,
      avgMasteryPct: answered.length === 0
        ? null
        : Math.round(answered.reduce((sum, l) => sum + (l.mastery ?? 0), 0) / answered.length * 100),
      sections: course.sections.map((section, index) => ({
        title: section.title,
        index,
        lessons: section.lessons.map(lesson => ({
          id: lesson.id,
          title: lesson.title,
          kind: lesson.kind,
          status: lesson.status,
          masteryPct: lesson.mastery === null ? null : Math.round(lesson.mastery * 100),
          weakConcepts: (conceptViews(lesson) ?? []).filter(c => c.weak).length,
          frictionCount: lesson.friction.length,
          due: dueIds.has(lesson.id),
          focus: lesson.id === focusId,
        })),
      })),
    }
  })
  let lesson: WorkbenchLesson | null = null
  if (focusId !== null) {
    try {
      const ref = findLesson(state, focusId)
      lesson = {
        lessonId: ref.lesson.id,
        courseTitle: ref.course.title,
        sectionTitle: ref.section.title,
        title: ref.lesson.title,
        status: ref.lesson.status,
        masteryPct: ref.lesson.mastery === null ? null : Math.round(ref.lesson.mastery * 100),
        strategy: strategyBand(ref.lesson.mastery),
        concepts: conceptViews(ref.lesson) ?? [],
        due: dueIds.has(ref.lesson.id),
        artifacts: (state.artifacts[ref.lesson.id] ?? []).map(a => ({ id: a.id, artifactType: a.artifactType, title: a.title, data: a.data })),
        starters: starterPrompts(ref.lesson.title).map(s => ({ label: s.label, message: s.message })),
        notes: ref.lesson.notes.map(n => ({
          id: n.id,
          zone: n.zone,
          title: n.title,
          text: n.text,
          source: n.source,
          quote: n.quote,
          pinned: n.pinned === true,
        })),
        html: renderMarkdown(normalizeMathNotation(
          ref.lesson.translation === undefined ? ref.lesson.body : renderBilingual(ref.lesson.body, ref.lesson.translation),
        )),
        markdown: ref.lesson.body,
        speechText: normalizeSpeechText(normalizeMathNotation(ref.lesson.body)),
      }
    } catch {
      lesson = null
    }
  }
  const due = dueReviews(state, undefined, now)
  return {
    active: state.active,
    mode: state.mode,
    courses,
    focusLessonId: focusId,
    lesson,
    dueCount: due.length,
    due: due.map(d => ({ lessonId: d.lessonId, lessonTitle: d.lessonTitle, courseTitle: d.courseTitle, overdueDays: d.overdueDays })),
    pendingProposals: state.proposals
      .filter(p => p.status === 'pending')
      .map(p => {
        try {
          return { id: p.id, lessonTitle: findLesson(state, p.lessonId).lesson.title, rationale: p.rationale }
        } catch {
          return { id: p.id, lessonTitle: p.lessonId, rationale: p.rationale }
        }
      }),
    memory: (() => {
      const snap = learnerSnapshot(state, now)
      return { global: snap.memoryGlobal, lesson: snap.memoryLesson, pattern: snap.memoryPattern }
    })(),
    lessonSessions: state.lessonSessions,
    progress: (() => {
      const xp = levelFromTotalXp(state.xp.total)
      return {
        totalXp: state.xp.total,
        level: xp.level,
        levelPct: xp.pct,
        todayXp: state.xp.todayXp,
        dailyGoal: DEFAULT_DAILY_GOAL,
        streak: state.streak.currentStreak,
        longestStreak: state.streak.longestStreak,
        freezeCount: state.streak.freezeCount,
      }
    })(),
  }
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' }

function sendJson(res: ResponseLike, status: number, value: unknown): void {
  res.writeHead(status, JSON_HEADERS).end(JSON.stringify(value))
}

/**
 * Read one JSON body, answering 400 on malformed or oversized input so the
 * handler never throws into the HTTP layer.
 * @returns the parsed value, or undefined when the response is already sent.
 */
async function readJsonBodySafe(req: RequestLike, res: ResponseLike): Promise<unknown | undefined> {
  try {
    return await readJsonBody(req as never)
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : 'bad request' })
    return undefined
  }
}

/** Read one JSON request body with a hard 64 kB cap; malformed bodies reject. */
function readJsonBody(req: RequestLike & { on(event: 'data' | 'end', listener: (...args: never[]) => void): void }): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
      if (chunks.reduce((n, c) => n + c.length, 0) > 65_536) {
        reject(new Error('request body too large'))
        return
      }
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('request body is not valid JSON'))
      }
    })
  })
}

/**
 * Register the study tab's API routes under `/lookatstudy/api/*`: the polling
 * state feed plus the tab's write actions.
 * @param webServer - the composed webserver's route registry.
 * @param deps - store plus the study-workspace directory.
 * @returns the disposer removing every route.
 */
export function registerDashboard(webServer: RouteRegistry, deps: DashboardDeps): () => void {
  const disposeRoutes = webServer.register({
    kind: 'prefix',
    path: '/lookatstudy',
    handler: async (req, res) => {
      const pathname = new URL(req.url ?? '/', 'http://x').pathname
      if (req.method === 'GET' && pathname === '/lookatstudy/api/state') {
        sendJson(res, 200, { ...workbenchState(deps.store.get(), new Date()), statePath: deps.statePath, version: pluginVersion() })
        return
      }
      if (req.method === 'GET' && pathname === '/lookatstudy/api/search') {
        // Full-text lesson search (rail search box fallback when title matching
        // finds nothing locally — the bodies live host-side, not in the feed).
        const query = new URL(req.url ?? '/', 'http://x').searchParams.get('q') ?? ''
        sendJson(res, 200, { ok: true, query, matches: searchLessons(deps.store.get(), query) })
        return
      }
      if (req.method === 'POST' && pathname === '/lookatstudy/api/active') {
        const body = await readJsonBodySafe(req, res)
        if (body === undefined) return
        if (typeof body.active !== 'boolean') {
          sendJson(res, 400, { ok: false, error: 'active (boolean) required' })
          return
        }
        deps.store.get().active = body.active
        deps.store.save()
        // Sync the host surface (tool registry) BEFORE responding so the
        // client's awaiting fetch guarantees the tools exist by the time it
        // queues the kickoff prompt.
        deps.onActiveChange(body.active)
        sendJson(res, 200, { ok: true, active: body.active })
        return
      }
      if (req.method === 'POST' && pathname === '/lookatstudy/api/focus') {
        const body = await readJsonBodySafe(req, res)
        if (body === undefined) return
        if (typeof body.lessonId !== 'string') {
          sendJson(res, 400, { ok: false, error: 'lessonId (string) required' })
          return
        }
        try {
          const ref = findLesson(deps.store.get(), body.lessonId)
          deps.store.get().focus = { lessonId: ref.lesson.id }
          deps.store.save()
          sendJson(res, 200, { ok: true })
        } catch (error) {
          sendJson(res, 404, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
        return
      }
      if (req.method === 'GET' && pathname === '/lookatstudy/api/study-workspace') {
        sendJson(res, 200, { ok: true, path: deps.studyAreaPath })
        return
      }
      if (req.method === 'POST' && pathname === '/lookatstudy/api/course/delete') {
        const body = await readJsonBodySafe(req, res)
        if (body === undefined) return
        if (typeof body.courseId !== 'string') {
          sendJson(res, 400, { ok: false, error: 'courseId (string) required' })
          return
        }
        try {
          const course = findCourse(deps.store.get(), body.courseId)
          deleteCourse(deps.store.get(), course.id)
          if (deps.store.get().focus?.lessonId.startsWith(`${course.id}:`)) {
            deps.store.get().focus = null
          }
          deps.store.save()
          sendJson(res, 200, { ok: true })
        } catch (error) {
          sendJson(res, 404, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
        return
      }
      if (req.method === 'POST' && pathname === '/lookatstudy/api/note/delete') {
        const body = await readJsonBodySafe(req, res)
        if (body === undefined) return
        if (typeof body.lessonId !== 'string' || typeof body.noteId !== 'string') {
          sendJson(res, 400, { ok: false, error: 'lessonId and noteId (strings) required' })
          return
        }
        try {
          deleteNote(deps.store.get(), body.lessonId, body.noteId)
          deps.store.save()
          sendJson(res, 200, { ok: true })
        } catch (error) {
          sendJson(res, 404, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
        return
      }
      if (req.method === 'POST' && pathname === '/lookatstudy/api/note/edit') {
        const body = await readJsonBodySafe(req, res)
        if (body === undefined) return
        if (typeof body.lessonId !== 'string' || typeof body.noteId !== 'string' || typeof body.text !== 'string') {
          sendJson(res, 400, { ok: false, error: 'lessonId, noteId (strings) and text (string) required' })
          return
        }
        try {
          editNote(deps.store.get(), body.lessonId, body.noteId, body.text)
          deps.store.save()
          sendJson(res, 200, { ok: true })
        } catch (error) {
          sendJson(res, 404, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
        return
      }
      if (req.method === 'POST' && pathname === '/lookatstudy/api/note/pin') {
        const body = await readJsonBodySafe(req, res)
        if (body === undefined) return
        if (typeof body.lessonId !== 'string' || typeof body.noteId !== 'string' || typeof body.pinned !== 'boolean') {
          sendJson(res, 400, { ok: false, error: 'lessonId, noteId (strings) and pinned (boolean) required' })
          return
        }
        try {
          pinNote(deps.store.get(), body.lessonId, body.noteId, body.pinned)
          deps.store.save()
          sendJson(res, 200, { ok: true })
        } catch (error) {
          sendJson(res, 404, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
        return
      }
      if (req.method === 'POST' && pathname === '/lookatstudy/api/note/user') {
        const body = await readJsonBodySafe(req, res)
        if (body === undefined) return
        if (typeof body.lessonId !== 'string' || typeof body.quote !== 'string' || body.quote.trim().length < 2) {
          sendJson(res, 400, { ok: false, error: 'lessonId and quote (a real selection) required' })
          return
        }
        try {
          const quote = body.quote.trim()
          const text = typeof body.text === 'string' && body.text.trim() !== '' ? body.text.trim() : quote
          const note = addNote(deps.store.get(), body.lessonId, 'record', quote.slice(0, 24), text, 'content', quote, new Date())
          deps.store.save()
          sendJson(res, 200, { ok: true, noteId: note.id })
        } catch (error) {
          sendJson(res, 404, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
        return
      }
      if (req.method === 'POST' && pathname === '/lookatstudy/api/review') {
        const body = await readJsonBodySafe(req, res)
        if (body === undefined) return
        const quality = body.quality
        if (typeof body.lessonId !== 'string' || typeof quality !== 'number' || ![1, 4, 5].includes(quality)) {
          sendJson(res, 400, { ok: false, error: 'lessonId and quality (1 | 4 | 5) required' })
          return
        }
        try {
          recordReview(deps.store.get(), body.lessonId, quality as 1 | 4 | 5, new Date())
          deps.store.save()
          sendJson(res, 200, { ok: true })
        } catch (error) {
          sendJson(res, 404, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
        return
      }
      if (req.method === 'POST' && pathname === '/lookatstudy/api/lesson-session') {
        const body = await readJsonBodySafe(req, res)
        if (body === undefined) return
        if (typeof body.lessonId !== 'string' || typeof body.sessionId !== 'string') {
          sendJson(res, 400, { ok: false, error: 'lessonId and sessionId (strings) required' })
          return
        }
        deps.store.get().lessonSessions[body.lessonId] = body.sessionId
        deps.store.save()
        sendJson(res, 200, { ok: true })
        return
      }
      if (req.method === 'POST' && pathname === '/lookatstudy/api/tts') {
        const body = await readJsonBodySafe(req, res)
        if (body === undefined) return
        const text = typeof body.text === 'string' ? body.text.trim() : ''
        if (text === '') {
          sendJson(res, 400, { ok: false, error: 'text (non-empty string) required' })
          return
        }
        if (text.length > 4000) {
          sendJson(res, 400, { ok: false, error: 'text exceeds 4000 chars (speak sentence groups, not whole lessons)' })
          return
        }
        const voice = normalizeVoice(typeof body.voice === 'string' ? body.voice : undefined)
        const cacheDir = join(deps.studyAreaPath, 'tts-cache')
        try {
          const mp3 = await cachedTtsMp3(cacheDir, text, voice, deps.tts?.synthesize)
          // Base64-in-JSON, not raw bytes: the host webserver's res can sit
          // behind middleware (gzip) that drops Buffer chunks; JSON survives
          // every wrapper and sentence-sized chunks make the overhead moot.
          sendJson(res, 200, { ok: true, mime: 'audio/mpeg', dataBase64: mp3.toString('base64') })
        } catch (error) {
          sendJson(res, 502, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
        return
      }
      if (req.method === 'POST' && pathname === '/lookatstudy/api/mode') {
        const body = await readJsonBodySafe(req, res)
        if (body === undefined) return
        if (body.mode !== 'direct' && body.mode !== 'guide' && body.mode !== 'practice') {
          sendJson(res, 400, { ok: false, error: 'mode must be direct | guide | practice' })
          return
        }
        deps.store.get().mode = body.mode
        deps.store.save()
        sendJson(res, 200, { ok: true, mode: body.mode })
        return
      }
      sendJson(res, 404, { ok: false, error: 'not found' })
    },
  })
  return () => { disposeRoutes() }
}

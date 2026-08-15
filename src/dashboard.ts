/**
 * The study tab's HTTP API under `/lookatstudy/api/*`: the polled state feed
 * and the tab's write actions (focus, mode, lesson-session binding, course
 * deletion, study-workspace path), reading the same live plugin state the
 * tutor tools write. The v0.3 standalone workbench page and its reverse
 * message channel were removed once the in-client study tab superseded them.
 * @module dsh-plugin-lookatstudy/dashboard
 */

import { renderMarkdown } from './markdown.ts'
import {
  conceptViews,
  deleteCourse,
  dueReviews,
  findCourse,
  findLesson,
  learnerSnapshot,
  starterPrompts,
  strategyBand,
  type LearningState,
} from './state.ts'

/** State access shared with the tools (same live object). */
export interface DashboardStore {
  get(): LearningState
  save(): void
}

/** Wiring handed in by `apply`. */
export interface DashboardDeps {
  store: DashboardStore
  /** Directory the one-click starter adopts as the study workspace (apply ensures it exists). */
  studyAreaPath: string
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
  end(chunk?: string): ResponseLike
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
  notes: Array<{ id: string; zone: string; title: string; text: string; source: string; quote: string | null }>
  html: string
}

/** Whole workbench state for the page. */
export interface WorkbenchState {
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
        starters: starterPrompts(ref.lesson.title).map(s => ({ label: s.label, message: s.message })),
        notes: ref.lesson.notes.map(n => ({
          id: n.id,
          zone: n.zone,
          title: n.title,
          text: n.text,
          source: n.source,
          quote: n.quote,
        })),
        html: renderMarkdown(ref.lesson.body),
      }
    } catch {
      lesson = null
    }
  }
  const due = dueReviews(state, undefined, now)
  return {
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
        sendJson(res, 200, workbenchState(deps.store.get(), new Date()))
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

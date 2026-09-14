/**
 * The study tab's HTTP API: state assembly (pure) and the route handlers
 * against structural request/response fakes — polling state feed, focus
 * switching, mode, lesson-session binding, and course deletion.
 */

import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseMarkdownToCourse } from '../src/vendor/markdown-course.ts'
import { emptyState, importCourse, proposeMastery, recordAnswer, addNote, deleteNote, findLesson, completeLesson, bindLessonThread, archiveLessonThread } from '../src/state.ts'
import type { LearningState } from '../src/state.ts'
import {
  registerDashboard,
  workbenchState,
  type RequestLike,
  type ResponseLike,
} from '../src/dashboard.ts'

const COURSE_MD = ['# Workbench Course', '## Part One', '### Reading', 'reading **body**', '### Writing', 'writing body', '## Part Two', '### Review', 'review body'].join('\n')

function fixture(): { state: LearningState; courseId: string; lessonId: string } {
  const state = emptyState()
  const course = importCourse(state, parseMarkdownToCourse(COURSE_MD), 'markdown', 'fixture')
  state.focus = { lessonId: `${course.id}:0:0` }
  return { state, courseId: course.id, lessonId: `${course.id}:0:0` }
}

/** Capture what a handler wrote. */
class FakeResponse implements ResponseLike {
  headersSent = false
  status = 0
  headers: Record<string, string> = {}
  body = ''
  writeHead(status: number, headers?: Record<string, string>): ResponseLike {
    this.status = status
    this.headers = headers ?? {}
    return this
  }
  end(chunk?: string): ResponseLike {
    if (chunk !== undefined) this.body += chunk
    return this
  }
  on(): void {}
  json(): unknown {
    return JSON.parse(this.body)
  }
}

/** Structural request with body-feeding helpers. */
class FakeRequest implements RequestLike {
  method: string
  url: string
  /** Defaults mimic the panel's own same-origin calls (A2 gate: local Host + the POST marker). */
  headers: Record<string, string>
  private listeners = new Map<string, Array<(chunk?: Buffer) => void>>()
  constructor(method: string, url: string, body?: unknown, headers?: Record<string, string>) {
    this.method = method
    this.url = url
    this.headers = { host: 'localhost:3080', 'x-lks-request': '1', ...(headers ?? {}) }
    if (typeof body === 'string') this.pendingBody = Buffer.from(body, 'utf8')
    else if (body !== undefined) this.pendingBody = Buffer.from(JSON.stringify(body), 'utf8')
  }
  private pendingBody: Buffer | undefined
  feed(): void {
    const data = this.listeners.get('data') ?? []
    const end = this.listeners.get('end') ?? []
    if (this.pendingBody !== undefined) for (const l of data) l(this.pendingBody)
    for (const l of end) l()
  }
  on(event: 'data' | 'end' | 'error' | 'aborted', listener: (chunk?: Buffer) => void): void {
    const list = this.listeners.get(event) ?? []
    list.push(listener as (chunk?: Buffer) => void)
    this.listeners.set(event, list)
  }
  /** Audit C13 test hook: fire the error listeners as an aborted client would. */
  abort(): void {
    for (const l of this.listeners.get('error') ?? []) l()
  }
}

async function handle(routes: Array<{ kind: string; path: string; handler: (req: RequestLike, res: ResponseLike) => unknown }>, req: FakeRequest, res: FakeResponse): Promise<FakeResponse> {
  const route = routes.find(r => r.path === '/lookatstudy')
  assert.ok(route, 'route registered')
  const done = route.handler(req, res)
  req.feed()
  await done
  return res
}

test('A2 auth gate: unmarked POSTs, foreign hosts, and foreign origins are refused', async () => {
  const { state } = fixture()
  const routes: Array<{ kind: string; path: string; handler: (req: RequestLike, res: ResponseLike) => unknown }> = []
  registerDashboard({ register: (route) => { routes.push(route); return () => {} } }, { store: { get: () => state, save: () => {} }, studyAreaPath: 'C:/study-area', statePath: 'C:/state.json', onActiveChange: () => {}, modelInfo: async () => null })
  state.active = true
  const post = async (headers?: Record<string, string>): Promise<number> => {
    const res = await handle(routes, new FakeRequest('POST', '/lookatstudy/api/active', { active: false }, headers), new FakeResponse())
    return res.status
  }
  assert.equal(await post({ 'x-lks-request': '' }), 403, 'a POST without the plugin marker is refused (drive-by fetch needs no preflight)')
  assert.equal(state.active, true, 'the refused POST did not mutate state')
  assert.equal(await post({ host: 'evil.example' }), 403, 'a foreign Host header is refused (DNS rebinding)')
  assert.equal(await post({ origin: 'http://evil.example' }), 403, 'a foreign Origin is refused even with the marker')
  assert.equal(await post({ origin: 'http://localhost:3080' }), 200, "the panel's own same-origin POST passes")
  assert.equal(state.active, false)
  const rebinding = await handle(routes, new FakeRequest('GET', '/lookatstudy/api/state', undefined, { host: 'evil.example' }), new FakeResponse())
  assert.equal(rebinding.status, 403, 'GETs carry the Host check too')
  const localGet = await handle(routes, new FakeRequest('GET', '/lookatstudy/api/state', undefined, { 'x-lks-request': '' }), new FakeResponse())
  assert.equal(localGet.status, 200, 'GETs from the host page need no marker (img tags cannot send one)')
  const attachment = await handle(routes, new FakeRequest('GET', '/lookatstudy/api/attachment/ghost.png', undefined, { 'x-lks-request': '' }), new FakeResponse())
  assert.equal(attachment.status, 404, 'attachment GET passes the gate and misses on the file (404, not 403)')
})

test('audit C13: a body read aborted mid-stream answers 400 instead of hanging the route', async () => {
  const { state } = fixture()
  const routes: Array<{ kind: string; path: string; handler: (req: RequestLike, res: ResponseLike) => unknown }> = []
  registerDashboard({ register: (route) => { routes.push(route); return () => {} } }, { store: { get: () => state, save: () => {} }, studyAreaPath: 'C:/study-area', statePath: 'C:/state.json', onActiveChange: () => {}, modelInfo: async () => null })
  const req = new FakeRequest('POST', '/lookatstudy/api/active')
  const res = new FakeResponse()
  const route = routes.find(r => r.path === '/lookatstudy')!
  const pending = route.handler(req, res)
  req.abort()
  await pending
  assert.equal(res.status, 400, 'the aborted read settles as a bad request — the handler promise resolves')
})

test('audit C26: lesson-session binds refuse unknown lesson ids', async () => {
  const { state } = fixture()
  const routes: Array<{ kind: string; path: string; handler: (req: RequestLike, res: ResponseLike) => unknown }> = []
  registerDashboard({ register: (route) => { routes.push(route); return () => {} } }, { store: { get: () => state, save: () => {} }, studyAreaPath: 'C:/study-area', statePath: 'C:/state.json', onActiveChange: () => {}, modelInfo: async () => null })
  const res = await handle(routes, new FakeRequest('POST', '/lookatstudy/api/lesson-session', { lessonId: 'ghost:9:9', sessionId: 's1' }), new FakeResponse())
  assert.equal(res.status, 404)
  assert.equal(state.lessonThreads['ghost:9:9'], undefined, 'no orphan group was minted')
})

test('audit C14: the exam GET writes state only when an attempt actually dangled', async () => {
  const { state } = fixture()
  const examId = state.courses[0]!.sections[0]!.lessons.find(l => l.kind === 'exam')!.id
  let saved = 0
  const routes: Array<{ kind: string; path: string; handler: (req: RequestLike, res: ResponseLike) => unknown }> = []
  registerDashboard({ register: (route) => { routes.push(route); return () => {} } }, { store: { get: () => state, save: () => { saved += 1 } }, studyAreaPath: 'C:/study-area', statePath: 'C:/state.json', onActiveChange: () => {}, modelInfo: async () => null })
  for (let i = 0; i < 3; i++) {
    const res = await handle(routes, new FakeRequest('GET', `/lookatstudy/api/exam?lessonId=${encodeURIComponent(examId)}`), new FakeResponse())
    assert.equal(res.status, 200)
  }
  assert.equal(saved, 0, 'three polls with no dangling attempts wrote nothing (C14)')
})

test('workbenchState assembles map, lesson html, notes, proposals, and due list', () => {
  const { state, courseId, lessonId } = fixture()
  recordAnswer(state, lessonId, true, undefined, new Date('2026-08-15T10:00:00Z'))
  addNote(state, lessonId, 'understand', 'map', '```mermaid\nflowchart TD\n```', 'ai', null, new Date())
  proposeMastery(state, lessonId, 'great recap', new Date('2026-08-15T10:00:00Z'))
  state.active = true
  const wb = workbenchState(state, new Date('2026-08-15T10:00:00Z'))
  assert.equal(wb.active, true, 'the activation flag rides the state feed')
  assert.equal(wb.mode, 'guide')
  assert.equal(wb.courses.length, 1)
  assert.equal(wb.courses[0]!.courseId, courseId)
  assert.equal(wb.courses[0]!.total, 4, 'three study lessons plus the S1 exam node')
  const focusNode = wb.courses[0]!.sections[0]!.lessons[0]!
  assert.ok(focusNode.focus)
  assert.equal(wb.focusLessonId, lessonId)
  assert.ok(wb.lesson!.html.includes('<strong>body</strong>'), 'lesson body rendered as sanitized html')
  assert.equal(wb.lesson!.notes.length, 1)
  assert.equal(wb.lesson!.starters.length, 4)
  assert.equal(wb.pendingProposals.length, 1)
  assert.equal(wb.pendingProposals[0]!.lessonTitle, 'Reading')
  assert.equal(wb.dueCount, 0)
})

test('routes: state API, focus switching, and unknown paths', async () => {
  const { state, lessonId } = fixture()
  const routes: Array<{ kind: string; path: string; handler: (req: RequestLike, res: ResponseLike) => unknown }> = []
  registerDashboard({ register: (route) => { routes.push(route); return () => {} } }, { store: { get: () => state, save: () => {} }, studyAreaPath: 'C:/study-area', statePath: 'C:/state.json', onActiveChange: () => {}, modelInfo: async () => null })

  const page = await handle(routes, new FakeRequest('GET', '/lookatstudy/'), new FakeResponse())
  assert.equal(page.status, 404, 'the standalone workbench page is gone; only the API remains')

  const api = await handle(routes, new FakeRequest('GET', '/lookatstudy/api/state'), new FakeResponse())
  assert.equal(api.status, 200)
  assert.equal((api.json() as { courses: unknown[] }).courses.length, 1)

  let saved = 0
  const routes2: Array<{ kind: string; path: string; handler: (req: RequestLike, res: ResponseLike) => unknown }> = []
  registerDashboard({ register: (route) => { routes2.push(route); return () => {} } }, { store: { get: () => state, save: () => { saved += 1 } }, studyAreaPath: 'C:/study-area', statePath: 'C:/state.json', onActiveChange: () => {}, modelInfo: async () => null })
  const focus = await handle(routes2, new FakeRequest('POST', '/lookatstudy/api/focus', { lessonId: `${state.courses[0]!.id}:0:1` }), new FakeResponse())
  assert.equal(focus.status, 200)
  assert.equal(saved, 1)
  assert.equal(state.focus?.lessonId, `${state.courses[0]!.id}:0:1`)
  assert.equal(lessonId, `${state.courses[0]!.id}:0:0`)

  const badFocus = await handle(routes2, new FakeRequest('POST', '/lookatstudy/api/focus', { lessonId: 'ghost:0:0' }), new FakeResponse())
  assert.equal(badFocus.status, 404)

  const missing = await handle(routes2, new FakeRequest('GET', '/lookatstudy/api/nope'), new FakeResponse())
  assert.equal(missing.status, 404)
})

test('lesson-session route (issue #11): group semantics — titled append, null clear, re-activate without duplication', async () => {
  const { state } = fixture()
  let saved = 0
  const routes: Array<{ kind: string; path: string; handler: (req: RequestLike, res: ResponseLike) => unknown }> = []
  registerDashboard({ register: (route) => { routes.push(route); return () => {} } }, { store: { get: () => state, save: () => { saved += 1 } }, studyAreaPath: 'C:/study-area', statePath: 'C:/state.json', onActiveChange: () => {}, modelInfo: async () => null })
  const lessonId = `${state.courses[0]!.id}:0:0`

  const bind = await handle(routes, new FakeRequest('POST', '/lookatstudy/api/lesson-session', { lessonId, sessionId: 's1', title: '判别式法为什么失效' }), new FakeResponse())
  assert.equal(bind.status, 200)
  assert.equal(saved, 1)
  const g1 = state.lessonThreads[lessonId]!
  assert.equal(g1.threads.length, 1)
  assert.equal(g1.threads[0]!.title, '判别式法为什么失效', 'the caller names the thread (first-message semantics)')
  assert.equal(g1.active, 's1')
  assert.equal(state.lessonSessions[lessonId], 's1', 'the legacy map mirrors the active pointer')

  const second = await handle(routes, new FakeRequest('POST', '/lookatstudy/api/lesson-session', { lessonId, sessionId: 's2', title: '换一条线' }), new FakeResponse())
  assert.equal(second.status, 200)
  const g2 = state.lessonThreads[lessonId]!
  assert.equal(g2.threads.length, 2)
  assert.equal(g2.active, 's2')

  const again = await handle(routes, new FakeRequest('POST', '/lookatstudy/api/lesson-session', { lessonId, sessionId: 's1' }), new FakeResponse())
  assert.equal(again.status, 200)
  assert.equal(state.lessonThreads[lessonId]!.threads.length, 2, 're-binding a known session never duplicates')
  assert.equal(state.lessonThreads[lessonId]!.active, 's1')

  const clear = await handle(routes, new FakeRequest('POST', '/lookatstudy/api/lesson-session', { lessonId, sessionId: null }), new FakeResponse())
  assert.equal(clear.status, 200)
  assert.equal(state.lessonThreads[lessonId]!.active, null, 'null clears the pointer (the plus-new affordance)')
  assert.equal(state.lessonThreads[lessonId]!.threads.length, 2, 'threads survive a clear')
  assert.equal(state.lessonSessions[lessonId], undefined)

  const bad = await handle(routes, new FakeRequest('POST', '/lookatstudy/api/lesson-session', { lessonId: 5 }), new FakeResponse())
  assert.equal(bad.status, 400, 'junk bodies reject loudly')
})

test('the state feed carries the thread groups beside the legacy map (issue #11 wire contract)', async () => {
  const { state } = fixture()
  const lessonId = `${state.courses[0]!.id}:0:0`
  bindLessonThread(state, lessonId, 's1', '第一条线')
  const routes: Array<{ kind: string; path: string; handler: (req: RequestLike, res: ResponseLike) => unknown }> = []
  registerDashboard({ register: (route) => { routes.push(route); return () => {} } }, { store: { get: () => state, save: () => {} }, studyAreaPath: 'C:/study-area', statePath: 'C:/state.json', onActiveChange: () => {}, modelInfo: async () => null })
  const feed = await handle(routes, new FakeRequest('GET', '/lookatstudy/api/state'), new FakeResponse())
  const body = feed.json() as { lessonSessions: Record<string, string>; lessonThreads: Record<string, { active: string | null; threads: Array<{ id: string; title: string }> }> }
  assert.equal(body.lessonSessions[lessonId], 's1')
  assert.equal(body.lessonThreads[lessonId]!.active, 's1')
  assert.equal(body.lessonThreads[lessonId]!.threads[0]!.title, '第一条线')
})

test('lesson-session route (issue #11): a title-less bind still succeeds (the thread falls back to the lesson id)', async () => {
  const { state } = fixture()
  const routes: Array<{ kind: string; path: string; handler: (req: RequestLike, res: ResponseLike) => unknown }> = []
  registerDashboard({ register: (route) => { routes.push(route); return () => {} } }, { store: { get: () => state, save: () => {} }, studyAreaPath: 'C:/study-area', statePath: 'C:/state.json', onActiveChange: () => {}, modelInfo: async () => null })
  const lessonId = `${state.courses[0]!.id}:0:2`
  const res = await handle(routes, new FakeRequest('POST', '/lookatstudy/api/lesson-session', { lessonId, sessionId: 's-notitle' }), new FakeResponse())
  assert.equal(res.status, 200)
  assert.equal(state.lessonThreads[lessonId]!.threads[0]!.title, lessonId, 'no title offered = the lesson id stands in (never an empty chip)')
})

test('lesson-thread route (issue #11 management): rename/archive/delete with post-op snapshot, 400/404 loud', async () => {
  const { state } = fixture()
  const routes: Array<{ kind: string; path: string; handler: (req: RequestLike, res: ResponseLike) => unknown }> = []
  registerDashboard({ register: (route) => { routes.push(route); return () => {} } }, { store: { get: () => state, save: () => {} }, studyAreaPath: 'C:/study-area', statePath: 'C:/state.json', onActiveChange: () => {}, modelInfo: async () => null })
  const lessonId = `${state.courses[0]!.id}:0:1`
  bindLessonThread(state, lessonId, 's1', '一线')
  bindLessonThread(state, lessonId, 's2', '二线')

  const ren = await handle(routes, new FakeRequest('POST', '/lookatstudy/api/lesson-thread', { lessonId, sessionId: 's1', op: 'rename', title: '改名后的线' }), new FakeResponse())
  assert.equal(ren.status, 200)
  assert.equal(state.lessonThreads[lessonId]!.threads[0]!.title, '改名后的线')

  const arch = await handle(routes, new FakeRequest('POST', '/lookatstudy/api/lesson-thread', { lessonId, sessionId: 's2', op: 'archive', archived: true }), new FakeResponse())
  assert.equal(arch.status, 200)
  const archBody = arch.json() as { active: string | null; threads: number }
  assert.equal(archBody.active, 's1', 'archiving the current thread rolls the pointer (reported back)')
  assert.equal(archBody.threads, 2)
  assert.equal(state.lessonThreads[lessonId]!.threads[1]!.status, 'archived')

  const del = await handle(routes, new FakeRequest('POST', '/lookatstudy/api/lesson-thread', { lessonId, sessionId: 's1', op: 'delete' }), new FakeResponse())
  assert.equal(del.status, 200)
  assert.equal((del.json() as { active: string | null }).active, null, 'deleting the rolled-to thread leaves no live pointer')

  const badOp = await handle(routes, new FakeRequest('POST', '/lookatstudy/api/lesson-thread', { lessonId, sessionId: 's2', op: 'explode' }), new FakeResponse())
  assert.equal(badOp.status, 400)
  const badTitle = await handle(routes, new FakeRequest('POST', '/lookatstudy/api/lesson-thread', { lessonId, sessionId: 's2', op: 'rename', title: '  ' }), new FakeResponse())
  assert.equal(badTitle.status, 400)
  const missing = await handle(routes, new FakeRequest('POST', '/lookatstudy/api/lesson-thread', { lessonId, sessionId: 'ghost', op: 'rename', title: 'x' }), new FakeResponse())
  assert.equal(missing.status, 404, 'unknown threads 404 with the state error')
})

test('the state feed carries thread status (archived threads are visible to the fold, filtered client-side)', async () => {
  const { state } = fixture()
  const lessonId = `${state.courses[0]!.id}:0:0`
  bindLessonThread(state, lessonId, 's1', '一线')
  archiveLessonThread(state, lessonId, 's1', true)
  const routes: Array<{ kind: string; path: string; handler: (req: RequestLike, res: ResponseLike) => unknown }> = []
  registerDashboard({ register: (route) => { routes.push(route); return () => {} } }, { store: { get: () => state, save: () => {} }, studyAreaPath: 'C:/study-area', statePath: 'C:/state.json', onActiveChange: () => {}, modelInfo: async () => null })
  const feed = await handle(routes, new FakeRequest('GET', '/lookatstudy/api/state'), new FakeResponse())
  const body = feed.json() as { lessonThreads: Record<string, { active: string | null; threads: Array<{ id: string; status?: string }> }> }
  assert.equal(body.lessonThreads[lessonId]!.threads[0]!.status, 'archived', 'the status rides the feed untouched')
  assert.equal(body.lessonThreads[lessonId]!.active, null)
})

test('course-pack route (upstream exportPack alignment): self-contained JSON + markdown rendering, 404 loud', async () => {
  const { state } = fixture()
  const routes: Array<{ kind: string; path: string; handler: (req: RequestLike, res: ResponseLike) => unknown }> = []
  registerDashboard({ register: (route) => { routes.push(route); return () => {} } }, { store: { get: () => state, save: () => {} }, studyAreaPath: 'C:/study-area', statePath: 'C:/state.json', onActiveChange: () => {}, modelInfo: async () => null })
  const courseId = state.courses[0]!.id
  const ok = await handle(routes, new FakeRequest('GET', `/lookatstudy/api/course-pack?courseId=${encodeURIComponent(courseId)}`), new FakeResponse())
  assert.equal(ok.status, 200)
  const body = ok.json() as { ok: boolean; fileName: string; markdown: string; pack: { kind: string; version: number; course: { title: string } } }
  assert.equal(body.ok, true)
  assert.ok(body.fileName.endsWith('.lookatstudy-pack.md'), `fileName=${body.fileName}`)
  assert.ok(body.markdown.startsWith(`# ${body.pack.course.title}`), 'the markdown rendering leads with the course title')
  assert.equal(body.pack.kind, 'lookatstudy-course-pack')
  assert.equal(body.pack.version, 1)
  const missing = await handle(routes, new FakeRequest('GET', '/lookatstudy/api/course-pack?courseId=ghost'), new FakeResponse())
  assert.equal(missing.status, 404)
})

test('the state feed always carries the groups object (issue #11): fresh states feed empty groups, never an omitted field', async () => {
  const { state } = fixture()
  const routes: Array<{ kind: string; path: string; handler: (req: RequestLike, res: ResponseLike) => unknown }> = []
  registerDashboard({ register: (route) => { routes.push(route); return () => {} } }, { store: { get: () => state, save: () => {} }, studyAreaPath: 'C:/study-area', statePath: 'C:/state.json', onActiveChange: () => {}, modelInfo: async () => null })
  const feed = await handle(routes, new FakeRequest('GET', '/lookatstudy/api/state'), new FakeResponse())
  const body = feed.json() as Record<string, unknown>
  assert.ok(body.lessonThreads !== undefined, 'the client indexes data.lessonThreads[lessonId] unconditionally — the field must exist')
  assert.deepEqual(body.lessonThreads, {}, 'a never-taught course feeds empty groups')
})

test('note delete route: removes one entry, persists, 400 on bad body, 404 on unknown ids', async () => {
  const { state, lessonId } = fixture()
  const note = addNote(state, lessonId, 'understand', 'map', 'body', 'ai', null, new Date())
  let saved = 0
  const routes: Array<{ kind: string; path: string; handler: (req: RequestLike, res: ResponseLike) => unknown }> = []
  registerDashboard({ register: (route) => { routes.push(route); return () => {} } }, { store: { get: () => state, save: () => { saved += 1 } }, studyAreaPath: 'C:/study-area', statePath: 'C:/state.json', onActiveChange: () => {}, modelInfo: async () => null })

  const bad = await handle(routes, new FakeRequest('POST', '/lookatstudy/api/note/delete', { lessonId }), new FakeResponse())
  assert.equal(bad.status, 400, 'missing noteId is a 400')

  const ghost = await handle(routes, new FakeRequest('POST', '/lookatstudy/api/note/delete', { lessonId, noteId: 'ghost' }), new FakeResponse())
  assert.equal(ghost.status, 404, 'unknown note id is a 404')
  assert.equal(saved, 0, 'failed deletions do not persist')

  const ok = await handle(routes, new FakeRequest('POST', '/lookatstudy/api/note/delete', { lessonId, noteId: note.id }), new FakeResponse())
  assert.equal(ok.status, 200)
  assert.equal(saved, 1, 'a successful delete persists')
  assert.equal(findLesson(state, lessonId).lesson.notes.length, 0, 'the note is gone from the live state')
  assert.throws(() => deleteNote(state, lessonId, note.id), /not found/, 'deleting twice fails loud')
})

test('review route: records the SM-2 self-rating, 400 on bad quality, 404 without a schedule', async () => {
  const { state, lessonId } = fixture()
  let saved = 0
  const routes: Array<{ kind: string; path: string; handler: (req: RequestLike, res: ResponseLike) => unknown }> = []
  registerDashboard({ register: (route) => { routes.push(route); return () => {} } }, { store: { get: () => state, save: () => { saved += 1 } }, studyAreaPath: 'C:/study-area', statePath: 'C:/state.json', onActiveChange: () => {}, modelInfo: async () => null })

  const noSchedule = await handle(routes, new FakeRequest('POST', '/lookatstudy/api/review', { lessonId, quality: 4 }), new FakeResponse())
  assert.equal(noSchedule.status, 404, 'a lesson without an SM-2 schedule cannot be reviewed')

  completeLesson(state, lessonId, new Date('2026-08-15T10:00:00Z'))
  const bad = await handle(routes, new FakeRequest('POST', '/lookatstudy/api/review', { lessonId, quality: 3 }), new FakeResponse())
  assert.equal(bad.status, 400, 'the card only sends 1 | 4 | 5 (the Memrise three)')

  const ok = await handle(routes, new FakeRequest('POST', '/lookatstudy/api/review', { lessonId, quality: 4 }), new FakeResponse())
  assert.equal(ok.status, 200)
  assert.equal(saved, 1, 'the rating persists')
  assert.ok((findLesson(state, lessonId)!.lesson.dueAt ?? '') > '2026-08-15', 'the next review is scheduled')
})

test('attachment route: base64 payload rides a lifted body cap, the 20 MiB ceiling and the 64 kB default stay armed (issue #4)', async () => {
  const { state } = fixture()
  const dir = mkdtempSync(join(tmpdir(), 'lks-attach-'))
  const routes: Array<{ kind: string; path: string; handler: (req: RequestLike, res: ResponseLike) => unknown }> = []
  registerDashboard({ register: (route) => { routes.push(route); return () => {} } }, { store: { get: () => state, save: () => {} }, studyAreaPath: dir, statePath: 'C:/state.json', onActiveChange: () => {}, modelInfo: async () => null })

  // the regression: 256 kB raw → ~342 kB of base64 JSON sailed past the old
  // hard 64 kB reader cap and died as 'request body too large'
  const payload = Buffer.alloc(256 * 1024, 7)
  const ok = await handle(routes, new FakeRequest('POST', '/lookatstudy/api/attachment', { name: 'shot.png', dataBase64: payload.toString('base64') }), new FakeResponse())
  assert.equal(ok.status, 200, `expected 200, got ${ok.status} ${ok.body}`)
  const okBody = ok.json() as { path: string; bytes: number }
  assert.equal(okBody.bytes, payload.length)
  assert.ok(readFileSync(join(dir, okBody.path)).equals(payload), 'the bytes land verbatim in the study workspace')

  // 20 MiB + 1 KiB raw: base64 (~27.97 MB) fits the lifted 28 MiB reader cap,
  // so the rejection comes from the route's own size validation
  const overFile = await handle(routes, new FakeRequest('POST', '/lookatstudy/api/attachment', { name: 'big.bin', dataBase64: Buffer.alloc(20 * 1024 * 1024 + 1024, 1).toString('base64') }), new FakeResponse())
  assert.equal(overFile.status, 400)
  assert.equal((overFile.json() as { error: string }).error, 'attachment must be 1B..20MiB')

  // 22 MiB raw: base64 (~30.8 MB) exceeds even the lifted cap — the reader rejects
  const overBody = await handle(routes, new FakeRequest('POST', '/lookatstudy/api/attachment', { name: 'huge.bin', dataBase64: Buffer.alloc(22 * 1024 * 1024, 1).toString('base64') }), new FakeResponse())
  assert.equal(overBody.status, 400)
  assert.equal((overBody.json() as { error: string }).error, 'request body too large')

  // issue #7: the read-back route serves what the intake wrote, byte-exact
  const served = await handle(routes, new FakeRequest('GET', `/lookatstudy/api/attachment/${encodeURIComponent(okBody.path.split('/').pop()!)}`), new FakeResponse())
  assert.equal(served.status, 200)
  assert.equal(served.headers['content-type'], 'image/png')
  assert.ok(Buffer.from(served.body, 'utf8').equals(payload), 'the GET route returns the stored bytes')

  const traversal = await handle(routes, new FakeRequest('GET', '/lookatstudy/api/attachment/..%2Fstate.json'), new FakeResponse())
  assert.equal(traversal.status, 404, 'path traversal is rejected server-side')

  const ghost = await handle(routes, new FakeRequest('GET', '/lookatstudy/api/attachment/nope.png'), new FakeResponse())
  assert.equal(ghost.status, 404)

  // every other route keeps the tight default: a 70 kB /api/active body 400s
  const tight = await handle(routes, new FakeRequest('POST', '/lookatstudy/api/active', { on: true, pad: 'x'.repeat(70_000) }), new FakeResponse())
  assert.equal(tight.status, 400)
  assert.equal((tight.json() as { error: string }).error, 'request body too large')
})

test('user-note route: a selection becomes a record-zone note whose quote is the highlight anchor', async () => {
  const { state, lessonId } = fixture()
  let saved = 0
  const routes: Array<{ kind: string; path: string; handler: (req: RequestLike, res: ResponseLike) => unknown }> = []
  registerDashboard({ register: (route) => { routes.push(route); return () => {} } }, { store: { get: () => state, save: () => { saved += 1 } }, studyAreaPath: 'C:/study-area', statePath: 'C:/state.json', onActiveChange: () => {}, modelInfo: async () => null })

  const bad = await handle(routes, new FakeRequest('POST', '/lookatstudy/api/note/user', { lessonId, quote: 'x' }), new FakeResponse())
  assert.equal(bad.status, 400, 'a too-short selection is rejected')

  const ok = await handle(routes, new FakeRequest('POST', '/lookatstudy/api/note/user', { lessonId, quote: '  选中的原文  ' }), new FakeResponse())
  assert.equal(ok.status, 200)
  assert.equal(saved, 1, 'the note persists')
  const note = findLesson(state, lessonId).lesson.notes[0]!
  assert.equal(note.zone, 'record', 'learner selections land in the record zone')
  assert.equal(note.source, 'content', 'quoted from the lesson body')
  assert.equal(note.quote, '选中的原文', 'the quote is trimmed verbatim — it IS the highlight anchor')
  assert.equal(note.text, '选中的原文', 'no explicit text defaults to the quote')
})

test('tts route: streams the synthesis (cache-first), 400 on empty text, 502 when the synth fails', async () => {
  const { state } = fixture()
  const studyArea = mkdtempSync(join(tmpdir(), 'lks-tts-route-'))
  const routes: Array<{ kind: string; path: string; handler: (req: RequestLike, res: ResponseLike) => unknown }> = []
  const synths: string[] = []
  registerDashboard({ register: (route) => { routes.push(route); return () => {} } }, {
    store: { get: () => state, save: () => {} },
    studyAreaPath: studyArea,
    statePath: 'C:/state.json',
    onActiveChange: () => {},
    modelInfo: async () => null,
    tts: {
      synthesize: async (text, voice) => {
        synths.push(`${voice}:${text}`)
        return Buffer.from(`mp3:${voice}:${text}`)
      },
    },
  })

  const empty = await handle(routes, new FakeRequest('POST', '/lookatstudy/api/tts', { text: '  ' }), new FakeResponse())
  assert.equal(empty.status, 400, 'blank text is a 400')

  const ok = await handle(routes, new FakeRequest('POST', '/lookatstudy/api/tts', { text: '第一句。' }), new FakeResponse())
  assert.equal(ok.status, 200)
  const payload = ok.json() as { ok?: boolean; mime?: string; dataBase64?: string }
  assert.equal(payload.mime, 'audio/mpeg')
  assert.equal(Buffer.from(payload.dataBase64 ?? '', 'base64').toString(), 'mp3:zh-CN-XiaoxiaoNeural:第一句。', 'base64 payload decodes to the synthesis (default voice 晓晓)')

  const again = await handle(routes, new FakeRequest('POST', '/lookatstudy/api/tts', { text: '第一句。' }), new FakeResponse())
  assert.equal(again.status, 200)
  assert.equal(synths.length, 1, 'the second identical request replays from the cache without synthesizing')

  const failingRoutes: Array<{ kind: string; path: string; handler: (req: RequestLike, res: ResponseLike) => unknown }> = []
  registerDashboard({ register: (route) => { failingRoutes.push(route); return () => {} } }, {
    store: { get: () => state, save: () => {} },
    studyAreaPath: studyArea,
    statePath: 'C:/state.json',
    onActiveChange: () => {},
    modelInfo: async () => null,
    tts: { synthesize: async () => { throw new Error('endpoint gone') } },
  })
  const dead = await handle(failingRoutes, new FakeRequest('POST', '/lookatstudy/api/tts', { text: '第二句。' }), new FakeResponse())
  assert.equal(dead.status, 502, 'a synthesis failure surfaces as a 502 (the client falls back to speechSynthesis)')
})

test('mode route: switches and persists the soul mode; 400 on bad values', async () => {
  const { state } = fixture()
  assert.equal(state.mode, 'guide')
  let saved = 0
  const routes: Array<{ kind: string; path: string; handler: (req: RequestLike, res: ResponseLike) => unknown }> = []
  registerDashboard({ register: (route) => { routes.push(route); return () => {} } }, { store: { get: () => state, save: () => { saved += 1 } }, studyAreaPath: 'C:/study-area', statePath: 'C:/state.json', onActiveChange: () => {}, modelInfo: async () => null })

  const ok = await handle(routes, new FakeRequest('POST', '/lookatstudy/api/mode', { mode: 'practice' }), new FakeResponse())
  assert.equal(ok.status, 200)
  assert.equal((ok.json() as { mode: string }).mode, 'practice')
  assert.equal(state.mode, 'practice')
  assert.equal(saved, 1)

  const bad = await handle(routes, new FakeRequest('POST', '/lookatstudy/api/mode', { mode: 'socratic' }), new FakeResponse())
  assert.equal(bad.status, 400)
  assert.equal(state.mode, 'practice', 'rejected value leaves the mode untouched')
  assert.equal(saved, 1)
})

test('active route: flips activation, persists, and syncs the surface before responding', async () => {
  const { state } = fixture()
  assert.equal(state.active, false, 'fixture starts dormant')
  let saved = 0
  const flips: boolean[] = []
  const routes: Array<{ kind: string; path: string; handler: (req: RequestLike, res: ResponseLike) => unknown }> = []
  registerDashboard({ register: (route) => { routes.push(route); return () => {} } }, {
    store: { get: () => state, save: () => { saved += 1 } },
    studyAreaPath: 'C:/study-area',
    statePath: 'C:/state.json',
    onActiveChange: (active) => { flips.push(active) },
    modelInfo: async () => null,
  })

  const feed = await handle(routes, new FakeRequest('GET', '/lookatstudy/api/state'), new FakeResponse())
  assert.equal((feed.json() as { active: boolean }).active, false, 'the state feed carries the flag')

  // The settings page and the composer dock pill ride the same feed: the
  // progress block and the state-file path must be present (W2/W4 contract).
  const feedValue = feed.json() as { progress: { totalXp: number; level: number; streak: number }; statePath: string }
  assert.ok(typeof feedValue.progress.totalXp === 'number', 'the feed carries the XP total')
  assert.ok(typeof feedValue.progress.level === 'number', 'the feed carries the level')
  assert.ok(typeof feedValue.progress.streak === 'number', 'the feed carries the streak')
  assert.equal(feedValue.statePath, 'C:/state.json', 'the feed carries the state-file path for the settings page')

  const on = await handle(routes, new FakeRequest('POST', '/lookatstudy/api/active', { active: true }), new FakeResponse())
  assert.equal(on.status, 200)
  assert.equal((on.json() as { active: boolean }).active, true)
  assert.equal(state.active, true)
  assert.equal(saved, 1)
  assert.deepEqual(flips, [true], 'the surface sync fired by the time the response landed')

  const off = await handle(routes, new FakeRequest('POST', '/lookatstudy/api/active', { active: false }), new FakeResponse())
  assert.equal((off.json() as { active: boolean }).active, false)
  assert.deepEqual(flips, [true, false], 'each flip fires exactly one sync')

  const bad = await handle(routes, new FakeRequest('POST', '/lookatstudy/api/active', { active: 'yes' }), new FakeResponse())
  assert.equal(bad.status, 400)
  assert.equal(state.active, false, 'a rejected value leaves activation untouched')
  assert.equal(saved, 2)
})

test('/study activates a dormant install and queues the kickoff through followup', async () => {
  const { executeStudyCommand, registerStudyCommand, studyKickoffPrompt } = await import('../src/commands.ts')
  const { state } = fixture()
  state.active = false
  let saved = 0
  const flips: boolean[] = []
  const followups: unknown[] = []
  const deps = {
    store: { get: () => state, save: () => { saved += 1 } },
    onActiveChange: (active: boolean) => { flips.push(active) },
  }
  // Bare /study on a dormant install: activate + persist + sync BEFORE the prompt.
  const result = executeStudyCommand(deps, { agent: { followup: m => { followups.push(m) } }, rawInput: '   ' })
  assert.equal(result.kind, 'success')
  assert.equal(state.active, true, 'the dormant install activated')
  assert.equal(saved, 1)
  assert.deepEqual(flips, [true], 'the tool registry synced before the prompt landed')
  const message = followups[0] as { id: string; role: string; content: Array<{ type: string; text: string }>; source: { kind: string } }
  assert.equal(message.role, 'user')
  assert.equal(message.content[0]!.text, studyKickoffPrompt(), 'bare /study queues the hero kickoff prompt')
  assert.equal(message.source.kind, 'plugin')
  assert.ok(typeof message.id === 'string' && message.id !== '', 'the message carries a minted id')
  // /study <text> passes the text through as the learning request.
  executeStudyCommand(deps, { agent: { followup: m => { followups.push(m) } }, rawInput: ' teach me backprop ' })
  assert.equal((followups[1] as { content: Array<{ text: string }> }).content[0]!.text, 'teach me backprop')
  // An already-active install does not re-save or re-sync.
  const savedBefore = saved
  const flipsBefore = flips.length
  executeStudyCommand(deps, { agent: { followup: () => {} }, rawInput: '' })
  assert.equal(saved, savedBefore, 'no redundant save when already active')
  assert.equal(flips.length, flipsBefore, 'no redundant sync when already active')
  // Registration shape: the /study definition on the commands service.
  let def: { name: string } | undefined
  registerStudyCommand({ register: d => { def = d; return () => {} } }, deps)
  assert.equal(def!.name, 'study')
})

// --- upstream v0.24.0 port: the settings About row rides the state feed's version ---

test('the state feed carries the plugin version read from the running package.json', async () => {
  const state = emptyState()
  state.active = true
  const routes: Array<{ kind: string; path: string; handler: (req: RequestLike, res: unknown) => unknown }> = []
  registerDashboard({ register: (route) => { routes.push(route as never); return () => {} } },
    { store: { get: () => state, save: () => {} }, studyAreaPath: 'C:/study-area', statePath: 'C:/state.json', onActiveChange: () => {}, modelInfo: async () => null } as never)
  const api = await handle(routes as never, new FakeRequest('GET', '/lookatstudy/api/state'), new FakeResponse())
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
  assert.equal((api.json() as { version: string }).version, pkg.version, 'version equals the installed package.json — strictly the running build')
})

test('the state feed carries the host-resolved model facts (real context capacity for the meter)', async () => {
  const state = emptyState()
  state.active = true
  const routes: Array<{ kind: string; path: string; handler: (req: RequestLike, res: unknown) => unknown }> = []
  registerDashboard({ register: (route) => { routes.push(route as never); return () => {} } },
    {
      store: { get: () => state, save: () => {} }, studyAreaPath: 'C:/study-area', statePath: 'C:/state.json', onActiveChange: () => {},
      modelInfo: async () => ({ id: 'glm-5.2', provider: 'glm-coding', contextWindow: 128000 }),
    } as never)
  const api = await handle(routes as never, new FakeRequest('GET', '/lookatstudy/api/state'), new FakeResponse())
  const model = (api.json() as { model: { id: string; provider: string; contextWindow: number | null } | null }).model
  assert.deepEqual(model, { id: 'glm-5.2', provider: 'glm-coding', contextWindow: 128000 }, 'the feed exposes the host-resolved capacity verbatim')
  // a face-less composition degrades to null, never throws the route down
  const routes2: Array<{ kind: string; path: string; handler: (req: RequestLike, res: unknown) => unknown }> = []
  registerDashboard({ register: (route) => { routes2.push(route as never); return () => {} } },
    { store: { get: () => state, save: () => {} }, studyAreaPath: 'C:/study-area', statePath: 'C:/state.json', onActiveChange: () => {}, modelInfo: async () => null } as never)
  const api2 = await handle(routes2 as never, new FakeRequest('GET', '/lookatstudy/api/state'), new FakeResponse())
  assert.equal((api2.json() as { model: unknown }).model, null, 'no faces on the composition → model null')
})


test('routes: the exam-v2 lifecycle rides the dashboard API (P12)', async () => {
  const state = emptyState()
  const course = importCourse(state, parseMarkdownToCourse(COURSE_MD), 'markdown', 'fixture')
  const exam = state.courses[0]!.sections.flatMap(s => s.lessons).find(l => l.kind === 'exam')!
  const routes: Array<{ kind: string; path: string; handler: (req: RequestLike, res: ResponseLike) => unknown }> = []
  registerDashboard({ register: (route) => { routes.push(route); return () => {} } }, { store: { get: () => state, save: () => {} }, studyAreaPath: 'C:/study-area', statePath: 'C:/state.json', onActiveChange: () => {}, modelInfo: async () => null })

  const idle = (await handle(routes, new FakeRequest('GET', `/lookatstudy/api/exam?lessonId=${encodeURIComponent(exam.id)}`), new FakeResponse()) as { status: number; json(): { status: string; questionCount: number; attemptCount: number } })
  assert.equal(idle.status, 200)
  assert.equal(idle.json().status, 'idle')

  const notExam = await handle(routes, new FakeRequest('GET', '/lookatstudy/api/exam?lessonId=ghost:0:0'), new FakeResponse())
  assert.equal(notExam.status, 404)

  await handle(routes, new FakeRequest('POST', '/lookatstudy/api/exam/prepare', { lessonId: exam.id }), new FakeResponse())
  const bank = Array.from({ length: 5 }, (_v, i) => ({ prompt: `Q${String(i + 1)}`, options: ['a', 'b', 'c', 'd'], answer: i % 4, kcTitle: null, explanation: null }))
  // banks land through the TOOL (anti-hallucination validated) — the routes only
  // carry the lifecycle; apply directly through state like the tool does
  const { applyExamBank } = await import('../src/state.ts')
  applyExamBank(state, exam.id, bank, new Date())

  const ready = (await handle(routes, new FakeRequest('GET', `/lookatstudy/api/exam?lessonId=${encodeURIComponent(exam.id)}`), new FakeResponse()) as { json(): { status: string; questionCount: number; kcCount: number; questions: unknown[] } })
  const rv = ready.json()
  assert.equal(rv.status, 'ready')
  assert.equal(rv.questionCount, 5)
  assert.equal(rv.questions.length, 5, 'the full bank ships to the answering view (upstream trust model)')

  const start = (await handle(routes, new FakeRequest('POST', '/lookatstudy/api/exam/start', { lessonId: exam.id }), new FakeResponse()) as { json(): { attemptId: string } })
  const attemptId = start.json().attemptId
  await handle(routes, new FakeRequest('POST', '/lookatstudy/api/exam/record', { lessonId: exam.id, attemptId, questionId: 'q0', answer: '0' }), new FakeResponse())
  const badRecord = await handle(routes, new FakeRequest('POST', '/lookatstudy/api/exam/record', { lessonId: exam.id, attemptId, questionId: 'q0', answer: 'zz' }), new FakeResponse())
  assert.equal(badRecord.status, 404, 'non-index answers fail loud')

  // a dangling attempt is graded dead on the next status read (upstream semantics)
  const resettle = (await handle(routes, new FakeRequest('GET', `/lookatstudy/api/exam?lessonId=${encodeURIComponent(exam.id)}`), new FakeResponse()) as { json(): { latestAttempt: { finishedAt: string | null; terminated: boolean; correctCount: number | null } } })
  const latest = resettle.json().latestAttempt
  assert.equal(latest.finishedAt !== null, true, 'GET settles the dangling attempt')
  assert.equal(latest.terminated, true)
  assert.equal(latest.correctCount, 1, 'partial credit kept')

  const submit = (await handle(routes, new FakeRequest('POST', '/lookatstudy/api/exam/submit', { lessonId: exam.id, attemptId }), new FakeResponse()) as { status: number })
  assert.equal(submit.status, 404, 'already-settled attempts refuse a second submit')

  await handle(routes, new FakeRequest('POST', '/lookatstudy/api/exam/regenerate', { lessonId: exam.id }), new FakeResponse())
  const backIdle = (await handle(routes, new FakeRequest('GET', `/lookatstudy/api/exam?lessonId=${encodeURIComponent(exam.id)}`), new FakeResponse()) as { json(): { status: string; attemptCount: number } })
  assert.equal(backIdle.json().status, 'idle')
  assert.equal(backIdle.json().attemptCount, 1, 'history survives regeneration')

  // the state feed's lesson projection carries the exam summary + kind
  state.focus = { lessonId: exam.id }
  const wb = workbenchState(state, new Date())
  assert.equal(wb.lesson!.kind, 'exam')
  assert.equal(wb.lesson!.exam!.status, 'idle')
  assert.equal(wb.lesson!.exam!.attemptCount, 1)
  void course
})

test('audit D34: the state feed answers 304 on an unchanged ETag', async () => {
  const { state } = fixture()
  const routes: Array<{ kind: string; path: string; handler: (req: RequestLike, res: ResponseLike) => unknown }> = []
  registerDashboard({ register: (route) => { routes.push(route); return () => {} } }, { store: { get: () => state, save: () => {} }, studyAreaPath: 'C:/study-area', statePath: 'C:/state.json', onActiveChange: () => {}, modelInfo: async () => null })
  const first = await handle(routes, new FakeRequest('GET', '/lookatstudy/api/state'), new FakeResponse())
  assert.equal(first.status, 200)
  const etag = first.headers.etag
  assert.ok(typeof etag === 'string' && etag.startsWith('"'), 'the feed carries a strong ETag')
  const second = await handle(routes, new FakeRequest('GET', '/lookatstudy/api/state', undefined, { 'if-none-match': etag }), new FakeResponse())
  assert.equal(second.status, 304, 'an unchanged poll answers Not Modified')
  assert.equal(second.body, '', 'no payload reships')
})

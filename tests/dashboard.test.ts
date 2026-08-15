/**
 * The study workbench: state assembly (pure) and the HTTP route handlers
 * against structural request/response fakes — page, polling state API,
 * focus switching, and the reverse message channel.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { parseMarkdownToCourse } from '../src/vendor/markdown-course.ts'
import { emptyState, importCourse, proposeMastery, recordAnswer, addNote } from '../src/state.ts'
import type { LearningState } from '../src/state.ts'
import {
  registerDashboard,
  workbenchState,
  type RequestLike,
  type ResponseLike,
} from '../src/dashboard.ts'
import { dashboardTools } from '../src/tools.ts'

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
  private listeners = new Map<string, Array<(chunk?: Buffer) => void>>()
  constructor(method: string, url: string, body?: unknown) {
    this.method = method
    this.url = url
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
  on(event: 'data' | 'end', listener: (chunk?: Buffer) => void): void {
    const list = this.listeners.get(event) ?? []
    list.push(listener as (chunk?: Buffer) => void)
    this.listeners.set(event, list)
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

test('workbenchState assembles map, lesson html, notes, proposals, and due list', () => {
  const { state, courseId, lessonId } = fixture()
  recordAnswer(state, lessonId, true, undefined, new Date('2026-08-15T10:00:00Z'))
  addNote(state, lessonId, 'understand', 'map', '```mermaid\nflowchart TD\n```', 'ai', null, new Date())
  proposeMastery(state, lessonId, 'great recap', new Date('2026-08-15T10:00:00Z'))
  const wb = workbenchState(state, new Date('2026-08-15T10:00:00Z'))
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

test('routes: page, state API, focus switching, and unknown paths', async () => {
  const { state, lessonId } = fixture()
  const routes: Array<{ kind: string; path: string; handler: (req: RequestLike, res: ResponseLike) => unknown }> = []
  registerDashboard({ register: (route) => { routes.push(route); return () => {} } }, { store: { get: () => state, save: () => {} }, agentRef: { current: undefined }, studyAreaPath: 'C:/study-area' })

  const page = await handle(routes, new FakeRequest('GET', '/lookatstudy/'), new FakeResponse())
  assert.equal(page.status, 200)
  assert.ok(page.body.includes('LookatStudy 学习台'))
  assert.ok(page.body.includes('/lookatstudy/api/state'))

  const api = await handle(routes, new FakeRequest('GET', '/lookatstudy/api/state'), new FakeResponse())
  assert.equal(api.status, 200)
  assert.equal((api.json() as { courses: unknown[] }).courses.length, 1)

  let saved = 0
  const routes2: Array<{ kind: string; path: string; handler: (req: RequestLike, res: ResponseLike) => unknown }> = []
  registerDashboard({ register: (route) => { routes2.push(route); return () => {} } }, { store: { get: () => state, save: () => { saved += 1 } }, agentRef: { current: undefined }, studyAreaPath: 'C:/study-area' })
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

test('mode route: switches and persists the soul mode; 400 on bad values', async () => {
  const { state } = fixture()
  assert.equal(state.mode, 'guide')
  let saved = 0
  const routes: Array<{ kind: string; path: string; handler: (req: RequestLike, res: ResponseLike) => unknown }> = []
  registerDashboard({ register: (route) => { routes.push(route); return () => {} } }, { store: { get: () => state, save: () => { saved += 1 } }, agentRef: { current: undefined } })

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

test('message route: 409 without an agent, followup with one, 400 on bad bodies', async () => {
  const { state } = fixture()
  const routes: Array<{ kind: string; path: string; handler: (req: RequestLike, res: ResponseLike) => unknown }> = []
  const agentRef: { current: { followup(message: unknown): void } | undefined } = { current: undefined }
  registerDashboard({ register: (route) => { routes.push(route); return () => {} } }, { store: { get: () => state, save: () => {} }, agentRef, studyAreaPath: 'C:/study-area' })

  const noAgent = await handle(routes, new FakeRequest('POST', '/lookatstudy/api/message', { text: 'hi' }), new FakeResponse())
  assert.equal(noAgent.status, 409)

  const sent: unknown[] = []
  agentRef.current = { followup: (message) => { sent.push(message) } }
  const ok = await handle(routes, new FakeRequest('POST', '/lookatstudy/api/message', { text: '开始上课' }), new FakeResponse())
  assert.equal(ok.status, 200)
  assert.equal(sent.length, 1)
  const message = sent[0] as { role: string; content: Array<{ type: string; text: string }>; source: { kind: string } }
  assert.equal(message.role, 'user')
  assert.equal(message.content[0]!.text, '开始上课')
  assert.equal(message.source.kind, 'user')

  const empty = await handle(routes, new FakeRequest('POST', '/lookatstudy/api/message', { text: '  ' }), new FakeResponse())
  assert.equal(empty.status, 400)
  const malformed = await handle(routes, new FakeRequest('POST', '/lookatstudy/api/message', 'not-json'), new FakeResponse())
  assert.ok([400, 500].includes(malformed.status))
})



test('lesson-session route records the thread mapping and persists', async () => {
  const { state, lessonId } = fixture()
  let saved = 0
  const routes: Array<{ kind: string; path: string; handler: (req: RequestLike, res: ResponseLike) => unknown }> = []
  registerDashboard({ register: (route) => { routes.push(route); return () => {} } }, { store: { get: () => state, save: () => { saved += 1 } }, agentRef: { current: undefined }, studyAreaPath: 'C:/study-area' })
  const ok = await handle(routes, new FakeRequest('POST', '/lookatstudy/api/lesson-session', { lessonId, sessionId: 'sess-1' }), new FakeResponse())
  assert.equal(ok.status, 200)
  assert.equal(saved, 1)
  assert.equal(state.lessonSessions[lessonId], 'sess-1')
  assert.equal(workbenchState(state, new Date()).lessonSessions[lessonId], 'sess-1', 'the mapping rides the state payload')
  const bad = await handle(routes, new FakeRequest('POST', '/lookatstudy/api/lesson-session', { lessonId }), new FakeResponse())
  assert.equal(bad.status, 400)
})

test('study-workspace route: returns the apply-created area path', async () => {
  const { state } = fixture()
  const routes: Array<{ kind: string; path: string; handler: (req: RequestLike, res: ResponseLike) => unknown }> = []
  registerDashboard({ register: (route) => { routes.push(route); return () => {} } }, { store: { get: () => state, save: () => {} }, agentRef: { current: undefined }, studyAreaPath: 'D:/areas/study' })
  const res = await handle(routes, new FakeRequest('GET', '/lookatstudy/api/study-workspace'), new FakeResponse())
  assert.equal(res.status, 200)
  assert.deepEqual(res.json(), { ok: true, path: 'D:/areas/study' })
})

test('dashboardTools returns a working study_dashboard tool', async () => {
  const [tool] = dashboardTools(() => 'http://127.0.0.1:3080/lookatstudy/')
  assert.ok(tool)
  assert.equal(tool.name, 'study_dashboard')
  const value = await tool.execute({}, { signal: new AbortController().signal } as never)
  assert.deepEqual(value, { url: 'http://127.0.0.1:3080/lookatstudy/' })
})

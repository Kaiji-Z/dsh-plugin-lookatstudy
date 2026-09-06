/**
 * The study tab's HTTP API: state assembly (pure) and the route handlers
 * against structural request/response fakes — polling state feed, focus
 * switching, mode, lesson-session binding, and course deletion.
 */

import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseMarkdownToCourse } from '../src/vendor/markdown-course.ts'
import { emptyState, importCourse, proposeMastery, recordAnswer, addNote, deleteNote, findLesson } from '../src/state.ts'
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
  registerDashboard({ register: (route) => { routes.push(route); return () => {} } }, { store: { get: () => state, save: () => {} }, studyAreaPath: 'C:/study-area', statePath: 'C:/state.json', onActiveChange: () => {} })

  const page = await handle(routes, new FakeRequest('GET', '/lookatstudy/'), new FakeResponse())
  assert.equal(page.status, 404, 'the standalone workbench page is gone; only the API remains')

  const api = await handle(routes, new FakeRequest('GET', '/lookatstudy/api/state'), new FakeResponse())
  assert.equal(api.status, 200)
  assert.equal((api.json() as { courses: unknown[] }).courses.length, 1)

  let saved = 0
  const routes2: Array<{ kind: string; path: string; handler: (req: RequestLike, res: ResponseLike) => unknown }> = []
  registerDashboard({ register: (route) => { routes2.push(route); return () => {} } }, { store: { get: () => state, save: () => { saved += 1 } }, studyAreaPath: 'C:/study-area', statePath: 'C:/state.json', onActiveChange: () => {} })
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

test('note delete route: removes one entry, persists, 400 on bad body, 404 on unknown ids', async () => {
  const { state, lessonId } = fixture()
  const note = addNote(state, lessonId, 'understand', 'map', 'body', 'ai', null, new Date())
  let saved = 0
  const routes: Array<{ kind: string; path: string; handler: (req: RequestLike, res: ResponseLike) => unknown }> = []
  registerDashboard({ register: (route) => { routes.push(route); return () => {} } }, { store: { get: () => state, save: () => { saved += 1 } }, studyAreaPath: 'C:/study-area', statePath: 'C:/state.json', onActiveChange: () => {} })

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

test('mode route: switches and persists the soul mode; 400 on bad values', async () => {
  const { state } = fixture()
  assert.equal(state.mode, 'guide')
  let saved = 0
  const routes: Array<{ kind: string; path: string; handler: (req: RequestLike, res: ResponseLike) => unknown }> = []
  registerDashboard({ register: (route) => { routes.push(route); return () => {} } }, { store: { get: () => state, save: () => { saved += 1 } }, studyAreaPath: 'C:/study-area', statePath: 'C:/state.json', onActiveChange: () => {} })

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
  const routes: Array<{ kind: string; path: string; handler: (req: RouteMethod, res: unknown) => unknown }> = []
  registerDashboard({ register: (route) => { routes.push(route as never); return () => {} } },
    { store: { get: () => state, save: () => {} }, studyAreaPath: 'C:/study-area', statePath: 'C:/state.json', onActiveChange: () => {} } as never)
  const api = await handle(routes as never, new FakeRequest('GET', '/lookatstudy/api/state'), new FakeResponse())
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
  assert.equal((api.json() as { version: string }).version, pkg.version, 'version equals the installed package.json — strictly the running build')
})

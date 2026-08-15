/**
 * Shared client-side study store: one module-level poller over the host
 * plugin's `/lookatstudy/api/state` endpoint, plus the three write actions
 * (focus, mode, reverse message). Every seat component binds through
 * {@link useStudy}; subscribers share the single 3 s poll cycle and the last
 * snapshot, so mounting more controls costs no extra requests.
 * @module dsh-plugin-lookatstudy/client/data
 */

import { useSyncExternalStore } from 'react'

/** Wire shape of `GET /lookatstudy/api/state` (structural mirror of the host's WorkbenchState). */
export interface StudyState {
  readonly mode: 'direct' | 'guide' | 'practice'
  readonly courses: ReadonlyArray<{
    readonly courseId: string
    readonly title: string
    readonly mastered: number
    readonly total: number
    readonly avgMasteryPct: number | null
    readonly sections: ReadonlyArray<{
      readonly title: string
      readonly index: number
      readonly lessons: ReadonlyArray<{
        readonly id: string
        readonly title: string
        readonly kind: 'study' | 'practice' | 'exam'
        readonly status: string
        readonly masteryPct: number | null
        readonly weakConcepts: number
        readonly frictionCount: number
        readonly due: boolean
        readonly focus: boolean
      }>
    }>
  }>
  readonly focusLessonId: string | null
  readonly lesson: {
    readonly lessonId: string
    readonly courseTitle: string
    readonly sectionTitle: string
    readonly title: string
    readonly status: string
    readonly masteryPct: number | null
    readonly strategy: string
    readonly concepts: ReadonlyArray<{ title: string; masteryPct: number; weak: boolean }>
    readonly starters: ReadonlyArray<{ label: string; message: string }>
    readonly notes: ReadonlyArray<{ id: string; zone: string; title: string; text: string; source: string; quote: string | null }>
    readonly html: string
  } | null
  readonly dueCount: number
  readonly due: ReadonlyArray<{ lessonId: string; lessonTitle: string; courseTitle: string; overdueDays: number }>
  readonly pendingProposals: ReadonlyArray<{ id: string; lessonTitle: string; rationale: string }>
  readonly memory: { global: string | null; lesson: string | null; pattern: string | null }
  readonly lessonSessions: Readonly<Record<string, string>>
}

/** Poll cadence for the shared store; one cycle serves every mounted seat. */
const POLL_MS = 3_000

type Listener = () => void

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, init)
  const body: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const error = body !== null && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
      ? body.error
      : `HTTP ${res.status}`
    throw new Error(error)
  }
  return body
}

class StudyStore {
  private snapshot: StudyState | null = null
  private readonly listeners = new Set<Listener>()
  private timer: ReturnType<typeof setInterval> | undefined
  private inflight = false

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    if (this.listeners.size === 1) {
      void this.tick()
      this.timer = setInterval(() => { void this.tick() }, POLL_MS)
    }
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0 && this.timer !== undefined) {
        clearInterval(this.timer)
        this.timer = undefined
      }
    }
  }

  getSnapshot = (): StudyState | null => this.snapshot

  private emit(): void {
    for (const listener of this.listeners) listener()
  }

  private async tick(): Promise<void> {
    if (this.inflight) return
    this.inflight = true
    try {
      const next = await fetchJson('/lookatstudy/api/state') as StudyState
      this.snapshot = next
      this.emit()
    } catch {
      // Host route absent (headless composition) or transient failure: keep
      // the last snapshot; seats render their loading/empty states.
    } finally {
      this.inflight = false
    }
  }

  /** One immediate re-read (after a write action). */
  refresh(): void {
    void this.tick()
  }

  /** Switch the tutor's soul mode directly (host persists and applies it on the next request). */
  async setMode(mode: StudyState['mode']): Promise<void> {
    await fetchJson('/lookatstudy/api/mode', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode }),
    })
    this.refresh()
  }

  /** Point the tutor's focus at one lesson. */
  async setFocus(lessonId: string): Promise<void> {
    await fetchJson('/lookatstudy/api/focus', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lessonId }),
    })
    this.refresh()
  }

  /** Record the dsh session backing one lesson (the simplified thread system). */
  async bindLessonSession(lessonId: string, sessionId: string): Promise<void> {
    await fetchJson('/lookatstudy/api/lesson-session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lessonId, sessionId }),
    })
    this.refresh()
  }

  /** Delete one course (and its proposals) from the host state. */
  async deleteCourse(courseId: string): Promise<void> {
    await fetchJson('/lookatstudy/api/course/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ courseId }),
    })
    this.refresh()
  }
}

/** The one shared store instance backing every study seat component. */
export const studyStore = new StudyStore()

/** React binding: live snapshot plus the write actions. */
export function useStudy(): {
  data: StudyState | null
  setMode: (mode: StudyState['mode']) => Promise<void>
  setFocus: (lessonId: string) => Promise<void>
  deleteCourse: (courseId: string) => Promise<void>
  bindLessonSession: (lessonId: string, sessionId: string) => Promise<void>
} {
  const data = useSyncExternalStore(studyStore.subscribe, studyStore.getSnapshot, studyStore.getSnapshot)
  return {
    data,
    setMode: studyStore.setMode.bind(studyStore),
    setFocus: studyStore.setFocus.bind(studyStore),
    deleteCourse: studyStore.deleteCourse.bind(studyStore),
    bindLessonSession: studyStore.bindLessonSession.bind(studyStore),
  }
}

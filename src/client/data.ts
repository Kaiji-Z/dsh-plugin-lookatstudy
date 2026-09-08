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
  readonly active: boolean
  readonly mode: 'direct' | 'guide' | 'practice'
  /** E2: the history-budget directive flag. */
  readonly historyBudget?: boolean
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
    readonly kind: string
    readonly status: string
    readonly masteryPct: number | null
    readonly strategy: string
    readonly concepts: ReadonlyArray<{ title: string; masteryPct: number; weak: boolean }>
    readonly starters: ReadonlyArray<{ label: string; message: string }>
    readonly artifacts: ReadonlyArray<{ id: string; artifactType: string; title: string; data: Record<string, unknown> }>
    readonly due: boolean
    readonly notes: ReadonlyArray<{ id: string; zone: string; title: string; text: string; source: string; quote: string | null; pinned: boolean }>
    readonly exam: {
      readonly status: string
      readonly questionCount: number
      readonly kcCount: number
      readonly bestStars: number
      readonly attemptCount: number
    } | null
    readonly html: string
    readonly markdown: string
    readonly speechText: string
  } | null
  readonly dueCount: number
  readonly due: ReadonlyArray<{ lessonId: string; lessonTitle: string; courseTitle: string; overdueDays: number }>
  readonly pendingProposals: ReadonlyArray<{ id: string; lessonTitle: string; rationale: string }>
  readonly memory: { global: string | null; lesson: string | null; pattern: string | null }
  readonly lessonSessions: Readonly<Record<string, string>>
  /** XP + streak block (mirrors study_courses; feeds the dock pill and the settings page). */
  readonly progress: {
    readonly totalXp: number
    readonly level: number
    readonly levelPct: number
    readonly todayXp: number
    readonly dailyGoal: number
    readonly streak: number
    readonly longestStreak: number
    readonly freezeCount: number
  }
  /** Absolute state-file path (read-only display). */
  readonly statePath: string
  /** Plugin version from the running build's package.json (settings About row). */
  readonly version: string
  /** Host-resolved tutor model facts (the meter's real context capacity). */
  readonly model: { readonly id: string; readonly contextWindow: number | null } | null
}

/** ── Exam v2 wire shapes (GET /lookatstudy/api/exam; upstream ExamStatusView). ── */
export interface ExamQuestionView {
  readonly id: string
  readonly prompt: string
  readonly options: readonly string[]
  readonly answer: number
  readonly kcTitle: string | null
  readonly explanation: string | null
}

export interface ExamPerQuestionResult {
  readonly exerciseId: string
  readonly kcTitle: string | null
  readonly correct: boolean
  readonly answered: boolean
  readonly userAnswer: string
  readonly correctAnswer: string
  readonly explanation: string | null
  readonly prompt: string | null
  readonly options: readonly string[] | null
}

export interface ExamStatusView {
  readonly ok: boolean
  readonly status: 'idle' | 'generating' | 'ready' | 'failed'
  readonly error: string | null
  readonly questionCount: number
  readonly kcCount: number
  readonly questions: readonly ExamQuestionView[]
  readonly bestStars: number
  readonly attemptCount: number
  readonly latestAttempt: {
    readonly id: string
    readonly finishedAt: string | null
    readonly correctCount: number | null
    readonly totalCount: number | null
    readonly stars: number | null
    readonly terminated: boolean
    readonly perQuestion: readonly ExamPerQuestionResult[]
  } | null
}

export interface ExamSubmitResult {
  readonly ok: boolean
  readonly correctCount: number
  readonly totalCount: number
  readonly stars: number
  readonly bestStars: number
  readonly terminated: boolean
  readonly perQuestion: readonly ExamPerQuestionResult[]
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

  /** E2: toggle the history-budget directive (the tutor layer executes the trim). */
  async setHistoryBudget(on: boolean): Promise<void> {
    await fetchJson('/lookatstudy/api/budget', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ on }),
    })
    this.refresh()
  }

  /** E3: land one attachment verbatim in the study workspace; returns the workspace-relative path. */
  async uploadAttachment(name: string, dataBase64: string): Promise<string> {
    const body = await fetchJson('/lookatstudy/api/attachment', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, dataBase64 }),
    }) as { path?: string }
    if (body === null || typeof body !== 'object' || typeof body.path !== 'string') throw new Error('attachment upload failed')
    return body.path
  }

  /**
   * Flip learning mode. The host syncs its tool registry before responding,
   * so awaiting this guarantees the `study_*` tools exist for the next prompt.
   */
  async activate(active: boolean): Promise<void> {
    await fetchJson('/lookatstudy/api/active', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ active }),
    })
    this.refresh()
  }

  /** Full-text lesson search (rail fallback when local title matching misses). */
  async searchLessons(query: string): Promise<Array<{ lessonId: string; lessonTitle: string; snippet: string }>> {
    const body = await fetchJson(`/lookatstudy/api/search?q=${encodeURIComponent(query)}`) as { matches?: Array<{ lessonId: string; lessonTitle: string; snippet: string }> }
    return body.matches ?? []
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

  /** Save a learner selection as a record-zone note (the highlight anchor is the quote). */
  async addUserNote(lessonId: string, quote: string): Promise<void> {
    await fetchJson('/lookatstudy/api/note/user', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lessonId, quote }),
    })
    this.refresh()
  }

  /** Record one SM-2 self-rating (1 again / 4 remembered / 5 mastered). */
  async recordReview(lessonId: string, quality: 1 | 4 | 5): Promise<void> {
    await fetchJson('/lookatstudy/api/review', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lessonId, quality }),
    })
    this.refresh()
  }

  /** Delete one notebook entry from a lesson's Cornell zones. */
  async deleteNote(lessonId: string, noteId: string): Promise<void> {
    await fetchJson('/lookatstudy/api/note/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lessonId, noteId }),
    })
    this.refresh()
  }

  /** Edit a note's body (C6). */
  async editNote(lessonId: string, noteId: string, text: string): Promise<void> {
    await fetchJson('/lookatstudy/api/note/edit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lessonId, noteId, text }),
    })
    this.refresh()
  }

  /** Pin/unpin a note (C6). */
  async pinNote(lessonId: string, noteId: string, pinned: boolean): Promise<void> {
    await fetchJson('/lookatstudy/api/note/pin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lessonId, noteId, pinned }),
    })
    this.refresh()
  }

  /** ── Exam v2 (P12): bank + attempt lifecycle (upstream exam-service API shape). ── */

  async examStatus(lessonId: string): Promise<ExamStatusView> {
    return await fetchJson(`/lookatstudy/api/exam?lessonId=${encodeURIComponent(lessonId)}`) as ExamStatusView
  }

  async examPrepare(lessonId: string): Promise<void> {
    await fetchJson('/lookatstudy/api/exam/prepare', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lessonId }),
    })
    this.refresh()
  }

  async examStart(lessonId: string): Promise<{ attemptId: string; questions: ExamQuestionView[] }> {
    const r = await fetchJson('/lookatstudy/api/exam/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lessonId }),
    }) as { attemptId: string; questions: ExamQuestionView[] }
    this.refresh()
    return r
  }

  async examRecord(lessonId: string, attemptId: string, questionId: string, answer: string): Promise<void> {
    await fetchJson('/lookatstudy/api/exam/record', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lessonId, attemptId, questionId, answer }),
    })
  }

  async examSubmit(lessonId: string, attemptId: string, terminated: boolean): Promise<ExamSubmitResult> {
    const r = await fetchJson('/lookatstudy/api/exam/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lessonId, attemptId, terminated }),
    }) as ExamSubmitResult
    this.refresh()
    return r
  }

  async examRegenerate(lessonId: string): Promise<void> {
    await fetchJson('/lookatstudy/api/exam/regenerate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lessonId }),
    })
    this.refresh()
  }

  /** Synthesize one speakable chunk to MP3 (host-side Edge TTS, cache-first). */
  async tts(text: string, voice?: string): Promise<ArrayBuffer> {
    const body = await fetchJson('/lookatstudy/api/tts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, voice }),
    }) as { ok?: boolean; dataBase64?: string }
    const raw = body.dataBase64
    if (body.ok !== true || typeof raw !== 'string') throw new Error('tts response missing audio payload')
    // atob → Uint8Array (binary string decode), Blob-ready for <audio>.
    const bin = atob(raw)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return bytes.buffer
  }
}

/** The voices the dashboard route accepts (same allowlist server-side). */
export const TTS_VOICES: ReadonlyArray<{ id: string; labelKey: string }> = [
  { id: 'zh-CN-XiaoxiaoNeural', labelKey: 'voice.xiaoxiao' },
  { id: 'zh-CN-YunxiNeural', labelKey: 'voice.yunxi' },
  { id: 'zh-CN-YunyangNeural', labelKey: 'voice.yunyang' },
  { id: 'zh-CN-XiaoyiNeural', labelKey: 'voice.xiaoyi' },
  { id: 'en-US-AriaNeural', labelKey: 'voice.aria' },
  { id: 'en-US-GuyNeural', labelKey: 'voice.guy' },
]

const TTS_VOICE_KEY = 'dsh-plugin-lookatstudy:tts-voice'

/** Narrow a stored voice id to the allowlist; anything else falls back to 晓晓. Pure. */
export function normalizeStoredVoice(raw: string | null | undefined): string {
  return TTS_VOICES.some(v => v.id === raw) ? raw! : TTS_VOICES[0]!.id
}

/** The selected read-aloud voice (browser-local preference; host state untouched). */
export function storedTtsVoice(): string {
  try {
    return normalizeStoredVoice(typeof localStorage === 'undefined' ? null : localStorage.getItem(TTS_VOICE_KEY))
  } catch {
    return TTS_VOICES[0]!.id
  }
}

export function storeTtsVoice(id: string): void {
  try {
    localStorage.setItem(TTS_VOICE_KEY, normalizeStoredVoice(id))
  } catch {
    // Privacy modes forbid storage writes; the picker still reflects this page's choice.
  }
}

/** The one shared store instance backing every study seat component. */
export const studyStore = new StudyStore()

/** React binding: live snapshot plus the write actions. */
export function useStudy(): {
  data: StudyState | null
  activate: (active: boolean) => Promise<void>
  setMode: (mode: StudyState['mode']) => Promise<void>
  setHistoryBudget: (on: boolean) => Promise<void>
  uploadAttachment: (name: string, dataBase64: string) => Promise<string>
  setFocus: (lessonId: string) => Promise<void>
  searchLessons: (query: string) => Promise<Array<{ lessonId: string; lessonTitle: string; snippet: string }>>
  deleteCourse: (courseId: string) => Promise<void>
  deleteNote: (lessonId: string, noteId: string) => Promise<void>
  editNote: (lessonId: string, noteId: string, text: string) => Promise<void>
  pinNote: (lessonId: string, noteId: string, pinned: boolean) => Promise<void>
  examStatus: (lessonId: string) => Promise<ExamStatusView>
  examPrepare: (lessonId: string) => Promise<void>
  examStart: (lessonId: string) => Promise<{ attemptId: string; questions: readonly ExamQuestionView[] }>
  examRecord: (lessonId: string, attemptId: string, questionId: string, answer: string) => Promise<void>
  examSubmit: (lessonId: string, attemptId: string, terminated: boolean) => Promise<ExamSubmitResult>
  examRegenerate: (lessonId: string) => Promise<void>
  addUserNote: (lessonId: string, quote: string) => Promise<void>
  recordReview: (lessonId: string, quality: 1 | 4 | 5) => Promise<void>
  bindLessonSession: (lessonId: string, sessionId: string) => Promise<void>
} {
  const data = useSyncExternalStore(studyStore.subscribe, studyStore.getSnapshot, studyStore.getSnapshot)
  return {
    data,
    activate: studyStore.activate.bind(studyStore),
    setMode: studyStore.setMode.bind(studyStore),
    setHistoryBudget: studyStore.setHistoryBudget.bind(studyStore),
    uploadAttachment: studyStore.uploadAttachment.bind(studyStore),
    setFocus: studyStore.setFocus.bind(studyStore),
    searchLessons: studyStore.searchLessons.bind(studyStore),
    deleteCourse: studyStore.deleteCourse.bind(studyStore),
    deleteNote: studyStore.deleteNote.bind(studyStore),
    editNote: studyStore.editNote.bind(studyStore),
    pinNote: studyStore.pinNote.bind(studyStore),
    examStatus: studyStore.examStatus.bind(studyStore),
    examPrepare: studyStore.examPrepare.bind(studyStore),
    examStart: studyStore.examStart.bind(studyStore),
    examRecord: studyStore.examRecord.bind(studyStore),
    examSubmit: studyStore.examSubmit.bind(studyStore),
    examRegenerate: studyStore.examRegenerate.bind(studyStore),
    addUserNote: studyStore.addUserNote.bind(studyStore),
    recordReview: studyStore.recordReview.bind(studyStore),
    bindLessonSession: studyStore.bindLessonSession.bind(studyStore),
  }
}

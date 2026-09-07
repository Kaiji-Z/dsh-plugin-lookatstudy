/**
 * The study panel — the sidebar-entry surface that takes over the center
 * column, arranged like upstream LookatStudy's app (App.tsx): 左 course rail
 * (tree/import/review) | 中 the tutor chat stream with its OWN composer (the
 * host composer is never involved) | 右 the notebook (讲解/概念图/笔记).
 *
 * Interaction model aligned with upstream: opening a lesson only FOCUSES it
 * (state-side attempt: in_progress + BKT seed + unlocks — zero LLM); the
 * tutor engages when the learner sends a message or taps a starter, which
 * lazily mints and stages the lesson's thread and prompts through the host's
 * session face. The host is exactly the conversation-model + agent-turn
 * engine; the thread's event window streams the reply back into the chat.
 * @module dsh-plugin-lookatstudy/client/panel
 */

import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode, TouchEvent as ReactTouchEvent } from 'react'
import {
  IconBoltFill16, IconBookFill16, IconCrownFill16, IconDownloadOutline16, IconFlameFill16, IconArrowUpFill16, IconCloseFill16, IconPinFill16,
  IconGoalOutline16, IconGlobeOutline14, IconLoadingOutline16, IconLockFill16,
  IconMaximizeOutline16, IconRefreshOutline16, IconStarFill16, IconTrashOutline16, IconWarningOutline16, IconWrenchOutline16,
  IconPlusOutline16, IconLinkOutline16, IconDocOutline16, IconFolderOutline16, IconBoxOutline16, IconSoundOutline16 } from './icons.tsx'
import type { ClientContext, SessionPromptFace } from './faces.ts'
import { useStudy, storedTtsVoice } from './data.ts'
import { renderMarkdown } from '../markdown.ts'
import { enhanceRendered, setEnhanceDeps } from './enhance.ts'
import { renderLessonConceptMap } from './diagrams.ts'
import { speechSentencesOf } from '../vendor/speech-text.ts'
import { speakMathInSentence } from '../vendor/math-speech.ts'
import { feedRows, feedLastSeq, feedTurnActive, hydrateArtifactRows, sedimentBacklog, importProgressOf } from './session-feed.ts'
import { ErrorBoundary, ContentBoundary } from './error-boundary.tsx'
import { wireCodeBlockCopy } from './codeblock.ts'
import { panelTheme, subscribePanelTheme } from './theme.ts'
import { ReadAloudController, type ReadAloudStatus, type SpeechEngine } from './readaloud.ts'
import { toastStore, type ToastItem, type ToastSeverity } from './toast.ts'
import { QuizCard, type QuizData } from './quizcard.tsx'
import { ArtifactCard, markArtifactsSeen, unseenArtifacts, type ArtifactRow } from './artifact-cards.tsx'
import { showStudyToast } from './toast.ts'
import { Companion, useCompanionMood } from './companion.tsx'
import { applyHighlights, getTextModel, locateInModel, planSegments } from './highlights.ts'
import { statusTitle, quizOptions, sectionDefaultOpen, mergeRailSearch, effectiveOpen, pickNarrowPane, isStuck, swipePane, settleMs, pickRandomDue, friendlyError } from './views.tsx'
import { ListSectionView, sectionWorldOf } from './maprail.tsx'
import { GlobalTooltip } from './tooltip.tsx'
import { ConfirmCard } from './confirmcard.tsx'
import { ExamView, type ExamSession } from './examview.tsx'
import { CelebrationLayer } from './celebration-layer.tsx'
import { CanvasStage } from './canvasstage.tsx'
import { celebrate, celebrationDiff, type CelebrationSnapshot } from './celebration.ts'
import { tr } from './locale.ts'

/** The three souls in pill order (same shape as the study tab's pills). */
const MODES: ReadonlyArray<{ id: 'direct' | 'guide' | 'practice'; labelKey: string; hintKey: string }> = [
  { id: 'direct', labelKey: 'soul.direct', hintKey: 'soul.direct.hint' },
  { id: 'guide', labelKey: 'soul.guide', hintKey: 'soul.guide.hint' },
  { id: 'practice', labelKey: 'soul.practice', hintKey: 'soul.practice.hint' },
]

const ZONES: ReadonlyArray<readonly [string, string]> = [
  ['understand', 'zone.understand'],
  ['record', 'zone.record'],
  ['practice', 'zone.practice'],
]

/** Toast severity glyph (P6): the state color rides the icon, text stays ink. */
function toastIcon(severity: ToastSeverity): ReactNode {
  if (severity === 'success') return createElement(IconStarFill16, { size: 14, className: 'lks-toast-glyph ok' })
  if (severity === 'warning') return createElement(IconWarningOutline16, { size: 14, className: 'lks-toast-glyph warn' })
  if (severity === 'error') return createElement(IconWarningOutline16, { size: 14, className: 'lks-toast-glyph err' })
  if (severity === 'info') return createElement(IconGlobeOutline14, { size: 13, className: 'lks-toast-glyph info' })
  return null
}

/** C6: locate a note's quote in the prose — wrap, flash, scroll into view. */
function locateNoteQuote(quote: string, prose: HTMLElement | null): void {
  if (prose === null || quote.trim() === '') return
  const model = getTextModel(prose, { includeMarks: true })
  const hit = locateInModel(model, quote, undefined)
  if (hit === null) return
  prose.querySelectorAll('mark.lks-flash').forEach(m => { m.replaceWith(...m.childNodes) })
  for (const seg of planSegments(model.nodes, hit.start, hit.end)) {
    const entry = model.nodes[seg.index]!
    const mid = seg.localStart > 0 ? entry.node.splitText(seg.localStart) : entry.node
    const localEnd = seg.localEnd - seg.localStart
    if (mid.textContent !== null && mid.textContent.length > localEnd) mid.splitText(localEnd)
    const mark = document.createElement('mark')
    mark.className = 'lks-flash'
    mid.parentElement?.insertBefore(mark, mid)
    mark.appendChild(mid)
    mark.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
}

/** C8: the most recent decided proposal's badge payload (render order preserved). */
function decidedBadgeOf(decided: Record<string, { kind: 'accepted' | 'declined'; title: string }>): { kind: 'accepted' | 'declined'; title: string } | null {
  const entries = Object.values(decided)
  return entries.length > 0 ? entries[entries.length - 1]! : null
}

function examOpen(lessons: ReadonlyArray<{ kind: string; masteryPct: number | null }>): boolean {
  return lessons.every(l => l.kind !== 'study' || (l.masteryPct ?? 0) >= 50)
}

function titleMatches(title: string, query: string): boolean {
  const keys = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return keys.every(k => title.toLowerCase().includes(k))
}

export type PanelSend = (text: string) => void

/**
 * Whether the host session list actually knows a bound thread id. A restart
 * can drop young sessions from persistence; an empty byId means the list has
 * not hydrated yet (assume known — the send's own open surfaces a real error).
 * Pure over the injected list snapshot.
 */
export function sessionKnown(ctx: ClientContext, id: string): boolean {
  const byId = (ctx.sessions.list?.getSnapshot() as { byId?: Readonly<Record<string, unknown>> } | undefined)?.byId
  if (byId === undefined) return true
  return Object.keys(byId).length === 0 ? true : id in byId
}

function textOf(blocks: readonly { type?: string; text?: string }[] | undefined): string {
  return (blocks ?? []).filter(b => (b.type ?? 'text') === 'text').map(b => b.text ?? '').join('\n\n').trim()
}

/** One rendered chat row (shared shape with the read-aloud era's renderer). */
/** One assistant row's audio controls (C11): speak/stop + n/total + karaoke. */
interface RowAudio {
  playing: boolean
  index: number
  total: number
  onPlay: (key: string) => void
  onStop: () => void
}

function chatRow(row: { key: string; role: string; text: string; toolState?: 'loading' | 'done' | 'error' }, interactive?: { send: PanelSend }, audio?: RowAudio): ReactNode {
  if (row.role === 'user') {
    return createElement('div', { key: row.key, className: 'lks14-msg lks14-msg-user' }, row.text)
  }
  if (row.role === 'reasoning') {
    // C14: the collapsible reasoning block (upstream ReasoningBlock).
    return createElement('details', { key: row.key, className: 'lks14-reasoning' },
      createElement('summary', null, tr('chat.reasoning', { n: String(row.text.length) })), row.text)
  }
  if (row.role === 'tool') {
    // C14: the three-state chip (loading dots / done check / error cross).
    return createElement('div', { key: row.key, className: 'lks14-toolchip' + ' ' + String(row.toolState ?? 'loading') },
      row.toolState === 'done' ? '✓' : row.toolState === 'error' ? '×' : createElement('i', null),
      createElement('span', null, row.text))
  }
  const cls = row.role === 'streaming' ? 'lks14-msg lks14-msg-assistant streaming' : 'lks14-msg lks14-msg-assistant'
  // D8: every markdown surface renders through a boundary — a poisoned row
  // degrades to the inline warning + retry, never unmounts the pane.
  const body = createElement(ErrorBoundary, { key: `b-${row.key}` },
    createElement('div', {
      className: cls,
      'data-row-key': row.key,
      dangerouslySetInnerHTML: { __html: renderMarkdown(row.text) },
    }))
  if (audio !== undefined && row.role === 'assistant') {
    return createElement('div', { key: row.key, className: 'lks14-msgwrap' },
      body,
      createElement('div', { className: 'lks14-msgaudio' },
        createElement('button', {
          className: 'lks-btn ghost lks-audio-toggle',
          style: { padding: '2px 8px', fontSize: '11.5px', flex: 'none' },
          title: audio.playing ? tr('read.stop') : tr('msg.speak'),
          'aria-label': audio.playing ? tr('read.stop') : tr('msg.speak'),
          onClick: () => { if (audio.playing) audio.onStop(); else audio.onPlay(row.key) },
        },
          createElement(IconSoundOutline16, { size: 13 }),
          createElement('span', { className: 'lks-audio-label' }, audio.playing ? tr('read.stop') : tr('msg.speak'))),
        audio.playing ? createElement('span', { className: 'lks14-msgaudio-n' }, String(audio.index + 1) + '/' + String(audio.total)) : null))
  }
  const options = interactive === undefined || row.role === 'streaming' ? [] : quizOptions(row.text)
  if (options.length < 2) return body
  return createElement('div', { key: row.key, className: 'lks14-turn' },
    body,
    createElement('div', { className: 'lks14-quiz', 'data-tooltip': tr('quiz.title') },
      ...options.map(opt => createElement('button', {
        key: opt.letter,
        className: 'lks14-opt',
        onClick: () => { interactive.send(tr('quiz.answer', { letter: opt.letter, text: opt.text })) },
      },
        createElement('span', { className: 'lks14-optletter' }, opt.letter),
        createElement('span', null, opt.text))),
    ))
}

/** Build the panel component bound to the client services. */
export function studyPanelView(ctx: ClientContext): () => ReactNode {
  return function StudyPanel(): ReactNode {
    return createElement(StudyPanelBody, { ctx, key: 'panel' })
  }
}

type StudyData = ReturnType<typeof useStudy>['data']

function StudyPanelBody({ ctx }: { ctx: ClientContext }): ReactNode {
  const { data, activate, setMode, setFocus, searchLessons, deleteCourse, deleteNote, bindLessonSession, uploadAttachment } = useStudy()
  // D8: the shared CodeBlock's delegated copy wire — one listener for every
  // zone the markdown pipeline feeds (chat, prose, notes).
  useEffect(() => { wireCodeBlockCopy() }, [])
  // P16: the skin follows the host theme store (wirePanelTheme drives it).
  const [theme, setTheme] = useState(panelTheme)
  // sync-on-mount: if the theme transitioned between this component's state
  // initialization and its subscription, the live value pulls it back.
  useEffect(() => {
    const sync = (): void => { setTheme(panelTheme()) }
    sync()
    return subscribePanelTheme(sync)
  }, [])
  // E7: the panel font scale — three tiers persisted locally (zoom scales the
  // px-fixed panel layout in Chromium without rewriting every font rule).
  const [zoomTier, setZoomTier] = useState<number>(() => {
    const raw = localStorage.getItem('dsh-plugin-lookatstudy:zoom')
    const n = raw === null ? NaN : Number(raw)
    return Number.isFinite(n) ? Math.min(1.1, Math.max(0.9, n)) : 1
  })
  const setZoom = (next: number): void => {
    const clamped = Math.min(1.1, Math.max(0.9, Math.round(next * 10) / 10))
    setZoomTier(clamped)
    try { localStorage.setItem('dsh-plugin-lookatstudy:zoom', String(clamped)) } catch { /* storage denied — session-only */ }
  }
  // E4: the command palette bus — CourseRail registers its map/review/course
  // actions here so the palette (mounted at the panel root) can drive them.
  const paletteBus = useRef<{ courseSelect?: (id: string) => void; reviewOpen?: () => void }>({})
  const [paletteOpen, setPaletteOpen] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k'
        && document.documentElement.hasAttribute('data-dsh-lookatstudy-active')) {
        e.preventDefault()
        setPaletteOpen(o => !o)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [])
  const [sendError, setSendError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // C2: the host prompt resolves at queue time, so the real generation signal
  // is the event window's turn lifecycle (turn/start..turn/end).
  const [feedGen, setFeedGen] = useState(false)
  const lastSeqRef = useRef(0)
  const stopWatermarkRef = useRef<number | null>(null)
  // P12 exam leave guard: ExamView reports its session here; every focus
  // navigation routes through guardedSetFocus while answering is active.
  const examSessionRef = useRef<ExamSession>({ active: false, terminate: null })
  const [examLeave, setExamLeave] = useState<{ pending: (() => void) | null } | null>(null)
  // returns Promise<void> to honor CourseRail's prop contract — the rail's
  // search/review rows call .catch on the result, and a void return made every
  // jump throw `undefined .catch` after the navigation side effect fired.
  const guardedSetFocus = useCallback((id: string): Promise<void> => {
    if (examSessionRef.current.active) {
      setExamLeave({ pending: () => { void setFocus(id) } })
      return Promise.resolve()
    }
    return setFocus(id)
  }, [setFocus])
  const onExamSession = useCallback((session: ExamSession): void => { examSessionRef.current = session }, [])
  const [rows, setRows] = useState<ReturnType<typeof feedRows>>([])
  // E1: the bound session's context pressure (projection face; the meter memo
  // below reads it — declared here, above its consumer, the TDZ trap again).
  const [pressure, setPressure] = useState<{ projectedTokens?: number; contextWindow?: number } | null>(null)
  // D7: the import tool chips folded for the rail's import watchers/progress.
  const importProgress = useMemo(() => importProgressOf(rows), [rows])
  // E1: the context meter value — the projection when the host reports it,
  // otherwise the labeled char estimate over the folded rows.
  const contextMeter = useMemo<{ pct: number | null; label: string; estimated: boolean }>(() => {
    if (pressure !== null && pressure.contextWindow !== undefined && pressure.contextWindow > 0 && pressure.projectedTokens !== undefined) {
      const pct = Math.min(100, Math.round((pressure.projectedTokens / pressure.contextWindow) * 100))
      return { pct, label: `${String(pressure.projectedTokens)}/${String(pressure.contextWindow)}`, estimated: false }
    }
    const chars = rows.reduce((n, r) => n + r.text.length, 0)
    return { pct: null, label: tr('meter.estimate', { n: String(Math.round(chars / 2.2)) }), estimated: true }
  }, [pressure, rows])
  const [feedAttached, setFeedAttached] = useState(false)
  const [draft, setDraft] = useState('')
  const [narrowPane, setNarrowPane] = useState<'rail' | 'chat' | 'note'>(pickNarrowPane(null))
  const lesson = data?.lesson ?? null
  const localBound = useRef<string | null>(null)
  const streamEl = useRef<HTMLDivElement | null>(null)
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  // C2: the live session face (kept by send) so the stop button can cancel the
  // running host turn; a fresh load has nothing to stop.
  const activeFace = useRef<SessionPromptFace | null>(null)
  const stop = (): void => {
    void (async () => {
      try {
        // C2: the face ref only exists after THIS panel sent; a page opened
        // mid-generation must resolve the bound session's face on demand.
        let face: SessionPromptFace | null | undefined = activeFace.current
        if (face === null) {
          const sessionId = localBound.current ?? (lesson !== null ? data?.lessonSessions[lesson.lessonId] ?? null : null)
          if (sessionId !== null && sessionKnown(ctx, sessionId)) {
            const actx = ctx.sessions.scope(sessionId)
            face = actx === undefined ? undefined : ctx.sessions.sessionOf(actx) ?? null
          }
        }
        await face?.cancel?.()
      } catch { /* already settled */ }
      // the host's cancel never journals turn/end (live 2026-09-06 catch) —
      // watermark the current seq so the wedge-open turn stops reading busy;
      // a fresh turn/start past the watermark re-arms naturally.
      stopWatermarkRef.current = lastSeqRef.current
      setFeedGen(false)
    })().finally(() => { setBusy(false) })
  }

  // P13: the celebration poll-diff — unlock/mastery/streak/energy-full ride the
  // state-feed transitions (the plugin's equivalent of upstream's
  // state:changed IPC). The DIFF is pure (celebrationDiff); this side only
  // anchors unlocks at their on-screen bubbles.
  const prevCelebrationRef = useRef<CelebrationSnapshot | null>(null)
  useEffect(() => {
    if (data === null) return
    const snapshot: CelebrationSnapshot = {
      lessons: data.courses.flatMap(c => c.sections.flatMap(s => s.lessons.map(l => ({ id: l.id, status: l.status })))),
      streak: data.progress?.streak ?? 0,
      todayXp: data.progress?.todayXp ?? 0,
      dailyGoal: data.progress?.dailyGoal ?? 0,
    }
    for (const ev of celebrationDiff(prevCelebrationRef.current, snapshot)) {
      if (ev.kind === 'unlock' && ev.lessonId !== undefined) {
        const el = document.querySelector(`[data-node-id="${CSS.escape(ev.lessonId)}"]`)
        const r = el !== null ? el.getBoundingClientRect() : null
        celebrate('unlock', r !== null && r.width > 0 ? { origin: { x: r.left + r.width / 2, y: r.top + 4 } } : undefined)
      } else {
        celebrate(ev.kind)
      }
    }
    prevCelebrationRef.current = snapshot
  }, [data])

  const boundId = localBound.current ?? (lesson !== null ? data?.lessonSessions[lesson.lessonId] ?? null : null)

  // The review nudge (upstream review.nudge): due reviews pull the learner
  // back — one toast per panel open, never repeated while it stays open.
  const nudged = useRef(false)
  useEffect(() => {
    if (nudged.current || (data?.dueCount ?? 0) === 0) return
    nudged.current = true
    showStudyToast(tr('review.nudge', { n: data!.dueCount }), { severity: 'warning', action: { label: tr('review.nudge.go'), onClick: () => {
      const first = data?.due[0]
      if (first !== undefined) guardedSetFocus(first.lessonId)
    } } })
  }, [data?.dueCount, data?.due, setFocus])

  // E1: the context meter source — the bound session's contextPressure
  // projection (getSnapshot/subscribe off the session face). When the
  // projection or the window size is absent, the meter falls back to the
  // labeled char estimate.
  useEffect(() => {
    setPressure(null)
    if (boundId === null) return
    let disposed = false
    let off: (() => void) | undefined
    try {
      const actx = ctx.sessions.scope(boundId)
      const face = actx === undefined ? undefined : (ctx.sessions as { sessionOf(a: unknown): { projections?: { faceOf(key: string): { getSnapshot(): unknown; subscribe(l: () => void): () => void } } | undefined } | undefined }).sessionOf(actx)
      const proj = face?.projections?.faceOf('contextPressure')
      if (proj !== undefined) {
        const read = (): void => {
          const snap = proj.getSnapshot() as { projectedTokens?: number; contextWindow?: number } | undefined
          if (!disposed && snap !== undefined && typeof snap === 'object') setPressure({ projectedTokens: snap.projectedTokens, contextWindow: snap.contextWindow })
        }
        read()
        off = proj.subscribe(read)
        return () => { disposed = true; off?.() }
      }
    } catch { /* projections absent — the estimate path covers it */ }
    return () => { disposed = true; off?.() }
  }, [boundId, ctx.sessions])
  // E6: the model/effort switcher state — catalog + current selection off the
  // bound session (modelSelection projection); switching rides the host's
  // selectModel remote. Feature-degrades to a read-only chip when absent.
  const [modelFace, setModelFace] = useState<{ provider: string; model: string; reasoningEffort?: string } | null>(null)
  useEffect(() => {
    setModelFace(null)
    if (boundId === null) return
    let disposed = false
    let off: (() => void) | undefined
    try {
      const actx = ctx.sessions.scope(boundId)
      const face = actx === undefined ? undefined : (ctx.sessions as { sessionOf(a: unknown): { projections?: { faceOf(key: string): { getSnapshot(): unknown; subscribe(l: () => void): () => void } } | undefined } | undefined }).sessionOf(actx)
      const proj = face?.projections?.faceOf('modelSelection')
      if (proj !== undefined) {
        const read = (): void => {
          const snap = proj.getSnapshot() as { next?: { provider: string; model: string; reasoningEffort?: string } | null } | undefined
          if (!disposed && snap !== undefined && typeof snap === 'object' && snap.next !== undefined && snap.next !== null) setModelFace(snap.next)
        }
        read()
        off = proj.subscribe(read)
        return () => { disposed = true; off?.() }
      }
    } catch { /* modelSelection absent — read-only mode */ }
    return () => { disposed = true; off?.() }
  }, [boundId, ctx.sessions])

  // The tutor chat stream: subscribe to the bound lesson thread's event window.
  // The host only opens a window for the STAGED (current) session, so when the
  // binding is absent (fresh page load / panel reopen), stage the thread first
  // — an internal navigation, suppressed so it never hands the column back —
  // and attach when the session list's current flips onto it. A binding the
  // host no longer knows (dropped by a restart) renders an empty stream; the
  // next send re-mints and re-binds. Nothing in here may throw into React.
  useEffect(() => {
    if (boundId === null) {
      setRows([])
      setFeedGen(false)
      setFeedAttached(false)
      return
    }
    setFeedAttached(false)
    let disposed = false
    let offSource: (() => void) | undefined
    let offList: (() => void) | undefined
    const attach = (): boolean => {
      const binding = (ctx.sessions as { binding(id: string): { eventSource?: { getSnapshot(): unknown; subscribe(l: () => void): () => void } } | undefined }).binding(boundId)
      const source = binding?.eventSource
      if (source === undefined) return false
      const update = (): void => {
        const snap = source.getSnapshot() as never
        setRows(feedRows(snap))
        lastSeqRef.current = feedLastSeq(snap)
        setFeedGen(feedTurnActive(snap, stopWatermarkRef.current))
      }
      update()
      setFeedAttached(true)
      offSource = source.subscribe(update)
      return true
    }
    const stage = (): void => {
      if (!sessionKnown(ctx, boundId)) return
      try {
        const shell = PANEL_SHELL.current
        if (shell !== null) shell.suppressHandBack(() => { ctx.sessions.open(boundId) })
        else ctx.sessions.open(boundId)
      } catch { /* staging raced a shutdown; the next send re-mints */ }
    }
    // binding() is PURE resolution — it can succeed while the session is
    // still off-stage, leaving the window unopened and the stream empty
    // (live 0.14.0 catch: 'attached-empty' forever). The window opens ⟺ the
    // session is the list's CURRENT, so reconcile stage-first, then attach.
    const reconcile = (): boolean => {
      if (disposed || offSource !== undefined) return true
      const current = ctx.sessions.list?.getSnapshot().current
      if (current !== boundId) {
        stage()
        return false
      }
      return attach()
    }
    if (!reconcile()) {
      // Staging and the history pull are async, and a thread that already IS
      // current fires no list notification at all — retry briefly instead of
      // waiting for an event that may never come; the list subscription
      // covers later flips (staging completes, current moves elsewhere…).
      let tries = 0
      const timer = setInterval(() => {
        if (disposed || offSource !== undefined || reconcile() || ++tries >= 40) clearInterval(timer)
      }, 150)
      const list = ctx.sessions.list
      if (list !== undefined) {
        offList = list.subscribe(() => {
          if (disposed || reconcile()) {
            offList?.()
            offList = undefined
          }
        })
      }
      return () => {
        disposed = true
        clearInterval(timer)
        offSource?.()
        offList?.()
      }
    }
    return () => {
      disposed = true
      offSource?.()
      offList?.()
    }
  }, [boundId, ctx])

  // Keep the stream pinned to the latest row.
  useEffect(() => {
    const el = streamEl.current
    if (el !== null) el.scrollTop = el.scrollHeight
  }, [rows])

  /** The one send path: lazily stage the lesson thread, then prompt. */
  const send = (text: string): void => {
    void (async () => {
      if (busy || lesson === null || text.trim() === '') return
      setBusy(true)
      setSendError(null)
      stopWatermarkRef.current = null
      try {
        if (data?.active !== true) await activate(true)
        let sessionId = localBound.current ?? data?.lessonSessions[lesson.lessonId] ?? null
        if (sessionId !== null && !sessionKnown(ctx, sessionId)) sessionId = null
        if (sessionId === null) {
          const area = await fetch('/lookatstudy/api/study-workspace')
          if (!area.ok) throw new Error(`study area unavailable (HTTP ${String(area.status)})`)
          const { path } = await area.json() as { path: string }
          const workspace = await ctx.workspaces.create({ path })
          sessionId = await ctx.sessions.create({ workspaceId: workspace.workspaceId })
          localBound.current = sessionId
          await bindLessonSession(lesson.lessonId, sessionId)
        }
        // Stage the thread (its event window only opens while current); the
        // internal navigation must not hand the panel back.
        const shell = PANEL_SHELL.current
        if (shell !== null) {
          shell.suppressHandBack(() => { ctx.sessions.open(sessionId!) })
        } else {
          ctx.sessions.open(sessionId)
        }
        const actx = ctx.sessions.scope(sessionId)
        const face: SessionPromptFace | undefined = actx === undefined ? undefined : ctx.sessions.sessionOf(actx)
        if (face === undefined) throw new Error('lesson session is not addressable yet')
        activeFace.current = face
        const result = await face.prompt([{ type: 'text', text }], 'queue')
        if (!result.ok) throw new Error(`prompt rejected: ${result.error.code}: ${result.error.message}`) // raw stays console-only (friendlyError maps the DOM text)
        setDraft('')
      } catch (err) {
        setSendError(friendlyError(err, 'send'))
      } finally {
        setBusy(false)
      }
    })()
  }

  // P12 exam-v2: ExamView decouples itself from this panel's send() — when a
  // bank is wanted it fires the DOM event and THIS side speaks to the tutor.
  // (Must live after send's declaration: the deps array reads it at render.)
  useEffect(() => {
    const onGenerate = (e: Event): void => {
      const detail = (e as CustomEvent<{ lessonId: string; sectionTitle: string }>).detail
      if (detail === undefined || typeof detail.sectionTitle !== 'string') return
      send(tr('prompt.exam.bank', { section: detail.sectionTitle }))
    }
    window.addEventListener('lookatstudy-exam-generate', onGenerate)
    return () => { window.removeEventListener('lookatstudy-exam-generate', onGenerate) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [send])

  const companion = useCompanionMood()
  const setCompanionEvent = companion.emit
  const progress = data?.progress ?? null
  // The upstream v0.6 ladder: rail full-height on surface-rail; the right half
  // = floating app-header + the chat/notebook row (chat surface-1, notebook
  // surface-2) — depth by color step, no borders.
  const body: ReactNode = createElement('div', {
    className: 'lks14-body',
    'data-pane': narrowPane,
    // C12: horizontal flick switches the narrow pane (upstream T3 swipe).
    onTouchStart: (e: ReactTouchEvent<HTMLDivElement>) => {
      const t = e.touches[0]
      touchStart.current = t === undefined ? null : { x: t.clientX, y: t.clientY }
    },
    onTouchEnd: (e: ReactTouchEvent<HTMLDivElement>) => {
      const s = touchStart.current
      touchStart.current = null
      const t = e.changedTouches[0]
      if (s === null || t === undefined) return
      const next = swipePane(narrowPane, t.clientX - s.x, t.clientY - s.y)
      if (next !== null) setNarrowPane(next)
    },
  },
    createElement(CourseRail, { data, activate, setFocus: guardedSetFocus, searchLessons, deleteCourse, send,
      // C7: a bubble jump on narrow layout lands the learner on the chat pane.
      onJumped: () => { setNarrowPane('chat') },
      // C13: tapping map blank space pokes the companion (whistle essence).
      onBlankTap: () => { setCompanionEvent('poke') },
      // D6: the bound thread's turn is live → its ball spins on the map.
      streamingLessonId: feedGen && lesson !== null ? lesson.lessonId : null,
      // D7: the import watchers ride the turn state + the import tool chips.
      turnActive: feedGen,
      importProgress,
      stop,
      // E4: the command palette's rail-side actions register here.
      paletteBus }),
    createElement('div', { className: 'lks14-righthalf' },
      createElement('div', { className: 'lks14-appheader' },
        createElement('span', { className: 'lks-hdr-title' }, lesson?.courseTitle ?? tr('tab.label')),
        createElement('span', { className: 'lks-hdr-xp', 'data-tooltip': tr('header.xp', { xp: progress?.totalXp ?? 0 }) },
          createElement('span', { className: 'lks-hdr-stat lks-hdr-glyph' }, createElement(IconBoltFill16, { size: 14 })),
          createElement('span', { className: 'lks-hdr-xpbar' }, createElement('i', { style: { transform: `scaleX(${String(Math.min(100, progress?.levelPct ?? 0) / 100)})` } }))),
        createElement('span', { className: 'lks-hdr-stat lks-hdr-streak', 'data-tooltip': tr('header.streak') },
          createElement('span', { className: 'lks-hdr-glyph' }, createElement(IconFlameFill16, { size: 14 })),
          String(progress?.streak ?? 0)),
        createElement('span', { className: 'lks-hdr-stat', 'data-tooltip': tr('header.level') }, `Lv${String(progress?.level ?? 1)}`),
        // E6: the model/effort face — chip shows the bound thread's model;
        // click opens the catalog picker (host selectModel under the hood).
        createElement(ModelFaceChip, {
          sessionId: boundId,
          current: modelFace,
          selectModel: (ctx as { remote?: { session?: { selectModel?: (req: Record<string, unknown>) => Promise<unknown>; modelCatalog?: () => Promise<unknown> } } }).remote?.session,
        }),
        // E7: the font scale pair — three tiers (0.9 / 1 / 1.1), persisted.
        createElement('span', { className: 'lks-hdr-zoom' },
          createElement('button', {
            className: 'lks-hdr-zoom-btn', 'aria-label': tr('zoom.out'),
            'data-tooltip': tr('zoom.out'),
            disabled: zoomTier <= 0.9,
            onClick: () => { setZoom(zoomTier - 0.1) },
          }, 'A−'),
          createElement('span', { className: 'lks-hdr-zoom-val' }, `${String(Math.round(zoomTier * 100))}%`),
          createElement('button', {
            className: 'lks-hdr-zoom-btn', 'aria-label': tr('zoom.in'),
            'data-tooltip': tr('zoom.in'),
            disabled: zoomTier >= 1.1,
            onClick: () => { setZoom(zoomTier + 0.1) },
          }, 'A+')),
      ),
      createElement('div', { className: 'lks14-row' },
        createElement(ChatPane, { data, lesson, rows, feedAttached, bound: boundId !== null, busy: busy || feedGen, sendError, draft, setDraft, send, stop, setMode, narrowPane, companionEvent: setCompanionEvent, onThreadJump: (id: string) => { setNarrowPane('chat'); void guardedSetFocus(id) }, contextMeter, uploadAttachment }),
        createElement(NotebookPane, { data, deleteNote, send, companionEvent: setCompanionEvent, onExamSession, examPaused: examLeave !== null }),
      ),
    ),
  )
  return createElement('div', { className: 'lks14 lks-ui', 'data-lks-panel': '', 'data-lks-theme': theme, style: { zoom: String(zoomTier) } },
    createElement(GlobalTooltip),
    paletteOpen
      ? createElement(CommandPalette, {
        searchLessons,
        courses: data?.courses.map(c => ({ id: c.courseId, title: c.title })) ?? [],
        onClose: () => { setPaletteOpen(false) },
        onLesson: (id: string) => { setPaletteOpen(false); setNarrowPane('chat'); void guardedSetFocus(id) },
        onCourse: (id: string) => { setPaletteOpen(false); paletteBus.current.courseSelect?.(id) },
        onReview: () => { setPaletteOpen(false); paletteBus.current.reviewOpen?.() },
        onStudy: () => { setPaletteOpen(false); setNarrowPane('chat'); void send(tr('prompt.start')) },
      })
      : null,
    createElement(Companion, { mood: companion.mood, onPoke: () => {
      setCompanionEvent('poke')
      showStudyToast(tr('companion.poked'), { severity: 'success' })
    } }),
    createElement('div', { className: 'lks14-switch' },
      ...(['rail', 'chat', 'note'] as const).map(pane => createElement('button', {
        key: pane,
        className: `lks14-switch-btn${narrowPane === pane ? ' on' : ''}`,
        'aria-pressed': String(narrowPane === pane),
        onClick: () => { setNarrowPane(pane) },
      }, tr(`pane.${pane}`))),
    ),
    createElement(CelebrationLayer),
    body,
    // P12 leave guard: upstream's examLeave modal — focus lands on confirm,
    // Esc keeps answering, confirming terminates (unanswered = wrong) then
    // runs the intercepted navigation.
    examLeave !== null ? createElement(ExamLeaveModal, {
      onCancel: () => { setExamLeave(null) },
      onConfirm: () => {
        const action = examLeave.pending
        setExamLeave(null)
        // P17 (the P12 legacy race): force the feed rebind to re-derive from
        // the lessonSessions map instead of the stale local binding.
        localBound.current = null
        const session = examSessionRef.current
        examSessionRef.current = { active: false, terminate: null }
        if (session.active && session.terminate !== null) {
          void session.terminate().catch(() => { /* navigation must not block */ }).finally(() => { action?.() })
        } else {
          action?.()
        }
      },
    }) : null,
    createElement(StudyToastStack))
}

/**
 * E4: the panel-scoped command palette (upstream's Cmd+K surface, plugin
 * edition). Own DOM listener (the host has no hotkey registration — P0's one
 * gap), captured only while the panel takeover is active. Rows: lesson
 * search-and-jump (the dashboard search API), course switch, review, start
 * studying — all funneling the panel's own actions.
 */
function CommandPalette({ searchLessons, courses, onClose, onLesson, onCourse, onReview, onStudy }: {
  searchLessons: (query: string) => Promise<Array<{ lessonId: string; lessonTitle: string; snippet: string }>>
  courses: ReadonlyArray<{ id: string; title: string }>
  onClose: () => void
  onLesson: (lessonId: string) => void
  onCourse: (courseId: string) => void
  onReview: () => void
  onStudy: () => void
}): ReactNode {
  const [query, setQuery] = useState('')
  const [lessons, setLessons] = useState<Array<{ lessonId: string; lessonTitle: string; snippet: string }>>([])
  const inputRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => {
    const q = query.trim()
    if (q === '') { setLessons([]); return }
    let disposed = false
    const t = setTimeout(() => {
      void searchLessons(q).then(rows => { if (!disposed) setLessons(rows.slice(0, 6)) }, () => { /* search degraded */ })
    }, 180)
    return () => { disposed = true; clearTimeout(t) }
  }, [query, searchLessons])
  const q = query.trim().toLowerCase()
  const courseRows = courses.filter(c => q === '' || c.title.toLowerCase().includes(q)).slice(0, 3)
  const actions: Array<{ id: 'review' | 'study'; label: string; run: () => void }> = [
    { id: 'review', label: tr('palette.review'), run: onReview },
    { id: 'study', label: tr('palette.study'), run: onStudy },
  ].filter(a => q === '' || a.label.toLowerCase().includes(q))
  const first = lessons[0]
  const onKey = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Escape') onClose()
    if (e.key === 'Enter') {
      if (first !== undefined) onLesson(first.lessonId)
      else if (courseRows[0] !== undefined) onCourse(courseRows[0].id)
      else if (actions[0] !== undefined) actions[0].run()
    }
  }
  return createElement('div', { className: 'lks14-palette', 'data-testid': 'command-palette', role: 'dialog', 'aria-label': tr('palette.label') },
    createElement('div', { className: 'lks14-palette-backdrop', onClick: onClose }),
    createElement('div', { className: 'lks14-palette-card' },
      createElement('input', {
        ref: inputRef,
        className: 'lks14-palette-input',
        placeholder: tr('palette.placeholder'),
        value: query,
        onChange: (e: { target: { value: string } }) => { setQuery(e.target.value) },
        onKeyDown: onKey,
      }),
      createElement('div', { className: 'lks14-palette-list' },
        lessons.map(l => createElement('button', {
          key: l.lessonId, className: 'lks14-palette-row', onClick: () => { onLesson(l.lessonId) },
        },
          createElement('span', { className: 'lks14-palette-kind' }, tr('palette.lessons')),
          createElement('span', { className: 'lks14-palette-text' }, l.lessonTitle,
            createElement('span', { className: 'lks14-palette-sub' }, l.snippet.slice(0, 60))))),
        courseRows.map(c => createElement('button', {
          key: c.id, className: 'lks14-palette-row', onClick: () => { onCourse(c.id) },
        },
          createElement('span', { className: 'lks14-palette-kind' }, tr('palette.courses')),
          createElement('span', { className: 'lks14-palette-text' }, c.title))),
        actions.map(a => createElement('button', {
          key: a.id, className: 'lks14-palette-row', onClick: a.run,
        },
          createElement('span', { className: 'lks14-palette-kind' }, tr('palette.kind.action')),
          createElement('span', { className: 'lks14-palette-text' }, a.label))),
        lessons.length === 0 && courseRows.length === 0 && actions.length === 0
          ? createElement('div', { className: 'lks14-palette-empty' }, tr('palette.empty'))
          : null)))
}

/**
 * E6 (upstream model switcher, plugin edition): the chip reads the bound
 * thread's modelSelection projection; opening it fetches the host catalog
 * (providers → models → efforts) and picking calls selectModel on the host —
 * the SAME face the host's own picker uses. Degrades to a read-only chip
 * when either face is absent (P0's recorded degradation).
 */
function ModelFaceChip({ sessionId, current, selectModel }: {
  sessionId: string | null
  current: { provider: string; model: string; reasoningEffort?: string } | null
  selectModel: { selectModel?: (req: Record<string, unknown>) => Promise<unknown>; modelCatalog?: () => Promise<unknown> } | undefined
}): ReactNode {
  const [open, setOpen] = useState(false)
  const [groups, setGroups] = useState<Array<{ id: string; name: string; models: Array<{ id: string; name: string; effort?: string }> }> | null>(null)
  const [busy, setBusy] = useState(false)
  const catalogReachable = selectModel?.modelCatalog !== undefined && selectModel?.selectModel !== undefined && sessionId !== null
  const label = current === null ? tr('model.unknown') : `${current.model}${current.reasoningEffort !== undefined && current.reasoningEffort !== '' ? ` · ${current.reasoningEffort}` : ''}`
  useEffect(() => { if (!open) setGroups(null) }, [open])
  const load = (): void => {
    if (groups !== null || selectModel?.modelCatalog === undefined) return
    void selectModel.modelCatalog().then(cat => {
      const c = cat as { groups?: Array<{ id?: string; name?: string; models?: Array<{ id?: string; name?: string; reasoning?: { efforts?: Array<{ id?: string }>, defaultEffort?: string } }> }> }
      setGroups((c.groups ?? []).map(g => ({
        id: g.id ?? '?', name: g.name ?? g.id ?? '?',
        models: (g.models ?? []).map(m => ({ id: m.id ?? '?', name: m.name ?? m.id ?? '?', effort: m.reasoning?.defaultEffort ?? m.reasoning?.efforts?.[0]?.id })),
      })))
    }, () => { setGroups([]) })
  }
  const pick = (provider: string, model: string, effort: string | undefined): void => {
    if (selectModel?.selectModel === undefined || sessionId === null) return
    setBusy(true)
    void selectModel.selectModel({ sessionId, provider, model, reasoningEffort: effort }).then(() => {
      setOpen(false)
      showStudyToast(tr('model.switched', { model }), { severity: 'success' })
    }, () => { showStudyToast(tr('model.switchFailed'), { severity: 'error' }) }).finally(() => { setBusy(false) })
  }
  return createElement('span', { className: 'lks-modelface' },
    createElement('button', {
      className: 'lks-modelface-chip',
      'data-testid': 'model-face-chip',
      'data-tooltip': current === null ? tr('model.unknown') : `${current.provider} / ${current.model}`,
      disabled: !catalogReachable,
      'aria-disabled': catalogReachable ? undefined : true,
      onClick: () => { setOpen(o => !o); load() },
    }, createElement(IconBoltFill16, { size: 12 }), label),
    open
      ? createElement('div', { className: 'lks-modelface-pop', role: 'menu', 'data-testid': 'model-face-pop' },
        (groups ?? []).map(g => createElement('div', { key: g.id, className: 'lks-modelface-group' },
          createElement('div', { className: 'lks-modelface-gname' }, g.name),
          ...g.models.map(m => createElement('button', {
            key: m.id,
            className: `lks-modelface-model${current !== null && current.model === m.id ? ' on' : ''}`,
            disabled: busy,
            onClick: () => { pick(g.id, m.id, m.effort) },
          }, m.name)))))
      : null)
}

/** P6: the panel's toast stack (upstream Toast port) — severity capsules,
 * top-center, auto-dismiss with an exit-animation handshake; the store clears
 * on unmount so no toast outlives the panel. */
/** P12: the exam leave-guard modal (upstream examLeave + useFocusTrap port):
 * overlay, focus starts on the destructive confirm, Esc keeps answering. */
function ExamLeaveModal({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }): ReactNode {
  const confirmRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    confirmRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return createElement('div', { className: 'lks14-examleave', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': tr('exam.leave.title') },
    createElement('div', { className: 'lks14-examleave-card' },
      createElement('div', { className: 'lks14-examleave-title' }, createElement(IconWarningOutline16, { size: 18 }), tr('exam.leave.title')),
      createElement('div', { className: 'lks14-examleave-msg' }, tr('exam.leave.message')),
      createElement('div', { className: 'lks14-examleave-row' },
        createElement('button', { className: 'lks-btn ghost', onClick: onCancel }, tr('exam.leave.cancel')),
        createElement('button', { ref: confirmRef, className: 'lks-btn danger', onClick: onConfirm }, tr('exam.leave.confirm')),
      ),
    ),
  )
}

function StudyToastStack(): ReactNode {
  const [items, setItems] = useState<readonly ToastItem[]>([])
  useEffect(() => {
    const update = (): void => { setItems([...toastStore.getSnapshot()]) }
    update()
    const unsubscribe = toastStore.subscribe(update)
    return () => {
      unsubscribe()
      toastStore.clear()
    }
  }, [])
  return createElement('div', { className: 'lks-toasts', role: 'region', 'aria-live': 'polite', 'aria-label': tr('toast.region') },
    ...items.map(t => createElement('div', {
      key: t.id,
      className: `lks-toast${t.exiting ? ' exiting' : ''}`,
      'data-severity': t.severity,
      onAnimationEnd: t.exiting ? () => { toastStore.finish(t.id) } : undefined,
    },
      toastIcon(t.severity),
      createElement('span', { className: 'lks-toast-text' }, t.message),
      t.action === undefined ? null : createElement('button', {
        className: 'lks-toast-action',
        onClick: () => {
          t.action?.onClick?.()
          toastStore.startExit(t.id)
        },
      }, t.action.label),
      createElement('button', {
        className: 'lks-toast-close',
        'aria-label': tr('toast.close'),
        onClick: () => { toastStore.startExit(t.id) },
      }, createElement(IconCloseFill16, { size: 12 })),
    )))
}

/** Module-level shell handle so the panel can suppress hand-back on internal opens. */
const PANEL_SHELL: { current: { suppressHandBack(fn: () => void): void } | null } = { current: null }
export function setPanelShell(shell: { suppressHandBack(fn: () => void): void } | null): void {
  PANEL_SHELL.current = shell
}

/** 左栏:course picker, tree, review box, import. */
function CourseRail({ data, activate, setFocus, searchLessons, deleteCourse, send, onJumped, onBlankTap, streamingLessonId, turnActive, importProgress, stop, paletteBus }: {
  data: StudyData
  activate: (active: boolean) => Promise<void>
  setFocus: (id: string) => Promise<void>
  searchLessons: (query: string) => Promise<Array<{ lessonId: string; lessonTitle: string; snippet: string }>>
  deleteCourse: (courseId: string) => Promise<void>
  send: PanelSend
  /** C7: fired after a bubble jump (narrow layout switches to the chat pane). */
  onJumped: () => void
  /** C13: a tap on map blank space (companion poke). */
  onBlankTap: () => void
  /** D6: the lesson whose tutor thread is streaming (spinner ball + rail notice). */
  streamingLessonId: string | null
  /** D7: the bound thread's turn is live (the import watchers key off it). */
  turnActive: boolean
  /** D7: the import tools' chip states folded from the bound thread. */
  importProgress: { fetch: { state: string }; apply: { state: string } }
  /** D7: stops the running turn (the import cancel). */
  stop: () => void
  /** E4: the command palette registers its rail-side actions here. */
  paletteBus: { current: { courseSelect?: (id: string) => void; reviewOpen?: () => void } }
}): ReactNode {
  const [selectedCourse, setSelectedCourse] = useState('')
  const [query, setQuery] = useState('')
  const [searchRows, setSearchRows] = useState<ReturnType<typeof mergeRailSearch>>([])
  const [sectionOverrides, setSectionOverrides] = useState<Record<string, boolean>>({})
  const toggleSection = (title: string, next: boolean): void => {
    setSectionOverrides(cur => ({ ...cur, [title]: next }))
  }
  const [confirmDel, setConfirmDel] = useState<{ rect: { left: number; top: number; right: number; bottom: number } } | null>(null)
  const [error, setError] = useState<string | null>(null)
  // B1: the upstream rail frame — a map/import tab capsule over two sliding
  // panes; search and review open as full-rail overlays from the title card.
  const [panel, setPanel] = useState<'map' | 'import'>('map')
  const [searchOpen, setSearchOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  // D6 (upstream world switcher): study is the default; a course change resets
  // (a new course may have no practice world — a stale one would strand the
  // rail on an empty view).
  const [world, setWorld] = useState<'study' | 'practice'>('study')
  // C12: the optimistic focus — the clicked bubble shows selected before the
  // 3s poll confirms it (cleared once the feed's focus matches).
  const [optFocus, setOptFocus] = useState<string | null>(null)
  const railEl = useRef<HTMLDivElement | null>(null)
  const scrollEl = useRef<HTMLDivElement | null>(null)
  // Course resolution lives above every effect that names it in deps (TDZ).
  const courseId = data !== null && data.courses.length > 0
    ? (data.courses.some(c => c.courseId === selectedCourse) ? selectedCourse : data.courses[0]!.courseId)
    : null
  // D6: reset the world on course change — after courseId's declaration (the
  // TDZ trap has bitten here; a stale practice selection on a course without
  // one would strand the rail on an empty view).
  useEffect(() => { setWorld('study') }, [courseId])
  // E4: the palette's rail-side actions (course switch + review overlay).
  paletteBus.current.courseSelect = (id: string) => { setSelectedCourse(id); setPanel('map') }
  paletteBus.current.reviewOpen = () => { setReviewOpen(true) }
  // D7: the import job watcher — success is the course-count poll (a new id
  // appears), failure is the turn ending with nothing new; cancel stops the
  // turn. sawTurn rides the prop transitions (queue latency means the turn
  // starts a beat AFTER the submit).
  const [importJob, setImportJob] = useState<ImportJob | null>(null)
  const [importResult, setImportResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const sawTurnRef = useRef(false)
  if (importJob !== null && turnActive) sawTurnRef.current = true
  const startImport = (label: string, prompt: string): void => {
    setImportResult(null)
    sawTurnRef.current = false
    setImportJob({ label, startedAt: Date.now(), baselineIds: new Set((data?.courses ?? []).map(c => c.courseId)) })
    send(prompt)
  }
  useEffect(() => {
    if (importJob === null || data === null) return
    const fresh = data.courses.find(c => !importJob.baselineIds.has(c.courseId))
    if (fresh !== undefined) {
      setImportJob(null)
      setImportResult({ ok: true, msg: tr('import.success') })
      setSelectedCourse(fresh.courseId)
      setPanel('map')
      return
    }
    if (sawTurnRef.current && !turnActive) {
      setImportJob(null)
      setImportResult({ ok: false, msg: tr('import.error.turn') })
    }
  }, [data?.courses, importJob, turnActive])
  const course = data?.courses.find(c => c.courseId === courseId) ?? null
  // C13: blank-tap classification (a >6px move is a drag/scroll, not a whistle).
  const blankDown = useRef<{ x: number; y: number } | null>(null)
  useEffect(() => {
    if (optFocus !== null && data?.focusLessonId === optFocus) setOptFocus(null)
  }, [data?.focusLessonId, optFocus])
  // C3: the focused bubble scrolls into view when a jump (search/review/due)
  // lands outside the viewport (upstream's ±60px rule).
  useEffect(() => {
    const id = data?.focusLessonId
    if (id === null || id === undefined || railEl.current === null) return
    const el = railEl.current.querySelector(`[data-node-id="${CSS.escape(id)}"]`)
    if (el === null) return
    const cRect = railEl.current.getBoundingClientRect()
    const eRect = el.getBoundingClientRect()
    if (eRect.top < cRect.top + 60 || eRect.bottom > cRect.bottom - 60) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [data?.focusLessonId])
  const reportError = (err: unknown): void => { setError(friendlyError(err, 'action')) }
  // Live search: title hits from the loaded tree + debounced full-text hits
  // merge into the results panel (upstream CourseSearchPanel semantics).
  useEffect(() => {
    if (query.trim().length < 2 || data === null) {
      setSearchRows([])
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      void searchLessons(query).then(textHits => {
        if (cancelled) return
        const tree = data.courses.find(c => c.courseId === (data.courses.some(x => x.courseId === selectedCourse) ? selectedCourse : data.courses[0]?.courseId))
        const lessons = (tree?.sections ?? []).flatMap(s => s.lessons)
        setSearchRows(mergeRailSearch(query, lessons.map(l => ({ id: l.id, title: l.title, status: l.status, kind: l.kind })), textHits))
      }).catch(() => { if (!cancelled) setSearchRows([]) })
    }, 250)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [query, selectedCourse, data, searchLessons])

  // The floating topbar: tab capsule + (map pane) the glass title card.
  const topbar: ReactNode = data === null ? null : createElement('div', { className: 'lks14-railtop' },
    createElement('div', { className: 'lks-railtabs' },
      ...(['map', 'import'] as const).map(tab => createElement('button', {
        key: tab,
        className: `lks-railtab${panel === tab ? ' on' : ''}`,
        'aria-pressed': String(panel === tab),
        onClick: () => { setPanel(tab) },
      }, tr(tab === 'map' ? 'map.tab.map' : 'map.tab.import')))),
    panel === 'map' && course !== null
      ? createElement('div', { className: 'lks14-railhead' },
        // distilled two-row head (0.19 critique round): identity row + tools row,
        // the mastery bar demoted to a hairline between them
        createElement('div', { className: 'lks14-railcard-row main' },
          data.courses.length > 1
            ? createElement('select', {
              className: 'lks-set-select',
              value: courseId ?? '',
              onChange: (e: { target: { value: string } }) => { setSelectedCourse(e.target.value); setConfirmDel(null) },
            }, ...data.courses.map(c => createElement('option', { key: c.courseId, value: c.courseId }, c.title)))
            : createElement('div', { className: 'lks14-railtitle', title: course.title }, course.title),
          createElement('span', { className: 'lks14-railpct' }, `${String(course.avgMasteryPct ?? 0)}%`),
          createElement('button', {
            className: 'lks-btn ghost',
            'data-tooltip': tr('rail.delete'),
            onClick: (e: { currentTarget: HTMLButtonElement; stopPropagation: () => void }) => {
              e.stopPropagation()
              const r = e.currentTarget.getBoundingClientRect()
              setConfirmDel({ rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } })
            },
          }, createElement(IconTrashOutline16, { size: 14 })),
        ),
        createElement('div', {
          className: `lks14-masteryhair${course.avgMasteryPct === 100 ? ' gold' : ''}`,
          title: course.avgMasteryPct === null ? tr('rail.avg.none') : tr('rail.avg', { pct: course.avgMasteryPct }),
        }, createElement('i', { style: { transform: `scaleX(${(course.avgMasteryPct ?? 0) / 100})` } })),
        createElement('div', { className: 'lks14-railcard-row tools' },
          createElement('button', {
            className: 'lks-railpill',
            'data-tooltip': tr('rail.search'),
            onClick: () => { setSearchOpen(true) },
          }, createElement(IconGlobeOutline14, { size: 13 }), tr('map.search.label')),
          createElement('button', {
            className: `lks-railpill${data.dueCount > 0 ? ' due' : ''}`,
            title: data.dueCount > 0 ? tr('rail.due', { count: data.dueCount }) : tr('map.review.label'),
            onClick: () => { setReviewOpen(true) },
          }, createElement(IconBookFill16, { size: 13 }), tr('map.review.label'),
            data.dueCount > 0 ? createElement('span', { className: 'lks-railpill-n' }, String(data.dueCount)) : null),
          // D6: the two-world switcher — only when a practice world exists
          // (upstream hides it for pure-study courses); shares the tools row.
          course.sections.some(s => sectionWorldOf(s) === 'practice')
            ? createElement('div', { className: 'lks-worldswitch', role: 'tablist' },
              createElement('button', {
                className: `lks-worldtab${world === 'study' ? ' on' : ''}`,
                'data-testid': 'world-tab-study',
                role: 'tab',
                'aria-selected': String(world === 'study'),
                onClick: () => { setWorld('study') },
              }, createElement(IconBookFill16, { size: 13 }), tr('map.world.study')),
              createElement('button', {
                className: `lks-worldtab${world === 'practice' ? ' on' : ''}`,
                'data-testid': 'world-tab-practice',
                role: 'tab',
                'aria-selected': String(world === 'practice'),
                onClick: () => { setWorld('practice') },
              }, createElement(IconWrenchOutline16, { size: 13 }), tr('map.world.practice')))
            : null,
        ),
      )
      : null,
  )

  // The map pane: sections under the floating chrome (pt reserves its height).
  const mapPane: ReactNode = data === null
    ? createElement('div', { className: 'lks14-empty' }, tr('loading'))
    : course === null
      ? null
      : createElement('div', {
        className: 'lks14-railscroll',
        ref: scrollEl,
        // C13: pointer-down records the fall point; a click that stayed put and
        // missed every control is a blank tap (the companion whistle).
        onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => {
          blankDown.current = { x: e.clientX, y: e.clientY }
        },
        onClick: (e: ReactMouseEvent<HTMLDivElement>) => {
          const d = blankDown.current
          blankDown.current = null
          if (d === null || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return
          if ((e.target as HTMLElement).closest('button, a, input, textarea, select') !== null) return
          onBlankTap()
        },
      },
        createElement('div', { className: 'lks-raillist' },
          // D6 (upstream world switcher): practice sections are free-explore and
          // never study-gated; in-rail search overrides the world (matches can
          // live in either world); an empty practice world carries its own
          // empty state instead of a blank rail.
          query.trim() === '' && world === 'practice' && !course.sections.some(s => sectionWorldOf(s) === 'practice')
            ? createElement('div', { className: 'lks-empty-practice' }, tr('map.empty.practice'))
            : course.sections.filter(s => query.trim() !== '' || sectionWorldOf(s) === world).flatMap(section => {
            const examAllowed = examOpen(section.lessons)
            const lessons = section.lessons.filter(l => query.trim() === '' || titleMatches(l.title, query) || l.focus)
            if (lessons.length === 0) return []
            const open = query.trim() !== '' || effectiveOpen(section.title, sectionDefaultOpen(section), sectionOverrides)
            return [createElement(ListSectionView, {
              key: section.title,
              streamingId: streamingLessonId,
              section: {
                title: section.title, index: section.index,
                // C12: the optimistic focus rides alongside the feed's focus.
                lessons: lessons.map(l => ({ ...l, focus: l.focus || l.id === optFocus })),
              },
              examAllowed,
              open,
              onToggle: () => { toggleSection(section.title, !open) },
              // Upstream alignment: tapping a row only FOCUSES the lesson —
              // the state-side attempt runs host-side, zero LLM traffic.
              onJump: (id: string) => {
                setOptFocus(id)
                onJumped()
                void setFocus(id).catch(() => { setOptFocus(null) })
              },
            })]
          })))

  // The import pane: course rows (multi-course), the URL row, the demo course.
  const importPane: ReactNode = data === null ? null : createElement('div', { className: 'lks14-railpane-import' },
    data.courses.length > 1
      ? createElement('div', { className: 'lks14-raillist' },
        ...data.courses.map(c => createElement('button', {
          key: c.courseId,
          className: `lks14-railcourse${c.courseId === courseId ? ' on' : ''}`,
          onClick: () => { setSelectedCourse(c.courseId); setPanel('map') },
        },
          createElement('span', { className: 'lks14-railcourse-title' }, c.title),
          createElement('span', { className: 'lks14-railcourse-sub' }, tr('rail.mastered', { mastered: c.mastered, total: c.total })),
        )))
      : null,
    data.courses.length === 0
      ? createElement('div', { className: 'lks14-empty' }, tr('rail.empty.title'))
      : null,
    createElement('button', {
      className: 'lks-btn ghost lks14-raildemo',
      onClick: () => { send(tr('prompt.import', { url: 'https://github.com/microsoft/AI-For-Beginners' })) },
    }, createElement(IconDownloadOutline16, null), tr('rail.empty.demo')),
    createElement(ImportPanel, {
      job: importJob,
      progress: importProgress,
      turnActive,
      result: importResult,
      onStart: startImport,
      onCancel: () => {
        stop()
        setImportJob(null)
        setImportResult({ ok: false, msg: tr('import.cancelled') })
      },
    }),
  )

  // Search overlay: pill opens it; Esc/Enter/click-through close or jump.
  const searchOverlay: ReactNode = searchOpen && data !== null
    ? createElement('div', { className: 'lks-railoverlay' },
      createElement('div', { className: 'lks-railoverlay-head' },
        createElement('input', {
          className: 'lks14-search',
          type: 'search',
          placeholder: tr('rail.search'),
          value: query,
          autoFocus: true,
          onChange: (e: { target: { value: string } }) => { setQuery(e.target.value) },
          onKeyDown: (e: ReactKeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Escape') { setQuery(''); setSearchRows([]); setSearchOpen(false) }
            if (e.key !== 'Enter' || query.trim() === '') return
            const first = searchRows[0]
            if (first !== undefined) {
              setQuery('')
              setSearchRows([])
              setSearchOpen(false)
              void setFocus(first.lessonId).catch(reportError)
            }
          },
        }),
        createElement('button', {
          className: 'lks-btn ghost',
          onClick: () => { setQuery(''); setSearchRows([]); setSearchOpen(false) },
        }, tr('map.overlay.close'))),
      searchRows.length > 0
        ? createElement('div', { className: 'lks14-searchpanel' },
          ...searchRows.map(row => createElement('button', {
            key: row.lessonId,
            className: 'lks14-searchrow',
            'data-tooltip': tr('rail.search.jump'),
            onClick: () => {
              setQuery('')
              setSearchRows([])
              setSearchOpen(false)
              void setFocus(row.lessonId).catch(reportError)
            },
          },
            createElement('span', { className: 'lks14-searchrow-title' }, row.title),
            row.courseTitle !== '' ? createElement('span', { className: 'lks14-searchrow-course' }, row.courseTitle) : null,
            row.snippet !== '' ? createElement('span', { className: 'lks14-searchrow-snip' }, row.snippet) : null)))
        : null)
    : null

  // Review overlay: the due list + start-review action (upstream's review entry).
  const reviewOverlay: ReactNode = reviewOpen && data !== null
    ? createElement('div', { className: 'lks-railoverlay' },
      createElement('div', { className: 'lks-railoverlay-head' },
        createElement('span', { className: 'lks14-railtitle' }, data.dueCount > 0 ? tr('rail.due', { count: data.dueCount }) : tr('map.review.label')),
        createElement('button', {
          className: 'lks-btn ghost',
          onClick: () => { setReviewOpen(false) },
        }, tr('map.overlay.close'))),
      ...data.due.map(d => createElement('button', {
        key: d.lessonId,
        className: 'lks14-dueitem',
        'data-tooltip': tr('review.jump'),
        onClick: () => { void setFocus(d.lessonId).catch(reportError) },
      },
        createElement('span', null, d.lessonTitle),
        d.overdueDays > 0 ? createElement('span', { className: 'lks14-over' }, tr('rail.due.over', { days: d.overdueDays })) : null)),
      data.dueCount > 0
        ? createElement('div', { className: 'lks14-reviewrow' },
          createElement('button', {
            className: 'lks-btn ghost',
            'data-tooltip': tr('review.random.hint'),
            onClick: () => {
              const pick = pickRandomDue(data.due)
              setReviewOpen(false)
              if (pick !== null) void setFocus(pick.lessonId).catch(reportError)
            },
          }, createElement(IconRefreshOutline16, { size: 13 }), tr('review.random')),
          createElement('button', {
            className: 'lks-btn primary',
            onClick: () => { setReviewOpen(false); send(tr('prompt.review')) },
          }, tr('rail.due.start')))
        : createElement('div', { className: 'lks14-empty' }, tr('rail.due.none')))
    : null

  // Upstream: no course → the import pane is the home pane.
  const effectivePanel = data !== null && data.courses.length === 0 ? 'import' : panel
  return createElement('div', { ref: railEl, className: 'lks14-col lks14-rail' },
    topbar,
    // D6: the streaming notice — the tutor is replying somewhere on the rail.
    // Pinned to the rail's bottom so the head stays two rows tall whether or
    // not it is showing (it used to grow the chrome and overlap the list).
    streamingLessonId !== null
      ? createElement('div', { className: 'lks-stream-note', 'data-testid': 'streaming-notice', role: 'status' },
        createElement('i', { className: 'lks-typing-dot' }, ''), tr('map.streaming.notice'))
      : null,
    createElement('div', { className: 'lks14-railbody' },
      createElement('div', {
        className: 'lks14-railtrack',
        style: { transform: effectivePanel === 'map' ? 'translateX(0)' : 'translateX(-50%)' },
      },
        createElement('div', { className: 'lks14-railpane' }, mapPane),
        createElement('div', { className: 'lks14-railpane' }, importPane),
      ),
    ),
    searchOverlay,
    reviewOverlay,
    confirmDel !== null && courseId !== null
      ? createElement(ConfirmCard, {
        anchor: confirmDel.rect,
        message: `${course?.title ?? ''} — ${tr('rail.delete.confirm')}`,
        danger: true,
        confirmLabel: tr('rail.delete'),
        onConfirm: () => {
          const id = courseId
          setConfirmDel(null)
          deleteCourse(id).then(() => {
            setSelectedCourse('')
            showStudyToast(tr('rail.deleted'), { severity: 'success' })
          }, reportError)
        },
        onCancel: () => { setConfirmDel(null) },
      })
      : null,
    createElement('div', { className: 'lks-propcard-err' }, error),
  )
}

type ImportTab = 'url' | 'md' | 'folder' | 'epub' | 'pack'

/** One import job in flight (D7) — the tutor turn owns the work; this is the pane's watcher state. */
interface ImportJob {
  readonly label: string
  readonly startedAt: number
  readonly baselineIds: ReadonlySet<string>
}

/**
 * D7 (upstream ImportPanel): the five honest source tabs — URL / MD / folder /
 * EPUB / course-pack (upstream's sixth, audio, is local Whisper transcription
 * and is deliberately not ported). Every tab funnels into ONE tutor prompt —
 * the agent pipeline is unchanged. While the job runs, an installer-style
 * progress screen replaces the form: step rows flip working→done off the
 * thread's tool chips, the working row carries a live elapsed counter, the
 * step log auto-scrolls, and cancel stops the turn.
 */
function ImportPanel({ job, progress, turnActive, result, onStart, onCancel }: {
  job: ImportJob | null
  progress: { fetch: { state: string }; apply: { state: string } }
  turnActive: boolean
  result: { ok: boolean; msg: string } | null
  onStart: (label: string, prompt: string) => void
  onCancel: () => void
}): ReactNode {
  const [tab, setTab] = useState<ImportTab>('url')
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [mdName, setMdName] = useState('')
  const [md, setMd] = useState('')
  const [folder, setFolder] = useState('')
  const [epub, setEpub] = useState('')
  const packRef = useRef<HTMLInputElement | null>(null)
  // the elapsed ticker — one beat per second while a job runs
  const [, setTick] = useState(0)
  useEffect(() => {
    if (job === null) return
    const t = setInterval(() => { setTick(x => x + 1) }, 1000)
    return () => { clearInterval(t) }
  }, [job === null])
  const scrollRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (el !== null) el.scrollTop = el.scrollHeight
  })

  const tabs: Array<{ k: ImportTab; label: string; icon: (p: { size?: number }) => ReactNode }> = [
    { k: 'url', label: tr('import.tab.url'), icon: IconLinkOutline16 },
    { k: 'md', label: tr('import.tab.md'), icon: IconDocOutline16 },
    { k: 'folder', label: tr('import.tab.folder'), icon: IconFolderOutline16 },
    { k: 'epub', label: tr('import.tab.epub'), icon: IconBookFill16 },
    { k: 'pack', label: tr('import.tab.pack'), icon: IconBoxOutline16 },
  ]

  // The installer screen (upstream: the progress card replaces the form).
  if (job !== null) {
    const fetchS = progress.fetch.state
    const applyS = progress.apply.state
    const failed = fetchS === 'error' || applyS === 'error'
    type RowState = 'done' | 'working' | 'pending'
    const rows: Array<{ label: string; state: RowState }> = [
      { label: tr('import.step.fetch'), state: fetchS === 'done' || fetchS === 'error' ? 'done' : 'working' },
      { label: tr('import.step.design'), state: (fetchS === 'done' && (applyS !== 'absent' || !turnActive)) || applyS !== 'absent' ? 'done' : fetchS === 'done' ? 'working' : 'pending' },
      { label: tr('import.step.apply'), state: applyS === 'done' || applyS === 'error' ? 'done' : applyS === 'loading' ? 'working' : 'pending' },
      { label: tr('import.step.done'), state: applyS === 'done' ? 'working' : 'pending' },
    ]
    const elapsed = Math.floor((Date.now() - job.startedAt) / 1000)
    return createElement('div', { className: 'lks14-importprog', 'data-testid': 'import-progress' },
      createElement('div', { className: 'lks14-importprog-head' },
        createElement('span', { className: 'lks14-importprog-spin', 'aria-hidden': 'true' }),
        createElement('span', { className: 'lks14-importprog-title' }, tr('import.progress.title')),
        createElement('button', {
          className: 'lks14-importprog-cancel',
          'data-testid': 'import-cancel-btn',
          onClick: onCancel,
        }, tr('import.progress.cancel'))),
      createElement('div', { className: 'lks14-importprog-note' }, tr('import.progress.note')),
      createElement('div', { className: 'lks14-importprog-src' }, job.label),
      failed
        ? createElement('div', { className: 'lks14-import-error', 'data-testid': 'import-error' }, tr('import.error', { msg: '' }))
        : null,
      createElement('div', { ref: scrollRef, className: 'lks14-importprog-steps' },
        rows.length === 0
          ? createElement('div', { className: 'lks14-importprog-step pending' }, tr('import.progress.starting'))
          : rows.map((row, i) => createElement('div', {
            key: i,
            className: `lks14-importprog-step ${row.state}`,
            'data-step': String(i + 1),
            'data-state': row.state,
          },
            row.state === 'done'
              ? createElement('span', { className: 'lks14-importprog-check', 'aria-hidden': 'true' }, '✓')
              : createElement('span', { className: 'lks14-importprog-dots', 'aria-hidden': 'true' }),
            createElement('span', { className: 'lks14-importprog-text' }, row.label,
              row.state === 'working' ? createElement('span', { className: 'lks14-importprog-elapsed' }, tr('import.progress.elapsed', { s: elapsed })) : null))))
    )
  }

  const form: ReactNode = tab === 'url'
    ? createElement('div', { className: 'lks14-importform', 'data-testid': 'import-url-section' },
      createElement('input', {
        className: 'lks14-search', type: 'url', placeholder: tr('rail.empty.placeholder'), value: url,
        onChange: (e: { target: { value: string } }) => { setUrl(e.target.value) },
        onKeyDown: (e: ReactKeyboardEvent<HTMLInputElement>) => {
          if (e.key === 'Enter' && url.trim() !== '') onStart(tr('import.tab.url'), tr('prompt.import.url', { url: url.trim() }))
        },
      }),
      createElement('div', { className: 'lks14-hint' }, tr('import.url.desc')),
      createElement('button', {
        className: 'lks-btn primary lks14-importbtn', disabled: url.trim() === '',
        onClick: () => { onStart(tr('import.tab.url'), tr('prompt.import.url', { url: url.trim() })) },
      }, tr('import.btn.url')))
    : tab === 'md'
      ? createElement('div', { className: 'lks14-importform' },
        createElement('input', {
          className: 'lks14-search', placeholder: tr('import.placeholder.name'), value: mdName,
          onChange: (e: { target: { value: string } }) => { setMdName(e.target.value) },
        }),
        createElement('textarea', {
          className: 'lks14-search lks14-importmd', rows: 4, placeholder: tr('import.placeholder.md'), value: md,
          onChange: (e: { target: { value: string } }) => { setMd(e.target.value) },
        }),
        createElement('button', {
          className: 'lks-btn primary lks14-importbtn', disabled: md.trim() === '',
          onClick: () => { onStart(tr('import.tab.md'), tr('prompt.import.md', { title: mdName.trim() === '' ? '' : `(标题「${mdName.trim()}」)`, md: md.trim() })) },
        }, tr('import.btn.md')))
      : tab === 'folder'
        ? createElement('div', { className: 'lks14-importform' },
          createElement('input', {
            className: 'lks14-search', placeholder: tr('import.folder.pathPlaceholder'), value: folder,
            onChange: (e: { target: { value: string } }) => { setFolder(e.target.value) },
            onKeyDown: (e: ReactKeyboardEvent<HTMLInputElement>) => {
              if (e.key === 'Enter' && folder.trim() !== '') onStart(tr('import.tab.folder'), tr('prompt.import.folder', { path: folder.trim(), title: '' }))
            },
          }),
          createElement('div', { className: 'lks14-hint' }, tr('import.folder.desc')),
          createElement('button', {
            className: 'lks-btn primary lks14-importbtn', disabled: folder.trim() === '',
            onClick: () => { onStart(tr('import.tab.folder'), tr('prompt.import.folder', { path: folder.trim(), title: '' })) },
          }, tr('import.btn.folder')))
        : tab === 'epub'
          ? createElement('div', { className: 'lks14-importform' },
            createElement('input', {
              className: 'lks14-search', placeholder: tr('import.epub.pathPlaceholder'), value: epub,
              onChange: (e: { target: { value: string } }) => { setEpub(e.target.value) },
            }),
            createElement('div', { className: 'lks14-hint' }, tr('import.epub.desc')),
            createElement('button', {
              className: 'lks-btn primary lks14-importbtn', disabled: epub.trim() === '',
              onClick: () => {
                const file = epub.trim().replaceAll('\\', '/').split('/').pop() ?? ''
                onStart(tr('import.tab.epub'), tr('prompt.import.epub', { path: epubFolderPath(epub.trim()), file, title: '' }))
              },
            }, tr('import.btn.epub')))
          : createElement('div', { className: 'lks14-importform' },
            createElement('div', { className: 'lks14-hint' }, tr('import.pack.desc')),
            createElement('input', {
              ref: packRef, type: 'file', accept: '.md,.markdown,.txt', className: 'lks14-importfile',
              onChange: (e: { target: HTMLInputElement & { files: FileList | null } }) => {
                const file = e.target.files?.[0]
                if (file === undefined || file === null) return
                void file.text().then(text => {
                  onStart(tr('import.tab.pack'), tr('prompt.import.md', { title: `(课程包「${file.name}」)`, md: text }))
                })
              },
            }),
            createElement('button', {
              className: 'lks-btn primary lks14-importbtn',
              onClick: () => { packRef.current?.click() },
            }, tr('import.btn.pack')))

  return createElement('div', { className: 'lks14-import' },
    result !== null
      ? createElement('div', { className: result.ok ? 'lks14-import-success' : 'lks14-import-error' }, result.msg)
      : null,
    createElement('button', {
      className: `lks14-importcta${open ? ' open' : ''}`,
      onClick: () => { setOpen(o => !o) },
    }, createElement(IconPlusOutline16, { size: 14 }), tr('import.cta')),
    open
      ? createElement('div', { className: 'lks14-importtabs', role: 'tablist' },
        ...tabs.map(t => createElement('button', {
          key: t.k,
          className: `lks14-importtab${tab === t.k ? ' on' : ''}`,
          role: 'tab',
          'aria-selected': String(tab === t.k),
          'data-testid': `import-tab-${t.k}`,
          onClick: () => { setTab(t.k) },
        }, createElement(t.icon, { size: 13 }), t.label)))
      : null,
    open ? form : null,
  )
}

/**
 * The EPUB tab's path preprocessing: an .epub file path folds to its parent
 * folder (the scanner parses EPUBs it finds inside folders); a folder path
 * passes through untouched. Pure.
 */
export function epubFolderPath(path: string): string {
  if (!/\.epub$/i.test(path)) return path
  const norm = path.replaceAll('\\', '/')
  const cut = norm.lastIndexOf('/')
  return cut <= 0 ? path : norm.slice(0, cut)
}

/** 中栏:the tutor chat stream with its own composer (upstream ChatStream + ChatComposer). */
function ChatPane({ data, lesson, rows, feedAttached, bound, busy, sendError, draft, setDraft, send, stop, setMode, narrowPane, companionEvent, onThreadJump, contextMeter, uploadAttachment }: {
  data: StudyData
  lesson: StudyData['lesson']
  rows: ReturnType<typeof feedRows>
  feedAttached: boolean
  bound: boolean
  busy: boolean
  sendError: string | null
  draft: string
  setDraft: (text: string) => void
  send: PanelSend
  stop: () => void
  setMode: (mode: 'direct' | 'guide' | 'practice') => Promise<void>
  narrowPane: 'rail' | 'chat' | 'note'
  companionEvent: (event: 'talk-start' | 'talk-end' | 'celebrate' | 'encourage' | 'decay' | 'poke') => void
  /** E5: jump to another lesson's thread pill (focus change rebinds the feed). */
  onThreadJump: (lessonId: string) => void
  /** E1: the context meter value (projection-backed, or the labeled estimate). */
  contextMeter: { pct: number | null; label: string; estimated: boolean }
  /** E3: land one attachment in the study workspace (returns its path). */
  uploadAttachment: (name: string, dataBase64: string) => Promise<string>
}): ReactNode {
  // C1 sticky-follow: follow new rows only while the reader sits at the bottom
  // (80px tolerance); scrolling up detaches, the FAB comes back.
  const stuck = useRef(true)
  const [showFab, setShowFab] = useState(false)
  const onStreamScroll = (): void => {
    const el = streamEl.current
    if (el === null) return
    stuck.current = isStuck(el.scrollTop, el.scrollHeight, el.clientHeight)
    setShowFab(!stuck.current && el.scrollHeight > el.clientHeight + 100)
  }
  const lastIsUser = rows.length > 0 && rows[rows.length - 1]!.role === 'user'
  const streamEl = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    // C1: chase the tail only while stuck, or when the learner just sent (the
    // upstream rule — your own message always pulls the view down).
    if (!stuck.current && !lastIsUser) return
    const el = streamEl.current
    if (el !== null) el.scrollTop = el.scrollHeight
  }, [rows.length, lastIsUser])
  const dormant = data?.active !== true
  // C2: Esc aborts the running turn (upstream's global escape).
  useEffect(() => {
    if (!busy) return
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') stop() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [busy, stop])

  // C11: per-message read-aloud — speak/stop under every assistant reply with
  // n/total progress and a sentence-level karaoke highlight inside the row.
  const { tts } = useStudy()
  const [msgAudio, setMsgAudio] = useState<{ key: string; index: number; total: number } | null>(null)
  const msgReadCtl = useRef<ReadAloudController | null>(null)
  const rowElement = (key: string): HTMLDivElement | null => {
    const el = streamEl.current?.querySelector(`[data-row-key="${CSS.escape(key)}"]`)
    return el instanceof HTMLDivElement ? el : null
  }
  /** Wrap the nth sentence of the row's text model in a reading mark (pure DOM). */
  const karaokeMark = (el: HTMLDivElement, index: number, sentences: readonly string[]): void => {
    el.querySelectorAll('mark.lks-reading').forEach(m => { m.replaceWith(...m.childNodes) })
    if (index >= sentences.length) return
    const model = getTextModel(el, { includeMarks: false })
    let cursor = 0
    for (let i = 0; i <= index; i++) {
      const hit = model.text.indexOf(sentences[i] ?? '', cursor)
      if (hit === -1) return
      if (i === index) {
        for (const seg of planSegments(model.nodes, hit, hit + (sentences[i] ?? '').length)) {
          const entry = model.nodes[seg.index]!
          const mid = seg.localStart > 0 ? entry.node.splitText(seg.localStart) : entry.node
          const localEnd = seg.localEnd - seg.localStart
          if (mid.textContent !== null && mid.textContent.length > localEnd) mid.splitText(localEnd)
          const mark = document.createElement('mark')
          mark.className = 'lks-reading'
          mid.parentElement?.insertBefore(mark, mid)
          mark.appendChild(mid)
        }
        return
      }
      cursor = hit + (sentences[i] ?? '').length
    }
  }
  const playMessage = (key: string): void => {
    const el = rowElement(key)
    if (el === null) return
    const plain = (el.textContent ?? '').trim()
    const sentences = speechSentencesOf(plain)
    if (sentences.length === 0) return
    companionEvent('talk-start')
    msgReadCtl.current?.stop()
    const voice = storedTtsVoice()
    const prefetch = new Map<string, Promise<Uint8Array>>()
    let currentAudio: HTMLAudioElement | null = null
    const fetchAudio = (text: string): Promise<Uint8Array> => {
      const hit = prefetch.get(text)
      if (hit !== undefined) { prefetch.delete(text); return hit }
      return tts(text, voice)
    }
    const edgeEngine: SpeechEngine = {
      speak: (text: string) => fetchAudio(text).then(buf => new Promise<void>((resolve, reject) => {
        const blobUrl = URL.createObjectURL(new Blob([buf], { type: 'audio/mpeg' }))
        const audio = new Audio(blobUrl)
        currentAudio = audio
        audio.onended = () => { URL.revokeObjectURL(blobUrl); if (currentAudio === audio) currentAudio = null; resolve() }
        audio.onerror = () => { URL.revokeObjectURL(blobUrl); if (currentAudio === audio) currentAudio = null; reject(new Error('audio playback failed')) }
        void audio.play().catch(reject)
      })),
      pause: () => { currentAudio?.pause() },
      resume: () => { void currentAudio?.play().catch(() => { /* ended */ }) },
      cancel: () => { currentAudio?.pause(); currentAudio = null },
    }
    const systemEngine: SpeechEngine = {
      speak: (text: string) => new Promise<void>(resolve => {
        const u = new SpeechSynthesisUtterance(text)
        u.lang = 'zh-CN'
        u.onend = () => { resolve() }
        u.onerror = () => { resolve() }
        window.speechSynthesis?.speak(u)
      }),
      pause: () => { window.speechSynthesis?.pause() },
      resume: () => { window.speechSynthesis?.resume() },
      cancel: () => { window.speechSynthesis?.cancel() },
    }
    const controller = new ReadAloudController(sentences, edgeEngine, systemEngine, s => {
      setMsgAudio(s.state === 'idle' && s.index >= s.total - 1 ? null : { key, index: s.index, total: s.total })
      const el2 = rowElement(key)
      if (el2 !== null) karaokeMark(el2, s.index, sentences)
    })
    msgReadCtl.current = controller
    setMsgAudio({ key, index: 0, total: sentences.length })
    void controller.start().catch(() => { setMsgAudio(null) })
  }
  const stopMessage = (): void => {
    companionEvent('talk-end')
    msgReadCtl.current?.stop()
    setMsgAudio(null)
    document.querySelectorAll('mark.lks-reading').forEach(m => { m.replaceWith(...m.childNodes) })
  }
  // D4: settled artifact-tool rows hydrate into inline cards (pure — re-runs
  // when the window rows or the state feed's artifacts change, so the state
  // poll landing after the journal still hydrates). The backlog stack under
  // the stream keeps what this window hasn't rendered, unseen first.
  const rowsView = useMemo(() => hydrateArtifactRows(rows, lesson?.artifacts), [rows, lesson?.artifacts])
  const inlineIds = useMemo(() => {
    const ids = new Set<string>()
    for (const row of rowsView) if (row.role === 'artifact' && row.artifactId !== undefined) ids.add(row.artifactId)
    return ids
  }, [rowsView])
  const backlog = useMemo(() => lesson !== null ? sedimentBacklog(lesson.artifacts, inlineIds, unseenArtifacts(lesson.lessonId, lesson.artifacts)) : [], [lesson, inlineIds])
  const inlineArtifactCard = (row: typeof rowsView[number]): ReactNode => {
    if (lesson === null || row.artifactId === undefined) return null
    const artifact = lesson.artifacts.find(a => a.id === row.artifactId)
    // The state feed fell behind the fold — the chip stands in until it lands.
    if (artifact === undefined) return chatRow({ ...row, role: 'tool', toolState: 'done' })
    return createElement('div', { className: 'lks14-inline-artifact' },
      artifact.artifactType === 'quiz'
        ? createElement(QuizCard, {
          lessonId: lesson.lessonId,
          artifactId: artifact.id,
          data: artifact.data as unknown as QuizData,
          masteryPct: lesson.masteryPct,
          send,
          onFinished: (allCorrect: boolean) => { companionEvent(allCorrect ? 'celebrate' : 'encourage') },
        })
        : createElement(ArtifactCard, { artifact: artifact as ArtifactRow, send }))
  }
  // E5: the thread switcher rows — lessonSessions joined to lesson titles
  // (every lesson that ever minted a thread gets a pill).
  const threadPills: Array<{ id: string; title: string; current: boolean }> = []
  if (data !== null) {
    const titles = new Map<string, string>()
    for (const c of data.courses) for (const s of c.sections) for (const l of s.lessons) titles.set(l.id, l.title)
    for (const [lessonId, sessionId] of Object.entries(data.lessonSessions)) {
      if (sessionId === undefined) continue
      const title = titles.get(lessonId)
      if (title === undefined) continue
      threadPills.push({ id: lessonId, title, current: lesson !== null && lesson.lessonId === lessonId })
    }
  }
  const lastAssistant = rowsView.reduce((acc, row, i) => row.role === 'assistant' ? i : acc, -1)
  const [error, setError] = useState<string | null>(null)
  const fire = (action: Promise<void>): void => {
    action.then(() => { setError(null) }, (err: unknown) => { setError(friendlyError(err, 'action')) })
  }
  const starters = lesson?.starters ?? []
  // E3: the attachment intake — one file at a time lands verbatim in the study
  // workspace (dashboard route), then the outgoing message carries the path
  // the tutor reads. Chunked base64 keeps big files off the arg-size cliff.
  const attachInputRef = useRef<HTMLInputElement | null>(null)
  const attachFile = (file: File): void => {
    void file.arrayBuffer().then(buf => {
      const bytes = new Uint8Array(buf)
      let bin = ''
      const CHUNK = 0x8000
      for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
      return uploadAttachment(file.name, btoa(bin))
    }).then(path => {
      send(tr('attach.sent', { name: file.name, path }))
    }, () => {
      showStudyToast(tr('attach.fail'), { severity: 'error' })
    })
  }
  const onComposerKey = (e: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (draft.trim() !== '' && !busy) send(draft)
    }
  }
  const proposal = data?.pendingProposals[0] ?? null
  // C8: a decided proposal keeps a read-only badge until the poll drops it —
  // the decision gets its visible closure instead of a silent disappearance.
  const [decided, setDecided] = useState<Record<string, { kind: 'accepted' | 'declined'; title: string }>>({})
  useEffect(() => {
    if (proposal === null) return
    setDecided(cur => {
      if (cur[proposal.id] === undefined) return cur
      const next = { ...cur }
      delete next[proposal.id]
      return next
    })
  }, [proposal?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const decidedBadge = proposal === null ? decidedBadgeOf(decided) : null
  return createElement('div', { className: 'lks14-col lks14-chat' },
    proposal !== null
      ? createElement('div', { className: 'lks-propbanner' },
          createElement(IconCrownFill16, { size: 14 }),
          createElement('span', { className: 'lks-propbanner-why' },
            tr('proposal.banner', { lesson: proposal.lessonTitle }), ' — ', proposal.rationale),
          createElement('button', {
            className: 'lks-btn primary',
            style: { padding: '4px 12px', fontSize: '12.5px' },
            onClick: () => { setDecided(cur => ({ ...cur, [proposal.id]: { kind: 'accepted', title: proposal.lessonTitle } })); send(tr('proposal.accept.msg', { lesson: proposal.lessonTitle })) },
          }, tr('proposal.accept')),
          createElement('button', {
            className: 'lks-btn ghost',
            style: { padding: '4px 12px', fontSize: '12.5px' },
            onClick: () => { setDecided(cur => ({ ...cur, [proposal.id]: { kind: 'declined', title: proposal.lessonTitle } })); send(tr('proposal.decline.msg', { lesson: proposal.lessonTitle })) },
          }, tr('proposal.decline')))
      : decidedBadge !== null
        ? createElement('div', { className: `lks-propbanner decided ${decidedBadge.kind}` },
            decidedBadge.kind === 'accepted' ? createElement(IconCrownFill16, { size: 14 }) : createElement(IconBookFill16, { size: 14 }),
            createElement('span', { className: 'lks-propbanner-why' },
              tr(decidedBadge.kind === 'accepted' ? 'proposal.applied' : 'proposal.rejected', { lesson: decidedBadge.title })))
        : null,
    // B4: upstream has no per-column header — a thin current-lesson row instead
    // (ThreadSwitcher empty-state style); the mode pills live in the composer.
    lesson !== null || !dormant
      ? createElement('div', { className: 'lks14-lessonrow' },
        lesson !== null ? createElement('span', null, lesson.title) : createElement('span', null, tr('col.tutor')),
        // E5: the thread switcher — one pill per lesson with a minted thread;
        // the current one marks itself, others jump (focus rebinds the feed).
        threadPills.length > 0
          ? createElement('span', { className: 'lks14-threadpills', role: 'tablist', 'aria-label': tr('threads.label') },
            ...threadPills.map(p => createElement('button', {
              key: p.id,
              className: `lks14-threadpill${p.current ? ' on' : ''}`,
              role: 'tab',
              'aria-selected': String(p.current),
              'data-tooltip': p.title,
              onClick: () => { if (!p.current) onThreadJump(p.id) },
            }, p.title)))
          : null)
      : null,
    // critique fix: the thread's owner is VISIBLE — a learner clicking around
    // the rail must never wonder whose conversation the chat column shows
    bound && lesson !== null
      ? createElement('div', { className: 'lks14-threadlabel' }, tr('thread.label', { title: lesson.title }))
      : null,
    createElement('div', {
      className: 'lks14-stream',
      onScroll: onStreamScroll,
      ref: streamEl,
      'data-lks-feed': rows.length > 0 ? `rows:${String(rows.length)}` : bound ? (feedAttached ? 'attached-empty' : 'waiting') : 'no-thread',
    },
      rows.length === 0
        ? createElement('div', { className: 'lks14-emptycard' },
          createElement('div', { className: 'lks14-emptycard-title' }, dormant ? tr('tutor.dormant') : tr('tutor.empty')),
          createElement('div', { className: 'lks14-emptycard-hint' }, tr('tutor.empty.hint')),
          !dormant
            ? createElement('button', {
              className: 'lks-btn primary',
              'data-tooltip': tr('chat.start.hint'),
              onClick: () => { send(starters[0]?.message ?? tr('prompt.start')) },
            }, tr('chat.start'))
            : null)
        : rowsView.map((row, i) => row.role === 'artifact'
          ? inlineArtifactCard(row)
          : chatRow(row,
            !dormant && i === lastAssistant ? { send } : undefined,
            row.role === 'assistant'
              ? { playing: msgAudio?.key === row.key, index: msgAudio?.index ?? 0, total: msgAudio?.total ?? 0, onPlay: playMessage, onStop: stopMessage }
              : undefined)),
      rowsView.length > 0 && rowsView[rowsView.length - 1]!.role === 'user'
        ? createElement('div', { className: 'lks14-thinking' }, createElement('i', null), createElement('i', null), createElement('i', null))
        : null,
    ),
    // D4: the sediment backlog — artifacts this window hasn't rendered inline,
    // unseen first (the stream owns the live thread; this is the backlog).
    ...backlog
      .filter(a => a.artifactType === 'quiz')
      .map(a => createElement(QuizCard, {
        key: a.id,
        lessonId: lesson!.lessonId,
        artifactId: a.id,
        data: a.data as unknown as QuizData,
        masteryPct: lesson!.masteryPct,
        send,
        onFinished: (allCorrect: boolean) => { companionEvent(allCorrect ? 'celebrate' : 'encourage') },
      })),
    ...backlog
      .filter(a => a.artifactType !== 'quiz')
      .map(a => createElement(ArtifactCard, { key: a.id, artifact: a as ArtifactRow, send })),
    // B7: starters appear only after the conversation starts (upstream gates
    // them on messages>0 — the empty state carries the CTA instead).
    rows.length > 0
      ? createElement('div', { className: 'lks14-starters' },
        ...starters.map(s => createElement('button', {
          key: s.label,
          className: 'lks14-starter',
          'aria-disabled': dormant || undefined,
          title: dormant ? tr('tutor.dormant') : s.message,
          onClick: () => { if (!dormant) send(s.message) },
        }, s.label)))
      : null,
    createElement('div', { className: 'lks14-composer' },
      // E1: the context meter — slim bar above the composer (projection-backed
      // pct + token pair; the estimate is labeled as such).
      createElement('div', { className: 'lks14-ctxmeter', 'data-testid': 'context-meter', 'data-estimated': String(contextMeter.estimated), title: tr('meter.label') },
        createElement('span', { className: 'lks14-ctxmeter-bar' },
          createElement('i', { style: { transform: `scaleX(${String((contextMeter.pct ?? 0) / 100)})` }, className: contextMeter.pct !== null && contextMeter.pct > 80 ? 'hot' : undefined })),
        createElement('span', { className: 'lks14-ctxmeter-label' }, contextMeter.estimated ? contextMeter.label : `${String(contextMeter.pct ?? 0)}% · ${contextMeter.label}`)),
      createElement('div', {
        className: 'lks14-composer-card',
        // E3: dropped files ride the same intake as the paperclip.
        onDragOver: (e: import('react').DragEvent<HTMLDivElement>) => { if (e.dataTransfer?.types.includes('Files') === true) e.preventDefault() },
        onDrop: (e: import('react').DragEvent<HTMLDivElement>) => {
          const file = e.dataTransfer?.files[0]
          if (file !== undefined && file !== null) { e.preventDefault(); attachFile(file) }
        },
      },
        // B4: the soul pills are the composer's first row (upstream ChatComposer).
        createElement('div', { className: 'lks14-soulrow' },
          createElement('span', { className: 'lks14-soullabel' }, tr('mode.label')),
          createElement('span', { className: 'lks14-pills' },
            ...MODES.map(mode => createElement('button', {
              key: mode.id,
              className: `lks14-pill${data?.mode === mode.id ? ' on' : ''}`,
              'aria-pressed': String(data?.mode === mode.id),
              'aria-disabled': dormant || undefined,
              title: dormant ? tr('tutor.dormant') : tr(mode.hintKey),
              onClick: () => { if (!dormant) fire(setMode(mode.id)) },
            }, mode.id === 'direct' ? createElement(IconBoltFill16, { size: 12 }) : mode.id === 'guide' ? createElement(IconGoalOutline16, { size: 12 }) : createElement(IconBookFill16, { size: 12 }), tr(mode.labelKey))))),
        createElement('textarea', {
          className: 'lks14-composertext',
          placeholder: busy ? tr('composer.busy') : tr('tutor.empty.hint'),
          value: draft,
          rows: 2,
          disabled: dormant,
          onChange: (e: { target: { value: string } }) => { setDraft(e.target.value) },
          onKeyDown: onComposerKey,
          // E3: pasted files ride the attachment intake (text pastes pass through).
          onPaste: (e: import('react').ClipboardEvent<HTMLTextAreaElement>) => {
            const files = e.clipboardData?.files
            if (files !== undefined && files.length > 0) { e.preventDefault(); void attachFile(files[0]!) }
          },
        }),
        // E3: the paperclip — one click, any learning file ≤20MiB.
        createElement('button', {
          className: 'lks-btn-attach',
          'aria-label': tr('attach.label'),
          'data-tooltip': tr('attach.label'),
          disabled: dormant,
          onClick: () => { attachInputRef.current?.click() },
        }, createElement(IconPinFill16, { size: 14 })),
        createElement('input', {
          ref: attachInputRef,
          type: 'file',
          className: 'lks14-importfile',
          onChange: (e: { target: HTMLInputElement & { files: FileList | null } }) => {
            const file = e.target.files?.[0]
            if (file !== undefined && file !== null) void attachFile(file)
            e.target.value = ''
          },
        }),
        // C2: send ↔ stop (upstream's 3D pair — stop cancels the host turn).
        busy
          ? createElement('button', {
            className: 'lks-btn-send stop',
            'aria-label': tr('chat.stop'),
            'data-tooltip': tr('chat.stop'),
            onClick: stop,
          }, createElement(IconCloseFill16, { size: 14 }))
          : createElement('button', {
            className: 'lks-btn-send',
            'aria-label': tr('composer.send'),
            disabled: dormant || draft.trim() === '',
            onClick: () => { send(draft) },
          }, createElement(IconArrowUpFill16, { size: 18 })),
      ),
    // C1: the scroll-to-bottom FAB (red pulse while the tutor streams).
    showFab
      ? createElement('button', {
        className: `lks14-scrollfab${busy ? ' streaming' : ''}`,
        'aria-label': tr('scroll.bottom'),
        'data-tooltip': tr('scroll.bottom'),
        onClick: () => {
          const el = streamEl.current
          stuck.current = true
          setShowFab(false)
          if (el !== null) el.scrollTop = el.scrollHeight
        },
      }, '▾')
      : null,
    sendError !== null || error !== null
      ? createElement('div', { className: 'lks-propcard-err' }, sendError ?? error)
      : null,
    ),
  )
}

/** 右栏:the notebook — 讲解/概念图/笔记 tabs (upstream NotebookPanel arrangement). */
function NotebookPane({ data, deleteNote, send, companionEvent, onExamSession, examPaused }: { data: StudyData; deleteNote: (lessonId: string, noteId: string) => Promise<void>; send: PanelSend; companionEvent: (event: 'talk-start' | 'talk-end' | 'celebrate' | 'encourage' | 'decay' | 'poke') => void; onExamSession: (session: ExamSession) => void; examPaused: boolean }): ReactNode {
  const lesson = data?.lesson ?? null
  const [tab, setTab] = useState<'teach' | 'cmap' | 'notes' | 'board'>('teach')
  const [error, setError] = useState<string | null>(null)
  const [confirmNoteDel, setConfirmNoteDel] = useState<{ id: string; rect: { left: number; top: number; right: number; bottom: number } } | null>(null)
  // C6: zone collapse + auto-expand on a new note (upstream ZoneSection).
  const [zoneOverrides, setZoneOverrides] = useState<Record<string, boolean>>({})
  const zoneCounts = useRef<Record<string, number>>({})
  const [editingNote, setEditingNote] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  // C6: a locate fired from the notes tab must wait for the teach prose to
  // remount before it can wrap and flash the quote.
  const [pendingLocate, setPendingLocate] = useState<string | null>(null)
  // P14: the concept-map expand modal (upstream canvas modals).
  const [cmapExpanded, setCmapExpanded] = useState(false)
  useEffect(() => {
    if (!cmapExpanded) return
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setCmapExpanded(false) }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [cmapExpanded])
  const [read, setRead] = useState<ReadAloudStatus | null>(null)
  const readCtl = useRef<ReadAloudController | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const { tts, addUserNote, recordReview, editNote, pinNote } = useStudy()
  const proseRef = useRef<HTMLDivElement | null>(null)
  const diagRef = useRef<HTMLDivElement | null>(null)

  const fire = (action: Promise<void>): void => {
    action.then(() => { setError(null) }, (err: unknown) => { setError(friendlyError(err, 'action')) })
  }

  // P12: exam nodes swap the notebook for the ExamView answering surface
  // (upstream swaps the whole middle column); the gate mirrors the rail's
  // examOpen — every sibling study lesson ≥50% mastery. Computed as a VALUE,
  // never an early return — the hook order must stay unconditional.
  const examContent: ReactNode = lesson !== null && lesson.kind === 'exam'
    ? (() => {
        const section = data?.courses.flatMap(c => c.sections).find(s => s.lessons.some(l => l.id === lesson.lessonId))
        const allowed = examOpen(section?.lessons ?? [])
        return allowed
          ? createElement(ExamView, { lessonId: lesson.lessonId, sectionTitle: lesson.sectionTitle, paused: examPaused, onSessionChange: onExamSession })
          : createElement('div', { className: 'lks14-empty', style: { padding: '16px 0' } as CSSProperties }, tr('status.exam'))
      })()
    : null


  // Canvas semantics (upstream): artifacts sediment into the notebook — the
  // 笔记 tab wears a badge for unseen ones, a toast announces each arrival
  // once, and opening the tab marks them seen.
  const artifacts: ArtifactRow[] = (lesson?.artifacts ?? []) as ArtifactRow[]
  const [, setUnseenTick] = useState(0)
  const unseen = unseenArtifacts(lesson?.lessonId ?? '', artifacts)
  const lastAnnounced = useRef<ReadonlySet<string>>(new Set())
  useEffect(() => {
    const fresh = unseen.filter(id => !lastAnnounced.current.has(id))
    if (fresh.length === 0) return
    lastAnnounced.current = new Set([...lastAnnounced.current, ...fresh])
    showStudyToast(tr('artifact.sedimented'), { severity: 'info' })
    setUnseenTick(Date.now())
  }, [unseen.join(','), lesson?.lessonId]) // eslint-disable-line react-hooks/exhaustive-deps
  const heavy = artifacts.filter(a => a.artifactType === 'compare_table' || a.artifactType === 'diagram' || a.artifactType === 'code_walkthrough')
  const latestHeavy = heavy.length > 0 ? heavy[heavy.length - 1]! : null

  // ── 画线笔记 (P2, upstream selection flow) ─────────────────────────────
  // The popover appears on pointerup / settle (never mid-drag), hides 250ms
  // after the selection clears (a tap on the button clears first — an
  // immediate hide would swallow the click).
  const [quoteBtn, setQuoteBtn] = useState<{ x: number; y: number; text: string; surrounding: string } | null>(null)
  const recordQuotes = (lesson?.notes ?? []).filter(n => n.zone === 'record' && n.quote !== null && n.quote.trim().length >= 2).map(n => n.quote!)

  const evaluateSelection = (): void => {
    const prose = proseRef.current
    const selection = window.getSelection()
    if (prose === null || selection === null || selection.rangeCount === 0) return
    const text = selection.toString().trim()
    if (text.length < 2 || text.length > 600) return
    const range = selection.getRangeAt(0)
    if (prose.contains(range.commonAncestorContainer) !== true) return
    const model = getTextModel(prose)
    const rect = range.getBoundingClientRect()
    const box = prose.getBoundingClientRect()
    const modelText = model.text
    const idx = locateInModel(model, text, undefined)?.start ?? modelText.indexOf(text)
    const surrounding = idx >= 0 ? modelText.slice(Math.max(0, idx - 30), idx + text.length + 30) : text
    setQuoteBtn({
      x: Math.min(Math.max(rect.left - box.left + rect.width / 2, 90), Math.max(box.width - 90, 90)),
      y: rect.top - box.top - 38,
      text,
      surrounding,
    })
  }

  useEffect(() => {
    // C12: coarse pointers need a longer quiet window before the popover lands.
    const SETTLE = settleMs(typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches)
    let settleTimer: ReturnType<typeof setTimeout> | null = null
    let hideTimer: ReturnType<typeof setTimeout> | null = null
    let gesture = false
    const selectionHasText = (): boolean => (window.getSelection()?.toString().trim().length ?? 0) >= 2
    const onChange = (): void => {
      if (selectionHasText()) {
        if (hideTimer !== null) { clearTimeout(hideTimer); hideTimer = null }
        setQuoteBtn(cur => (cur === null ? cur : null))
        if (settleTimer !== null) clearTimeout(settleTimer)
        settleTimer = setTimeout(() => {
          settleTimer = null
          if (!gesture && selectionHasText()) evaluateSelection()
        }, SETTLE)
      } else if (hideTimer === null) {
        hideTimer = setTimeout(() => { setQuoteBtn(cur => (cur === null ? cur : null)) }, 250)
      }
    }
    const onDown = (e: PointerEvent): void => {
      const el = e.target as Element | null
      if (el?.closest?.('[data-lks-quote-btn]') !== null) return
      gesture = true
    }
    const onUp = (): void => {
      gesture = false
      if (settleTimer !== null) { clearTimeout(settleTimer); settleTimer = null }
      if (hideTimer === null && selectionHasText()) evaluateSelection()
    }
    document.addEventListener('selectionchange', onChange)
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onUp, true)
    return () => {
      document.removeEventListener('selectionchange', onChange)
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onUp, true)
      if (settleTimer !== null) clearTimeout(settleTimer)
      if (hideTimer !== null) clearTimeout(hideTimer)
    }
  }, [])

  // Persisted highlights: record-zone quotes anchor marks; applied after the
  // enhance pass settles (its DOM mutations change the text model).
  const [enhanceTick, setEnhanceTick] = useState(0)
  const [rateBusy, setRateBusy] = useState(false)

  const startReading = (): void => {
    if (lesson === null || lesson.speechText.trim() === '') return
    companionEvent('talk-start')
    readCtl.current?.stop()
    const sentences = speechSentencesOf(lesson.speechText)
    const voice = storedTtsVoice()
    // Edge-over-dashboard engine: per-run prefetch map (prewarm fills it, speak
    // consumes it) + a currentAudio ref so pause/resume reach real playback.
    const prefetch = new Map<string, Promise<Uint8Array>>()
    let currentAudio: HTMLAudioElement | null = null
    const fetchAudio = (text: string): Promise<Uint8Array> => {
      const hit = prefetch.get(text)
      if (hit !== undefined) { prefetch.delete(text); return hit }
      return tts(text, voice)
    }
    const edgeEngine: SpeechEngine = {
      speak(text: string): Promise<void> {
        return fetchAudio(text).then(buf => new Promise<void>((resolve, reject) => {
          const blobUrl = URL.createObjectURL(new Blob([buf], { type: 'audio/mpeg' }))
          const audio = new Audio(blobUrl)
          currentAudio = audio
          audio.onended = () => { URL.revokeObjectURL(blobUrl); if (currentAudio === audio) currentAudio = null; resolve() }
          audio.onerror = () => { URL.revokeObjectURL(blobUrl); if (currentAudio === audio) currentAudio = null; reject(new Error('audio playback failed')) }
          void audio.play().catch(reject)
        }))
      },
      pause(): void { currentAudio?.pause() },
      resume(): void { currentAudio?.play().catch(() => { /* mid-sentence resume raced the end */ }) },
      cancel(): void { currentAudio?.pause(); currentAudio = null },
      prewarm(text: string): void {
        if (!prefetch.has(text)) prefetch.set(text, tts(text, voice))
      },
    }
    // The system-voice fallback (0.13.0 dual-track): the controller's one-way
    // ratchet switches here the moment Edge synthesis fails.
    const systemEngine: SpeechEngine = {
      speak(text: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
          const synth = window.speechSynthesis
          if (synth === undefined) { reject(new Error('system speech unavailable')); return }
          const utter = new SpeechSynthesisUtterance(text)
          utter.lang = voice.startsWith('en') ? 'en-US' : 'zh-CN'
          utter.onend = () => { resolve() }
          utter.onerror = () => { reject(new Error('system speech failed')) }
          synth.speak(utter)
        })
      },
      pause(): void { window.speechSynthesis?.pause() },
      resume(): void { window.speechSynthesis?.resume() },
      cancel(): void { window.speechSynthesis?.cancel() },
    }
    const controller = new ReadAloudController(
      sentences.map(s => speakMathInSentence(s)),
      edgeEngine,
      systemEngine,
      s => setRead(s),
    )
    readCtl.current = controller
    void controller.start().catch((err: unknown) => { setReadError(err instanceof Error ? err.message : String(err)) })
  }
  const stopReading = (): void => {
    companionEvent('talk-end')
    readCtl.current?.stop()
    setRead(null)
  }

  useEffect(() => {
    if (tab !== 'cmap' || diagRef.current === null || lesson === null) return
    const el = diagRef.current
    el.textContent = ''
    const run = lesson.concepts.length === 0
      ? Promise.reject(new Error('no concepts'))
      : renderLessonConceptMap(el, lesson.title, lesson.concepts.map(c => ({ title: c.title, masteryPct: c.masteryPct })))
    run.catch((err) => {
      el.textContent = lesson.concepts.length === 0 ? tr('bb.fallback.cmap.empty') : tr('bb.fallback.cmap')
      void err
    })
  }, [tab, lesson?.lessonId, lesson?.concepts.length])

  useEffect(() => {
    if (tab !== 'teach' || proseRef.current === null || lesson === null) return
    void enhanceRendered(proseRef.current)
      .catch(() => { /* degrade */ })
      .finally(() => {
        // the highlight model must be computed post-enhance (shiki/katex/mermaid
        // mutate the DOM, changing the text model)
        applyHighlights(proseRef.current, recordQuotes)
        setEnhanceTick(Date.now())
      })
  }, [tab, lesson?.html]) // eslint-disable-line react-hooks/exhaustive-deps

  // C6: fire the queued locate once the teach prose is back in the tree.
  useEffect(() => {
    if (pendingLocate === null || tab !== 'teach' || proseRef.current === null) return
    locateNoteQuote(pendingLocate, proseRef.current)
    setPendingLocate(null)
  }, [pendingLocate, tab]) // eslint-disable-line react-hooks/exhaustive-deps

  const body: ReactNode = lesson === null
    ? createElement('div', { className: 'lks14-empty' }, tr('bb.empty'), createElement('br'), tr('bb.empty.hint'))
    : createElement('div', { className: 'lks14-notebody' },
      createElement('div', { className: 'lks14-viewtabs' },
        createElement('button', { className: `lks14-viewtab${tab === 'teach' ? ' on' : ''}`, 'aria-pressed': String(tab === 'teach'), onClick: () => { setTab('teach') } }, tr('viewtab.teach')),
        createElement('button', { className: `lks14-viewtab${tab === 'cmap' ? ' on' : ''}`, 'aria-pressed': String(tab === 'cmap'), 'data-tooltip': tr('viewtab.cmap.title'), onClick: () => { setTab('cmap') } }, createElement(IconGlobeOutline14, { size: 13 }), tr('viewtab.cmap')),
        createElement('button', {
          className: `lks14-viewtab${tab === 'notes' ? ' on' : ''}`,
          'aria-pressed': String(tab === 'notes'),
          onClick: () => {
            setTab('notes')
            if (lesson !== null && unseen.length > 0) {
              markArtifactsSeen(lesson.lessonId, unseen)
              setUnseenTick(Date.now())
            }
          },
        }, tr('bb.notes'), unseen.length > 0 ? createElement('span', { className: 'lks-viewtab-badge' }, String(unseen.length)) : null),
        createElement('button', {
          className: `lks14-viewtab${tab === 'board' ? ' on' : ''}`,
          'aria-pressed': String(tab === 'board'),
          'data-tooltip': tr('bb.board.empty'),
          onClick: () => { setTab('board') },
        }, createElement(IconMaximizeOutline16, { size: 13 }), tr('viewtab.board')),
      ),
      // B5: the lesson head sits under the tab capsule (upstream ContentTab kicker)
      tab !== 'notes'
        ? createElement('div', { className: 'lks14-lessonhead' },
          createElement('h2', null, lesson.title),
          createElement('div', { className: 'lks14-meta' },
            `${lesson.courseTitle} · ${statusTitle('study', lesson.status)}`),
        )
        : null,
      tab === 'teach'
        ? createElement('div', null,
          lesson.due ? createElement('div', { className: 'lks-ratecard', 'data-lks-rate': lesson.lessonId },
            createElement('div', { className: 'lks-ratecard-title' }, tr('review.rate.title')),
            createElement('div', { className: 'lks-ratecard-opts' },
              ...([['1', 'review.again'], ['4', 'review.remembered'], ['5', 'review.mastered']] as const).map(([q, key]) =>
                createElement('button', {
                  key: q,
                  className: `lks-ratecard-opt${q === '1' ? ' again' : q === '5' ? ' best' : ''}`,
                  disabled: rateBusy,
                  onClick: () => {
                    setRateBusy(true)
                    recordReview(lesson.lessonId, Number(q) as 1 | 4 | 5)
                      .then(() => {
                        companionEvent(Number(q) >= 4 ? 'celebrate' : 'encourage')
                        // P13: SRS 自评高光 — 记得/很熟带自评卡锚点;忘了原地柔红闪。
                        const rateEl = document.querySelector(`[data-lks-rate="${lesson.lessonId}"]`)
                        const rr = Number(q) >= 4 && rateEl !== null ? rateEl.getBoundingClientRect() : null
                        celebrate(Number(q) >= 4 ? 'correct' : 'wrong', rr !== null ? { origin: { x: rr.right - 48, y: rr.top + 24 } } : undefined)
                        showStudyToast(Number(q) >= 4 ? tr('review.done.good', { days: 1 }) : tr('review.done.again'), { severity: Number(q) >= 4 ? 'success' : 'warning' })
                        setRateBusy(false)
                      })
                      .catch((err: unknown) => {
                        setError(err instanceof Error ? err.message : String(err))
                        setRateBusy(false)
                      })
                  },
                }, tr(key)))) ,
          ) : null,
          createElement('div', { className: 'lks-readbar' },
            createElement('button', {
              className: 'lks-btn ghost',
              style: { padding: '3px 8px', fontSize: '12.5px', flex: 'none' },
              title: read !== null && read.state === 'speaking' ? tr('read.pause') : tr('read.play'),
              onClick: () => {
                if (read !== null && read.state === 'speaking') { readCtl.current?.pause(); return }
                if (read !== null && read.state === 'paused') { readCtl.current?.resume(); return }
                startReading()
              },
            }, read !== null && read.state === 'speaking' ? tr('read.pause') : tr('read.play')),
            read !== null
              ? createElement('button', {
                className: 'lks-btn ghost',
                style: { padding: '3px 8px', fontSize: '12.5px', flex: 'none' },
                'data-tooltip': tr('read.stop'),
                onClick: stopReading,
              }, tr('read.stop'))
              : null,
            read !== null && read.state !== 'idle' && lesson !== null
              ? createElement('span', { className: 'lks-readbar-cur' },
                (speechSentencesOf(lesson.speechText)[read.index] ?? '').slice(0, 80))
              : null,
            readError !== null ? createElement('span', { className: 'lks-readbar-notice' }, readError) : null,
            read !== null && read.degraded ? createElement('span', { className: 'lks-readbar-notice' }, tr('read.engine.system')) : null,
          ),
          createElement('div', { className: 'lks14-prosewrap' },
            createElement(ContentBoundary, {
              content: lesson.markdown ?? '',
              boundaryKey: `prose-${lesson.lessonId}`,
            }, createElement('div', { className: 'lks14-prose', ref: proseRef, dangerouslySetInnerHTML: { __html: lesson.html } })),
            quoteBtn !== null
              ? createElement('div', {
                  className: 'lks-quote-btn',
                  'data-lks-quote-btn': '',
                  style: { left: `${quoteBtn.x}px`, top: `${quoteBtn.y}px` },
                },
                createElement('button', {
                  onClick: () => {
                    const truncated = quoteBtn.text.length > 200 ? `${quoteBtn.text.slice(0, 200)}…` : quoteBtn.text
                    send(tr('note.quote.template', { text: truncated }))
                    setQuoteBtn(null)
                    window.getSelection()?.removeAllRanges()
                  },
                }, tr('note.quote.ask')),
                createElement('button', {
                  onClick: () => {
                    if (lesson !== null) {
                      void addUserNote(lesson.lessonId, quoteBtn.text).catch((err: unknown) => { setError(err instanceof Error ? err.message : String(err)) })
                      void applyHighlights(proseRef.current!, [quoteBtn.text])
                      showStudyToast(tr('note.saved'), { severity: 'success' })
                    }
                    setQuoteBtn(null)
                    window.getSelection()?.removeAllRanges()
                  },
                }, tr('note.quote.save')))
              : null),
          latestHeavy !== null ? createElement('div', { className: 'lks-acard-stage' },
            createElement(ArtifactCard, { artifact: latestHeavy, send: () => {} }))
            : null,
        )
        : tab === 'board'
          ? (() => {
              const heavy = artifacts.filter(a => a.artifactType === 'compare_table' || a.artifactType === 'diagram' || a.artifactType === 'code_walkthrough')
              const latest = heavy.length > 0 ? heavy[heavy.length - 1]! : null
              if (latest === null) {
                return createElement('div', { className: 'lks14-empty', style: { padding: '32px 0' } as CSSProperties }, tr('bb.board.empty'))
              }
              // P14: the board — one latest heavy artifact on the zoomable stage
              return createElement('div', { className: 'lks14-board' },
                createElement('div', { className: 'lks14-board-head' }, createElement(IconMaximizeOutline16, { size: 14 }), latest.title),
                createElement('div', { className: 'lks14-board-stage' },
                  createElement(CanvasStage, { testid: 'board-canvas-stage' },
                    createElement('div', { className: 'lks14-board-artifact' },
                      createElement(ArtifactCard, { artifact: latest, send: () => {} })))))
            })()
          : tab === 'cmap'
          ? createElement('div', { className: 'lks14-cmapwrap' },
            createElement('div', { className: 'lks14-prose', ref: diagRef }),
            createElement('button', {
              className: 'lks-acard-expand lks14-cmap-expand',
              'data-tooltip': tr('artifact.expand'),
              onClick: () => { setCmapExpanded(true) },
            }, createElement(IconMaximizeOutline16, { size: 13 })),
            cmapExpanded && lesson !== null && lesson.concepts.length > 0
              ? createElement('div', { className: 'lks-acard-modal', onClick: () => { setCmapExpanded(false) } },
                createElement('div', { className: 'lks-acard-modal-body', onClick: (e: { stopPropagation: () => void }) => { e.stopPropagation() } },
                  createElement('div', { className: 'lks-acard-modal-title' }, tr('viewtab.cmap'),
                    createElement('button', { className: 'lks-acard-expand', onClick: () => { setCmapExpanded(false) } }, createElement(IconCloseFill16, { size: 13 }))),
                  createElement(CanvasStage, { testid: 'cmap-modal-stage' },
                    createElement('div', {
                      className: 'lks14-modal-diagram',
                      ref: (el: HTMLDivElement | null) => {
                        if (el !== null) {
                          el.textContent = ''
                          void renderLessonConceptMap(el, lesson.title, lesson.concepts.map(c => ({ title: c.title, masteryPct: c.masteryPct }))).catch(() => { el.textContent = tr('bb.fallback.cmap') })
                        }
                      },
                    }))))
              : null)
          : createElement('div', { className: 'lks14-zones' },
            (() => {
              const understand = artifacts.filter(a => a.artifactType === 'compare_table' || a.artifactType === 'diagram' || a.artifactType === 'code_walkthrough')
              if (understand.length === 0) return null
              return createElement('div', { key: 'artifacts', className: 'lks14-zone' },
                createElement('div', { className: 'lks14-zoneh' }, tr('zone.artifacts')),
                ...understand.map(a => createElement(ArtifactCard, { key: a.id, artifact: a, send: () => {} })))
            })(),
            lesson.notes.length === 0
              ? createElement('div', { className: 'lks14-empty', style: { padding: '16px 0' } as CSSProperties }, tr('bb.notes.empty'))
              : ZONES.filter(([zone]) => lesson.notes.some(n => n.zone === zone)).map(([zone, labelKey]) => {
                const zoneNotes = lesson.notes.filter(n => n.zone === zone)
                  .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))
                const prevCount = zoneCounts.current[zone] ?? zoneNotes.length
                if (zoneNotes.length > prevCount && zoneOverrides[zone] !== undefined) setZoneOverrides(cur => ({ ...cur, [zone]: true }))
                zoneCounts.current[zone] = zoneNotes.length
                const open = zoneOverrides[zone] ?? true
                return createElement('div', { key: zone, className: 'lks14-zone' },
                  createElement('button', {
                    className: 'lks14-zoneh',
                    'aria-expanded': String(open),
                    onClick: () => { setZoneOverrides(cur => ({ ...cur, [zone]: !open })) },
                  },
                  tr(labelKey),
                  createElement('span', { className: 'lks14-zonecount' }, String(zoneNotes.length)),
                  createElement('span', { className: 'lks14-zonecaret' }, open ? '▾' : '▸')),
                  ...(open ? zoneNotes.map(n => createElement('div', { key: n.id, className: `lks-note${n.pinned ? ' pinned' : ''}` },
                    createElement('span', { className: 'lks-note-src' }, tr('note.src.' + n.source)),
                    createElement('button', {
                      className: 'lks-note-act',
                      title: n.pinned ? tr('note.unpin') : tr('note.pin'),
                      'aria-label': n.pinned ? tr('note.unpin') : tr('note.pin'),
                      onClick: () => { fire(pinNote(lesson.lessonId, n.id, !n.pinned)) },
                    }, createElement(IconPinFill16, { size: 12 })),
                    n.quote !== null
                      ? createElement('button', {
                        className: 'lks-note-act',
                      'data-tooltip': tr('note.locate'),
                      'aria-label': tr('note.locate'),
                      onClick: () => {
                        if (tab !== 'teach') { setTab('teach'); setPendingLocate(n.quote ?? '') }
                        else locateNoteQuote(n.quote ?? '', proseRef.current)
                      },
                      }, createElement(IconGoalOutline16, { size: 12 }))
                      : null,
                    createElement('button', {
                      className: 'lks-note-act',
                      'data-tooltip': tr('note.edit'),
                      'aria-label': tr('note.edit'),
                      onClick: () => { setEditingNote(n.id); setEditDraft(n.text) },
                    }, '✎'),
                    createElement('button', {
                      className: 'lks-note-del',
                      'data-tooltip': tr('note.delete'),
                      'aria-label': tr('note.delete'),
                      onClick: (e: { currentTarget: HTMLButtonElement; stopPropagation: () => void }) => {
                        e.stopPropagation()
                        const r = e.currentTarget.getBoundingClientRect()
                        setConfirmNoteDel({ id: n.id, rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } })
                      },
                    }, createElement(IconTrashOutline16, { size: 12 })),
                    createElement('div', { className: 'lks-note-title' }, n.title),
                    editingNote === n.id
                      ? createElement('div', { className: 'lks-note-edit' },
                        createElement('textarea', {
                          className: 'lks14-search',
                          rows: 3,
                          value: editDraft,
                          onChange: (e: { target: { value: string } }) => { setEditDraft(e.target.value) },
                        }),
                        createElement('div', { className: 'lks-confirmcard-row' },
                          createElement('button', {
                            className: 'lks-btn ghost',
                            onClick: () => { setEditingNote(null) },
                          }, tr('confirm.cancel')),
                          createElement('button', {
                            className: 'lks-btn primary',
                            disabled: editDraft.trim() === '',
                            onClick: () => { setEditingNote(null); fire(editNote(lesson.lessonId, n.id, editDraft)) },
                          }, tr('note.save'))))
                      : createElement(ContentBoundary, {
                        content: n.text,
                        boundaryKey: `note-${n.id}`,
                      }, createElement('div', { className: 'lks-note-text', dangerouslySetInnerHTML: { __html: renderMarkdown(n.text) } })),
                    n.quote !== null ? createElement('div', { className: 'lks-note-q' }, `'${n.quote}'`) : null,
                  )) : []),
                )
              }),
            ),
      )
  return createElement('div', { className: 'lks14-col lks14-note' },
    examContent !== null
      ? createElement('div', { className: 'lks14-notebody' }, examContent)
      : body,
    examContent === null && confirmNoteDel !== null
      ? createElement(ConfirmCard, {
        anchor: confirmNoteDel.rect,
        message: tr('note.delete.confirm'),
        danger: true,
        confirmLabel: tr('note.delete'),
        onConfirm: () => { const id = confirmNoteDel.id; setConfirmNoteDel(null); if (lesson !== null) fire(deleteNote(lesson.lessonId, id)) },
        onCancel: () => { setConfirmNoteDel(null) },
      })
      : null,
    createElement('div', { className: 'lks-propcard-err' }, error),
  )
}

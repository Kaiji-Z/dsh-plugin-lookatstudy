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

import { createElement, useEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import {
  IconBoltFill16, IconBookFill16, IconCrownFill16, IconDownloadOutline16,
  IconGoalOutline16, IconGlobeOutline14, IconLoadingOutline16, IconLockFill16,
  IconRefreshOutline16, IconStarFill16, IconTrashOutline16,
} from './icons.tsx'
import type { ClientContext, SessionPromptFace } from './faces.ts'
import { useStudy, storedTtsVoice } from './data.ts'
import { renderMarkdown } from '../markdown.ts'
import { enhanceRendered, setEnhanceDeps } from './enhance.ts'
import { renderLessonConceptMap } from './diagrams.ts'
import { speechSentencesOf } from '../vendor/speech-text.ts'
import { speakMathInSentence } from '../vendor/math-speech.ts'
import { feedRows } from './session-feed.ts'
import { ReadAloudController, type ReadAloudStatus, type SpeechEngine } from './readaloud.ts'
import { toastStore, type ToastItem, type ToastSeverity } from './toast.ts'
import { statusTitle, quizOptions, sectionDefaultOpen } from './views.tsx'
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

function statusIcon(kind: string, status: string): ReactNode {
  if (kind === 'exam') return createElement(IconGoalOutline16, { size: 14 })
  if (status === 'mastered') return createElement(IconCrownFill16, { size: 14 })
  if (status === 'in_progress') return createElement(IconBookFill16, { size: 14 })
  if (status === 'available') return createElement(IconStarFill16, { size: 14 })
  return createElement(IconLockFill16, { size: 14 })
}

/** Toast severity glyph (P6): the state color rides the icon, text stays ink. */
function toastIcon(severity: ToastSeverity): ReactNode {
  if (severity === 'success') return createElement(IconStarFill16, { size: 14, className: 'lks-toast-glyph ok' })
  if (severity === 'warning') return createElement(IconWarningOutline16, { size: 14, className: 'lks-toast-glyph warn' })
  if (severity === 'error') return createElement(IconWarningOutline16, { size: 14, className: 'lks-toast-glyph err' })
  if (severity === 'info') return createElement(IconGlobeOutline14, { size: 13, className: 'lks-toast-glyph info' })
  return null
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
function chatRow(row: { key: string; role: string; text: string }, interactive?: { send: PanelSend }): ReactNode {
  if (row.role === 'user') {
    return createElement('div', { key: row.key, className: 'lks14-msg lks14-msg-user' }, row.text)
  }
  const cls = row.role === 'streaming' ? 'lks14-msg lks14-msg-assistant streaming' : 'lks14-msg lks14-msg-assistant'
  const body = createElement('div', {
    key: row.key,
    className: cls,
    dangerouslySetInnerHTML: { __html: renderMarkdown(row.text) },
  })
  const options = interactive === undefined || row.role === 'streaming' ? [] : quizOptions(row.text)
  if (options.length < 2) return body
  return createElement('div', { key: row.key, className: 'lks14-turn' },
    body,
    createElement('div', { className: 'lks14-quiz', title: tr('quiz.title') },
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
  const { data, activate, setMode, setFocus, searchLessons, deleteCourse, deleteNote, bindLessonSession } = useStudy()
  const [sendError, setSendError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [rows, setRows] = useState<ReturnType<typeof feedRows>>([])
  const [feedAttached, setFeedAttached] = useState(false)
  const [draft, setDraft] = useState('')
  const lesson = data?.lesson ?? null
  const localBound = useRef<string | null>(null)
  const streamEl = useRef<HTMLDivElement | null>(null)

  const boundId = localBound.current ?? (lesson !== null ? data?.lessonSessions[lesson.lessonId] ?? null : null)

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
      const update = (): void => { setRows(feedRows(source.getSnapshot() as never)) }
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
        const result = await face.prompt([{ type: 'text', text }], 'queue')
        if (!result.ok) throw new Error(`prompt rejected: ${result.error.code}: ${result.error.message}`)
        setDraft('')
      } catch (err) {
        setSendError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    })()
  }

  const body: ReactNode = createElement('div', { className: 'lks14-body' },
    createElement(CourseRail, { data, activate, setFocus, searchLessons, deleteCourse, send }),
    createElement(ChatPane, { data, lesson, rows, feedAttached, bound: boundId !== null, busy, sendError, draft, setDraft, send, setMode }),
    createElement(NotebookPane, { data, deleteNote }),
  )
  return createElement('div', { className: 'lks14', 'data-lks-panel': '' }, body, createElement(StudyToastStack))
}

/** P6: the panel's toast stack (upstream Toast port) — severity capsules,
 * top-center, auto-dismiss with an exit-animation handshake; the store clears
 * on unmount so no toast outlives the panel. */
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
      }, '×'),
    )))
}

/** Module-level shell handle so the panel can suppress hand-back on internal opens. */
const PANEL_SHELL: { current: { suppressHandBack(fn: () => void): void } | null } = { current: null }
export function setPanelShell(shell: { suppressHandBack(fn: () => void): void } | null): void {
  PANEL_SHELL.current = shell
}

/** 左栏:course picker, tree, review box, import. */
function CourseRail({ data, activate, setFocus, searchLessons, deleteCourse, send }: {
  data: StudyData
  activate: (active: boolean) => Promise<void>
  setFocus: (id: string) => Promise<void>
  searchLessons: (query: string) => Promise<Array<{ lessonId: string; lessonTitle: string; snippet: string }>>
  deleteCourse: (courseId: string) => Promise<void>
  send: PanelSend
}): ReactNode {
  const [selectedCourse, setSelectedCourse] = useState('')
  const [query, setQuery] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reportError = (err: unknown): void => { setError(err instanceof Error ? err.message : String(err)) }
  useEffect(() => {
    if (!confirmDelete) return
    const disarm = (): void => { setConfirmDelete(false) }
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') disarm() }
    window.addEventListener('click', disarm)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', disarm)
      window.removeEventListener('keydown', onKey)
    }
  }, [confirmDelete])

  const body: ReactNode = data === null
    ? createElement('div', { className: 'lks14-empty' }, tr('loading'))
    : data.courses.length === 0
      ? createElement('div', { className: 'lks14-empty' },
        tr('rail.empty.title'), createElement('br'),
        createElement('button', {
          className: 'lks-btn primary',
          style: { margin: '10px 0' },
          onClick: () => { send(tr('prompt.import', { url: 'https://github.com/microsoft/AI-For-Beginners' })) },
        }, createElement(IconDownloadOutline16, null), tr('rail.empty.demo')),
        createElement(ImportRow, { send }),
      )
      : (() => {
        const courseId = data.courses.some(c => c.courseId === selectedCourse)
          ? selectedCourse
          : data.courses[0]!.courseId
        const course = data.courses.find(c => c.courseId === courseId)!
        return createElement('div', null,
          createElement('div', { className: 'lks14-railhead' },
            data.courses.length > 1
              ? createElement('select', {
                className: 'lks-set-select',
                value: courseId,
                onChange: (e: { target: { value: string } }) => { setSelectedCourse(e.target.value); setConfirmDelete(false) },
              }, ...data.courses.map(c => createElement('option', { key: c.courseId, value: c.courseId }, c.title)))
              : createElement('div', { className: 'lks14-railtitle', title: course.title }, course.title),
            createElement('button', {
              className: `lks-btn ${confirmDelete ? 'primary' : 'ghost'}`,
              title: confirmDelete ? tr('rail.delete.title.confirm') : tr('rail.delete'),
              onClick: (e: { stopPropagation: () => void }) => {
                e.stopPropagation()
                if (!confirmDelete) { setConfirmDelete(true); return }
                setConfirmDelete(false)
                deleteCourse(courseId).then(() => { setSelectedCourse('') }, reportError)
              },
            }, confirmDelete ? tr('rail.delete.confirm') : createElement(IconTrashOutline16, { size: 14 })),
          ),
          createElement('div', { className: 'lks14-railsub' }, tr('rail.mastered', { mastered: course.mastered, total: course.total })),
          createElement('div', {
            className: `lks14-masterybar${course.avgMasteryPct === 100 ? ' gold' : ''}`,
            title: course.avgMasteryPct === null ? tr('rail.avg.none') : tr('rail.avg', { pct: course.avgMasteryPct }),
          }, createElement('i', { style: { transform: `scaleX(${(course.avgMasteryPct ?? 0) / 100})` } })),
          createElement('input', {
            className: 'lks14-search',
            type: 'search',
            placeholder: tr('rail.search'),
            value: query,
            onChange: (e: { target: { value: string } }) => { setQuery(e.target.value) },
            onKeyDown: (e: ReactKeyboardEvent<HTMLInputElement>) => {
              if (e.key !== 'Enter' || query.trim() === '') return
              for (const section of course.sections) {
                const hit = section.lessons.find(l => l.kind !== 'exam' && l.status !== 'locked' && titleMatches(l.title, query))
                if (hit !== undefined) {
                  void setFocus(hit.id).catch(reportError)
                  return
                }
              }
              void searchLessons(query).then(hits => {
                const hit = hits.find(h => h.lessonId.startsWith(`${courseId}:`)) ?? hits[0]
                if (hit !== undefined) { setQuery(''); void setFocus(hit.lessonId).catch(reportError) }
              }).catch(reportError)
            },
          }),
          data.dueCount > 0
            ? createElement('div', { className: 'lks14-duebox' },
              createElement(IconRefreshOutline16, { size: 13 }), tr('rail.due', { count: data.dueCount }),
              ...data.due.map(d => createElement('div', { key: d.lessonId, className: 'lks14-dueitem' },
                createElement('span', null, d.lessonTitle),
                d.overdueDays > 0 ? createElement('span', { className: 'lks14-over' }, tr('rail.due.over', { days: d.overdueDays })) : null)),
              createElement('button', {
                className: 'lks-btn ghost',
                style: { marginTop: '6px' },
                onClick: () => { send(tr('prompt.review')) },
              }, tr('rail.due.start')),
            )
            : null,
          ...course.sections.flatMap(section => {
            const examAllowed = examOpen(section.lessons)
            const lessons = section.lessons.filter(l => query.trim() === '' || titleMatches(l.title, query) || l.focus)
            if (lessons.length === 0) return []
            const open = query.trim() !== '' || sectionDefaultOpen(section)
            return [
              createElement('button', {
                key: section.title,
                type: 'button',
                className: 'lks14-sechead',
                'aria-expanded': String(open),
                title: open ? tr('rail.section.collapse') : tr('rail.section.expand', { count: section.lessons.length }),
                onClick: () => { /* sections are always-open in the panel v1; the head is informational */ },
              },
              createElement('span', { className: 'lks14-secnum' }, String(section.index + 1)),
              createElement('span', { className: 'lks14-secheadt' }, section.title),
              createElement('span', { className: 'lks14-secheadc' }, open ? '▾' : '▸')),
              ...(open ? lessons.map(lesson => {
                const locked = lesson.status === 'locked' || (lesson.kind === 'exam' && !examAllowed)
                return createElement('button', {
                  key: lesson.id,
                  type: 'button',
                  className: `lks14-node${lesson.focus ? ' focus' : ''}`,
                  'aria-disabled': locked || undefined,
                  title: `${lesson.title} — ${statusTitle(lesson.kind, locked ? 'locked' : lesson.status)}`,
                  onClick: () => {
                    // Upstream alignment: selecting a lesson only FOCUSES it —
                    // the state-side attempt runs host-side, zero LLM traffic.
                    if (locked) return
                    void setFocus(lesson.id).catch(reportError)
                  },
                },
                createElement('span', { className: 'lks14-g' }, statusIcon(lesson.kind, locked ? 'locked' : lesson.status)),
                createElement('span', { className: 'lks14-t' }, lesson.title),
                lesson.weakConcepts > 0 ? createElement('span', { className: 'lks14-tag weak', title: tr('tag.weak', { count: lesson.weakConcepts }) }, createElement(IconBoltFill16, { size: 10 }), String(lesson.weakConcepts)) : null,
                lesson.masteryPct !== null
                  ? createElement('span', { className: 'lks14-bar', title: tr('tag.mastery', { pct: lesson.masteryPct }) }, createElement('i', { style: { transform: `scaleX(${lesson.masteryPct / 100})` } }))
                  : null,
                lesson.masteryPct !== null ? createElement('span', { className: 'lks14-pct' }, `${lesson.masteryPct}%`) : null,
                )
              }) : []),
            ]
          }),
          createElement('button', {
            className: 'lks-btn ghost',
            style: { marginTop: '10px' },
            onClick: () => { setShowImport(!showImport) },
          }, showImport ? tr('rail.import.close') : null, tr('rail.import.toggle')),
          showImport ? createElement(ImportRow, { send }) : null,
        )
      })()
  return createElement('div', { className: 'lks14-col lks14-rail' },
    createElement('div', { className: 'lks14-colhead' }, tr('col.rail')),
    body,
    createElement('div', { className: 'lks-propcard-err' }, error),
  )
}

function ImportRow({ send }: { send: PanelSend }): ReactNode {
  const [url, setUrl] = useState('')
  return createElement('div', { className: 'lks14-import' },
    createElement('div', { className: 'lks14-inputrow' },
      createElement('input', {
        className: 'lks14-search',
        type: 'url',
        placeholder: tr('rail.empty.placeholder'),
        value: url,
        onChange: (e: { target: { value: string } }) => { setUrl(e.target.value) },
        onKeyDown: (e: ReactKeyboardEvent<HTMLInputElement>) => {
          if (e.key === 'Enter' && url.trim() !== '') send(tr('prompt.import', { url: url.trim() }))
        },
      }),
      createElement('button', {
        className: 'lks-btn primary',
        disabled: url.trim() === '',
        onClick: () => { send(tr('prompt.import', { url: url.trim() })) },
      }, tr('rail.empty.button')),
    ),
    createElement('div', { className: 'lks14-hint' },
      tr('rail.empty.hint'), createElement('br'),
      tr('rail.empty.hint2')),
  )
}

/** 中栏:the tutor chat stream with its own composer (upstream ChatStream + ChatComposer). */
function ChatPane({ data, lesson, rows, feedAttached, bound, busy, sendError, draft, setDraft, send, setMode }: {
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
  setMode: (mode: 'direct' | 'guide' | 'practice') => Promise<void>
}): ReactNode {
  const streamEl = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = streamEl.current
    if (el !== null) el.scrollTop = el.scrollHeight
  }, [rows.length])
  const dormant = data?.active !== true
  const lastAssistant = rows.reduce((acc, row, i) => row.role === 'assistant' ? i : acc, -1)
  const [error, setError] = useState<string | null>(null)
  const fire = (action: Promise<void>): void => {
    action.then(() => { setError(null) }, (err: unknown) => { setError(err instanceof Error ? err.message : String(err)) })
  }
  const starters = lesson?.starters ?? []
  const onComposerKey = (e: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (draft.trim() !== '' && !busy) send(draft)
    }
  }
  return createElement('div', { className: 'lks14-col lks14-chat' },
    createElement('div', { className: 'lks14-colhead' },
      tr('col.tutor'),
      lesson !== null ? createElement('span', { className: 'lks14-chatlesson' }, lesson.title) : null,
      createElement('span', { className: 'lks14-pills' },
        ...MODES.map(mode => createElement('button', {
          key: mode.id,
          className: `lks14-pill${data?.mode === mode.id ? ' on' : ''}`,
          'aria-pressed': String(data?.mode === mode.id),
          'aria-disabled': dormant || undefined,
          title: dormant ? tr('tutor.dormant') : tr(mode.hintKey),
          onClick: () => { if (!dormant) fire(setMode(mode.id)) },
        }, tr(mode.labelKey))),
      ),
    ),
    createElement('div', {
      className: 'lks14-stream',
      ref: streamEl,
      'data-lks-feed': rows.length > 0 ? `rows:${String(rows.length)}` : bound ? (feedAttached ? 'attached-empty' : 'waiting') : 'no-thread',
    },
      rows.length === 0
        ? createElement('div', { className: 'lks14-empty' },
          dormant ? tr('tutor.dormant') : tr('tutor.empty'), createElement('br'), tr('tutor.empty.hint'))
        : rows.map((row, i) => chatRow(row, !dormant && i === lastAssistant ? { send } : undefined)),
    ),
    createElement('div', { className: 'lks14-starters' },
      ...starters.map(s => createElement('button', {
        key: s.label,
        className: 'lks14-starter',
        'aria-disabled': dormant || undefined,
        title: dormant ? tr('tutor.dormant') : s.message,
        onClick: () => { if (!dormant) send(s.message) },
      }, s.label)),
    ),
    createElement('div', { className: 'lks14-composer' },
      createElement('textarea', {
        className: 'lks14-composertext',
        placeholder: busy ? tr('composer.busy') : tr('tutor.empty.hint'),
        value: draft,
        rows: 2,
        disabled: dormant,
        onChange: (e: { target: { value: string } }) => { setDraft(e.target.value) },
        onKeyDown: onComposerKey,
      }),
      createElement('button', {
        className: 'lks-btn primary',
        disabled: busy || dormant || draft.trim() === '',
        onClick: () => { send(draft) },
      }, busy ? createElement(IconLoadingOutline16, { size: 13, className: 'lks-spin' }) : null, tr('composer.send')),
      ),
    sendError !== null || error !== null
      ? createElement('div', { className: 'lks-propcard-err' }, sendError ?? error)
      : null,
  )
}

/** 右栏:the notebook — 讲解/概念图/笔记 tabs (upstream NotebookPanel arrangement). */
function NotebookPane({ data, deleteNote }: { data: StudyData; deleteNote: (lessonId: string, noteId: string) => Promise<void> }): ReactNode {
  const lesson = data?.lesson ?? null
  const [tab, setTab] = useState<'teach' | 'cmap' | 'notes'>('teach')
  const [error, setError] = useState<string | null>(null)
  const [armedNote, setArmedNote] = useState<string | null>(null)
  const [read, setRead] = useState<ReadAloudStatus | null>(null)
  const readCtl = useRef<ReadAloudController | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const { tts } = useStudy()
  const proseRef = useRef<HTMLDivElement | null>(null)
  const diagRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!armedNote) return
    const disarm = (): void => { setArmedNote(null) }
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') disarm() }
    window.addEventListener('click', disarm)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', disarm)
      window.removeEventListener('keydown', onKey)
    }
  }, [armedNote])

  const fire = (action: Promise<void>): void => {
    action.then(() => { setError(null) }, (err: unknown) => { setError(err instanceof Error ? err.message : String(err)) })
  }

  const startReading = (): void => {
    if (lesson === null || lesson.speechText.trim() === '') return
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
    void enhanceRendered(proseRef.current).catch(() => { /* degrade */ })
  }, [tab, lesson?.html])

  const body: ReactNode = lesson === null
    ? createElement('div', { className: 'lks14-empty' }, tr('bb.empty'), createElement('br'), tr('bb.empty.hint'))
    : createElement('div', { className: 'lks14-notebody' },
      createElement('div', { className: 'lks14-lessonhead' },
        createElement('h2', null, lesson.title),
        createElement('div', { className: 'lks14-meta' },
          `${lesson.courseTitle} · ${statusTitle('study', lesson.status)}`
          + (lesson.masteryPct === null ? '' : ` · ${tr('bb.mastery', { pct: lesson.masteryPct })}`)),
      ),
      createElement('div', { className: 'lks14-viewtabs' },
        createElement('button', { className: `lks14-viewtab${tab === 'teach' ? ' on' : ''}`, 'aria-pressed': String(tab === 'teach'), onClick: () => { setTab('teach') } }, tr('viewtab.teach')),
        createElement('button', { className: `lks14-viewtab${tab === 'cmap' ? ' on' : ''}`, 'aria-pressed': String(tab === 'cmap'), title: tr('viewtab.cmap.title'), onClick: () => { setTab('cmap') } }, createElement(IconGlobeOutline14, { size: 13 }), tr('viewtab.cmap')),
        createElement('button', { className: `lks14-viewtab${tab === 'notes' ? ' on' : ''}`, 'aria-pressed': String(tab === 'notes'), onClick: () => { setTab('notes') } }, tr('bb.notes')),
      ),
      tab === 'teach'
        ? createElement('div', null,
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
                title: tr('read.stop'),
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
          createElement('div', { className: 'lks14-prose', ref: proseRef, dangerouslySetInnerHTML: { __html: lesson.html } }),
        )
        : tab === 'cmap'
          ? createElement('div', { className: 'lks14-prose', ref: diagRef })
          : createElement('div', { className: 'lks14-zones' },
            lesson.notes.length === 0
              ? createElement('div', { className: 'lks14-empty', style: { padding: '16px 0' } as CSSProperties }, tr('bb.notes.empty'))
              : ZONES.filter(([zone]) => lesson.notes.some(n => n.zone === zone)).map(([zone, labelKey]) =>
                createElement('div', { key: zone, className: 'lks14-zone' },
                  createElement('div', { className: 'lks14-zoneh' }, tr(labelKey)),
                  ...lesson.notes.filter(n => n.zone === zone).map(n => createElement('div', { key: n.id, className: 'lks-note' },
                    createElement('span', { className: 'lks-note-src' }, n.source),
                    createElement('button', {
                      className: `lks-note-del${armedNote === n.id ? ' armed' : ''}`,
                      title: armedNote === n.id ? tr('note.delete.confirm') : tr('note.delete'),
                      'aria-label': armedNote === n.id ? tr('note.delete.confirm') : tr('note.delete'),
                      onClick: (e: { stopPropagation: () => void }) => {
                        e.stopPropagation()
                        if (armedNote !== n.id) { setArmedNote(n.id); return }
                        setArmedNote(null)
                        fire(deleteNote(lesson.lessonId, n.id))
                      },
                    }, createElement(IconTrashOutline16, { size: 12 })),
                    createElement('div', { className: 'lks-note-title' }, n.title),
                    createElement('div', { className: 'lks-note-text', dangerouslySetInnerHTML: { __html: renderMarkdown(n.text) } }),
                    n.quote !== null ? createElement('div', { className: 'lks-note-q' }, `“${n.quote}”`) : null,
                  )),
                )),
            ),
      )
  return createElement('div', { className: 'lks14-col lks14-note' },
    createElement('div', { className: 'lks14-colhead' }, tr('col.bb')),
    body,
    createElement('div', { className: 'lks-propcard-err' }, error),
  )
}

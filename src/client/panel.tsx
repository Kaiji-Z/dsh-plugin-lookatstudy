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
  IconRefreshOutline16, IconStarFill16, IconTrashOutline16, IconWarningOutline16,
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
import { QuizCard, type QuizData } from './quizcard.tsx'
import { ArtifactCard, markArtifactsSeen, unseenArtifacts, type ArtifactRow } from './artifact-cards.tsx'
import { showStudyToast } from './toast.ts'
import { Companion, useCompanionMood } from './companion.tsx'
import { applyHighlights, getTextModel, locateInModel } from './highlights.ts'
import { statusTitle, quizOptions, sectionDefaultOpen, mergeRailSearch, effectiveOpen, pickNarrowPane } from './views.tsx'
import { MapSectionView, pickSky } from './maprail.tsx'
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
  const [narrowPane, setNarrowPane] = useState<'rail' | 'chat' | 'note'>(pickNarrowPane(null))
  const lesson = data?.lesson ?? null
  const localBound = useRef<string | null>(null)
  const streamEl = useRef<HTMLDivElement | null>(null)

  const boundId = localBound.current ?? (lesson !== null ? data?.lessonSessions[lesson.lessonId] ?? null : null)

  // The review nudge (upstream review.nudge): due reviews pull the learner
  // back — one toast per panel open, never repeated while it stays open.
  const nudged = useRef(false)
  useEffect(() => {
    if (nudged.current || (data?.dueCount ?? 0) === 0) return
    nudged.current = true
    showStudyToast(tr('review.nudge', { n: data!.dueCount }), { severity: 'warning', action: { label: tr('review.nudge.go'), onClick: () => {
      const first = data?.due[0]
      if (first !== undefined) void setFocus(first.lessonId).catch(() => { /* the poll will resync */ })
    } } })
  }, [data?.dueCount, data?.due, setFocus])

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

  const companion = useCompanionMood()
  const setCompanionEvent = companion.emit
  const progress = data?.progress ?? null
  // The upstream v0.6 ladder: rail full-height on surface-rail; the right half
  // = floating app-header + the chat/notebook row (chat surface-1, notebook
  // surface-2) — depth by color step, no borders.
  const body: ReactNode = createElement('div', { className: 'lks14-body', 'data-pane': narrowPane },
    createElement(CourseRail, { data, activate, setFocus, searchLessons, deleteCourse, send }),
    createElement('div', { className: 'lks14-righthalf' },
      createElement('div', { className: 'lks14-appheader' },
        createElement('span', { className: 'lks-hdr-title' }, lesson?.courseTitle ?? tr('tab.label')),
        createElement('span', { className: 'lks-hdr-xp', title: tr('header.xp', { xp: progress?.totalXp ?? 0 }) },
          createElement('span', { className: 'lks-hdr-stat' }, '\u26a1'),
          createElement('span', { className: 'lks-hdr-xpbar' }, createElement('i', { style: { width: `${Math.min(100, progress?.levelPct ?? 0)}%` } }))),
        createElement('span', { className: 'lks-hdr-stat lks-hdr-streak', title: tr('header.streak') }, '\ud83d\udd25', String(progress?.streak ?? 0)),
        createElement('span', { className: 'lks-hdr-stat', title: tr('header.level') }, `Lv${String(progress?.level ?? 1)}`),
      ),
      createElement('div', { className: 'lks14-row' },
        createElement(ChatPane, { data, lesson, rows, feedAttached, bound: boundId !== null, busy, sendError, draft, setDraft, send, setMode, narrowPane, companionEvent: setCompanionEvent }),
        createElement(NotebookPane, { data, deleteNote, send, companionEvent: setCompanionEvent }),
      ),
    ),
  )
  return createElement('div', { className: 'lks14 lks-ui', 'data-lks-panel': '' },
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
    body, createElement(StudyToastStack))
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
  const [searchRows, setSearchRows] = useState<ReturnType<typeof mergeRailSearch>>([])
  const [sectionOverrides, setSectionOverrides] = useState<Record<string, boolean>>({})
  const toggleSection = (title: string, next: boolean): void => {
    setSectionOverrides(cur => ({ ...cur, [title]: next }))
  }
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
        return createElement('div', { className: `lks-map lks-sky-${pickSky(courseId)}` },
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
              if (e.key === 'Escape') { setQuery(''); setSearchRows([]) }
              if (e.key !== 'Enter' || query.trim() === '') return
              const first = searchRows[0]
              if (first !== undefined) {
                setQuery('')
                setSearchRows([])
                void setFocus(first.lessonId).catch(reportError)
              }
            },
          }),
          searchRows.length > 0
            ? createElement('div', { className: 'lks14-searchpanel' },
              ...searchRows.map(row => createElement('button', {
                key: row.lessonId,
                className: 'lks14-searchrow',
                title: tr('rail.search.jump'),
                onClick: () => {
                  setQuery('')
                  setSearchRows([])
                  void setFocus(row.lessonId).catch(reportError)
                },
              },
                createElement('span', { className: 'lks14-searchrow-title' }, row.title),
                row.courseTitle !== '' ? createElement('span', { className: 'lks14-searchrow-course' }, row.courseTitle) : null,
                row.snippet !== '' ? createElement('span', { className: 'lks14-searchrow-snip' }, row.snippet) : null)))
            : null,
          data.dueCount > 0
            ? createElement('div', { className: 'lks14-duebox' },
              createElement(IconRefreshOutline16, { size: 13 }), tr('rail.due', { count: data.dueCount }),
              ...data.due.map(d => createElement('button', {
                key: d.lessonId,
                className: 'lks14-dueitem',
                title: tr('review.jump'),
                onClick: () => { void setFocus(d.lessonId).catch(reportError) },
              },
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
            const open = query.trim() !== '' || effectiveOpen(section.title, sectionDefaultOpen(section), sectionOverrides)
            return [createElement(MapSectionView, {
              key: section.title,
              section: { title: section.title, index: section.index, lessons },
              examAllowed,
              open,
              onToggle: () => { toggleSection(section.title, !open) },
              // Upstream alignment: tapping a bubble only FOCUSES the lesson —
              // the state-side attempt runs host-side, zero LLM traffic.
              onJump: (id: string) => { void setFocus(id).catch(reportError) },
            })]
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
function ChatPane({ data, lesson, rows, feedAttached, bound, busy, sendError, draft, setDraft, send, setMode, narrowPane, companionEvent }: {
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
  narrowPane: 'rail' | 'chat' | 'note'
  companionEvent: (event: 'talk-start' | 'talk-end' | 'celebrate' | 'encourage' | 'decay' | 'poke') => void
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
  const proposal = data?.pendingProposals[0] ?? null
  return createElement('div', { className: 'lks14-col lks14-chat' },
    proposal !== null
      ? createElement('div', { className: 'lks-propbanner' },
          createElement(IconCrownFill16, { size: 14 }),
          createElement('span', { className: 'lks-propbanner-why' },
            tr('proposal.banner', { lesson: proposal.lessonTitle }), ' — ', proposal.rationale),
          createElement('button', {
            className: 'lks-btn primary',
            style: { padding: '4px 12px', fontSize: '12.5px' },
            onClick: () => { send(tr('proposal.accept.msg', { lesson: proposal.lessonTitle })) },
          }, tr('proposal.accept')),
          createElement('button', {
            className: 'lks-btn ghost',
            style: { padding: '4px 12px', fontSize: '12.5px' },
            onClick: () => { send(tr('proposal.decline.msg', { lesson: proposal.lessonTitle })) },
          }, tr('proposal.decline')))
      : null,
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
      rows.length > 0 && rows[rows.length - 1]!.role === 'user'
        ? createElement('div', { className: 'lks14-thinking' }, createElement('i', null), createElement('i', null), createElement('i', null))
        : null,
    ),
    ...(lesson?.artifacts ?? [])
      .filter(a => a.artifactType === 'quiz')
      .map(a => createElement(QuizCard, {
        key: a.id,
        lessonId: lesson.lessonId,
        artifactId: a.id,
        data: a.data as unknown as QuizData,
        masteryPct: lesson.masteryPct,
        send,
        onFinished: (allCorrect: boolean) => { companionEvent(allCorrect ? 'celebrate' : 'encourage') },
      })),
    ...(lesson?.artifacts ?? [])
      .filter(a => a.artifactType !== 'quiz')
      .map(a => createElement(ArtifactCard, { key: a.id, artifact: a as ArtifactRow, send })),
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
      createElement('div', { className: 'lks14-composer-card' },
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
          className: 'lks-btn-send',
          'aria-label': tr('composer.send'),
          disabled: busy || dormant || draft.trim() === '',
          onClick: () => { send(draft) },
        }, busy ? createElement(IconLoadingOutline16, { size: 16, className: 'lks-spin' }) : '↑'),
      ),
    sendError !== null || error !== null
      ? createElement('div', { className: 'lks-propcard-err' }, sendError ?? error)
      : null,
    ),
  )
}

/** 右栏:the notebook — 讲解/概念图/笔记 tabs (upstream NotebookPanel arrangement). */
function NotebookPane({ data, deleteNote, send, companionEvent }: { data: StudyData; deleteNote: (lessonId: string, noteId: string) => Promise<void>; send: PanelSend; companionEvent: (event: 'talk-start' | 'talk-end' | 'celebrate' | 'encourage' | 'decay' | 'poke') => void }): ReactNode {
  const lesson = data?.lesson ?? null
  const [tab, setTab] = useState<'teach' | 'cmap' | 'notes'>('teach')
  const [error, setError] = useState<string | null>(null)
  const [armedNote, setArmedNote] = useState<string | null>(null)
  const [read, setRead] = useState<ReadAloudStatus | null>(null)
  const readCtl = useRef<ReadAloudController | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const { tts, addUserNote, recordReview } = useStudy()
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
    const SETTLE = 250
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
      ),
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
          createElement('div', { className: 'lks14-prosewrap' },
            createElement('div', { className: 'lks14-prose', ref: proseRef, dangerouslySetInnerHTML: { __html: lesson.html } }),
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
        : tab === 'cmap'
          ? createElement('div', { className: 'lks14-prose', ref: diagRef })
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

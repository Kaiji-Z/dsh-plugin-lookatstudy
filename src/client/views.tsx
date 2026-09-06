/**
 * The study tab: one `conversation.view` entry rendering the whole plugin —
 * a simplified LookatStudy inside dsh, three columns in the tab. Left: the
 * course map (selector, tree, due box, one-click demo import). Middle: the
 * tutor conversation — a read-only transcript folded from the session
 * snapshot (user text, assistant text rendered through the plugin's own
 * markdown pipeline; tool calls stay in the host conversation's toolview
 * cards — a mirrored second record diverged) plus the soul pills, starters,
 * pending proposal banner, and a reverse-channel input. Right: the blackboard —
 * focus-lesson 讲解 and the Cornell 笔记 zones. Nothing outside this tab
 * touches dsh chrome.
 * @module dsh-plugin-lookatstudy/client/views
 */

import { createElement, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import {
  IconBoltFill16, IconBookFill16, IconCrownFill16, IconFlameFill16, IconGlobeOutline14,
  IconGoalOutline16, IconLockFill16, IconPinFill16, IconPlayOutline16, IconPlusOutline16,
  IconPowerFill16, IconRefreshOutline16, IconStarFill16, IconTrashOutline16,
  IconDownloadOutline16, IconLoadingOutline16, IconWarningOutline16,
} from './icons.tsx'
import type { ClientContext, SessionMachineSnapshot, StudyViewProps, TranscriptNode, TranscriptPartial, TranscriptSlice } from './faces.ts'
import { useStudy, storedTtsVoice } from './data.ts'
import { renderMarkdown } from '../markdown.ts'
import { enhanceRendered, setEnhanceDeps } from './enhance.ts'
import { renderLessonConceptMap } from './diagrams.ts'
import { speechSentencesOf } from '../vendor/speech-text.ts'
import { speakMathInSentence } from '../vendor/math-speech.ts'
import { ReadAloudController, type ReadAloudStatus, type SpeechEngine } from './readaloud.ts'
import { tr, type StudyT } from './locale.ts'

/** The three souls, in pill order (labels from LookatStudy's mode switcher). */
const MODES: ReadonlyArray<{ id: 'direct' | 'guide' | 'practice'; labelKey: string; hintKey: string }> = [
  { id: 'direct', labelKey: 'soul.direct', hintKey: 'soul.direct.hint' },
  { id: 'guide', labelKey: 'soul.guide', hintKey: 'soul.guide.hint' },
  { id: 'practice', labelKey: 'soul.practice', hintKey: 'soul.practice.hint' },
]

/** Zone keys for the Cornell notebook (understand / record / practice). */
const ZONES: ReadonlyArray<readonly [string, string]> = [
  ['understand', 'zone.understand'],
  ['record', 'zone.record'],
  ['practice', 'zone.practice'],
]

/** Status icon for one lesson row (LookatStudy's map icon semantics, SVG glyphs). */
function statusIcon(kind: string, status: string): ReactNode {
  if (kind === 'exam') return createElement(IconGoalOutline16, { size: 14 })
  if (status === 'mastered') return createElement(IconCrownFill16, { size: 14 })
  if (status === 'in_progress') return createElement(IconBookFill16, { size: 14 })
  if (status === 'available') return createElement(IconStarFill16, { size: 14 })
  return createElement(IconLockFill16, { size: 14 })
}

/** LookatStudy's exam gate: an exam node opens only when every sibling study lesson reached mastery ≥50%. */
function examOpen(lessons: ReadonlyArray<{ kind: string; masteryPct: number | null }>): boolean {
  return lessons.every(l => l.kind !== 'study' || (l.masteryPct ?? 0) >= 50)
}

/** Multi-keyword AND title filter (LookatStudy course-tree-filter). */
function titleMatches(title: string, query: string): boolean {
  const keys = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return keys.every(k => title.toLowerCase().includes(k))
}

/**
 * Default expansion for one rail section: collapsed when every study lesson is
 * done (mastered) or not yet reachable (locked) — long courses otherwise scroll
 * 5× their viewport. The active frontier and the focus lesson's section stay
 * open; exam nodes never force a section open (they are gated separately).
 * Pure.
 * @param section - one course section projection with lesson kinds/statuses.
 */
export function sectionDefaultOpen(section: { lessons: ReadonlyArray<{ kind: string; status: string; focus: boolean }> }): boolean {
  return section.lessons.some(l => l.focus || (l.kind !== 'exam' && l.status !== 'mastered' && l.status !== 'locked'))
}

/** The rail's import row: a GitHub URL input plus the paste/folder hints. */
function ImportRow({ send }: { send: StudySend }): ReactNode {
  const [url, setUrl] = useState('')
  return createElement('div', { className: 'lks-import' },
    createElement('div', { className: 'lks-inputrow' },
      createElement('input', {
        className: 'lks-input',
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
    createElement('div', { className: 'lks-import-hint' },
      tr('rail.empty.hint'), createElement('br'),
      tr('rail.empty.hint2')),
  )
}

/** One rendered transcript row (pure fold of the conversation snapshot). */
export interface ChatRow {
  readonly key: string
  readonly role: 'user' | 'assistant' | 'error' | 'streaming' | 'thinking'
  readonly text: string
}

/**
 * Tooltip text for one course-tree status glyph. Pure (the translator is an
 * optional parameter defaulting to the active one, evaluated per call).
 * @param kind - lesson kind ('study' | 'practice' | 'exam').
 * @param status - lesson status ('locked' | 'available' | 'in_progress' | 'mastered').
 * @param t - translator (defaults to the module's active translator).
 */
export function statusTitle(kind: string, status: string, t: StudyT = tr): string {
  if (kind === 'exam') return t('status.exam')
  switch (status) {
    case 'mastered': return t('status.mastered')
    case 'in_progress': return t('status.in_progress')
    case 'available': return t('status.available')
    default: return t('status.locked')
  }
}

/**
 * Extract the last quiz option block (2–4 consecutive `A. …` `B. …` lines,
 * letters strictly consecutive from A) from an assistant reply — the raw text
 * of the tutor's question becomes the clickable answer surface. Pure.
 * @param text - one assistant reply's markdown.
 * @returns the options of the last valid block, or [] when none.
 */
export function quizOptions(text: string): ReadonlyArray<{ letter: string; text: string }> {
  const runs: Array<Array<{ letter: string; text: string }>> = []
  let run: Array<{ letter: string; text: string }> = []
  const flush = (): void => {
    if (run.length >= 2) runs.push(run)
    run = []
  }
  for (const line of text.split('\n')) {
    const match = /^([A-D])[.、:)]\s+(.+)$/.exec(line.trim())
    if (match === null) {
      flush()
      continue
    }
    const nextLetter = run.length === 0 ? 'A' : String.fromCharCode(run[run.length - 1]!.letter.charCodeAt(0) + 1)
    if (match[1] === nextLetter) run.push({ letter: match[1], text: match[2]! })
    else {
      flush()
      if (match[1] === 'A') run.push({ letter: match[1], text: match[2]! })
    }
  }
  flush()
  return runs.at(-1) ?? []
}

function textOf(blocks: readonly { type: string; text?: string }[] | undefined): string {
  return (blocks ?? []).filter(b => b.type === 'text').map(b => b.text ?? '').join('\n\n').trim()
}

function assistantText(blocks: readonly { kind: string; text?: string }[] | undefined): string {
  return (blocks ?? []).filter(b => b.kind === 'text').map(b => b.text ?? '').join('\n\n').trim()
}

/**
 * Fold conversation nodes (plus the streaming partial) into render rows.
 * Tool results are skipped: the host conversation renders the rich
 * `tool.call.toolview` cards, and the tutor column stays a pure persona
 * surface (a transcript mirror there grew a second, diverging record).
 * Both inputs tolerate undefined: newer hosts (DSH v0.1.2-alpha.4) mount
 * the conversation view before session data exists, and the fold must
 * degrade to an empty transcript instead of blanking the whole tab.
 * @param nodes - finalized conversation nodes from the snapshot.
 * @param partial - the in-flight assistant partial, or null.
 * @param t - translator (defaults to the active one, per call).
 * @returns ordered rows; never mutates its inputs.
 */
export function transcriptRows(nodes: readonly TranscriptNode[] | undefined, partial: TranscriptPartial | null | undefined, t: StudyT = tr): readonly ChatRow[] {
  const rows: ChatRow[] = []
  for (const node of nodes ?? []) {
    switch (node.kind) {
      case 'user':
      case 'steering': {
        const text = textOf(node.content)
        if (text !== '') rows.push({ key: `u${node.seq}`, role: 'user', text })
        break
      }
      case 'assistant': {
        const text = assistantText(node.blocks)
        if (text !== '') rows.push({ key: `a${node.seq}`, role: 'assistant', text })
        break
      }
      case 'turn-error':
        rows.push({ key: `e${node.seq}`, role: 'error', text: node.message ?? '' })
        break
      default:
        break
    }
  }
  if (partial != null) {
    const text = assistantText(partial.blocks)
    if (text !== '') rows.push({ key: 'streaming', role: 'streaming', text })
    // No text yet means the tutor is reasoning (or lining up tool calls) —
    // without this row the column sits dead silent through the whole phase.
    else rows.push({ key: 'thinking', role: 'thinking', text: t('row.thinking') })
  }
  return rows
}

/** Small inline error surface for failed write actions (shared with the settings page). */
export function ActionError({ error }: { error: string | null }): ReactNode {
  if (error === null) return null
  return createElement('div', { className: 'lks-propcard-err' }, error)
}

/**
 * Land one message in the dsh composer and submit it — the same path as the
 * Send button, so button text is visible in the native input for a beat and
 * then goes through the full submission pipeline (no reverse channel).
 */
export type StudySend = (text: string) => void

/**
 * Resolve the transcript across host generations. 0.1.3+ hosts expose the
 * node array as the Chat target's `legacy` slice; pre-0.1.3 hosts hand the
 * whole conversation snapshot (nodes + partial) through `useSession`, whose
 * 0.1.3+ successor returns the session MACHINE (no node array). The array
 * check tells those two `useSession` shapes apart. Pure.
 */
export function pickTranscript(
  chatLegacy: TranscriptSlice | undefined,
  sessionSnapshot: (TranscriptSlice & SessionMachineSnapshot) | undefined,
): TranscriptSlice | undefined {
  if (chatLegacy !== undefined) return chatLegacy
  return sessionSnapshot !== undefined && Array.isArray(sessionSnapshot.nodes) ? sessionSnapshot : undefined
}

/** Narrow-mode pane selector: which of the three columns is the main display. */
type StudyPane = 'rail' | 'tutor' | 'bb'

/** sessionStorage key keeping the narrow-mode pane across view remounts (tab switches) and reloads. */
const PANE_KEY = 'dsh-plugin-lookatstudy:pane'

/** Narrow the stored value back to a pane id; anything else (or nothing stored) falls back to 导师. Pure, unit-testable. */
export function pickPane(stored: string | null): StudyPane {
  return stored === 'rail' || stored === 'tutor' || stored === 'bb' ? stored : 'tutor'
}

/** Read the persisted pane; the try swallows only the SecurityError privacy modes throw on storage access — the fallback is the default pane. */
function storedPane(): StudyPane {
  try {
    return pickPane(sessionStorage.getItem(PANE_KEY))
  } catch {
    return 'tutor'
  }
}

/**
 * The framework's branded `SessionId`, minted locally (structural twin of the
 * brand — session ids are plain strings on the wire; the brand exists to keep
 * opaque ids out of string APIs). Replaces the former `as never` casts.
 */
type SessionId = string & { readonly __sessionBrand: 'SessionId' }
const sessionId = (id: string): SessionId => id as SessionId

/** The whole study tab. Wide = three columns (课程 | 导师 | 黑板); narrow (<1220px) = one composer-width pane with a three-way switcher. */
export function studyView(ctx: ClientContext): (props: StudyViewProps) => ReactNode {
  return function StudyView(props: StudyViewProps): ReactNode {
    return createElement(StudyTab, { ...props, ctx, key: 'tab' })
  }
}

/** Tab body: the factory-bound ctx carries workspaces/sessions for the per-lesson session jumps. */
function StudyTab({ inputActions, ctx, ...standard }: StudyViewProps & { ctx: ClientContext }): ReactNode {
  const { data, activate, setMode, setFocus, searchLessons, deleteCourse, deleteNote, bindLessonSession } = useStudy()
  // The transcript moved twice across host generations (see pickTranscript).
  // Both hooks are version-stable, so the optional calls keep hook order
  // constant on any given host.
  const chatLegacy = standard.useChat?.((s) => s.legacy)
  const sessionSnapshot = standard.useSession?.((s) => s)
  const snapshot: TranscriptSlice | undefined = pickTranscript(chatLegacy, sessionSnapshot)
  // Newer hosts (DSH v0.1.2-alpha.4) mount the tab before session data
  // exists, so every read off this value guards for undefined.
  const currentSessionId = standard.sessionId ?? snapshot?.sessionId ?? ''
  const [pane, setPane] = useState<StudyPane>(storedPane)
  const rootRef = useRef<HTMLDivElement | null>(null)
  // The wide layout puts the tutor column left of the scroll body's center
  // (fixed rail + flexible blackboard), so the floating composer would sit
  // mid-screen under nothing. While this view is mounted and measurable, shift
  // the host composer card ([data-composer-card], a stable host anchor) under
  // the tutor column; any collapsed shift (narrow single-pane mode, hidden
  // view, no room) removes the class and restores the host's natural
  // centering. ResizeObserver on the study root catches mount/show/hide/resize.
  useEffect(() => {
    const root = rootRef.current
    const card = document.querySelector<HTMLElement>('[data-composer-card]')
    const seat = card?.parentElement ?? null
    if (root === null || card === null || seat === null) return
    const clear = (): void => {
      card.classList.remove('lks-composer-follow')
      card.style.removeProperty('--lks-composer-shift')
      card.style.removeProperty('--lks-composer-follow-width')
    }
    const apply = (): void => {
      const tutor = root.querySelector<HTMLElement>('.lks-col-tutor')
      const rail = root.querySelector<HTMLElement>('.lks-col-rail')
      if (tutor === null || rail === null || getComputedStyle(rail).display === 'none') return clear()
      const seatRect = seat.getBoundingClientRect()
      const tutorRect = tutor.getBoundingClientRect()
      if (seatRect.width === 0 || tutorRect.width === 0) return clear()
      const pad = parseFloat(getComputedStyle(seat).paddingLeft) || 0
      const cardW = card.getBoundingClientRect().width
      const max = seatRect.width - 2 * pad - cardW
      const shift = Math.round(Math.max(0, Math.min(tutorRect.left - (seatRect.left + pad), max)))
      if (shift < 2) return clear()
      card.style.setProperty('--lks-composer-shift', `${shift}px`)
      // The tutor column shrinks proportionally below ~1857px containers
      // (42cqi cap) — the docked composer card tracks that live width so the
      // card never overhangs the transcript column it sits under.
      card.style.setProperty('--lks-composer-follow-width', `${Math.round(tutorRect.width)}px`)
      card.classList.add('lks-composer-follow')
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(root)
    ro.observe(seat)
    window.addEventListener('resize', apply)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', apply)
      clear()
    }
  }, [])
  const send: StudySend = (text) => {
    void (async () => {
      // Dormant installs activate first: the host registers the study tools
      // before the activation POST resolves, so the prompt meets a model that
      // can already call them.
      if (data?.active !== true) await activate(true)
      inputActions.setDraft(text)
      inputActions.submit()
    })()
  }
  // The bound translator reads the active locale at call time; a locale
  // switch must re-render to pick the new strings (the framework `t` seat
  // does this for slot entries — the deep component tree rides this bump).
  const [, bumpLocale] = useState(0)
  useEffect(() => {
    const localeSvc = ctx.locale
    if (localeSvc === undefined) return
    return localeSvc.subscribe(() => { bumpLocale(v => v + 1) })
  }, [ctx])
  const panes: ReadonlyArray<{ id: StudyPane; labelKey: string }> = [
    { id: 'rail', labelKey: 'pane.rail' },
    { id: 'tutor', labelKey: 'pane.tutor' },
    { id: 'bb', labelKey: 'pane.bb' },
  ]
  return createElement('div', {
    ref: rootRef,
    className: 'lks-root lks-study',
    'data-conversation-composer-overlay': '',
    'data-pane': pane,
  },
  // Always-visible activation bar: the tab is the fallback entry when another
  // plugin's composer takeover hides the starter pill.
  createElement('div', { className: 'lks-actbar' },
    data === null ? null : createElement('button', {
      className: `lks-btn ${data.active ? 'ghost' : 'primary'}`,
      title: data.active ? tr('active.on.title') : tr('active.off.title'),
      onClick: () => { void activate(!data.active) },
    }, data.active ? createElement(IconPowerFill16, { size: 13 }) : createElement(IconPlayOutline16, { size: 13 }), data.active ? tr('active.on') : tr('active.off')),
  ),
  // .lks-body carries the row/column direction so the container query can
  // flip it — a container query cannot style the container element itself.
  createElement('div', { className: 'lks-body' },
    createElement('div', { className: 'lks-switch' },
      ...panes.map(p => createElement('button', {
        key: p.id,
        className: `lks-switch-btn${pane === p.id ? ' on' : ''}`,
        'aria-pressed': String(pane === p.id),
        onClick: () => {
        setPane(p.id)
        try {
          sessionStorage.setItem(PANE_KEY, p.id)
        } catch {
          // Privacy modes forbid storage writes; the in-memory choice still holds this page.
        }
      },
      }, tr(p.labelKey))),
    ),
    createElement(CourseRail, { data, activate, setFocus, searchLessons, deleteCourse, bindLessonSession, send, ctx, currentSessionId }),
    createElement(TutorColumn, { data, setMode, send, snapshot }),
    createElement(BlackboardColumn, { data, deleteNote }),
  ),
  )
}

type StudyData = ReturnType<typeof useStudy>['data']

/** Left column: course management (pick/delete/search/import), lesson tree, due box. */
function CourseRail({ data, activate, setFocus, searchLessons, deleteCourse, bindLessonSession, send, ctx, currentSessionId }: {
  data: StudyData
  activate: (active: boolean) => Promise<void>
  setFocus: (id: string) => Promise<void>
  searchLessons: (query: string) => Promise<Array<{ lessonId: string; lessonTitle: string; snippet: string }>>
  deleteCourse: (courseId: string) => Promise<void>
  bindLessonSession: (lessonId: string, sessionId: string) => Promise<void>
  send: StudySend
  ctx: ClientContext
  currentSessionId: string
}): ReactNode {
  const [jumping, setJumping] = useState<string | null>(null)
  /** Open (or mint) the lesson's own session — the simplified thread system. */
  const openLessonThread = (lesson: { id: string; title: string }): void => {
    if (jumping !== null) return
    const mapped = data?.lessonSessions[lesson.id]
    if (mapped === currentSessionId) {
      void setFocus(lesson.id).catch(reportError)
      return
    }
    if (mapped !== undefined && ctx.sessions.binding(sessionId(mapped)) !== undefined) {
      void setFocus(lesson.id).catch(reportError)
      ctx.sessions.open(sessionId(mapped))
      return
    }
    setJumping(lesson.id)
    void setFocus(lesson.id).then(() => (async () => {
      // Minting a lesson session prompts directly (not through `send`), so
      // activation happens here too — same dormant-install guarantee.
      if (data?.active !== true) await activate(true)
      const area = await fetch('/lookatstudy/api/study-workspace')
      if (!area.ok) throw new Error(`study area unavailable (HTTP ${area.status})`)
      const { path } = await area.json() as { path: string }
      const workspace = await ctx.workspaces.create({ path })
      // 0.1.3 moved the session mint from workspaces.connectWorkspace to
      // sessions.create (same dual-host detect as the starter). Each lesson
      // gets its own thread: a fresh blank session per lesson node.
      const sessionId = ctx.workspaces.connectWorkspace !== undefined
        ? await ctx.workspaces.connectWorkspace(workspace.workspaceId)
        : await ctx.sessions.create({ workspaceId: workspace.workspaceId })
      const actx = ctx.sessions.scope(sessionId)
      const face = actx === undefined ? undefined : ctx.sessions.sessionOf(actx)
      if (face === undefined) throw new Error('lesson session is not addressable yet')
      const result = await face.prompt([{ type: 'text', text: tr('prompt.lesson', { title: lesson.title }) }], 'queue')
      if (!result.ok) throw new Error(`lesson prompt rejected: ${result.error.code}: ${result.error.message}`)
      await bindLessonSession(lesson.id, sessionId)
      ctx.sessions.open(sessionId)
    })()).then(
      () => { setJumping(null) },
      (err: unknown) => { reportError(err); setJumping(null) },
    )
  }
  const [selectedCourse, setSelectedCourse] = useState('')
  const [query, setQuery] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  // An armed delete disarms on outside click or Escape — a stray second
  // click anywhere else must not be able to confirm destruction.
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
  const [showImport, setShowImport] = useState(false)
  /** Per-section open overrides (courseId/sectionTitle → open?), on top of the frontier default. */
  const [secOpen, setSecOpen] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)
  const reportError = (err: unknown): void => { setError(err instanceof Error ? err.message : String(err)) }
  const body: ReactNode = data === null
    ? createElement('div', { className: 'lks-empty' }, tr('loading'))
    : data.courses.length === 0
      ? createElement('div', { className: 'lks-empty' },
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
          createElement('div', { className: 'lks-rail-head' },
            data.courses.length > 1
              ? createElement('select', {
                className: 'lks-rail-select',
                value: courseId,
                onChange: (e: { target: { value: string } }) => { setSelectedCourse(e.target.value); setConfirmDelete(false) },
              }, ...data.courses.map(c => createElement('option', { key: c.courseId, value: c.courseId }, c.title)))
              : createElement('div', { className: 'lks-rail-title', title: course.title }, course.title),
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
          createElement('div', { className: 'lks-rail-sub' }, tr('rail.mastered', { mastered: course.mastered, total: course.total })),
          createElement('div', {
            className: `lks-masterybar${course.avgMasteryPct === 100 ? ' gold' : ''}`,
            title: course.avgMasteryPct === null ? tr('rail.avg.none') : tr('rail.avg', { pct: course.avgMasteryPct }),
          }, createElement('i', { style: { transform: `scaleX(${(course.avgMasteryPct ?? 0) / 100})` } })),
          createElement('input', {
            className: 'lks-search',
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
              // No title hit → full-text over lesson bodies (host-side search)
              void searchLessons(query).then(hits => {
                const hit = hits.find(h => h.lessonId.startsWith(`${courseId}:`)) ?? hits[0]
                if (hit !== undefined) { setQuery(''); void setFocus(hit.lessonId).catch(reportError) }
              }).catch(reportError)
            },
          }),
          course.sections.some(s => s.lessons.some(l => l.focus))
            ? createElement('button', {
              className: 'lks-btn ghost',
              style: { margin: '0 0 6px', padding: '3px 8px', fontSize: '13px' },
              title: tr('rail.locate.title'),
              onClick: () => {
                const focusSection = course.sections.find(s => s.lessons.some(l => l.focus))
                if (focusSection === undefined) return
                setSecOpen(m => ({ ...m, [`${courseId}/${focusSection.title}`]: true }))
                // One frame past the React commit, so the freshly-expanded node exists to scroll to.
                window.setTimeout(() => {
                  document.querySelector('.lks-col-rail .lks-node.focus')?.scrollIntoView({ block: 'center', behavior: 'smooth' })
                }, 60)
              },
            }, createElement(IconPinFill16, { size: 13 }), tr('rail.locate'))
            : null,
          data.dueCount > 0
            ? createElement('div', { className: 'lks-duebox' },
              createElement(IconRefreshOutline16, { size: 13 }), tr('rail.due', { count: data.dueCount }),
              ...data.due.map(d => createElement('div', { key: d.lessonId, className: 'lks-due-item' },
                createElement('span', null, d.lessonTitle),
                d.overdueDays > 0 ? createElement('span', { className: 'lks-over' }, tr('rail.due.over', { days: d.overdueDays })) : null)),
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
            const secKey = `${courseId}/${section.title}`
            // Active search overrides collapse (results must be visible);
            // otherwise the user's toggle wins over the frontier default.
            const open = query.trim() !== '' || (secOpen[secKey] ?? sectionDefaultOpen(section))
            return [
              createElement('button', {
                key: section.title,
                type: 'button',
                className: 'lks-sechead',
                'aria-expanded': String(open),
                title: open ? tr('rail.section.collapse') : tr('rail.section.expand', { count: section.lessons.length }),
                onClick: () => { setSecOpen(m => ({ ...m, [secKey]: !open })) },
              },
              createElement('span', { className: 'lks-sec-num' }, String(section.index + 1)),
              createElement('span', { className: 'lks-sechead-t' }, section.title),
              open ? null : createElement('span', { className: 'lks-sechead-n' }, tr('rail.section.count', { count: section.lessons.length })),
              createElement('span', { className: 'lks-sechead-c' }, open ? '▾' : '▸')),
              ...(open ? lessons.map(lesson => {
                const locked = lesson.status === 'locked' || (lesson.kind === 'exam' && !examAllowed)
                // aria-disabled (not the disabled attribute): the row stays
                // focusable so its title can explain WHY it is locked.
                return createElement('button', {
                  key: lesson.id,
                  type: 'button',
                  className: `lks-node${lesson.focus ? ' focus' : ''}`,
                  'aria-disabled': locked || undefined,
                  title: jumping === lesson.id
                    ? tr('rail.lesson.opening')
                    : `${lesson.title} — ${statusTitle(lesson.kind, locked ? 'locked' : lesson.status)}${locked || lesson.kind === 'exam' ? '' : tr('rail.lesson.openHint')}`,
                  onClick: () => {
                    if (locked) return
                    if (lesson.kind === 'exam') {
                      void setFocus(lesson.id).catch(reportError)
                      send(tr('prompt.exam', { section: section.title }))
                      return
                    }
                    openLessonThread(lesson)
                  },
                },
                createElement('span', { className: 'lks-g' }, jumping === lesson.id ? createElement(IconLoadingOutline16, { size: 14, className: 'lks-spin' }) : statusIcon(lesson.kind, locked ? 'locked' : lesson.status)),
                createElement('span', { className: 'lks-t' }, lesson.title),
                lesson.due ? createElement('span', { className: 'lks-tag due', title: tr('rail.due.tag') }, createElement(IconRefreshOutline16, { size: 11 })) : null,
                lesson.weakConcepts > 0 ? createElement('span', { className: 'lks-tag weak', title: tr('tag.weak', { count: lesson.weakConcepts }) }, createElement(IconBoltFill16, { size: 10 }), String(lesson.weakConcepts)) : null,
                lesson.frictionCount > 0 ? createElement('span', { className: 'lks-tag fric', title: tr('tag.friction', { count: lesson.frictionCount }) }, createElement(IconWarningOutline16, { size: 10 }), String(lesson.frictionCount)) : null,
                lesson.masteryPct !== null
                  ? createElement('span', { className: 'lks-bar', title: tr('tag.mastery', { pct: lesson.masteryPct }) }, createElement('i', { style: { transform: `scaleX(${lesson.masteryPct / 100})` } }))
                  : null,
                lesson.masteryPct !== null ? createElement('span', { className: 'lks-pct', title: tr('tag.mastery.short') }, `${lesson.masteryPct}%`) : null,
                )
              }) : []),
            ]
          }),
          createElement('button', {
            className: 'lks-btn ghost',
            style: { marginTop: '10px' },
            onClick: () => { setShowImport(!showImport) },
          }, showImport ? tr('rail.import.close') : createElement(IconPlusOutline16, { size: 13 }), tr('rail.import.toggle')),
          showImport ? createElement(ImportRow, { send }) : null,
        )
      })()
  return createElement('div', { className: 'lks-col lks-col-rail' },
    createElement('div', { className: 'lks-colhead' }, tr('col.rail')),
    body,
    createElement(ActionError, { error }),
  )
}

/** One transcript row's element; `interactive` adds the quiz-answer buttons to an assistant row. */
function chatRowElement(row: ChatRow, interactive?: { send: StudySend }): ReactNode {
  if (row.role === 'user') {
    return createElement('div', { key: row.key, className: 'lks-msg user' }, row.text)
  }
  if (row.role === 'error') {
    return createElement('div', { key: row.key, className: 'lks-msg error' }, `⚠ ${row.text}`)
  }
  if (row.role === 'thinking') {
    return createElement('div', { key: row.key, className: 'lks-msg thinking', title: tr('row.thinking.title') },
      createElement(IconLoadingOutline16, { size: 14, className: 'lks-spin' }),
      row.text)
  }
  const cls = row.role === 'streaming' ? 'lks-msg assistant lks-prose streaming' : 'lks-msg assistant lks-prose'
  const body = createElement('div', {
    key: row.key,
    className: cls,
    dangerouslySetInnerHTML: { __html: renderMarkdown(row.text) },
  })
  const options = interactive === undefined || row.role === 'streaming' ? [] : quizOptions(row.text)
  if (options.length < 2) return body
  return createElement('div', { key: row.key, className: 'lks-turn' },
    body,
    createElement('div', { className: 'lks-quiz', title: tr('quiz.title') },
      ...options.map(opt => createElement('button', {
        key: opt.letter,
        className: 'lks-opt',
        onClick: () => { interactive.send(tr('quiz.answer', { letter: opt.letter, text: opt.text })) },
      },
        createElement('span', { className: 'lks-optletter' }, opt.letter),
        createElement('span', null, opt.text))),
  ))
}

/** Middle column: the tutor — transcript, proposal banner, pills, starters. Typing happens in the native composer below the tab. */
function TutorColumn({ data, setMode, send, snapshot }: {
  data: StudyData
  setMode: (mode: 'direct' | 'guide' | 'practice') => Promise<void>
  send: StudySend
  snapshot: TranscriptSlice | undefined
}): ReactNode {
  const [error, setError] = useState<string | null>(null)
  const rows = transcriptRows(snapshot?.nodes, snapshot?.partial ?? null)
  // Quiz buttons only on the last settled assistant reply: older questions are
  // already answered, and the streaming partial may cut an option mid-line.
  const lastAssistant = rows.reduce((acc, row, i) => row.role === 'assistant' ? i : acc, -1)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (el !== null) el.scrollTop = el.scrollHeight
  }, [rows.length])
  // Transcript enhancement rides the same scroll container: assistant math/code
  // diagrams get their CDN pass after every row change (idempotent per element).
  useEffect(() => {
    const el = scrollRef.current
    if (el !== null && rows.length > 0) void enhanceRendered(el).catch(() => { /* degrade */ })
  }, [rows.length])
  const proposal = data?.pendingProposals[0] ?? null
  const lesson = data?.lesson ?? null
  const dormant = data?.active !== true
  /** Mode switches are the only fallible write left here (host route); surface failures inline. */
  const fire = (action: Promise<void>): void => {
    action.then(() => { setError(null) }, (err: unknown) => { setError(err instanceof Error ? err.message : String(err)) })
  }
  return createElement('div', { className: 'lks-col lks-col-tutor' },
    createElement('div', { className: 'lks-colhead' }, tr('col.tutor')),
    dormant
      ? createElement('div', { className: 'lks-dormant' }, tr('tutor.dormant'))
      : null,
    createElement('div', { className: 'lks-transcript', ref: scrollRef },
      rows.length === 0 && !dormant
        ? createElement('div', { className: 'lks-empty' }, tr('tutor.empty'), createElement('br'), tr('tutor.empty.hint'))
        : rows.map((row, i) => chatRowElement(row, !dormant && i === lastAssistant ? { send } : undefined)),
    ),
    proposal !== null
      ? createElement('div', { className: 'lks-banner' },
        createElement('span', null, '🎓'),
        createElement('span', { className: 'lks-why' }, tr('proposal.text', { lesson: proposal.lessonTitle, rationale: proposal.rationale })),
        createElement('button', {
          className: 'lks-btn primary',
          onClick: () => { send(tr('prompt.proposal.accept', { id: proposal.id })) },
        }, tr('proposal.accept')),
        createElement('button', {
          className: 'lks-btn ghost',
          onClick: () => { send(tr('prompt.proposal.decline', { id: proposal.id })) },
        }, tr('proposal.decline')),
      )
      : null,
    createElement('div', { className: 'lks-pills', style: { height: 'auto', padding: '4px 0' } },
      ...MODES.map(mode => createElement('button', {
        key: mode.id,
        className: `lks-pill${data?.mode === mode.id ? ' on' : ''}`,
        'aria-pressed': String(data?.mode === mode.id),
        'aria-disabled': dormant || undefined,
        title: dormant ? tr('tutor.dormant') : tr(mode.hintKey),
        onClick: () => { if (!dormant) fire(setMode(mode.id)) },
      }, tr(mode.labelKey))),
    ),
    lesson !== null && lesson.starters.length > 0
      ? createElement('div', { className: 'lks-dock', style: { padding: '0 0 6px' } },
        ...lesson.starters.map(s => createElement('button', {
          key: s.label,
          className: 'lks-starter',
          'aria-disabled': dormant || undefined,
          title: dormant ? tr('tutor.dormant') : s.message,
          onClick: () => { if (!dormant) send(s.message) },
        }, s.label)),
      )
      : null,
    createElement(ActionError, { error }),
  )
}

/** Browser speechSynthesis engine — the offline/endpoint-gone fallback voice. */
function systemSpeechEngine(): SpeechEngine {
  return {
    speak(text: string): Promise<void> {
      return new Promise((resolve, reject) => {
        const synth = typeof window === 'undefined' ? undefined : window.speechSynthesis
        if (synth === undefined) {
          reject(new Error('no speechSynthesis'))
          return
        }
        const utterance = new SpeechSynthesisUtterance(text)
        utterance.lang = 'zh-CN'
        utterance.onend = () => resolve()
        utterance.onerror = () => reject(new Error('speechSynthesis failed'))
        synth.speak(utterance)
      })
    },
    pause(): void { window.speechSynthesis?.pause() },
    resume(): void { window.speechSynthesis?.resume() },
    cancel(): void { window.speechSynthesis?.cancel() },
  }
}

/** Edge-over-dashboard engine: MP3 from /api/tts played through an <audio>, with per-session prefetch. */
function audioSpeechEngine(fetchTts: (text: string) => Promise<ArrayBuffer>): SpeechEngine {
  let audio: HTMLAudioElement | null = null
  const prefetch = new Map<string, Promise<ArrayBuffer>>()
  const load = (text: string): Promise<ArrayBuffer> => {
    let pending = prefetch.get(text)
    if (pending === undefined) {
      pending = fetchTts(text)
      pending.catch(() => prefetch.delete(text)) // failed fetches may be retried
      prefetch.set(text, pending)
    }
    return pending
  }
  return {
    speak(text: string): Promise<void> {
      return load(text).then(buf => new Promise<void>((resolve, reject) => {
        const blobUrl = URL.createObjectURL(new Blob([buf], { type: 'audio/mpeg' }))
        audio = new Audio(blobUrl)
        const done = (): void => {
          URL.revokeObjectURL(blobUrl)
          resolve()
        }
        audio.onended = done
        audio.onerror = () => {
          URL.revokeObjectURL(blobUrl)
          reject(new Error('audio playback failed'))
        }
        void audio.play().catch(reject)
      }))
    },
    pause(): void { audio?.pause() },
    resume(): void { void audio?.play() },
    cancel(): void {
      audio?.pause()
      audio = null
    },
    prewarm(text: string): void { void load(text) },
  }
}

/** Right column: the blackboard — focus-lesson 讲解/脑图/概念图 plus the Cornell 笔记. */
function BlackboardColumn({ data, deleteNote }: { data: StudyData; deleteNote: (lessonId: string, noteId: string) => Promise<void> }): ReactNode {
  const lesson = data?.lesson ?? null
  const { tts } = useStudy()
  const [pane, setPane] = useState<'teach' | 'cmap'>('teach')
  const [error, setError] = useState<string | null>(null)
  // Read-aloud: one controller per lesson play; the bar shows the current
  // sentence and the degradation notice when the system voice takes over.
  const [read, setRead] = useState<ReadAloudStatus | null>(null)
  const readCtl = useRef<ReadAloudController | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const startReading = (): void => {
    if (lesson === null || lesson.speechText.trim() === '') return
    readCtl.current?.stop()
    const sentences = speechSentencesOf(lesson.speechText)
    const voice = storedTtsVoice()
    const controller = new ReadAloudController(
      sentences.map(s => speakMathInSentence(s)),
      audioSpeechEngine(text => tts(text, voice)),
      systemSpeechEngine(),
      s => {
        setRead(s)
        if (s.degraded && s.engine === 'system' && !readError) setReadError(tr('read.engine.system'))
      },
    )
    readCtl.current = controller
    setReadError(null)
    void controller.start().catch((err: unknown) => { setReadError(err instanceof Error ? err.message : String(err)) })
  }
  const stopReading = (): void => {
    readCtl.current?.stop()
    setRead(null)
    setReadError(null)
  }
  // Armed note deletion: one click arms ("确认删除?"), the next confirms —
  // mirroring the rail's course delete; a stray click anywhere else disarms.
  const [armedNote, setArmedNote] = useState<string | null>(null)
  useEffect(() => {
    if (armedNote === null) return
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
  const proseRef = useRef<HTMLDivElement | null>(null)
  const diagRef = useRef<HTMLDivElement | null>(null)
  // Post-render enhancement: math/shiki/mermaid via CDN, every failure degrades silently.
  useEffect(() => {
    if (pane !== 'teach' || proseRef.current === null || lesson === null) return
    const el = proseRef.current
    void enhanceRendered(el).catch(() => { /* degrade */ })
  }, [pane, lesson?.html])
  // Diagram panes (also CDN + vendored layout, honest one-line failure notice).
  useEffect(() => {
    if (pane !== 'cmap' || diagRef.current === null || lesson === null) return
    const el = diagRef.current
    el.textContent = ''
    const run = lesson.concepts.length === 0
      ? Promise.reject(new Error('no concepts'))
      : renderLessonConceptMap(el, lesson.title, lesson.concepts.map(c => ({ title: c.title, masteryPct: c.masteryPct })))
    run.catch((err) => {
      console.error('lks diagram pane failed:', pane, err)
      el.textContent = lesson.concepts.length === 0
        ? tr('bb.fallback.cmap.empty')
        : tr('bb.fallback.cmap')
    })
  }, [pane, lesson?.lessonId, lesson?.concepts.length])

  const body: ReactNode = lesson === null
    ? createElement('div', { className: 'lks-empty' }, tr('bb.empty'), createElement('br'), tr('bb.empty.hint'))
    : createElement('div', null,
      createElement('div', { className: 'lks-lessonhead' },
        createElement('h2', null, lesson.title),
        createElement('div', { className: 'lks-meta' },
          `${lesson.courseTitle} · ${statusTitle('study', lesson.status)}`
          + (lesson.masteryPct === null ? '' : ` · ${tr('bb.mastery', { pct: lesson.masteryPct })}`)),
        createElement('div', { className: 'lks-meta' }, `${tr('bb.strategy')}：${lesson.strategy}`),
        lesson.concepts.length > 0
          ? createElement('div', { className: 'lks-chips' },
            ...lesson.concepts.map(c => createElement('span', {
              key: c.title,
              className: `lks-chip${c.weak ? ' weak' : ''}`,
            }, `${c.title} ${c.masteryPct}%${c.weak ? ' ⚡' : ''}`)))
          : null,
      ),
      createElement('div', { className: 'lks-viewtabs' },
        createElement('button', { className: `lks-viewtab${pane === 'teach' ? ' on' : ''}`, 'aria-pressed': String(pane === 'teach'), onClick: () => { setPane('teach') } }, tr('viewtab.teach')),
        createElement('button', { className: `lks-viewtab${pane === 'cmap' ? ' on' : ''}`, 'aria-pressed': String(pane === 'cmap'), title: tr('viewtab.cmap.title'), onClick: () => { setPane('cmap') } }, createElement(IconGlobeOutline14, { size: 13 }), tr('viewtab.cmap')),
      ),
      pane === 'teach'
        ? createElement('div', { className: 'lks-readbar' },
          createElement('button', {
            className: 'lks-btn ghost',
            style: { padding: '3px 8px', fontSize: '12.5px', flex: 'none' },
            title: read !== null && read.state === 'speaking' ? tr('read.pause') : tr('read.play'),
            onClick: () => {
              if (read !== null && read.state === 'speaking') { readCtl.current?.pause(); return }
              if (read !== null && read.state === 'paused') { readCtl.current?.resume(); return }
              startReading()
            },
          }, createElement(IconPlayOutline16, { size: 12 }), read !== null && read.state === 'speaking' ? tr('read.pause') : read !== null && read.state === 'paused' ? tr('read.resume') : tr('read.play')),
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
        )
        : null,
      pane === 'teach'
        ? createElement('div', { className: 'lks-prose', ref: proseRef, dangerouslySetInnerHTML: { __html: lesson.html } })
        : createElement('div', { className: 'lks-prose', ref: diagRef }),
      createElement('div', { className: 'lks-bb-notes' },
        createElement('div', { className: 'lks-sec' }, tr('bb.notes')),
        lesson.notes.length === 0
          ? createElement('div', { className: 'lks-empty', style: { padding: '16px 0' } }, tr('bb.notes.empty'))
          : ZONES.filter(([zone]) => lesson.notes.some(n => n.zone === zone)).map(([zone, labelKey]) =>
            createElement('div', { key: zone, className: 'lks-zone' },
              createElement('div', { className: 'lks-zone-h' }, tr(labelKey)),
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
  return createElement('div', { className: 'lks-col lks-col-bb' },
    createElement('div', { className: 'lks-colhead' }, tr('col.bb')),
    body,
    createElement(ActionError, { error }),
  )
}

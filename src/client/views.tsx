/**
 * The study tab: one `conversation.view` entry rendering the whole plugin —
 * a simplified LookatStudy inside dsh, three columns in the tab. Left: the
 * course map (selector, tree, due box, one-click demo import). Middle: the
 * tutor conversation — a read-only mini transcript folded from the session
 * snapshot (user text, assistant text rendered through the plugin's own
 * markdown pipeline, tool chips) plus the soul pills, starters, pending
 * proposal banner, and a reverse-channel input. Right: the blackboard —
 * focus-lesson 讲解 and the Cornell 笔记 zones. Nothing outside this tab
 * touches dsh chrome.
 * @module dsh-plugin-lookatstudy/client/views
 */

import { createElement, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  AssistantBlock, ConversationNode, ConversationSnapshot, PartialAssistant,
} from '@deepseek-ai/dsh-client-runtime/client'
import { useStudy } from './data.ts'
import { renderMarkdown } from '../markdown.ts'

/** The three souls, in pill order (labels from LookatStudy's mode switcher). */
const MODES: ReadonlyArray<{ id: 'direct' | 'guide' | 'practice'; label: string; hint: string }> = [
  { id: 'direct', label: '直讲', hint: 'direct 精讲:先讲清楚,再确认懂没懂' },
  { id: 'guide', label: '引导', hint: 'guide 引导:让你自己往前推一步,导师递台阶' },
  { id: 'practice', label: '实战', hint: 'practice 实战:在真实世界的乱问题里学' },
]

/** Zone labels for the Cornell notebook (understand / record / practice). */
const ZONES: ReadonlyArray<readonly [string, string]> = [
  ['understand', '🧠 理解区 — 知识结构'],
  ['record', '📝 记录区 — 我的话'],
  ['practice', '✍️ 练习区 — 答题日志'],
]

/** Status glyph for one lesson row (LookatStudy's map icons). */
function glyph(kind: string, status: string): string {
  if (kind === 'exam') return '🎯'
  if (status === 'mastered') return '👑'
  if (status === 'in_progress') return '📖'
  if (status === 'available') return '⭐'
  return '🔒'
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

/** The rail's import row: a GitHub URL input plus the paste/folder hints. */
function ImportRow({ send }: { send: StudySend }): ReactNode {
  const [url, setUrl] = useState('')
  return createElement('div', { className: 'lks-import' },
    createElement('div', { className: 'lks-inputrow' },
      createElement('input', {
        className: 'lks-input',
        type: 'url',
        placeholder: 'GitHub 仓库链接,如 microsoft/AI-For-Beginners',
        value: url,
        onChange: (e: { target: { value: string } }) => { setUrl(e.target.value) },
        onKeyDown: (e: ReactKeyboardEvent<HTMLInputElement>) => {
          if (e.key === 'Enter' && url.trim() !== '') send(`导入课程:用 study_import_github 抓取 ${url.trim()}`)
        },
      }),
      createElement('button', {
        className: 'lks-btn primary',
        disabled: url.trim() === '',
        onClick: () => { send(`导入课程:用 study_import_github 抓取 ${url.trim()}`) },
      }, '导入'),
    ),
    createElement('div', { className: 'lks-import-hint' },
      '粘贴 markdown → 说「导入为课程」', createElement('br'),
      '本地文件夹 → 说「导入 D:/path/to/folder」'),
  )
}

/** One rendered transcript row (pure fold of the conversation snapshot). */
export interface ChatRow {
  readonly key: string
  readonly role: 'user' | 'assistant' | 'tool' | 'error' | 'streaming'
  readonly text: string
}

function textOf(blocks: readonly { type: string; text?: string }[]): string {
  return blocks.filter(b => b.type === 'text').map(b => b.text ?? '').join('\n\n').trim()
}

function assistantText(blocks: readonly AssistantBlock[]): string {
  return blocks.filter(b => b.kind === 'text').map(b => b.text).join('\n\n').trim()
}

/**
 * Fold conversation nodes (plus the streaming partial) into render rows;
 * tool activity condenses to one muted chip per settled call.
 * @param nodes - finalized conversation nodes from the snapshot.
 * @param partial - the in-flight assistant partial, or null.
 * @returns ordered rows; never mutates its inputs.
 */
export function transcriptRows(nodes: readonly ConversationNode[], partial: PartialAssistant | null): readonly ChatRow[] {
  const rows: ChatRow[] = []
  for (const node of nodes) {
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
      case 'tool-result':
        rows.push({ key: `t${node.seq}`, role: 'tool', text: node.call?.name ?? node.callId })
        break
      case 'turn-error':
        rows.push({ key: `e${node.seq}`, role: 'error', text: node.message })
        break
      default:
        break
    }
  }
  if (partial !== null) {
    const text = assistantText(partial.blocks)
    if (text !== '') rows.push({ key: 'streaming', role: 'streaming', text })
  }
  return rows
}

/** Small inline error surface for failed write actions. */
function ActionError({ error }: { error: string | null }): ReactNode {
  if (error === null) return null
  return createElement('div', { className: 'lks-propcard-err' }, error)
}

/**
 * Land one message in the dsh composer and submit it — the same path as the
 * Send button, so button text is visible in the native input for a beat and
 * then goes through the full submission pipeline (no reverse channel).
 */
export type StudySend = (text: string) => void

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

/** The whole study tab. Wide = three columns (课程 | 导师 | 黑板); narrow (<1220px) = one composer-width pane with a three-way switcher. */
export function studyView(ctx: ClientContext): (props: ConvViewProps) => ReactNode {
  return function StudyView(props: ConvViewProps): ReactNode {
    return createElement(StudyTab, { ...props, ctx, key: 'tab' })
  }
}

/** Tab body: the factory-bound ctx carries workspaces/sessions for the per-lesson session jumps. */
function StudyTab({ useSession, inputActions, ctx }: ConvViewProps & { ctx: ClientContext }): ReactNode {
  const { data, setMode, setFocus, deleteCourse, bindLessonSession } = useStudy()
  const snapshot = useSession((s: ConversationSnapshot) => s)
  const [pane, setPane] = useState<StudyPane>(storedPane)
  const send: StudySend = (text) => {
    inputActions.setDraft(text)
    inputActions.submit()
  }
  const panes: ReadonlyArray<{ id: StudyPane; label: string }> = [
    { id: 'rail', label: '课程' },
    { id: 'tutor', label: '导师' },
    { id: 'bb', label: '黑板' },
  ]
  return createElement('div', {
    className: 'lks-root lks-study',
    'data-conversation-composer-overlay': '',
    'data-pane': pane,
  },
  // .lks-body carries the row/column direction so the container query can
  // flip it — a container query cannot style the container element itself.
  createElement('div', { className: 'lks-body' },
    createElement('div', { className: 'lks-switch' },
      ...panes.map(p => createElement('button', {
        key: p.id,
        className: `lks-switch-btn${pane === p.id ? ' on' : ''}`,
        onClick: () => {
        setPane(p.id)
        try {
          sessionStorage.setItem(PANE_KEY, p.id)
        } catch {
          // Privacy modes forbid storage writes; the in-memory choice still holds this page.
        }
      },
      }, p.label)),
    ),
    createElement(CourseRail, { data, setFocus, deleteCourse, bindLessonSession, send, ctx, currentSessionId: snapshot.sessionId }),
    createElement(TutorColumn, { data, setMode, send, snapshot }),
    createElement(BlackboardColumn, { data }),
  ),
  )
}

type StudyData = ReturnType<typeof useStudy>['data']

/** Left column: course management (pick/delete/search/import), lesson tree, due box. */
function CourseRail({ data, setFocus, deleteCourse, bindLessonSession, send, ctx, currentSessionId }: {
  data: StudyData
  setFocus: (id: string) => Promise<void>
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
    if (mapped !== undefined && ctx.sessions.binding(mapped as never) !== undefined) {
      void setFocus(lesson.id).catch(reportError)
      ctx.sessions.open(mapped as never)
      return
    }
    setJumping(lesson.id)
    void setFocus(lesson.id).then(() => (async () => {
      const area = await fetch('/lookatstudy/api/study-workspace')
      if (!area.ok) throw new Error(`study area unavailable (HTTP ${area.status})`)
      const { path } = await area.json() as { path: string }
      const workspace = await ctx.workspaces.create({ path })
      // connectWorkspace mints a fresh blank session once the workspace's
      // previous blank is used — each lesson thereby gets its own thread.
      const sessionId = await ctx.workspaces.connectWorkspace(workspace.workspaceId)
      const actx = ctx.sessions.scope(sessionId)
      const face = actx === undefined ? undefined : ctx.sessions.sessionOf(actx)
      if (face === undefined) throw new Error('lesson session is not addressable yet')
      const result = await face.prompt([{ type: 'text', text: `学习「${lesson.title}」:用 study_lesson 打开这一课开始学习。` }], 'queue')
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
  const [showImport, setShowImport] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reportError = (err: unknown): void => { setError(err instanceof Error ? err.message : String(err)) }
  const body: ReactNode = data === null
    ? createElement('div', { className: 'lks-empty' }, '加载中…')
    : data.courses.length === 0
      ? createElement('div', { className: 'lks-empty' },
        '暂无课程', createElement('br'),
        createElement('button', {
          className: 'lks-btn primary',
          style: { margin: '10px 0' },
          onClick: () => { send('导入课程:用 study_import_github 抓取 https://github.com/microsoft/AI-For-Beginners') },
        }, '📚 导入示例课程'),
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
              : createElement('div', { className: 'lks-rail-title' }, course.title),
            createElement('button', {
              className: `lks-btn ${confirmDelete ? 'primary' : 'ghost'}`,
              title: confirmDelete ? '再点一次确认删除(含全部进度与笔记)' : '删除本课程',
              onClick: () => {
                if (!confirmDelete) { setConfirmDelete(true); return }
                setConfirmDelete(false)
                deleteCourse(courseId).then(() => { setSelectedCourse('') }, reportError)
              },
            }, confirmDelete ? '确认删除?' : '🗑'),
          ),
          createElement('div', { className: 'lks-rail-sub' }, `${course.mastered}/${course.total} 已掌握`),
          createElement('div', {
            className: `lks-masterybar${course.avgMasteryPct === 100 ? ' gold' : ''}`,
            title: course.avgMasteryPct === null ? '尚无掌握度数据' : `平均掌握度 ${course.avgMasteryPct}%`,
          }, createElement('i', { style: { width: `${course.avgMasteryPct ?? 0}%` } })),
          createElement('input', {
            className: 'lks-search',
            type: 'search',
            placeholder: '搜索课时…(多关键词空格分隔)',
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
            },
          }),
          data.dueCount > 0
            ? createElement('div', { className: 'lks-duebox' },
              `🔁 待复习 ${data.dueCount}`,
              ...data.due.map(d => createElement('div', { key: d.lessonId, className: 'lks-due-item' },
                createElement('span', null, d.lessonTitle),
                d.overdueDays > 0 ? createElement('span', { className: 'lks-over' }, `超${d.overdueDays}天`) : null)),
              createElement('button', {
                className: 'lks-btn ghost',
                style: { marginTop: '6px' },
                onClick: () => { send('开始今天的复习,从最到期的课时开始') },
              }, '开始复习'),
            )
            : null,
          ...course.sections.flatMap(section => {
            const examAllowed = examOpen(section.lessons)
            const lessons = section.lessons.filter(l => query.trim() === '' || titleMatches(l.title, query) || l.focus)
            if (lessons.length === 0) return []
            return [
              createElement('div', { key: section.title, className: 'lks-sec' },
                createElement('span', { className: 'lks-sec-num' }, String(section.index + 1)),
                ` ${section.title}`),
              ...lessons.map(lesson => {
                const locked = lesson.status === 'locked' || (lesson.kind === 'exam' && !examAllowed)
                return createElement('div', {
                  key: lesson.id,
                  className: `lks-node${locked ? ' locked' : ''}${lesson.focus ? ' focus' : ''}`,
                  title: locked
                    ? lesson.kind === 'exam' ? '章节测验:本节全部课时掌握度 ≥50% 后开放' : '尚未解锁 — 先学前面的课时'
                    : lesson.title,
                  onClick: () => {
                    if (locked) return
                    if (lesson.kind === 'exam') {
                      void setFocus(lesson.id).catch(reportError)
                      send(`开始「${section.title}」的章节测验:按本节课时出题,答完逐题判分`)
                      return
                    }
                    openLessonThread(lesson)
                  },
                },
                createElement('span', { className: 'lks-g' }, jumping === lesson.id ? '⏳' : glyph(lesson.kind, locked ? 'locked' : lesson.status)),
                createElement('span', { className: 'lks-t' }, lesson.title),
                lesson.due ? createElement('span', { className: 'lks-tag due' }, '🔁') : null,
                lesson.weakConcepts > 0 ? createElement('span', { className: 'lks-tag weak' }, `⚡${lesson.weakConcepts}`) : null,
                lesson.frictionCount > 0 ? createElement('span', { className: 'lks-tag fric' }, `😣${lesson.frictionCount}`) : null,
                lesson.masteryPct !== null
                  ? createElement('span', { className: 'lks-bar' }, createElement('i', { style: { width: `${lesson.masteryPct}%` } }))
                  : null,
                lesson.masteryPct !== null ? createElement('span', { className: 'lks-pct' }, `${lesson.masteryPct}%`) : null,
                )
              }),
            ]
          }),
          createElement('button', {
            className: 'lks-btn ghost',
            style: { marginTop: '10px' },
            onClick: () => { setShowImport(!showImport) },
          }, showImport ? '收起导入' : '＋ 导入课程'),
          showImport ? createElement(ImportRow, { send }) : null,
        )
      })()
  return createElement('div', { className: 'lks-col lks-col-rail' },
    createElement('div', { className: 'lks-colhead' }, '课程'),
    body,
    createElement(ActionError, { error }),
  )
}

/** One transcript row's element. */
function chatRowElement(row: ChatRow): ReactNode {
  if (row.role === 'user') {
    return createElement('div', { key: row.key, className: 'lks-msg user' }, row.text)
  }
  if (row.role === 'tool') {
    return createElement('div', { key: row.key, className: 'lks-msg tool' }, `🔧 ${row.text}`)
  }
  if (row.role === 'error') {
    return createElement('div', { key: row.key, className: 'lks-msg error' }, `⚠ ${row.text}`)
  }
  const cls = row.role === 'streaming' ? 'lks-msg assistant lks-prose streaming' : 'lks-msg assistant lks-prose'
  return createElement('div', {
    key: row.key,
    className: cls,
    dangerouslySetInnerHTML: { __html: renderMarkdown(row.text) },
  })
}

/** Middle column: the tutor — transcript, proposal banner, pills, starters. Typing happens in the native composer below the tab. */
function TutorColumn({ data, setMode, send, snapshot }: {
  data: StudyData
  setMode: (mode: 'direct' | 'guide' | 'practice') => Promise<void>
  send: StudySend
  snapshot: ConversationSnapshot
}): ReactNode {
  const [error, setError] = useState<string | null>(null)
  const rows = transcriptRows(snapshot.nodes, snapshot.partial)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (el !== null) el.scrollTop = el.scrollHeight
  }, [rows.length])
  const proposal = data?.pendingProposals[0] ?? null
  const lesson = data?.lesson ?? null
  /** Mode switches are the only fallible write left here (host route); surface failures inline. */
  const fire = (action: Promise<void>): void => {
    action.then(() => { setError(null) }, (err: unknown) => { setError(err instanceof Error ? err.message : String(err)) })
  }
  return createElement('div', { className: 'lks-col lks-col-tutor' },
    createElement('div', { className: 'lks-colhead' }, '导师'),
    createElement('div', { className: 'lks-transcript', ref: scrollRef },
      rows.length === 0
        ? createElement('div', { className: 'lks-empty' }, '对话会出现在这里', createElement('br'), '在下方输入框和导师说话')
        : rows.map(chatRowElement),
    ),
    proposal !== null
      ? createElement('div', { className: 'lks-banner' },
        createElement('span', null, '🎓'),
        createElement('span', { className: 'lks-why' }, `导师提议你已掌握「${proposal.lessonTitle}」:${proposal.rationale}`),
        createElement('button', {
          className: 'lks-btn primary',
          onClick: () => { send(`接受提案 ${proposal.id} —— 确认标记这课为已掌握`) },
        }, '接受'),
        createElement('button', {
          className: 'lks-btn ghost',
          onClick: () => { send(`拒绝提案 ${proposal.id} —— 我想再练练`) },
        }, '再练练'),
      )
      : null,
    createElement('div', { className: 'lks-pills', style: { height: 'auto', padding: '4px 0' } },
      ...MODES.map(mode => createElement('button', {
        key: mode.id,
        className: `lks-pill${data?.mode === mode.id ? ' on' : ''}`,
        title: mode.hint,
        onClick: () => { fire(setMode(mode.id)) },
      }, mode.label)),
    ),
    lesson !== null && lesson.starters.length > 0
      ? createElement('div', { className: 'lks-dock', style: { padding: '0 0 6px' } },
        ...lesson.starters.map(s => createElement('button', {
          key: s.label,
          className: 'lks-starter',
          title: s.message,
          onClick: () => { send(s.message) },
        }, s.label)),
      )
      : null,
    createElement(ActionError, { error }),
  )
}

/** Right column: the blackboard — focus-lesson 讲解 plus the Cornell 笔记. */
function BlackboardColumn({ data }: { data: StudyData }): ReactNode {
  const lesson = data?.lesson ?? null
  const body: ReactNode = lesson === null
    ? createElement('div', { className: 'lks-empty' }, '黑板还空着', createElement('br'), '在左侧课程树选择一课')
    : createElement('div', null,
      createElement('div', { className: 'lks-lessonhead' },
        createElement('h2', null, lesson.title),
        createElement('div', { className: 'lks-meta' },
          `${lesson.courseTitle} · ${lesson.status}`
          + (lesson.masteryPct === null ? '' : ` · 掌握度 ${lesson.masteryPct}%`)
          + ` · ${lesson.strategy}`),
        lesson.concepts.length > 0
          ? createElement('div', { className: 'lks-chips' },
            ...lesson.concepts.map(c => createElement('span', {
              key: c.title,
              className: `lks-chip${c.weak ? ' weak' : ''}`,
            }, `${c.title} ${c.masteryPct}%${c.weak ? ' ⚡' : ''}`)))
          : null,
      ),
      createElement('div', { className: 'lks-prose', dangerouslySetInnerHTML: { __html: lesson.html } }),
      createElement('div', { className: 'lks-bb-notes' },
        createElement('div', { className: 'lks-sec' }, '笔记'),
        lesson.notes.length === 0
          ? createElement('div', { className: 'lks-empty', style: { padding: '16px 0' } }, '这一课还没有笔记')
          : ZONES.filter(([zone]) => lesson.notes.some(n => n.zone === zone)).map(([zone, label]) =>
            createElement('div', { key: zone, className: 'lks-zone' },
              createElement('h4', null, label),
              ...lesson.notes.filter(n => n.zone === zone).map(n => createElement('div', { key: n.id, className: 'lks-note' },
                createElement('span', { className: 'lks-note-src' }, n.source),
                createElement('div', { className: 'lks-note-title' }, n.title),
                createElement('div', { className: 'lks-note-text' }, n.text),
                n.quote !== null ? createElement('div', { className: 'lks-note-q' }, `“${n.quote}”`) : null,
              )),
            )),
      ),
    )
  return createElement('div', { className: 'lks-col lks-col-bb' },
    createElement('div', { className: 'lks-colhead' }, '黑板'),
    body,
  )
}

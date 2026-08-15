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
import type { ReactNode } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
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
function glyph(status: string): string {
  if (status === 'completed') return '✅'
  if (status === 'available') return '▶️'
  return '🔒'
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

/** The whole study tab. */
export function StudyView({ useSession, inputActions }: ConvViewProps): ReactNode {
  const { data, setMode, setFocus } = useStudy()
  const snapshot = useSession((s: ConversationSnapshot) => s)
  const send: StudySend = (text) => {
    inputActions.setDraft(text)
    inputActions.submit()
  }
  return createElement('div', { className: 'lks-root lks-study', 'data-conversation-composer-overlay': '' },
    createElement(CourseRail, { data, setFocus, send }),
    createElement(TutorColumn, { data, setMode, send, snapshot }),
    createElement(BlackboardColumn, { data }),
  )
}

type StudyData = ReturnType<typeof useStudy>['data']

/** Left column: course picker, lesson tree, due box, or the import empty state. */
function CourseRail({ data, setFocus, send }: { data: StudyData; setFocus: (id: string) => Promise<void>; send: StudySend }): ReactNode {
  const [selectedCourse, setSelectedCourse] = useState('')
  const [error, setError] = useState<string | null>(null)
  const reportError = (err: unknown): void => { setError(err instanceof Error ? err.message : String(err)) }
  const body: ReactNode = data === null
    ? createElement('div', { className: 'lks-empty' }, '加载中…')
    : data.courses.length === 0
      ? createElement('div', { className: 'lks-empty' },
        '暂无课程', createElement('br'),
        createElement('button', {
          className: 'lks-btn primary',
          style: { marginTop: '10px' },
          onClick: () => { send('导入课程:用 study_import_github 抓取 https://github.com/microsoft/AI-For-Beginners') },
        }, '📚 导入示例课程'),
        createElement('div', { style: { marginTop: '12px', fontSize: '12px' } },
          '粘贴 markdown → 说「导入为课程」', createElement('br'),
          '本地文件夹 → 说「导入 D:/path/to/folder」', createElement('br'),
          '任意 GitHub 仓库 → 贴链接给导师'),
      )
      : (() => {
        const courseId = data.courses.some(c => c.courseId === selectedCourse)
          ? selectedCourse
          : data.courses[0]!.courseId
        const course = data.courses.find(c => c.courseId === courseId)!
        return createElement('div', null,
          data.courses.length > 1
            ? createElement('select', {
              className: 'lks-rail-select',
              value: courseId,
              onChange: (e: { target: { value: string } }) => { setSelectedCourse(e.target.value) },
            }, ...data.courses.map(c => createElement('option', { key: c.courseId, value: c.courseId }, c.title)))
            : createElement('div', { className: 'lks-rail-title' }, course.title),
          createElement('div', { className: 'lks-rail-sub' },
            `${course.completed}/${course.total} 完成${course.avgMasteryPct !== null ? ` · 平均 ${course.avgMasteryPct}%` : ''}`),
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
          ...course.sections.flatMap(section => [
            createElement('div', { key: section.title, className: 'lks-sec' }, section.title),
            ...section.lessons.map(lesson => createElement('div', {
              key: lesson.id,
              className: `lks-node${lesson.status === 'locked' ? ' locked' : ''}${lesson.focus ? ' focus' : ''}`,
              title: lesson.status === 'locked' ? '尚未解锁 — 先完成前面的课时' : lesson.title,
              onClick: () => {
                if (lesson.status === 'locked') return
                void setFocus(lesson.id).catch(reportError)
              },
            },
            createElement('span', { className: 'lks-g' }, glyph(lesson.status)),
            createElement('span', { className: 'lks-t' }, lesson.title),
            lesson.weakConcepts > 0 ? createElement('span', { className: 'lks-tag weak' }, `⚡${lesson.weakConcepts}`) : null,
            lesson.frictionCount > 0 ? createElement('span', { className: 'lks-tag fric' }, `😣${lesson.frictionCount}`) : null,
            lesson.masteryPct !== null
              ? createElement('span', { className: 'lks-bar' }, createElement('i', { style: { width: `${lesson.masteryPct}%` } }))
              : null,
            lesson.masteryPct !== null ? createElement('span', { className: 'lks-pct' }, `${lesson.masteryPct}%`) : null,
            )),
          ]),
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
    createElement('div', { className: 'lks-colhead' }, '老师'),
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

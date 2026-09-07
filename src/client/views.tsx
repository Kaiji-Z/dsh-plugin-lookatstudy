/**
 * Shared pure helpers for the study panel's pieces: chat-row shapes, tree
 * status copy, quiz-option extraction, and section default expansion. The
 * panel itself lives in `panel.tsx`; since 0.14.0 nothing here touches the
 * host composer or the conversation view.
 * @module dsh-plugin-lookatstudy/client/views
 */

import { createElement } from 'react'
import type { ReactNode } from 'react'
import { tr, type StudyT } from './locale.ts'

/** One rendered tutor chat row (fed by session-feed's fold). */
export interface ChatRow {
  readonly key: string
  readonly role: 'user' | 'assistant' | 'error' | 'streaming' | 'thinking' | 'reasoning' | 'tool'
  readonly text: string
  /** tool rows only: the chip's state (loading → done/error). */
  readonly toolState?: 'loading' | 'done' | 'error'
}

/** Small inline error surface for failed write actions (shared with settings). */
export function ActionError({ error }: { error: string | null }): ReactNode {
  if (error === null) return null
  return createElement('div', { className: 'lks-propcard-err' }, error)
}

/**
 * Tooltip text for one course-tree status glyph. Pure (the translator is an
 * optional parameter defaulting to the active one, evaluated per call).
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
 */
export function quizOptions(text: string): ReadonlyArray<{ letter: string; text: string }> {
  const runs: Array<Array<{ letter: string; text: string }>> = []
  let run: Array<{ letter: string; text: string }> = []
  const flush = (): void => {
    if (run.length >= 2) runs.push(run)
    run = []
  }
  for (const line of text.split('\n')) {
    // Two accepted shapes. The space after the letter punctuation is OPTIONAL
    // ("A.py 脚本"), and a markdown table row ("| **A** | `.py` 脚本 … |")
    // parses too — the tutor drifts into tables despite the persona's format
    // directive (live 0.14.0 catch: the quiz rendered as plain text and the
    // options stayed unclickable).
    const plain = /^([A-D])[.、:)]\s*(.+)$/.exec(line.trim())
    const table = /^\|\s*\*{0,2}([A-D])\*{0,2}\s*\|\s*(.+?)\s*\|$/.exec(line.trim())
    const match = plain ?? (table !== null
      ? [table[0]!, table[1]!, table[2]!.replaceAll('**', '').replaceAll('`', '')] as RegExpExecArray
      : null)
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

/** One row of the rail search results panel. */
export interface RailSearchRow {
  readonly lessonId: string
  readonly title: string
  readonly snippet: string
  readonly courseTitle: string
  readonly fromTitle: boolean
}

/**
 * Merge the rail's two search tracks into the results panel: title hits
 * (lessons whose name matches — they are also filtered into the tree) first,
 * then full-text hits not already covered, snippets carried for the body
 * matches. Pure; empty queries yield no panel.
 */
export function mergeRailSearch(
  query: string,
  lessons: ReadonlyArray<{ id: string; title: string; status: string; kind: string }>,
  textHits: ReadonlyArray<{ lessonId: string; lessonTitle: string; snippet: string; courseTitle: string }>,
): RailSearchRow[] {
  const keys = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (keys.length === 0) return []
  const rows: RailSearchRow[] = []
  const seen = new Set<string>()
  const matches = (title: string): boolean => keys.every(k => title.toLowerCase().includes(k))
  for (const lesson of lessons) {
    if (lesson.kind === 'exam' || lesson.status === 'locked' || !matches(lesson.title)) continue
    rows.push({ lessonId: lesson.id, title: lesson.title, snippet: '', courseTitle: '', fromTitle: true })
    seen.add(lesson.id)
  }
  for (const hit of textHits) {
    if (seen.has(hit.lessonId)) continue
    rows.push({ lessonId: hit.lessonId, title: hit.lessonTitle, snippet: hit.snippet, courseTitle: hit.courseTitle, fromTitle: false })
    seen.add(hit.lessonId)
  }
  return rows.slice(0, 12)
}

/**
 * A section's effective openness: the user's explicit toggle (persisted per
 * course) overrides the frontier-based default. Pure.
 */
export function effectiveOpen(
  sectionTitle: string,
  defaultOpen: boolean,
  overrides: Readonly<Record<string, boolean>>,
): boolean {
  return overrides[sectionTitle] ?? defaultOpen
}

/**
 * The narrow-mode pane picker: only valid ids, remembering the last choice
 * (upstream's narrow switcher semantics). Pure.
 */
export function pickNarrowPane(stored: string | null): 'rail' | 'chat' | 'note' {
  return stored === 'rail' || stored === 'chat' || stored === 'note' ? stored : 'chat'
}

/**
 * Default expansion for one rail section: collapsed when every study lesson is
 * done (mastered) or not yet reachable (locked). The focus lesson's section
 * stays open; exam nodes never force a section open. Pure.
 */
export function sectionDefaultOpen(section: { lessons: ReadonlyArray<{ kind: string; status: string; focus: boolean }> }): boolean {
  return section.lessons.some(l => l.focus || (l.kind !== 'exam' && l.status !== 'mastered' && l.status !== 'locked'))
}

/**
 * C1 sticky-follow: the stream follows new rows only while the reader is
 * within `tolerance` of the bottom (upstream's 80px rule — scroll up and the
 * feed stops chasing you). Pure.
 */
export function isStuck(scrollTop: number, scrollHeight: number, clientHeight: number, tolerance = 80): boolean {
  return scrollHeight - scrollTop - clientHeight <= tolerance
}

/**
 * C12 touch pane swipe: a horizontal flick (>50px, dominance >2x) switches the
 * narrow pane neighbor; anything else is not a pane gesture. Pure
 * (upstream swipeTarget semantics).
 */
export function swipePane(pane: 'rail' | 'chat' | 'note', dx: number, dy: number): 'rail' | 'chat' | 'note' | null {
  if (Math.abs(dx) < 50 || Math.abs(dx) <= 2 * Math.abs(dy)) return null
  const order: ReadonlyArray<'rail' | 'chat' | 'note'> = ['rail', 'chat', 'note']
  const idx = order.indexOf(pane)
  if (idx < 0) return null
  const next = dx < 0 ? idx + 1 : idx - 1
  return next >= 0 && next < order.length ? order[next]! : null
}

/**
 * C12 selection-popover settle: coarse pointers need a longer quiet window
 * (upstream's 600/250 two-tier). Pure.
 */
export function settleMs(coarse: boolean): number {
  return coarse ? 600 : 250
}

/**
 * C9 interleaved review: pick one due lesson at random (Math.random; empty in,
 * null out). Pure.
 */
export function pickRandomDue<T>(items: readonly T[]): T | null {
  if (items.length === 0) return null
  return items[Math.floor(Math.random() * items.length)] ?? null
}

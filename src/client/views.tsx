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
  readonly role: 'user' | 'assistant' | 'error' | 'streaming' | 'thinking'
  readonly text: string
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

/**
 * Default expansion for one rail section: collapsed when every study lesson is
 * done (mastered) or not yet reachable (locked). The focus lesson's section
 * stays open; exam nodes never force a section open. Pure.
 */
export function sectionDefaultOpen(section: { lessons: ReadonlyArray<{ kind: string; status: string; focus: boolean }> }): boolean {
  return section.lessons.some(l => l.focus || (l.kind !== 'exam' && l.status !== 'mastered' && l.status !== 'locked'))
}

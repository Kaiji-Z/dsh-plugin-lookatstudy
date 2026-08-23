/**
 * Keyed `tool.call.toolview` entries: learning-aware cards for the
 * conversation tab's tool rows (our own study tab renders its own chips, but
 * learning also happens in the plain 对话 view). One generic card body over
 * the result's `meta` (the tool's presentationMeta lines — replay-safe by
 * construction) with a per-tool header; `study_record_answer` additionally
 * parses its args for a live ✓/✗ tone while the call is still running.
 * @module dsh-plugin-lookatstudy/client/toolviews
 */

import { createElement } from 'react'
import type { ReactNode } from 'react'
import { tr } from './locale.ts'

/** Structural slice of ToolCallBlock the views consume. */
export interface ToolBlockFace {
  kind?: string
  name?: string
  argsRaw?: string
  content?: ReadonlyArray<{ type: string; text?: string }>
  isError?: boolean
  meta?: unknown
}

/** Props slice the slot passes (ToolCallOwnerProps). */
export interface ToolViewPropsFace {
  toolName: string
  block: ToolBlockFace
}

/** Header glyph per tool (missing tools simply use the generic row). */
const TOOL_GLYPHS: Record<string, string> = {
  study_record_answer: '✍️',
  study_lesson: '📘',
  study_due_reviews: '🔁',
  study_exam_result: '🎯',
}

/** The ✓/✗ tone from record_answer's args; null for other shapes. Pure. */
export function answerTone(argsRaw: string | undefined): { correct: boolean; concept: string } | null {
  if (argsRaw === undefined) return null
  try {
    const args = JSON.parse(argsRaw) as { concept?: unknown; correct?: unknown }
    return {
      correct: args.correct === true,
      concept: typeof args.concept === 'string' && args.concept !== '' ? args.concept : tr('chip.unattributed'),
    }
  } catch {
    return null
  }
}

/** Card lines: the result's meta (string[]) when present, else its text content. Pure. */
export function metaLines(block: ToolBlockFace): string[] {
  if (Array.isArray(block.meta)) {
    const lines = (block.meta as unknown[]).filter((x): x is string => typeof x === 'string')
    if (lines.length > 0) return lines
  }
  return (block.content ?? [])
    .filter(b => b.type === 'text' && typeof b.text === 'string')
    .map(b => (b.text as string).split('\n'))
    .flat()
    .filter(l => l.trim() !== '')
}

/** Shared card body: header + lines; error results keep their text visible. */
function studyToolCard(toolName: string, block: ToolBlockFace, extra?: ReactNode): ReactNode {
  const lines = metaLines(block)
  const glyph = TOOL_GLYPHS[toolName] ?? '🔧'
  return createElement('div', { className: `lks-tv${block.isError === true ? ' err' : ''}` },
    extra ?? null,
    createElement('span', { className: 'lks-tv-head' }, `${glyph} ${toolName}`),
    lines.length === 0
      ? null
      : createElement('div', { className: 'lks-tv-lines' },
        ...lines.map((line, i) => createElement('div', { key: String(i), className: 'lks-tv-line' }, line)),
      ),
  )
}

/** study_record_answer: live ✓/✗ tone from args + the graded line from meta. */
export function StudyAnswerView({ toolName, block }: ToolViewPropsFace): ReactNode {
  const tone = answerTone(block.argsRaw)
  const chip = tone === null ? null : createElement('span', { className: `lks-tv-chip ${tone.correct ? 'ok' : 'bad'}` },
    tr(tone.correct ? 'chip.correct' : 'chip.wrong', { concept: tone.concept }))
  return studyToolCard(toolName, block, chip)
}

/** Generic meta-line card for the read-type study tools. */
export function StudyLessonView({ toolName, block }: ToolViewPropsFace): ReactNode {
  return studyToolCard(toolName, block)
}

/** study_due_reviews list card. */
export function StudyDueView({ toolName, block }: ToolViewPropsFace): ReactNode {
  return studyToolCard(toolName, block)
}

/** study_exam_result star card. */
export function StudyExamView({ toolName, block }: ToolViewPropsFace): ReactNode {
  return studyToolCard(toolName, block)
}

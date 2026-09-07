/**
 * RailList — the course rail as a quiet list (owner decision 2026-09-08: the
 * upstream balloon/physics map is a deliberate DEVIATION — a work tool reads
 * as a course tree, matching the chat/notebook columns' language). Sections
 * collapse; rows carry the status glyph, mastery bar, due/streaming badges,
 * and the same tooltips the map bubbles had. Focus-click stays zero-LLM.
 */
import { createElement, type CSSProperties, type ReactNode } from 'react'
import { IconBookFill16, IconCrownFill16, IconGoalOutline16, IconLoaderArc16, IconLockFill16, IconStarFill16 } from './icons.tsx'
import { tr } from './locale.ts'

/** The rail lesson projection (a structural slice of StudyData's section lessons). */
export interface MapLesson {
  readonly id: string
  readonly title: string
  readonly kind: 'study' | 'practice' | 'exam'
  readonly status: string
  readonly masteryPct: number | null
  readonly due: boolean
  readonly focus: boolean
}

/** Status→glyph-class fold: the four study states + the three exam variants. */
const STATUS_CLASS: Record<string, string> = { locked: 'locked', available: 'available', in_progress: 'in-progress', mastered: 'mastered' }

/** One fold for the row's state class (the list successor of bubbleClasses). */
export function rowStateClass(lesson: Pick<MapLesson, 'kind' | 'status'>, examAllowed: boolean): string {
  if (lesson.kind === 'exam') {
    if (!examAllowed) return 'exam-locked'
    return lesson.status === 'mastered' ? 'exam-passed' : 'exam'
  }
  return STATUS_CLASS[lesson.status] ?? 'locked'
}

/** The row's mastery-bar fill: mastered reads full, in-progress reads live. */
export function rowMasteryPct(lesson: Pick<MapLesson, 'status' | 'masteryPct'>): number | null {
  if (lesson.status === 'mastered') return 100
  if (lesson.status === 'in_progress') return lesson.masteryPct ?? 0
  return null
}

/**
 * A section's world (D6, upstream World = study | practice): the plugin's
 * state flattens the design's per-lesson world into lesson kinds, so a
 * section is the practice world iff it is non-empty and purely practice
 * (the design protocol marks sections, keeping them homogeneous).
 */
export function sectionWorldOf(section: { lessons: readonly Pick<MapLesson, 'kind'>[] }): 'study' | 'practice' {
  return section.lessons.length > 0 && section.lessons.every(l => l.kind === 'practice') ? 'practice' : 'study'
}

/** One section: a quiet header toggle + the lesson rows. */
export function ListSectionView({ section, examAllowed, open, onToggle, onJump, streamingId }: {
  section: { title: string; index: number; lessons: readonly MapLesson[] }
  examAllowed: boolean
  open: boolean
  onToggle: () => void
  onJump: (lessonId: string) => void
  /** D6: the lesson whose thread is streaming (its row wears the spinner). */
  streamingId?: string | null
}): ReactNode {
  const lessons = section.lessons
  const done = lessons.filter(l => l.status === 'mastered').length
  return createElement('section', { className: 'lks-railsec' },
    createElement('button', {
      type: 'button',
      className: 'lks-railsec-head',
      'aria-expanded': String(open),
      'data-tooltip': open ? tr('rail.section.collapse') : tr('rail.section.expand', { count: section.lessons.length }),
      onClick: onToggle,
    },
    createElement('span', { className: 'lks-railsec-num' }, String(section.index + 1)),
    createElement('span', { className: 'lks-railsec-title' }, section.title),
    createElement('span', { className: 'lks-railsec-count' }, `${String(done)}/${String(lessons.length)}`),
    createElement('span', { className: 'lks-railsec-caret' }, open ? '▾' : '▸')),
    open
      ? createElement('div', { className: 'lks-railsec-list' },
        ...lessons.map(lesson => {
          const locked = lesson.status === 'locked' || (lesson.kind === 'exam' && !examAllowed)
          const pct = rowMasteryPct(lesson)
          const state = rowStateClass(lesson, examAllowed)
          return createElement('button', {
            key: lesson.id,
            type: 'button',
            className: `lks-lessorow st-${state}${lesson.focus ? ' selected' : ''}`,
            'data-node-id': lesson.id,
            'aria-disabled': locked || undefined,
            'data-tooltip': `${lesson.title} — ${lesson.kind === 'exam' && !examAllowed ? tr('map.exam.locked') : locked ? tr('map.node.locked') : lesson.due ? tr('map.node.due') : lesson.title}`,
            onClick: () => { if (!locked) onJump(lesson.id) },
          },
          createElement('span', { className: 'lks-lessorow-glyph', 'aria-hidden': 'true' },
            state === 'exam-locked' || (lesson.kind !== 'exam' && lesson.status === 'locked')
              ? createElement(IconLockFill16, { size: 13, className: 'dim' })
              : lesson.kind === 'exam'
                ? createElement(IconGoalOutline16, { size: 14 })
                : lesson.status === 'locked'
                  ? createElement(IconLockFill16, { size: 13, className: 'dim' })
                  : lesson.status === 'mastered'
                    ? createElement(IconCrownFill16, { size: 14 })
                    : lesson.status === 'in_progress'
                      ? createElement(IconBookFill16, { size: 14 })
                      : createElement(IconStarFill16, { size: 14 })),
          createElement('span', { className: 'lks-lessorow-main' },
            createElement('span', { className: 'lks-lessorow-title' }, lesson.title),
            pct !== null
              ? createElement('span', { className: 'lks-lessorow-bar' },
                createElement('i', { style: { transform: `scaleX(${String(pct / 100)})` } } as CSSProperties))
              : null),
          lesson.due && !locked && lesson.kind !== 'exam'
            ? createElement('span', { className: 'lks-lessorow-due', 'aria-label': tr('map.node.due') }, '!')
            : null,
          streamingId !== undefined && streamingId !== null && streamingId === lesson.id
            ? createElement('span', {
              className: 'lks-lessorow-spin',
              role: 'status',
              'aria-label': tr('thread.streamingBadge'),
              'data-node-streaming': lesson.id,
            }, createElement(IconLoaderArc16, { size: 12 }))
            : null)
        }))
      : null,
  )
}

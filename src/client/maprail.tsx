/**
 * MapRail balloon map (P9b) — the upstream v0.28 course map ported onto the
 * plugin's rail: deterministic balloon layout (vendored mapLayout engine),
 * sagging bezier ropes with path-draw on walked segments, state bubbles with
 * 3D sphere lighting, signpost section heads, and the sky backdrop. This is
 * upstream's own reduced-motion presentation (static layout + balloon-bob
 * CSS), which is exactly the deterministic half of its physics map.
 */
import { createElement, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { computeBalloonLayout, balloonSegmentToPath, hashStr, NODE_BOX_H } from '../vendor/map-layout.ts'
import { IconBookFill16, IconCrownFill16, IconGoalOutline16, IconLoaderArc16, IconLockFill16, IconStarFill16 } from './icons.tsx'
import { tr } from './locale.ts'
import { useSectionIsland, type WeatherChannels } from './physics-map.tsx'
import { balloonSegmentToPath as _bsp } from '../vendor/map-layout.ts'

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

/** Upstream bubbleClass port: the four study states + the three exam variants.
 *  Status→class goes through a table (in_progress → in-progress, like upstream's switch). */
const STATUS_CLASS: Record<string, string> = { locked: 'locked', available: 'available', in_progress: 'in-progress', mastered: 'mastered' }

/** The physics ball radius (upstream BALL_RADIUS = 28; visual bubble ≈56px). */
const BALL_R = 28

export function bubbleClasses(lesson: Pick<MapLesson, 'kind' | 'status'>, examAllowed: boolean): string {
  if (lesson.kind === 'exam') {
    if (!examAllowed) return 'lks-bubble lks-exam-locked'
    return lesson.status === 'mastered' ? 'lks-bubble lks-exam-passed' : 'lks-bubble lks-exam'
  }
  return `lks-bubble lks-bubble-${STATUS_CLASS[lesson.status] ?? 'locked'}`
}

/** A rope segment is "walked" when its FROM node has been opened
 *  (upstream ropeStyleIsPassed: mastered | in_progress | available). */
export function ropePassed(from: Pick<MapLesson, 'status'>): boolean {
  return from.status === 'mastered' || from.status === 'in_progress' || from.status === 'available'
}

/** Deterministic sky preset per course (upstream pickPreset's CSS-essence port). */
export function pickSky(courseId: string): 'day' | 'dusk' | 'night' {
  return (['day', 'dusk', 'night'] as const)[hashStr(courseId) % 3]
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

/** One section: signpost head (still the plugin's collapse toggle) + the balloon field. */
export function MapSectionView({ section, examAllowed, open, onToggle, onJump, physics, physicsWeather, scrollRef, railRef, channels, streamingId }: {
  section: { title: string; index: number; lessons: readonly MapLesson[] }
  examAllowed: boolean
  open: boolean
  onToggle: () => void
  onJump: (lessonId: string) => void
  physics: boolean
  physicsWeather: string
  scrollRef: { current: HTMLDivElement | null }
  railRef: { current: HTMLDivElement | null }
  channels: WeatherChannels
  /** D6: the lesson whose thread is streaming (its ball wears the spinner). */
  streamingId?: string | null
}): ReactNode {
  const pathRef = useRef<HTMLDivElement | null>(null)
  const [containerW, setContainerW] = useState(268)
  useEffect(() => {
    if (pathRef.current === null) return
    const measure = (): void => {
      const w = pathRef.current?.clientWidth ?? 268
      setContainerW(w > 0 ? w : 268)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(pathRef.current)
    return () => { ro.disconnect() }
  }, [open])

  const lessons = section.lessons
  const layout = computeBalloonLayout(lessons.length, containerW, section.title)

  const lockedOf = (lessonId: string): boolean => {
    const lesson = lessons.find(l => l.id === lessonId)
    if (lesson === undefined) return true
    return lesson.status === 'locked' || (lesson.kind === 'exam' && !examAllowed)
  }
  const handles = useSectionIsland({
    enabled: physics && open && lessons.length > 0,
    weather: physicsWeather,
    lessons,
    layout,
    containerW,
    containerRef: pathRef,
    scrollRef,
    railRef,
    sectionKey: section.title,
    lockedOf,
    onJump,
    channels,
  })

  return createElement('section', { className: 'lks-mapsec' },
    createElement('button', {
      type: 'button',
      className: 'lks-signpost',
      'aria-expanded': String(open),
      'data-tooltip': open ? tr('rail.section.collapse') : tr('rail.section.expand', { count: section.lessons.length }),
      onClick: onToggle,
    },
    createElement('span', { className: 'lks-signpost-num' }, String(section.index + 1)),
    createElement('span', { className: 'lks-signpost-title' }, section.title),
    createElement('span', { className: 'lks-signpost-caret' }, open ? '▾' : '▸')),
    open && lessons.length > 0
      ? createElement('div', { ref: pathRef, className: `lks-mapfield${physics ? ' lks-physics' : ''}`, style: { minHeight: `${String(layout.height)}px` } },
        createElement('svg', {
          className: 'lks-mapropes',
          'aria-hidden': 'true',
          style: { height: `${String(layout.height + 40)}px`, overflow: 'visible' },
        },
        physics
          ? [
              // P15: the rope pool (one path per link; the frame loop rewrites d),
              // pulse rings, field halos, and the next-section exam knot.
              ...layout.segments.map(seg => createElement('path', {
                key: `rope-${String(seg.index)}`,
                'data-rope': '',
                d: balloonSegmentToPath(seg),
                stroke: ropePassed(lessons[seg.index] ?? { status: 'locked' }) ? 'var(--brand)' : 'var(--ink-faint)',
                'stroke-width': '2.5',
                'stroke-opacity': '0.5',
                fill: 'none',
                'stroke-linecap': 'round',
                'stroke-dasharray': '3 7',
              })),
              createElement('circle', { key: 'next-knot', 'data-next-knot': '', cx: 0, cy: 0, r: 3.5, fill: 'var(--gold)', opacity: '0' }),
              ...Array.from({ length: 8 }, (_v, i) => createElement('circle', { key: `pulse-${String(i)}`, 'data-pulse': '', cx: 0, cy: 0, r: 6, fill: 'none', stroke: 'var(--accent)', opacity: '0' })),
              ...lessons.map((lesson, i) => createElement('circle', { key: `field-${String(i)}`, 'data-field': '', 'data-node': lesson.id, cx: 0, cy: 0, r: BALL_R + 8, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2, opacity: '0' })),
            ]
          : [...layout.segments.map(seg => {
            const passed = ropePassed(lessons[seg.index] ?? { status: 'locked' })
            return createElement('path', {
              key: seg.index,
              d: balloonSegmentToPath(seg),
              stroke: passed ? 'var(--brand)' : 'var(--ink-faint)',
              'stroke-width': passed ? '4' : '2.5',
              'stroke-opacity': passed ? '0.6' : '0.5',
              fill: 'none',
              'stroke-linecap': 'round',
              'stroke-dasharray': passed ? 'none' : '3 7',
              style: passed ? ({ pathLength: 1, animation: 'lks-path-draw 600ms var(--ease-out-expo)' } as CSSProperties) : undefined,
            })
          })]),
        ...lessons.map((lesson, i) => {
          const node = layout.nodes[i]
          if (node === undefined) return null
          const h = hashStr(lesson.id)
          const locked = lesson.status === 'locked' || (lesson.kind === 'exam' && !examAllowed)
          const showRing = lesson.kind !== 'exam' && (lesson.status === 'in_progress' || lesson.status === 'mastered')
          const ringPct = lesson.status === 'mastered' ? 100 : lesson.status === 'in_progress' ? (lesson.masteryPct ?? 0) : 0
          return createElement('div', {
            key: lesson.id,
            className: 'lks-mapnode',
            'data-node-id': lesson.id,
            style: {
              left: `${String(node.x - 55)}px`,
              top: `${String(node.y - NODE_BOX_H / 2 + 10)}px`,
              '--bob-delay': `${String((h % 40) / 10)}s`,
              '--bob-duration': `${String(5 + (h % 30) / 10)}s`,
              ...(handles !== null ? { touchAction: 'pan-y' } : {}),
            } as CSSProperties,
            ...(handles !== null
              ? {
                  onPointerDown: (e: import('react').PointerEvent<HTMLDivElement>) => { handles.onBallPointerDown(e, lesson.id) },
                  onPointerMove: handles.onBallPointerMove,
                  onPointerUp: handles.onBallPointerUp,
                  onPointerCancel: handles.onBallPointerUp,
                }
              : {}),
          },
          createElement('button', {
            type: 'button',
            className: `${bubbleClasses(lesson, examAllowed)}${lesson.focus ? ' selected' : ''}`,
            'aria-disabled': locked || undefined,
            'data-tooltip': `${lesson.title} — ${lesson.kind === 'exam' && !examAllowed ? tr('map.exam.locked') : locked ? tr('map.node.locked') : lesson.due ? tr('map.node.due') : lesson.title}`,
            onClick: () => { if (!locked) onJump(lesson.id) },
          },
          showRing
            ? createElement('svg', { className: 'lks-bubble-ring', viewBox: '0 0 56 56', 'aria-hidden': 'true' },
              createElement('circle', { cx: 28, cy: 28, r: 25, fill: 'none', stroke: 'rgb(255 255 255 / 0.2)', 'stroke-width': 2.5 }),
              createElement('circle', {
                cx: 28, cy: 28, r: 25, fill: 'none',
                stroke: lesson.status === 'mastered' ? '#ffc800' : 'white',
                'stroke-width': 2.5, 'stroke-linecap': 'round',
                'stroke-dasharray': `${String((ringPct / 100) * 157)} 157`,
              }))
            : null,
          lesson.kind === 'exam'
            ? (locked
                ? createElement(IconLockFill16, { size: 22, className: 'lks-bubble-glyph dim' })
                : createElement(IconGoalOutline16, { size: 24, className: 'lks-bubble-glyph' }))
            : lesson.status === 'locked'
              ? createElement(IconLockFill16, { size: 20, className: 'lks-bubble-glyph dim' })
              : lesson.status === 'mastered'
                ? createElement(IconCrownFill16, { size: 24, className: 'lks-bubble-glyph' })
                : lesson.status === 'in_progress'
                  ? createElement(IconBookFill16, { size: 24, className: 'lks-bubble-glyph' })
                  : createElement(IconStarFill16, { size: 24, className: 'lks-bubble-glyph' }),
          lesson.due && !locked && lesson.kind !== 'exam'
            ? createElement('span', { className: 'lks-bubble-due', 'aria-label': tr('map.node.due') }, '!')
            : null,
          // D6 (upstream v0.23 streaming badge): the ball of a streaming thread
          // wears a spinning chip at its top-right — including from the map.
          streamingId !== undefined && streamingId !== null && streamingId === lesson.id
            ? createElement('span', {
              className: 'lks-bubble-spin',
              role: 'status',
              'aria-label': tr('thread.streamingBadge'),
              'data-node-streaming': lesson.id,
            }, createElement(IconLoaderArc16, { size: 14 }))
            : null),
          lesson.focus
            ? createElement('div', { className: 'lks-bubble-name' }, lesson.title)
            : null)
        }))
      : null,
  )
}

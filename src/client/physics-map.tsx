/**
 * Physics map layer (P15, upstream MapRail's physics half): Matter.js islands
 * per section (real gravity + buoyant balloons on particle-chain ropes),
 * DOM-transform sync every frame, drag with threshold classification (click
 * vs drag, locked balls are static rigid bodies, 300ms post-drag click
 * suppression), viewport ±200px freeze, live-state continuation across island
 * rebuilds, and the weather canvases (attachSky over the rail, attachOrbWeather
 * over the balls with impact-splash/flake channels + physics-driven snow load).
 * reduced-motion keeps the static path (this layer never mounts).
 * @module dsh-plugin-lookatstudy/client/physics-map
 */

import { createElement, useEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react'
import {
  ANCHOR_KNOT_Y, BALL_RADIUS, ROPE_ATTACH,
  classifyPointer, createSectionIsland, decaySquash, knotX, remapSpawnX, ropeChainPathD, squashTransform,
  type FlakeEvent, type ImpactEvent, type SectionIsland, type Vec2,
} from '../vendor/map-physics.ts'
import { PRESETS, PRESET_KEYS, attachOrbWeather, attachSky, type OrbPos } from '../vendor/sky-canvas.ts'
import { hashStr } from '../vendor/map-layout.ts'
import type { MapLesson } from './maprail.tsx'

/** Weather event channels (nav coordinates) shared by islands and the orb canvas. */
export interface WeatherChannels {
  impacts: ImpactEvent[]
  flakes: FlakeEvent[]
  /** Physics snow load per node (the orb canvas renders domes from this truth). */
  orbSnow: Map<string, number>
}

export function makeWeatherChannels(): WeatherChannels {
  return { impacts: [], flakes: [], orbSnow: new Map() }
}

/**
 * The deterministic preset key for a course. Upstream's pickPreset re-seeds
 * with performance.now() so every launch re-rolls the weather; the plugin
 * pins one season+weather per courseId instead — probes, freeze tests, and
 * the env-* filter all need the rail's sky to be stable per course.
 */
export function coursePresetKey(courseId: string | null): string {
  return PRESET_KEYS[hashStr(courseId ?? 'none') % PRESET_KEYS.length]!
}

/** The course's season + weather (drives the env-* bubble filter and the canvases). */
export function courseEnv(courseId: string | null): { season: string; weather: string } {
  const preset = PRESETS[coursePresetKey(courseId)]
  return preset === undefined ? { season: 'summer', weather: 'clear' } : { season: preset.season, weather: preset.weather }
}

/** The deterministic weather key for a course. */
export function courseWeather(courseId: string | null): string {
  return courseEnv(courseId).weather
}

/* ── the sky + orb-weather canvases (absolute children of the rail column) ── */

export function MapSky({ scrollRef, railRef, courseId, channels }: {
  scrollRef: RefObject<HTMLDivElement | null>
  railRef: RefObject<HTMLDivElement | null>
  courseId: string | null
  channels: WeatherChannels
}): ReactNode {
  const skyRef = useRef<HTMLCanvasElement | null>(null)
  const orbRef = useRef<HTMLCanvasElement | null>(null)
  const presetKey = coursePresetKey(courseId)
  const preset = PRESETS[presetKey]

  useEffect(() => {
    const canvas = skyRef.current
    const scroll = scrollRef.current
    const nav = railRef.current
    if (canvas === null || scroll === null || nav === null || preset === undefined) return
    return attachSky(canvas, scroll, nav, preset)
  }, [scrollRef, railRef, preset])

  useEffect(() => {
    const canvas = orbRef.current
    const nav = railRef.current
    const scroll = scrollRef.current
    if (canvas === null || nav === null || scroll === null || preset === undefined) return
    // cached node list + navRect (upstream Phase 0 perf: no per-frame queries)
    let cachedNodes: HTMLDivElement[] | null = null
    let cachedNavRect: DOMRect | null = null
    const invalidate = (): void => { cachedNodes = null; cachedNavRect = null }
    const mo = new MutationObserver(invalidate)
    mo.observe(scroll, { childList: true, subtree: true })
    window.addEventListener('resize', invalidate)
    const getOrbs = (): OrbPos[] => {
      if (cachedNodes === null) cachedNodes = Array.from(scroll.querySelectorAll<HTMLDivElement>('.lks-mapnode'))
      const navRect = cachedNavRect ?? nav.getBoundingClientRect()
      cachedNavRect = navRect
      const out: OrbPos[] = []
      for (const n of cachedNodes) {
        const r = n.getBoundingClientRect()
        if (r.bottom < navRect.top || r.top > navRect.bottom) continue
        const nodeId = n.getAttribute('data-node-id') ?? undefined
        const snow = nodeId !== undefined ? channels.orbSnow.get(nodeId) : undefined
        out.push({
          x: r.left - navRect.left + r.width / 2,
          y: r.top - navRect.top + r.height / 2,
          r: r.width / 2,
          ...(snow !== undefined ? { snow } : {}),
        })
      }
      return out
    }
    const getImpacts = (): ImpactEvent[] => {
      const out = channels.impacts.slice()
      channels.impacts.length = 0
      return out
    }
    const getFlakes = (): FlakeEvent[] => {
      const out = channels.flakes.slice()
      channels.flakes.length = 0
      return out
    }
    const detach = attachOrbWeather(canvas, nav, preset, getOrbs, getImpacts, getFlakes)
    return () => {
      detach()
      mo.disconnect()
      window.removeEventListener('resize', invalidate)
    }
  }, [scrollRef, railRef, preset, channels])

  return createElement('div', { className: 'lks-physky', 'aria-hidden': 'true' },
    createElement('canvas', { ref: skyRef, className: 'lks-sky-canvas' }),
    createElement('canvas', { ref: orbRef, className: 'lks-orb-weather-canvas' }),
  )
}

/* ── the per-section island: lifecycle + frame loop + pointer routing ── */

export interface SectionPhysicsHandles {
  onBallPointerDown: (e: ReactPointerEvent<HTMLDivElement>, nodeId: string) => void
  onBallPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void
  onBallPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void
}

export function useSectionIsland(opts: {
  enabled: boolean
  weather: string
  lessons: readonly MapLesson[]
  layout: { nodes: ReadonlyArray<{ x: number; y: number }>; height: number }
  containerW: number
  containerRef: RefObject<HTMLDivElement | null>
  scrollRef: RefObject<HTMLDivElement | null>
  railRef: RefObject<HTMLDivElement | null>
  sectionKey: string
  lockedOf: (lessonId: string) => boolean
  onJump: (lessonId: string) => void
  channels: WeatherChannels
}): SectionPhysicsHandles | null {
  const islandRef = useRef<SectionIsland | null>(null)
  const liveStateRef = useRef<Map<string, { x: number; y: number; vx?: number; vy?: number }>>(new Map())
  const liveWidthRef = useRef(0)
  const pointerRef = useRef<{ track: { startX: number; startY: number }; id: number; dragging: boolean; nodeId: string } | null>(null)
  const suppressClickUntilRef = useRef(0)

  const lessonSig = opts.lessons.map(l => l.id).join(',')
  const lockedSig = opts.lessons.map(l => opts.lockedOf(l.id) ? 1 : 0).join('')

  useEffect(() => {
    if (!opts.enabled || opts.lessons.length === 0 || opts.containerW <= 0) return
    const container = opts.containerRef.current
    const scroller = opts.scrollRef.current
    if (container === null || scroller === null) return

    // the exam rope's next-section knot: measure the next signpost when present
    let nextKnot: Vec2 | undefined
    const lastLesson = opts.lessons[opts.lessons.length - 1]
    if (lastLesson !== undefined && lastLesson.kind === 'exam') {
      // `?? null`: the ?. chain yields undefined (no next sibling in DOM) and the
      // null check alone let undefined through — typing in search force-opens every
      // section, so the course-final exam section has no nextElementSibling to rope to.
      const nextSign = container.closest('section')?.nextElementSibling?.querySelector('.lks-signpost') ?? null
      if (nextSign !== null) {
        nextKnot = {
          x: knotX(`${opts.sectionKey}:next`, opts.containerW),
          y: nextSign.getBoundingClientRect().top - container.getBoundingClientRect().top,
        }
      }
    }
    const island = createSectionIsland({
      nodes: opts.layout.nodes.map((n, i) => {
        const lesson = opts.lessons[i]!
        const sp = liveStateRef.current.get(lesson.id)
        return {
          id: lesson.id,
          x: n.x,
          y: n.y,
          isExam: lesson.kind === 'exam',
          locked: opts.lockedOf(lesson.id),
          spawn: sp !== undefined ? remapSpawnX(sp, liveWidthRef.current, opts.containerW) : undefined,
        }
      }),
      width: opts.containerW,
      height: opts.layout.height + 40, // rope-chain droop margin
      weather: opts.weather,
      anchorKnotX: knotX(`${opts.sectionKey}:knot`, opts.containerW),
      nextKnot,
    })
    islandRef.current = island
    const nextKnotEl = container.querySelector('[data-next-knot]')
    if (nextKnotEl !== null) {
      if (island.nextKnot !== undefined) {
        nextKnotEl.setAttribute('cx', String(island.nextKnot.x))
        nextKnotEl.setAttribute('cy', String(island.nextKnot.y))
      } else {
        nextKnotEl.setAttribute('opacity', '0')
      }
    }

    const wrappers = new Map<string, HTMLDivElement>()
    for (const el of container.querySelectorAll<HTMLDivElement>('[data-node-id]')) {
      const id = el.dataset.nodeId
      if (id !== undefined) wrappers.set(id, el)
    }
    const ropeEls = Array.from(container.querySelectorAll('[data-rope]')) as SVGPathElement[]
    const pulseEls = Array.from(container.querySelectorAll('[data-pulse]')) as SVGCircleElement[]
    const fieldEls = Array.from(container.querySelectorAll('[data-field]')) as SVGCircleElement[]

    // viewport gate: freeze islands ±200px outside the scroller's view
    let inView = true
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) inView = en.isIntersecting
    }, { root: scroller, rootMargin: '200px 0px 200px 0px' })
    io.observe(container)

    const PULSE_MS = 520
    const pulses: Array<{ x: number; y: number; t0: number; s: number }> = []

    let raf = 0
    let last = performance.now()
    const frame = (now: number): void => {
      raf = requestAnimationFrame(frame)
      const dt = Math.min(50, now - last)
      last = now
      if (!inView) return

      island.step(dt)

      // balls: transform = physics pos − layout pos (+ collision squash), direct DOM
      for (const b of island.balls) {
        const el = wrappers.get(b.nodeId)
        if (el !== undefined) {
          el.style.transform = squashTransform(b.body.position.x - b.layoutX, b.body.position.y - b.layoutY, b.squash, b.squashAngle)
        }
        b.squash = decaySquash(b.squash, dt)
        opts.channels.orbSnow.set(b.nodeId, b.snow)
      }

      // ropes: polyline through the attach points + particles
      const attachOf = (id: string): Vec2 => {
        if (id === '__anchor') return island.anchor
        if (id === '__next') return island.nextKnot ?? island.anchor
        const b = island.ball(id)
        if (b !== undefined) return { x: b.body.position.x, y: b.body.position.y + BALL_RADIUS * ROPE_ATTACH }
        const i = opts.lessons.findIndex(l => l.id === id)
        const n = i >= 0 ? opts.layout.nodes[i] : undefined
        return n !== undefined ? { x: n.x, y: n.y + BALL_RADIUS * ROPE_ATTACH } : { x: 0, y: 0 }
      }
      for (let i = 0; i < island.links.length && i < ropeEls.length; i++) {
        const link = island.links[i]!
        const points: Vec2[] = [attachOf(link.from)]
        for (const p of link.particles) points.push({ x: p.position.x, y: p.position.y })
        points.push(attachOf(link.to))
        ropeEls[i]!.setAttribute('d', ropeChainPathD(points))
      }

      // field rings (pair-repulsion glow)
      for (let i = 0; i < island.balls.length && i < fieldEls.length; i++) {
        const b = island.balls[i]!
        const el = fieldEls[i]!
        if (b.field > 0.03) {
          el.setAttribute('cx', String(b.body.position.x))
          el.setAttribute('cy', String(b.body.position.y))
          el.setAttribute('r', String(BALL_RADIUS + 4 + b.field * 5))
          el.setAttribute('opacity', String((0.30 * b.field).toFixed(3)))
        } else {
          el.setAttribute('opacity', '0')
        }
      }

      // impact pulses (SVG ring pool) + weather channel feeds (rail coords)
      const impacts = island.drainImpacts()
      for (const im of impacts) pulses.push({ x: im.x, y: im.y, t0: now, s: Math.min(1, im.speed / 14) })
      for (let i = pulses.length - 1; i >= 0; i--) { if (now - pulses[i]!.t0 > PULSE_MS) pulses.splice(i, 1) }
      for (let i = 0; i < pulseEls.length; i++) {
        const p = pulses[i]
        const el = pulseEls[i]!
        if (p === undefined) { el.setAttribute('opacity', '0'); continue }
        const k = (now - p.t0) / PULSE_MS
        el.setAttribute('cx', String(p.x))
        el.setAttribute('cy', String(p.y))
        el.setAttribute('r', String(6 + k * (14 + p.s * 14)))
        el.setAttribute('opacity', String(0.55 * (1 - k)))
        el.setAttribute('stroke-width', String(2 + p.s * 1.5))
      }

      const shedFlakes = island.drainFlakes()
      const rail = opts.railRef.current
      if ((impacts.length > 0 || shedFlakes.length > 0) && rail !== null) {
        const cr = container.getBoundingClientRect()
        const nr = rail.getBoundingClientRect()
        const toRail = (p: { x: number; y: number }): { x: number; y: number } => ({ x: p.x + cr.left - nr.left, y: p.y + cr.top - nr.top })
        for (const im of impacts) opts.channels.impacts.push({ ...toRail(im), speed: im.speed })
        for (const f of shedFlakes) opts.channels.flakes.push({ ...toRail(f), vx: f.vx, vy: f.vy, amount: f.amount })
      }
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      io.disconnect()
      // continuation snapshot (locked balls sit at their layout positions)
      for (const b of island.balls) {
        liveStateRef.current.set(b.nodeId, {
          x: b.body.position.x, y: b.body.position.y,
          vx: b.body.velocity.x, vy: b.body.velocity.y,
        })
      }
      liveWidthRef.current = opts.containerW
      island.dispose()
      islandRef.current = null
      for (const el of wrappers.values()) el.style.transform = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.enabled, opts.containerW, lessonSig, lockedSig, opts.sectionKey, opts.weather])

  if (!opts.enabled) return null

  /* pointer routing: soft drag past the threshold, self-routed clicks
     (setPointerCapture redirects the native click away from the button). */
  return {
    onBallPointerDown: (e, nodeId) => {
      const island = islandRef.current
      if (island === null || e.button !== 0) return
      if (opts.lockedOf(nodeId)) return // locked balls are not draggable
      const container = opts.containerRef.current
      if (container === null) return
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        /* synthetic events carry no real pointer */
      }
      suppressClickUntilRef.current = 0
      pointerRef.current = { track: { startX: e.clientX, startY: e.clientY }, id: e.pointerId, dragging: false, nodeId }
    },
    onBallPointerMove: (e) => {
      const p = pointerRef.current
      const island = islandRef.current
      if (p === null || island === null || e.pointerId !== p.id) return
      const container = opts.containerRef.current
      if (container === null) return
      if (!p.dragging && classifyPointer(p.track, e.clientX, e.clientY) === 'drag') {
        p.dragging = true
        e.currentTarget.style.zIndex = '40'
        const cr = container.getBoundingClientRect()
        island.beginDrag(p.nodeId, e.clientX - cr.left, e.clientY - cr.top)
      }
      if (!p.dragging) return // under the threshold: vertical gestures feed scrolling
      const cr = container.getBoundingClientRect()
      island.moveDrag(e.clientX - cr.left, e.clientY - cr.top)
    },
    onBallPointerUp: (e) => {
      const p = pointerRef.current
      if (p === null || e.pointerId !== p.id) return
      islandRef.current?.endDrag()
      e.currentTarget.style.zIndex = ''
      if (classifyPointer(p.track, e.clientX, e.clientY) === 'drag') {
        // suppress the capture-redirected click for a short window
        suppressClickUntilRef.current = Date.now() + 300
      } else {
        const lesson = opts.lessons.find(l => l.id === p.nodeId)
        if (lesson !== undefined && Date.now() >= suppressClickUntilRef.current && !opts.lockedOf(lesson.id)) {
          opts.onJump(lesson.id)
        }
      }
      pointerRef.current = null
    },
  }
}

/**
 * CanvasStage (P14, upstream CanvasStage.tsx port): the canvas-style artifact
 * stage — content keeps its natural size and one transform (translate+scale)
 * does everything. Gestures: single-pointer drag pan, two-pointer pinch
 * anchored at the midpoint, wheel zoom anchored at the cursor, double
 * click/tap toggles fit↔100%. ResizeObserver refits on content/stage size
 * changes (mermaid's async svg). A floating −/%/fit/+ toolbar stays mounted.
 * Shared by the notebook's board tab and the diagram modals.
 * (lucide glyphs collapse to text/plugin icons; the client stays dependency-
 * free.)
 * @module dsh-plugin-lookatstudy/client/canvasstage
 */

import { createElement, useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react'
import { clampPan, fitTransform, zoomAtClamped, type PanZoomTransform } from '../vendor/panzoom.ts'
import { IconMaximizeOutline16, IconPlusOutline16 } from './icons.tsx'
import { tr } from './locale.ts'

const MIN_SCALE = 0.05
const MAX_SCALE = 4
/** 工具条步进(手势/滚轮连续,按钮给干脆的一档)。 */
const STEP = 1.25

export function CanvasStage({ children, grid = true, testid }: {
  children: ReactNode
  /** 画布点阵底纹(黑板/弹窗 true;窄容器可关)。 */
  grid?: boolean
  testid?: string
}): ReactNode {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [tf, setTf] = useState<PanZoomTransform>({ x: 0, y: 0, scale: 1 })
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  /** 活跃手势中禁用过渡(跟手必须即时;按钮缩放才享受平滑)。 */
  const [gesturing, setGesturing] = useState(false)
  const lastPointerTypeRef = useRef('mouse')
  const atFitRef = useRef(true)
  const gesture = useRef<{
    pointers: Map<number, { x: number; y: number }>
    pinchBase: { dist: number; factorAcc: number } | null
    lastMid: { x: number; y: number } | null
    panning: boolean
    moved: boolean
  }>({ pointers: new Map(), pinchBase: null, lastMid: null, panning: false, moved: false })
  const lastTapRef = useRef<{ t: number; x: number; y: number } | null>(null)

  const bounds = useCallback(() => {
    const stage = stageRef.current
    const content = contentRef.current
    return {
      min: MIN_SCALE,
      max: MAX_SCALE,
      contentW: content?.offsetWidth ?? 0,
      contentH: content?.offsetHeight ?? 0,
      viewW: stage?.clientWidth ?? 0,
      viewH: stage?.clientHeight ?? 0,
    }
  }, [])

  const refit = useCallback(() => {
    const b = bounds()
    if (b.contentW === 0 || b.viewW === 0) return
    setTf(fitTransform(b.contentW, b.contentH, b.viewW, b.viewH))
    atFitRef.current = true
  }, [bounds])

  // 内容(自然尺寸)+ 舞台双 RO → 变化即适屏(mermaid 异步出 svg 后自动回正)
  useEffect(() => {
    const stage = stageRef.current
    const content = contentRef.current
    if (stage === null || content === null) return
    const measure = (): void => {
      setSize({ w: content.offsetWidth, h: content.offsetHeight })
      refit()
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(content)
    ro.observe(stage)
    return () => { ro.disconnect() }
  }, [refit])

  const zoomBy = useCallback((factor: number, ax?: number, ay?: number) => {
    const b = bounds()
    const cx = ax ?? b.viewW / 2
    const cy = ay ?? b.viewH / 2
    setTf(cur => zoomAtClamped(cur, factor, cx, cy, b))
    atFitRef.current = false
  }, [bounds])

  /* ---- 指针手势(拖动/捏合/双击) ---- */
  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    // 工具条上的指针不进手势(setPointerCapture 会把后续 click 重定向到舞台)
    if ((e.target as HTMLElement).closest?.('[data-testid="canvas-zoom-controls"]') !== null) return
    const el = e.currentTarget
    try {
      el.setPointerCapture(e.pointerId)
    } catch {
      /* 合成事件无真实指针 */
    }
    const g = gesture.current
    lastPointerTypeRef.current = e.pointerType
    if (g.pointers.size === 0) setGesturing(true)
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (g.pointers.size === 2) {
      const [p1, p2] = [...g.pointers.values()]
      g.pinchBase = { dist: Math.hypot(p1!.x - p2!.x, p1!.y - p2!.y), factorAcc: 1 }
      g.lastMid = { x: (p1!.x + p2!.x) / 2, y: (p1!.y + p2!.y) / 2 }
      g.panning = false
    } else if (g.pointers.size === 1) {
      g.panning = true
      g.moved = false
      g.lastMid = { x: e.clientX, y: e.clientY }
    }
  }, [])

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current
    if (!g.pointers.has(e.pointerId)) return
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const stage = stageRef.current
    if (stage === null) return
    const rect = stage.getBoundingClientRect()

    if (g.pointers.size >= 2 && g.pinchBase !== null) {
      // 捏合:锚定双指中点
      const [p1, p2] = [...g.pointers.values()]
      const dist = Math.hypot(p1!.x - p2!.x, p1!.y - p2!.y)
      const mid = { x: (p1!.x + p2!.x) / 2, y: (p1!.y + p2!.y) / 2 }
      if (g.pinchBase.dist > 0) {
        const factor = dist / g.pinchBase.dist / g.pinchBase.factorAcc
        g.pinchBase.factorAcc *= factor
        zoomBy(factor, mid.x - rect.left, mid.y - rect.top)
      }
      // 中点移动 = 平移(捏着拖)。增量先落局部常量 — updater 必须纯。
      if (g.lastMid !== null) {
        const dx = mid.x - g.lastMid.x
        const dy = mid.y - g.lastMid.y
        const b = bounds()
        setTf(cur => clampPan({ ...cur, x: cur.x + dx, y: cur.y + dy }, b.contentW, b.contentH, b.viewW, b.viewH))
      }
      g.lastMid = mid
      return
    }

    if (g.panning && g.lastMid !== null) {
      const dx = e.clientX - g.lastMid.x
      const dy = e.clientY - g.lastMid.y
      if (Math.abs(dx) + Math.abs(dy) > 2) g.moved = true
      const b = bounds()
      setTf(cur => clampPan({ ...cur, x: cur.x + dx, y: cur.y + dy }, b.contentW, b.contentH, b.viewW, b.viewH))
      g.lastMid = { x: e.clientX, y: e.clientY }
    }
  }, [bounds, zoomBy])

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current
    const wasSingle = g.pointers.size === 1
    g.pointers.delete(e.pointerId)
    if (g.pointers.size < 2) g.pinchBase = null
    if (g.pointers.size === 0) {
      g.panning = false
      g.lastMid = null
      setGesturing(false)
      // 单指快速点按(无拖动)= 双击检测 → 适屏↔100%(触屏路径)
      if (wasSingle && !g.moved && e.pointerType !== 'mouse') {
        const now = performance.now()
        const last = lastTapRef.current
        if (last !== null && now - last.t < 320 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 32) {
          const b = bounds()
          if (atFitRef.current) {
            setTf(clampPan({ x: (b.viewW - b.contentW) / 2, y: Math.max(24, (b.viewH - b.contentH) / 2), scale: 1 }, b.contentW, b.contentH, b.viewW, b.viewH))
            atFitRef.current = false
          } else {
            refit()
          }
          lastTapRef.current = null
        } else {
          lastTapRef.current = { t: now, x: e.clientX, y: e.clientY }
        }
      }
    } else if (g.pointers.size === 1) {
      const only = [...g.pointers.values()][0]!
      g.lastMid = { x: only.x, y: only.y }
      g.panning = true
    }
  }, [bounds, refit])

  // 滚轮缩放(画布惯例:锚定光标)
  const onWheel = useCallback((e: ReactWheelEvent<HTMLDivElement>) => {
    e.preventDefault()
    const rect = stageRef.current?.getBoundingClientRect()
    if (rect === undefined) return
    zoomBy(e.deltaY < 0 ? STEP : 1 / STEP, e.clientX - rect.left, e.clientY - rect.top)
  }, [zoomBy])

  // 鼠标双击:适屏↔100%(触屏走双 tap 路径)
  const onDoubleClick = useCallback(() => {
    if (lastPointerTypeRef.current !== 'mouse') return
    const b = bounds()
    if (atFitRef.current) {
      setTf(clampPan({ x: (b.viewW - b.contentW) / 2, y: Math.max(24, (b.viewH - b.contentH) / 2), scale: 1 }, b.contentW, b.contentH, b.viewW, b.viewH))
      atFitRef.current = false
    } else {
      refit()
    }
  }, [bounds, refit])

  return createElement('div', {
    ref: stageRef,
    'data-testid': testid,
    'data-noswipe': '',
    className: `lks14-stage${grid ? ' grid' : ''}`,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    onWheel,
    onDoubleClick,
  },
    createElement('div', {
      ref: contentRef,
      className: `lks14-stage-content${gesturing ? '' : ' glide'}`,
      style: { transform: `translate(${String(tf.x)}px, ${String(tf.y)}px) scale(${String(tf.scale)})`, transformOrigin: '0 0' },
    }, children),
    createElement('div', { className: 'lks14-stage-tools', 'data-testid': 'canvas-zoom-controls' },
      createElement('button', {
        onClick: () => { zoomBy(1 / STEP) },
        disabled: tf.scale <= MIN_SCALE + 1e-6,
        'aria-label': tr('artifact.zoomOut'),
        'data-testid': 'canvas-zoom-out',
      }, '−'),
      createElement('span', { 'data-testid': 'canvas-zoom-pct' }, `${String(Math.round(tf.scale * 100))}%`),
      createElement('button', {
        onClick: () => { zoomBy(STEP) },
        disabled: tf.scale >= MAX_SCALE - 1e-6,
        'aria-label': tr('artifact.zoomIn'),
        'data-testid': 'canvas-zoom-in',
      }, createElement(IconPlusOutline16, { size: 14 })),
      createElement('button', {
        onClick: () => { refit() },
        'aria-label': tr('artifact.canvas.fit'),
        'data-testid': 'canvas-zoom-fit',
      }, createElement(IconMaximizeOutline16, { size: 14 })),
    ),
    // 自然尺寸探针(供测试断言,零视觉)
    createElement('span', { 'data-testid': 'canvas-natural-size', className: 'lks14-stage-probe' },
      size === null ? '' : `${String(size.w)}x${String(size.h)}`),
  )
}

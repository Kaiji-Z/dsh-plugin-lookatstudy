/**
 * GlobalTooltip (C15, upstream GlobalTooltip port): one portal-level tooltip
 * riding the panel — mouse pointers follow the cursor, coarse pointers anchor
 * above the element after a 500ms long-press; both clamp into the viewport.
 * Elements opt in with data-tooltip instead of the native title.
 * @module dsh-plugin-lookatstudy/client/tooltip
 */

import { createElement, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

/** Clamp a tooltip box into the viewport (pure — test-frozen). */
export function clampTip(x: number, y: number, w: number, h: number, vw: number, vh: number): { x: number; y: number } {
  return {
    x: Math.max(8, Math.min(x, vw - w - 8)),
    y: Math.max(8, Math.min(y, vh - h - 8)),
  }
}

/** Long-press threshold for coarse pointers (upstream 500ms). */
export const TIP_LONGPRESS_MS = 500

export function GlobalTooltip(): ReactNode {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null)
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
    const target = (e: PointerEvent): HTMLElement | null =>
      (e.target as HTMLElement | null)?.closest?.('[data-tooltip]') ?? null

    const show = (el: HTMLElement, x: number, y: number): void => {
      const text = el.getAttribute('data-tooltip') ?? ''
      if (text === '') return
      setTip({ text, x, y })
    }

    // the tip is position:fixed INSIDE the zoomed .lks-ui subtree — CSS zoom
    // scales fixed coordinates, so raw clientX/Y drift grows across the panel
    // (a 1.1 zoom trails the mouse ~100px at the panel's right edge). Divide
    // by the live zoom and keep the offset tight (0.19 owner note: the tip
    // sits at the mouse).
    const panelZoom = (): number => {
      const z = parseFloat(document.querySelector('.lks-ui')?.style.zoom ?? '1')
      return Number.isFinite(z) && z > 0 ? z : 1
    }
    const onMove = (e: PointerEvent): void => {
      if (coarse) return
      const el = target(e)
      if (el === null) { setTip(null); return }
      const z = panelZoom()
      show(el, (e.clientX + 10) / z, (e.clientY + 12) / z)
    }
    const onLeave = (): void => { setTip(null) }

    const onDown = (e: PointerEvent): void => {
      if (!coarse) return
      const el = target(e)
      if (el === null) return
      const start = { x: e.clientX, y: e.clientY }
      if (pressTimer.current !== null) clearTimeout(pressTimer.current)
      pressTimer.current = setTimeout(() => {
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < 10) {
          const r = el.getBoundingClientRect()
          const z = panelZoom()
          show(el, (r.left + r.width / 2 - 80) / z, (r.top - 36) / z)
        }
      }, TIP_LONGPRESS_MS)
    }
    const onUp = (): void => {
      if (pressTimer.current !== null) { clearTimeout(pressTimer.current); pressTimer.current = null }
    }
    // a click dismisses — reading a tooltip over the thing you just acted on
    // must not outlive the action
    const onClick = (): void => { setTip(null) }

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerleave', onLeave)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('pointerup', onUp)
    document.addEventListener('click', onClick)
    return () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerleave', onLeave)
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('click', onClick)
      if (pressTimer.current !== null) clearTimeout(pressTimer.current)
    }
  }, [])

  if (tip === null) return null
  const z = parseFloat(document.querySelector('.lks-ui')?.style.zoom ?? '1') || 1
  const clamped = clampTip(tip.x, tip.y, 200, 40, window.innerWidth / z, window.innerHeight / z)
  return createElement('div', { className: 'lks-tip', role: 'tooltip', style: { left: `${String(clamped.x)}px`, top: `${String(clamped.y)}px` } }, tip.text)
}

/**
 * CelebrationLayer (P13, upstream CelebrationLayer.tsx port): the root-level
 * celebration renderer — canvas particle bursts with idle rAF stop, or a
 * centered static glyph fade when the user prefers reduced motion. One
 * instance mounts at the panel root; z above everything, pointer-events off.
 * (Upstream's framer-motion AnimatePresence collapses to a CSS opacity
 * transition here — the client bundle stays dependency-free.)
 * @module dsh-plugin-lookatstudy/client/celebration-layer
 */

import { createElement, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { onCelebration, iconFor, particleAlpha, seedBurst, stepParticle, type CelebrationEvent, type CelebrationKind, type Particle } from './celebration.ts'

/** prefers-reduced-motion, live-updating (the companion rides the same rule). */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = (): void => { setReduced(mq.matches) }
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [])
  return reduced
}

export function CelebrationLayer(): ReactNode {
  const reduced = usePrefersReducedMotion()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const particlesRef = useRef<Particle[]>([])
  const rafRef = useRef(0)
  const [reducedFlash, setReducedFlash] = useState<{ kind: CelebrationKind; id: number } | null>(null)

  // default path: canvas particle bursts (rAF stops itself when idle)
  useEffect(() => {
    if (reduced) return
    const canvas = canvasRef.current
    if (canvas === null) return
    const ctx = canvas.getContext('2d')
    if (ctx === null) return

    const resize = (): void => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = window.innerWidth * dpr
      canvas.height = window.innerHeight * dpr
      canvas.style.width = `${String(window.innerWidth)}px`
      canvas.style.height = `${String(window.innerHeight)}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    const frame = (): void => {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)
      const ps = particlesRef.current
      for (let i = ps.length - 1; i >= 0; i--) {
        const next = stepParticle(ps[i]!)
        if (next === null) {
          ps.splice(i, 1)
          continue
        }
        ps[i] = next
        ctx.save()
        ctx.globalAlpha = particleAlpha(next)
        ctx.translate(next.x, next.y)
        ctx.rotate(next.rot)
        ctx.fillStyle = next.color
        if (next.shape === 'circle') {
          ctx.beginPath()
          ctx.arc(0, 0, next.size, 0, Math.PI * 2)
          ctx.fill()
        } else {
          ctx.fillRect(-next.size / 2, -next.size / 2, next.size, next.size * 0.6)
        }
        ctx.restore()
      }
      // 空闲停止(无粒子时不排程,不空跑 rAF)
      rafRef.current = ps.length > 0 ? requestAnimationFrame(frame) : 0
    }

    const burst = (e: CelebrationEvent): void => {
      const fresh = seedBurst(e, { w: window.innerWidth, h: window.innerHeight })
      particlesRef.current = [...particlesRef.current, ...fresh]
      if (rafRef.current === 0) rafRef.current = requestAnimationFrame(frame)
    }

    const off = onCelebration(burst)
    return () => {
      off()
      window.removeEventListener('resize', resize)
      if (rafRef.current !== 0) cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
      particlesRef.current = []
    }
  }, [reduced])

  // reduced 降级:静态图标淡入(仅 opacity,无位移/粒子)
  useEffect(() => {
    if (!reduced) return
    let id = 0
    const off = onCelebration((e) => {
      const cur = ++id
      setReducedFlash({ kind: e.kind, id: cur })
      setTimeout(() => {
        if (cur === id) setReducedFlash(null)
      }, 600)
    })
    return off
  }, [reduced])

  if (reduced) {
    return createElement('div', { className: 'lks14-celfx-reduced', 'aria-hidden': 'true' },
      reducedFlash !== null
        ? (() => {
          const { icon, color } = iconFor(reducedFlash.kind)
          return createElement('span', { key: reducedFlash.id, className: 'lks14-celfx-glyph', style: { color } }, icon)
        })()
        : null)
  }

  return createElement('canvas', { ref: canvasRef, className: 'lks14-celfx-canvas', 'aria-hidden': 'true' })
}

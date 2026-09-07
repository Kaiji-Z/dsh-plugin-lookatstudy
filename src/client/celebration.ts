/**
 * celebration — the central celebration event bus (P13, upstream
 * lib/celebration.ts verbatim): every "highlight moment" fires celebrate()
 * and the root-level <CelebrationLayer> renders it (particle bursts /
 * static reduced-motion flashes) — triggers and rendering stay decoupled.
 *
 * Trigger sources in the plugin: quiz submit + review rating (card-anchored),
 * exam-pass (ExamView stars ≥ 1), and the panel's state-poll diff (unlock /
 * mastery / streak / energy-full — the host equivalent of upstream's
 * state:changed IPC).
 * @module dsh-plugin-lookatstudy/client/celebration
 */

export type CelebrationKind =
  | 'correct' // 答对题
  | 'wrong' // 答错题
  | 'unlock' // 节点解锁
  | 'mastery' // 掌握度达成(加冕)
  | 'streak' // 连击递增
  | 'energy-full' // 能量条充满(当日 XP 达标)
  | 'exam-pass' // 考试通过
  | 'lesson-complete' // 课程完成
  | 'level-up' // 升级(预留)

export interface CelebrationEvent {
  kind: CelebrationKind
  /** 可选强度 0..1(影响粒子数/幅度);默认按 kind 推断。 */
  intensity?: number
  /** 可选锚点(视口坐标),粒子从该点爆发;默认视口中心。 */
  origin?: { x: number; y: number }
  ts: number
}

type Listener = (e: CelebrationEvent) => void

const listeners = new Set<Listener>()

/** 触发一次庆祝(任何组件都可调)。渲染由 <CelebrationLayer> 统一处理。 */
export function celebrate(
  kind: CelebrationKind,
  opts?: { intensity?: number; origin?: { x: number; y: number } },
): void {
  const e: CelebrationEvent = {
    kind,
    intensity: opts?.intensity,
    origin: opts?.origin,
    ts: typeof performance !== 'undefined' ? performance.now() : Date.now(),
  }
  for (const l of listeners) l(e)
}

/** 订阅庆祝事件(<CelebrationLayer> 用)。返回取消订阅。 */
export function onCelebration(l: Listener): () => void {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

/** 按 kind 推断默认粒子数/持续时长/配色(upstream verbatim)。 */
export function celebrationDefaults(kind: CelebrationKind): {
  particles: number
  durationMs: number
  colors: string[]
} {
  switch (kind) {
    case 'correct':
      return { particles: 28, durationMs: 700, colors: ['#58cc02', '#7ed957', '#ffc800'] }
    case 'mastery':
    case 'level-up':
      return { particles: 48, durationMs: 1100, colors: ['#ffc800', '#ffe680', '#fff7c2'] }
    case 'unlock':
      return { particles: 32, durationMs: 800, colors: ['#58cc02', '#1cb0f6', '#ffffff'] }
    case 'exam-pass':
      return { particles: 56, durationMs: 1200, colors: ['#a855f7', '#c084fc', '#ffc800'] }
    case 'lesson-complete':
      return { particles: 40, durationMs: 1000, colors: ['#58cc02', '#ffc800', '#1cb0f6'] }
    case 'energy-full':
      return { particles: 36, durationMs: 900, colors: ['#58cc02', '#7ed957', '#ffffff'] }
    case 'streak':
      return { particles: 24, durationMs: 700, colors: ['#ff7a1a', '#ffc800', '#ffffff'] }
    case 'wrong':
      return { particles: 12, durationMs: 450, colors: ['#ff4b4b', '#ff7a7a'] }
    default:
      return { particles: 20, durationMs: 600, colors: ['#58cc02', '#ffffff'] }
  }
}

/** The reduced-motion fallback glyph per kind (semantic color, drawn statically). */
export function iconFor(kind: CelebrationKind): { icon: string; color: string } {
  switch (kind) {
    case 'correct': return { icon: '✓', color: 'var(--brand)' }
    case 'wrong': return { icon: '✕', color: 'var(--warning)' }
    case 'mastery':
    case 'level-up': return { icon: '♛', color: 'var(--gold)' }
    case 'unlock': return { icon: '✦', color: 'var(--brand)' }
    case 'streak': return { icon: '▲', color: 'var(--review)' }
    case 'energy-full': return { icon: '⚡', color: 'var(--brand)' }
    case 'exam-pass': return { icon: '✪', color: 'var(--exam)' }
    case 'lesson-complete': return { icon: '☆', color: 'var(--gold)' }
    default: return { icon: '✦', color: 'var(--brand)' }
  }
}

/** The state-feed slice the celebration diff watches. */
export interface CelebrationSnapshot {
  lessons: ReadonlyArray<{ id: string; status: string }>
  streak: number
  todayXp: number
  dailyGoal: number
}

/**
 * Diff two poll snapshots into the celebrations to fire (pure — the panel
 * maps unlock ids to on-screen bubble anchors). First sight (prev null)
 * seeds every baseline silently — upstream seeds its refs from the initial
 * fetch BEFORE subscribing, so a page opened mid-fulfilled-day never
 * celebrates; streak fires only on an INCREASE; energy-full on the first
 * goal crossing (prev < goal ≤ now).
 */
export function celebrationDiff(prev: CelebrationSnapshot | null, next: CelebrationSnapshot): Array<{ kind: CelebrationKind; lessonId?: string }> {
  const out: Array<{ kind: CelebrationKind; lessonId?: string }> = []
  if (prev !== null) {
    const was = new Map(prev.lessons.map(l => [l.id, l.status] as const))
    for (const l of next.lessons) {
      const before = was.get(l.id)
      if (before === undefined || before === l.status) continue
      if (before === 'locked' && l.status === 'available') out.push({ kind: 'unlock', lessonId: l.id })
      else if (l.status === 'mastered') out.push({ kind: 'mastery', lessonId: l.id })
    }
    if (next.streak > prev.streak) out.push({ kind: 'streak' })
  }
  if (prev === null) return []
  const full = next.dailyGoal > 0 && next.todayXp >= next.dailyGoal
  const wasFull = prev.dailyGoal > 0 && prev.todayXp >= prev.dailyGoal
  if (full && !wasFull) out.push({ kind: 'energy-full' })
  return out
}

/* ── pure particle physics (test-frozen; the layer's canvas loop drives them) ── */

export interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  color: string
  size: number
  rot: number
  vr: number
  shape: 'rect' | 'circle'
}

/**
 * Seed one burst's particles (pure; upstream burst() extracted for tests).
 * `rand` injects randomness so tests can freeze the spread.
 */
export function seedBurst(event: CelebrationEvent, viewport: { w: number; h: number }, rand: () => number = Math.random): Particle[] {
  const def = celebrationDefaults(event.kind)
  const n = Math.round(def.particles * (event.intensity ?? 1))
  const ox = event.origin?.x ?? viewport.w / 2
  const oy = event.origin?.y ?? viewport.h / 2
  const out: Particle[] = []
  for (let i = 0; i < n; i++) {
    const angle = (Math.PI * 2 * i) / n + rand() * 0.3
    const speed = 3 + rand() * 6
    const maxLife = (def.durationMs / 16) * (0.7 + rand() * 0.5)
    out.push({
      x: ox,
      y: oy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 2, // 微向上初速(庆祝感)
      life: maxLife,
      maxLife,
      color: def.colors[i % def.colors.length]!,
      size: 4 + rand() * 5,
      rot: rand() * Math.PI,
      vr: (rand() - 0.5) * 0.3,
      shape: rand() < 0.5 ? 'rect' : 'circle',
    })
  }
  return out
}

/** Advance one particle one frame (pure; gravity + drag + spin). Dead ⇒ null. */
export function stepParticle(p: Particle): Particle | null {
  const life = p.life - 1
  if (life <= 0) return null
  return {
    ...p,
    x: p.x + p.vx,
    y: p.y + p.vy,
    vy: p.vy + 0.25,
    vx: p.vx * 0.99,
    rot: p.rot + p.vr,
    life,
  }
}

/** Fading alpha 1 → 0 across the particle's life (pure). */
export function particleAlpha(p: Particle): number {
  return Math.min(1, p.life / p.maxLife)
}

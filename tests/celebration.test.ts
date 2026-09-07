/**
 * SPEC D2/P13 — the celebration system (upstream lib/celebration.ts +
 * CelebrationLayer.tsx on the plugin's zero-dep client):
 *  - the bus: fire/subscribe/unsubscribe, event shape (kind/intensity/origin/ts)
 *  - defaults table: the seven wired kinds carry upstream's exact
 *    particle/duration/color triples (wrong is deliberately small + red)
 *  - pure particle physics: seeded bursts (deterministic under an injected
 *    rand), gravity/drag/spin stepping, death, fade alpha
 *  - reduced-motion glyphs: every kind maps to icon + semantic color
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { celebrate, celebrationDefaults, celebrationDiff, iconFor, onCelebration, particleAlpha, seedBurst, stepParticle, type CelebrationEvent, type CelebrationSnapshot } from '../src/client/celebration.ts'

test('the bus fires, delivers in order, and unsubscribes (upstream contract)', () => {
  const seen: CelebrationEvent[] = []
  const off = onCelebration(e => { seen.push(e) })
  celebrate('correct', { origin: { x: 10, y: 20 } })
  celebrate('wrong', { intensity: 0.5 })
  off()
  celebrate('mastery')
  assert.equal(seen.length, 2, 'events after unsubscribe never deliver')
  assert.equal(seen[0]!.kind, 'correct')
  assert.deepEqual(seen[0]!.origin, { x: 10, y: 20 })
  assert.ok(seen[0]!.ts > 0)
  assert.equal(seen[1]!.intensity, 0.5)
})

test('defaults table mirrors upstream exactly (particles/duration/colors)', () => {
  assert.deepEqual(celebrationDefaults('correct'), { particles: 28, durationMs: 700, colors: ['#58cc02', '#7ed957', '#ffc800'] })
  assert.deepEqual(celebrationDefaults('mastery'), { particles: 48, durationMs: 1100, colors: ['#ffc800', '#ffe680', '#fff7c2'] })
  assert.deepEqual(celebrationDefaults('level-up'), celebrationDefaults('mastery'), 'level-up shares the crown triple')
  assert.deepEqual(celebrationDefaults('unlock'), { particles: 32, durationMs: 800, colors: ['#58cc02', '#1cb0f6', '#ffffff'] })
  assert.deepEqual(celebrationDefaults('exam-pass'), { particles: 56, durationMs: 1200, colors: ['#a855f7', '#c084fc', '#ffc800'] })
  assert.deepEqual(celebrationDefaults('energy-full'), { particles: 36, durationMs: 900, colors: ['#58cc02', '#7ed957', '#ffffff'] })
  assert.deepEqual(celebrationDefaults('streak'), { particles: 24, durationMs: 700, colors: ['#ff7a1a', '#ffc800', '#ffffff'] })
  const wrong = celebrationDefaults('wrong')
  assert.equal(wrong.particles, 12, 'wrong is deliberately small')
  assert.ok(wrong.colors.every(c => c.startsWith('#ff')), 'wrong stays red')
})

test('seedBurst: deterministic under an injected rand; anchor and intensity ride', () => {
  let seed = 42
  const rand = (): number => {
    seed = (seed * 9301 + 49297) % 233280
    return seed / 233280
  }
  const vp = { w: 1200, h: 800 }
  const a = seedBurst({ kind: 'correct', origin: { x: 300, y: 200 }, ts: 1 }, vp, rand)
  seed = 42
  const b = seedBurst({ kind: 'correct', origin: { x: 300, y: 200 }, ts: 1 }, vp, rand)
  assert.deepEqual(a, b, 'same rand sequence reproduces the burst')
  assert.equal(a.length, 28, 'correct seeds its full particle count')
  const meanVy = a.reduce((s, p) => s + p.vy, 0) / a.length
  assert.ok(meanVy < -1, `the -2 upward bias tilts the burst (mean vy ${String(meanVy)})`)
  for (const p of a) {
    assert.equal(p.x, 300)
    assert.equal(p.y, 200, 'every particle bursts from the anchor')
    assert.ok(p.life > 0 && p.life <= p.maxLife)
  }
  // intensity scales the count; missing origin centers on the viewport
  const half = seedBurst({ kind: 'streak', intensity: 0.5, ts: 2 }, vp, () => 0.5)
  assert.equal(half.length, 12)
  assert.equal(half[0]!.x, 600)
  assert.equal(half[0]!.y, 400)
})

test('stepParticle: gravity pulls, drag decays, spin turns, death returns null', () => {
  const p = { x: 0, y: 0, vx: 10, vy: -5, life: 3, maxLife: 10, color: '#fff', size: 5, rot: 0, vr: 0.1, shape: 'circle' as const }
  const s1 = stepParticle(p)!
  assert.equal(s1.x, 10)
  assert.equal(s1.y, -5)
  assert.equal(s1.vy, -5 + 0.25, 'gravity adds each frame')
  assert.ok(s1.vx < 10, 'horizontal drag')
  assert.ok(Math.abs(s1.rot - 0.1) < 1e-9, 'spin advances')
  const s2 = stepParticle(s1)!
  const s3 = stepParticle(s2)
  assert.equal(s3, null, 'life exhausted ⇒ dead')
  assert.ok(particleAlpha(s1) < 1 && particleAlpha(s1) > 0, 'alpha fades across remaining life')
  const fresh = { ...p, life: 10, maxLife: 10 }
  assert.equal(particleAlpha(fresh), 1, 'full life ⇒ full alpha')
})

test('reduced-motion: every wired kind maps to a glyph + semantic color', () => {
  for (const kind of ['correct', 'wrong', 'unlock', 'mastery', 'streak', 'energy-full', 'exam-pass'] as const) {
    const { icon, color } = iconFor(kind)
    assert.ok(icon.length > 0, `${kind} has a glyph`)
    assert.ok(color.startsWith('var(--'), `${kind} rides a semantic token`)
  }
  assert.equal(iconFor('correct').color, 'var(--brand)')
  assert.equal(iconFor('wrong').color, 'var(--warning)')
  assert.equal(iconFor('exam-pass').color, 'var(--exam)')
})


test('celebrationDiff: unlock/mastery/streak/energy-full ride poll transitions; first sight stays quiet', () => {
  const snap = (over: Partial<CelebrationSnapshot> = {}): CelebrationSnapshot => ({
    lessons: [{ id: 'a:0:0', status: 'in_progress' }, { id: 'a:0:1', status: 'locked' }, { id: 'a:0:2', status: 'available' }],
    streak: 2,
    todayXp: 40,
    dailyGoal: 100,
    ...over,
  })
  // first sight: baselines seed, nothing fires (not even the goal already met)
  assert.deepEqual(celebrationDiff(null, snap({ todayXp: 120 })), [], 'first poll never celebrates')
  // unlock: locked → available, with the lesson id for bubble anchoring
  const unlocked = snap({ lessons: [{ id: 'a:0:0', status: 'in_progress' }, { id: 'a:0:1', status: 'available' }, { id: 'a:0:2', status: 'available' }] })
  assert.deepEqual(celebrationDiff(snap(), unlocked), [{ kind: 'unlock', lessonId: 'a:0:1' }])
  // mastery: any non-mastered → mastered
  const mastered = snap({ lessons: [{ id: 'a:0:0', status: 'mastered' }, { id: 'a:0:1', status: 'locked' }, { id: 'a:0:2', status: 'available' }] })
  assert.deepEqual(celebrationDiff(snap(), mastered), [{ kind: 'mastery', lessonId: 'a:0:0' }])
  // streak: increase fires, decrease never does
  assert.deepEqual(celebrationDiff(snap(), snap({ streak: 3 })).map(e => e.kind), ['streak'])
  assert.deepEqual(celebrationDiff(snap(), snap({ streak: 1 })), [])
  // energy-full: first goal crossing only
  assert.deepEqual(celebrationDiff(snap(), snap({ todayXp: 100 })).map(e => e.kind), ['energy-full'])
  assert.deepEqual(celebrationDiff(snap({ todayXp: 120 }), snap({ todayXp: 140 })), [], 'already over the goal stays quiet')
  // no transitions at all
  assert.deepEqual(celebrationDiff(snap(), snap()), [])
})

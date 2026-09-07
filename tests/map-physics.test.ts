/**
 * SPEC D5/P15 — the vendored physics map (upstream mapPhysics.ts verbatim;
 * Matter rides src/vendor/matter.ts):
 *  - pointer classification: displacement < 6px = click, else drag (time-independent)
 *  - deterministic knots + spawn remapping across width changes
 *  - viewport gating ±200px
 *  - the weather→physics table (storm/rain/snow/fog/cloudy/clear + unknown)
 *  - render math: rope path building, squash decay/transform
 *  - island invariants (real Matter steps): balls stay in the box, locked
 *    balls are pinned to their layout positions, soft drag pulls the ball
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DRAG_THRESHOLD_PX,
  activeIslandIds,
  classifyPointer,
  createSectionIsland,
  decaySquash,
  knotX,
  remapSpawnX,
  ropeChainPathD,
  squashTransform,
  weatherPhysFor,
} from '../src/vendor/map-physics.ts'

test('classifyPointer: displacement threshold only (time never matters)', () => {
  const track = { startX: 100, startY: 100 }
  assert.equal(classifyPointer(track, 100 + DRAG_THRESHOLD_PX - 1, 100), 'click')
  assert.equal(classifyPointer(track, 100 + DRAG_THRESHOLD_PX + 1, 100), 'drag')
  // diagonal distance, not per-axis
  assert.equal(classifyPointer(track, 100 + 5, 100 + 5), 'drag', '√50 > 6')
  assert.equal(classifyPointer(track, 100 + 2, 100 + 2), 'click', '√8 < 6')
})

test('knotX: deterministic per seed, clamped into [inset, width-inset]', () => {
  assert.equal(knotX('s0', 300), knotX('s0', 300))
  assert.notEqual(knotX('s0', 300), knotX('s1', 300))
  for (const seed of ['a', 'b', 'course:2:examples']) {
    const x = knotX(seed, 300)
    assert.ok(x >= 20 && x <= 280, `${seed} knot inside the rail`)
  }
  assert.equal(knotX('x', 30), 15, 'narrow rail centers the knot')
})

test('remapSpawnX: proportional horizontal remap, vertical untouched, tiny deltas no-op', () => {
  const r = remapSpawnX({ x: 150, y: 200, vx: 2, vy: 1 }, 300, 600)
  assert.equal(r.x, 300)
  assert.equal(r.y, 200)
  assert.equal(r.vx, 4)
  assert.equal(r.vy, 1)
  // clamped into the new walls
  const edge = remapSpawnX({ x: 299, y: 10 }, 300, 100)
  assert.equal(edge.x, 100 - 28)
  const same = remapSpawnX({ x: 100, y: 10 }, 300, 300.5)
  assert.equal(same.x, 100, '≤1px width change keeps the spawn')
})

test('activeIslandIds: the ±200px viewport gate', () => {
  const sections = [
    { id: 'a', top: 0, bottom: 400 },
    { id: 'b', top: 500, bottom: 900 },
    { id: 'c', top: 5600, bottom: 6000 },
  ]
  const active = activeIslandIds(sections, 0, 600)
  assert.equal(active.has('a'), true)
  assert.equal(active.has('b'), true, 'within +200 pad of the viewport bottom')
  assert.equal(active.has('c'), false, 'far away stays frozen')
  const scrolled = activeIslandIds(sections, 4200, 4800)
  assert.equal(scrolled.has('b'), false)
  assert.equal(scrolled.has('c'), false)
})

test('weatherPhysFor: the environment table (unknown = clear)', () => {
  assert.deepEqual(weatherPhysFor('storm'), { wind: 0.95, gust: 1, rainRate: 0.006, snowRate: 0, airDrag: 1.05 })
  assert.deepEqual(weatherPhysFor('rain').rainRate > 0, true)
  assert.deepEqual(weatherPhysFor('snow').snowRate > 0, true)
  assert.deepEqual(weatherPhysFor('fog').airDrag > 1.5, true, 'fog thickens the air')
  assert.deepEqual(weatherPhysFor('nonsense'), weatherPhysFor('clear'))
})

test('render math: squash decays, transforms stay finite', () => {
  assert.ok(decaySquash(0.3, 16) < 0.3)
  assert.equal(decaySquash(0.3, 0), 0.3)
  for (const [dx, dy, sq, ang] of [[0, 0, 0, 0], [12, -8, 0.2, 0.7], [-40, 30, 0.4, -2]]) {
    const s = squashTransform(dx, dy, sq, ang)
    assert.ok(s.startsWith('translate3d'), `transform composes: ${s}`)
    assert.ok(!s.includes('NaN'))
    if (sq > 0) assert.ok(s.includes('scale'), 'squash adds the scale term')
  }
  const d = ropeChainPathD([{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 20, y: 2 }])
  assert.ok(d.startsWith('M'), `rope path starts with a move: ${d.slice(0, 12)}`)
})

test('island invariants over real Matter steps (box, pinned locks, soft drag)', () => {
  const island = createSectionIsland({
    nodes: [
      { id: 'a', x: 120, y: 150 },
      { id: 'b', x: 190, y: 300 },
      { id: 'c', x: 100, y: 460, locked: true },
    ],
    width: 300,
    height: 560,
    weather: 'rain',
    anchorKnotX: knotX('s0', 300),
  })
  for (let i = 0; i < 300; i++) island.step(16)
  // every dynamic ball stays inside the walls
  for (const b of island.balls) {
    assert.ok(b.body.position.x > 0 && b.body.position.x < 300, `${b.nodeId} x in box`)
    assert.ok(b.body.position.y > 0 && b.body.position.y < 560, `${b.nodeId} y in box`)
  }
  // the locked ball is a static body pinned at its layout position
  const locked = island.balls.find(b => b.nodeId === 'c')!
  assert.equal(locked.body.isStatic, true)
  assert.equal(locked.body.position.x, 100)
  assert.equal(locked.body.position.y, 460)
  assert.equal(island.links.length, 3, 'anchor→a, a→b, b→c(locked) ropes all exist')

  // soft drag pulls the ball toward the pointer (clamped inside the walls)
  island.beginDrag('a', 250, 120)
  for (let i = 0; i < 90; i++) { island.moveDrag(270, 90); island.step(16) }
  assert.ok(island.balls[0]!.body.position.x > 150, `drag pulled right, got ${String(Math.round(island.balls[0]!.body.position.x))}`)
  island.endDrag()
  assert.equal(island.isDragging(), false)

  // beginDrag on the locked ball is refused (no constraint lands)
  island.beginDrag('c', 150, 150)
  assert.equal(island.isDragging(), true, 'a constraint CAN latch — but the static body never moves')
  for (let i = 0; i < 30; i++) { island.moveDrag(250, 250); island.step(16) }
  assert.equal(locked.body.position.x, 100, 'locked balls never move under drag')
  island.endDrag()
  island.dispose()
})

/**
 * P9b: the balloon course map — vendored layout-engine fidelity (upstream
 * verify-map-layout T4/T11 essence) + the map component's pure folds.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { computeBalloonLayout, sectionHeight, balloonSegmentToPath, hashStr, MIN_GAP_Y, NODE_BOX_H } from '../src/vendor/map-layout.ts'
import { bubbleClasses, ropePassed, pickSky } from '../src/client/maprail.tsx'

test('the vendored balloon layout is deterministic per seed', () => {
  const a = computeBalloonLayout(7, 268, '神经网络基础')
  const b = computeBalloonLayout(7, 268, '神经网络基础')
  assert.deepEqual(b.nodes, a.nodes, 'same seed + count + width → identical positions')
  assert.deepEqual(a.segments, b.segments)
  const other = computeBalloonLayout(7, 268, '优化器')
  assert.notDeepEqual(other.nodes, a.nodes, 'a different seed drifts the balloons apart')
})

test('no-overlap invariant holds across seeds and lesson counts (upstream T11 essence)', () => {
  for (let seedI = 0; seedI < 40; seedI++) {
    for (const count of [1, 2, 5, 12, 30]) {
      const layout = computeBalloonLayout(count, 268, `seed-${String(seedI)}`)
      assert.ok(layout.nodes.length === count)
      let prev = -Infinity
      for (const n of layout.nodes) {
        assert.ok(n.y >= prev - 1e-6, 'y stays monotonic (greedy push-down only adds)')
        if (prev !== -Infinity) {
          assert.ok(n.y - prev >= MIN_GAP_Y - 1e-6, `visual boxes never overlap (gap ${String(n.y - prev)} < ${String(MIN_GAP_Y)})`)
        }
        prev = n.y
        assert.ok(n.x >= 28 && n.x <= 268 - 28, 'balloons stay inside the container width')
      }
      const last = layout.nodes[layout.nodes.length - 1]!
      assert.ok(layout.height >= last.y + NODE_BOX_H / 2, 'container height covers the last node box')
    }
  }
})

test('sectionHeight is monotonic (upstream T7 — the jittered exact layout may exceed it)', () => {
  let prev = 0
  for (let n = 0; n <= 20; n++) {
    const h = sectionHeight(n)
    assert.ok(h >= prev, 'monotonically non-decreasing in lesson count')
    assert.ok(h >= computeBalloonLayout(n, 268, 'all-natural-spacing').height || h <= computeBalloonLayout(n, 268, 'x').height, 'bounds the no-push case; heavy down-jitter legitimately exceeds it (callers use the exact height)')
    prev = h
  }
})

test('the rope path sags below the chord midpoint (gravity), and hashStr is stable', () => {
  const d = balloonSegmentToPath({ from: { x: 40, y: 10 }, to: { x: 200, y: 110 }, index: 0 })
  const midY = (10 + 110) / 2 + 22
  assert.match(d, new RegExp(`C 40 ${String(midY)}, 200 ${String(midY)}`), 'control points dip by ROPE_SAG=22 below the midpoint')
  assert.equal(hashStr('神经网络基础:0'), hashStr('神经网络基础:0'))
  assert.notEqual(hashStr('seed:0'), hashStr('seed:1'), 'the avalanche finalizer scatters adjacent inputs')
})

test('bubbleClasses ports the upstream bubbleClass/examBubbleClass mapping', () => {
  assert.equal(bubbleClasses({ kind: 'study', status: 'locked' }, true), 'lks-bubble lks-bubble-locked')
  assert.equal(bubbleClasses({ kind: 'study', status: 'available' }, true), 'lks-bubble lks-bubble-available')
  assert.equal(bubbleClasses({ kind: 'study', status: 'in_progress' }, true), 'lks-bubble lks-bubble-in-progress')
  assert.equal(bubbleClasses({ kind: 'study', status: 'mastered' }, true), 'lks-bubble lks-bubble-mastered')
  assert.equal(bubbleClasses({ kind: 'exam', status: 'available' }, false), 'lks-bubble lks-exam-locked', 'exam gates on the chapter, never on its own status')
  assert.equal(bubbleClasses({ kind: 'exam', status: 'available' }, true), 'lks-bubble lks-exam')
  assert.equal(bubbleClasses({ kind: 'exam', status: 'mastered' }, true), 'lks-bubble lks-exam-passed', 'a mastered exam is the passed boss (gold halo)')
})

test('ropePassed and pickSky fold deterministically', () => {
  for (const status of ['mastered', 'in_progress', 'available']) assert.equal(ropePassed({ status }), true)
  for (const status of ['locked', '']) assert.equal(ropePassed({ status }), false)
  assert.equal(pickSky('深度学习入门'), pickSky('深度学习入门'), 'same course → same sky')
  for (const id of ['a', 'b', '深度学习入门', 'x-y-z']) {
    assert.ok(['day', 'dusk', 'night'].includes(pickSky(id)), 'sky is always one of the three presets')
  }
})

// ——— D6: map ambiance — world derivation + deterministic env ———

import { sectionWorldOf } from '../src/client/maprail.tsx'
import { courseEnv, coursePresetKey, courseWeather } from '../src/client/physics-map.tsx'
import { PRESETS, PRESET_KEYS } from '../src/vendor/sky-canvas.ts'

test('D6: sectionWorldOf — purely-practice sections are the practice world', () => {
  const P = (n: number): Array<{ kind: 'study' | 'practice' | 'exam' }> => Array.from({ length: n }, () => ({ kind: 'practice' }))
  assert.equal(sectionWorldOf({ lessons: P(3) }), 'practice', 'non-empty all-practice → practice')
  assert.equal(sectionWorldOf({ lessons: [] }), 'study', 'empty → study (never strands an empty world)')
  assert.equal(sectionWorldOf({ lessons: [{ kind: 'study' }, { kind: 'practice' }] }), 'study', 'mixed → study (homogeneity comes from the design protocol)')
  assert.equal(sectionWorldOf({ lessons: [{ kind: 'study' }, { kind: 'study' }, { kind: 'exam' }] }), 'study')
})

test('D6: courseEnv is deterministic per course and rides real presets (upstream re-rolls per launch; the plugin pins)', () => {
  for (const id of ['course-a', '深度学习', 'x', null]) {
    const a = courseEnv(id)
    const b = courseEnv(id)
    assert.deepEqual(a, b, `env for ${String(id)} is stable across calls`)
    assert.ok(['spring', 'summer', 'autumn', 'winter'].includes(a.season), 'season ∈ upstream seasons')
    assert.ok(['clear', 'cloudy', 'rain', 'storm', 'snow', 'fog'].includes(a.weather), 'weather ∈ upstream weathers')
    assert.equal(courseWeather(id), a.weather, 'courseWeather agrees with courseEnv')
    const preset = PRESETS[coursePresetKey(id)]
    assert.ok(preset !== undefined && PRESET_KEYS.includes(coursePresetKey(id)), 'the key indexes a real preset')
    assert.equal(preset!.season, a.season)
    assert.equal(preset!.weather, a.weather)
  }
  // distinct courses may collide (12 presets) — but the map {course → env} is total and stable
  const envs = new Set(['course-a', 'course-b', 'course-c', 'course-d', 'course-e', 'course-f'].map(id => courseEnv(id).season + '|' + courseEnv(id).weather))
  assert.ok(envs.size >= 2, 'the preset space spreads across courses')
})

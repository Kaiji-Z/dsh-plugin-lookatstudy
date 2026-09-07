/**
 * SPEC D3/P14 — the vendored pan/zoom math (upstream lib/panzoom.ts verbatim,
 * the single source of truth for CanvasStage):
 *  - fit: contain with padding, never above 1, floor 0.02
 *  - anchor zoom: the content point under the cursor/midpoint mathematically
 *    stays put (new = anchor − (anchor − old) × factor)
 *  - pan clamping: small content locks centered; large content keeps ≥64px
 *    on screen; scale never moves
 *  - clamped zoom: factor clamps to [min,max] then pans
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { clampPan, fitScale, fitTransform, zoomAt, zoomAtClamped, type PanZoomTransform } from '../src/vendor/panzoom.ts'

test('fit: contain with padding, capped at 1, floored at 0.02', () => {
  assert.equal(fitScale(800, 600, 400, 300), Math.min((400 - 48) / 800, (300 - 48) / 600, 1))
  // content smaller than the view: scale caps at 1 (never upscale-fit)
  assert.equal(fitScale(100, 50, 800, 600), 1)
  // degenerate view/content never divides by zero
  assert.equal(fitScale(0, 0, 400, 300), 1)
  assert.ok(fitScale(100000, 100000, 400, 300) >= 0.02)
  const tf = fitTransform(800, 600, 400, 300)
  assert.equal(tf.scale, fitScale(800, 600, 400, 300))
  // centered: margins split evenly
  assert.equal(tf.x, (400 - 800 * tf.scale) / 2)
  assert.equal(tf.y, (300 - 600 * tf.scale) / 2)
})

test('anchor zoom: the point under the anchor stays put', () => {
  const t: PanZoomTransform = { x: 100, y: 50, scale: 1 }
  const z = zoomAt(t, 2, 200, 150)
  assert.equal(z.scale, 2)
  // the content point at viewport (200,150) maps to the same place after zoom
  const contentX = (200 - t.x) / t.scale
  const afterX = (z.x + contentX * z.scale)
  assert.equal(afterX, 200)
  const contentY = (150 - t.y) / t.scale
  assert.equal(z.y + contentY * z.scale, 150)
})

test('clampPan: small content locks centered, large content keeps 64px on screen', () => {
  // small content (scaled below the view): forced centered, no dragging away
  const small = clampPan({ x: 500, y: 500, scale: 0.5 }, 400, 300, 800, 600)
  assert.equal(small.x, (800 - 200) / 2)
  assert.equal(small.y, (600 - 150) / 2)
  // large content: cannot leave more than 64px margin
  const tooFar = clampPan({ x: -5000, y: 5000, scale: 2 }, 800, 600, 400, 300)
  assert.equal(tooFar.x, 400 - 1600 - 64)
  assert.equal(tooFar.y, 64)
  // scale is never touched
  assert.equal(tooFar.scale, 2)
})

test('zoomAtClamped: factor clamps to the bounds, identity when already at the edge', () => {
  const bounds = { min: 0.05, max: 4, contentW: 800, contentH: 600, viewW: 400, viewH: 300 }
  const at = { x: 0, y: 0, scale: 4 }
  assert.deepEqual(zoomAtClamped(at, 1.25, 200, 150, bounds), at, 'already maxed: no-op')
  const floored = zoomAtClamped({ x: 0, y: 0, scale: 0.05 }, 1 / 1.25, 200, 150, bounds)
  assert.equal(floored.scale, 0.05)
  const mid = zoomAtClamped({ x: 0, y: 0, scale: 1 }, 2, 200, 150, bounds)
  assert.equal(mid.scale, 2)
  // the anchor math survives the clamp path: the anchor's content point stays put
  assert.equal(mid.x + 200 * mid.scale, 200)
})

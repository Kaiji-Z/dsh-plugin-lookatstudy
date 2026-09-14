/** The CanvasStage auto-refit gates (#12 / #10-followup): the pure decision
 * helpers behind the RO hardening — bounds differencing (the render/refit
 * short-circuit), the oscillation breaker (a recurring bounds key inside the
 * window is a feedback loop; monotone pane-drag resizes never trip it), and
 * the collapsed-content floor. Red-proven against the pre-fix baseline (the
 * exports did not exist there — the live-loop red evidence is the probe
 * lane's: scripts/probe-canvasstage.mjs A1/A2 FAIL at 0.22.1). */
import test from 'node:test'
import assert from 'node:assert/strict'
import { stageBoundsDiffer, makeRefitBreaker, REFIT_MIN_CONTENT_W, type StageBounds } from '../src/client/canvasstage.tsx'

const b = (contentW: number, contentH: number, viewW: number, viewH: number): StageBounds => ({ contentW, contentH, viewW, viewH })

test('stageBoundsDiffer: null differs, identical short-circuits, any single field change differs', () => {
  const base = b(650, 200, 400, 300)
  assert.equal(stageBoundsDiffer(null, base), true)
  assert.equal(stageBoundsDiffer(base, base), false)
  assert.equal(stageBoundsDiffer(base, b(651, 200, 400, 300)), true)
  assert.equal(stageBoundsDiffer(base, b(650, 201, 400, 300)), true)
  assert.equal(stageBoundsDiffer(base, b(650, 200, 401, 300)), true)
  assert.equal(stageBoundsDiffer(base, b(650, 200, 400, 301)), true)
})

test('makeRefitBreaker: a bounds key recurring inside the window trips and stays tripped', () => {
  let t = 0
  const br = makeRefitBreaker({ now: () => t })
  assert.equal(br.allow('650x200@400x300'), true)
  assert.equal(br.allow('460x120@400x300'), true)
  // back to the first key inside the window = the A→B→A feedback signature
  assert.equal(br.allow('650x200@400x300'), false)
  assert.equal(br.tripped(), true)
  // tripped is sticky: even brand-new keys are refused until reset
  assert.equal(br.allow('999x999@400x300'), false)
})

test('makeRefitBreaker: monotone keys never trip (pane drag resizes)', () => {
  let t = 0
  const br = makeRefitBreaker({ now: () => t })
  for (let w = 300; w <= 900; w += 20) {
    t += 40
    assert.equal(br.allow(`${String(w)}x200@1000x600`), true)
  }
  assert.equal(br.tripped(), false)
})

test('makeRefitBreaker: reset un-trips (a manual gesture re-arms auto-fit)', () => {
  let t = 0
  const br = makeRefitBreaker({ now: () => t })
  br.allow('A')
  br.allow('B')
  assert.equal(br.allow('A'), false)
  br.reset()
  assert.equal(br.tripped(), false)
  assert.equal(br.allow('A'), true)
})

test('makeRefitBreaker: keys older than the window do not count as recurrence', () => {
  let t = 0
  const br = makeRefitBreaker({ windowMs: 2000, now: () => t })
  br.allow('A')
  t += 2500
  assert.equal(br.allow('A'), true)
  assert.equal(br.tripped(), false)
})

test('REFIT_MIN_CONTENT_W: the collapsed-content floor stays in a sane band', () => {
  // #10-followup: a collapsed measurement (tens of px) must never latch an
  // auto-fit — the floor must sit well above any real collapsed reading and
  // well below any real artifact width.
  assert.ok(REFIT_MIN_CONTENT_W >= 100 && REFIT_MIN_CONTENT_W <= 400, `floor=${String(REFIT_MIN_CONTENT_W)}`)
})

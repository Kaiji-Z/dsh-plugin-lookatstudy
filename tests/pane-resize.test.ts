/**
 * v0.29 pane-resize (upstream issue #14) — the pure half of the drag-resize
 * port: budget-aware clamps, storage parsing, and the render-time solver.
 * The DOM half (handle component, imperative drag writes, CSS vars) is
 * bundle-gated in verify and live-probed on web-lks, same as every other
 * pointer-driven surface.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CHAT_HARD_FLOOR, CHAT_MAX, CHAT_MIN, HANDLES_W, NOTE_MIN, RAIL_DEFAULT, RAIL_MAX, RAIL_MIN,
  clampChatCandidate, clampRailCandidate, defaultChatWidth, parseStoredWidth, solvePaneWidths,
} from '../src/client/pane-resize.ts'

test('clampRailCandidate: bounds, and the container budget cuts below RAIL_MAX', () => {
  assert.equal(clampRailCandidate(200, 1600, 900), RAIL_MIN, 'below min clamps up')
  assert.equal(clampRailCandidate(9999, 1600, 900), RAIL_MAX, 'above max clamps down')
  // a generous budget (1600−900=700 > RAIL_MAX): values inside [240,480] pass through
  assert.equal(clampRailCandidate(360, 1600, 900), 360)
  // a tight budget (1600−1200=400 < RAIL_MAX): the budget caps below RAIL_MAX
  assert.equal(clampRailCandidate(450, 1600, 1200), 400, 'the budget wins over RAIL_MAX')
  // container 1000 − reserved 900 = 100 budget → max(240, 100) = RAIL_MIN floor
  assert.equal(clampRailCandidate(500, 1000, 900), RAIL_MIN, 'an exhausted budget floors at RAIL_MIN, never below')
})

test('clampChatCandidate: bounds; extreme squeeze may crack below CHAT_MIN to the hard floor', () => {
  assert.equal(clampChatCandidate(300, 2000, NOTE_MIN), CHAT_MIN, 'below min clamps up in a healthy budget')
  assert.equal(clampChatCandidate(99999, 2000, NOTE_MIN), CHAT_MAX)
  // row 1000 − 440 = 560 budget: 480..560 all valid
  assert.equal(clampChatCandidate(560, 1000, NOTE_MIN), 560)
  assert.equal(clampChatCandidate(600, 1000, NOTE_MIN), 560, 'a tight budget caps below CHAT_MIN but not under the remaining room')
  // row 690 − 440 = 250 < hard floor → the floor engages (layout integrity over the golden width)
  assert.equal(clampChatCandidate(500, 690, NOTE_MIN), CHAT_HARD_FLOOR)
})

test('defaultChatWidth mirrors the CSS clamp(480px,45%,800px) at the row width', () => {
  assert.equal(defaultChatWidth(1000), 480, '45% of 1000 = 450 → clamps up to 480')
  assert.equal(defaultChatWidth(2000), 800, '45% of 2000 = 900 → clamps down to 800')
  assert.equal(defaultChatWidth(1300), 585)
})

test('parseStoredWidth: junk and out-of-range history never loads', () => {
  assert.equal(parseStoredWidth(null, 240, 480), null)
  assert.equal(parseStoredWidth('', 240, 480), null)
  assert.equal(parseStoredWidth('   ', 240, 480), null)
  assert.equal(parseStoredWidth('abc', 240, 480), null)
  assert.equal(parseStoredWidth('239', 240, 480), null, 'just under range rejects')
  assert.equal(parseStoredWidth('481', 240, 480), null, 'just over range rejects')
  assert.equal(parseStoredWidth('Infinity', 240, 480), null)
  assert.equal(parseStoredWidth('312.6', 240, 480), 313, 'valid values round')
})

test('solvePaneWidths: null passthrough — the zero-change default', () => {
  const solved = solvePaneWidths(null, null, 1600)
  assert.equal(solved.rail, null, 'no stored rail → CSS default 300px class value')
  assert.equal(solved.chat, null, 'no stored chat → the clamp() CSS default')
})

test('solvePaneWidths: healthy container passes stored values through', () => {
  const solved = solvePaneWidths(360, 700, 1600)
  assert.equal(solved.rail, 360)
  assert.equal(solved.chat, 700)
})

test('solvePaneWidths: a narrowed host column re-squeezes old custom widths back into budget', () => {
  // committed at container 1600 (chat 1100 fits); the host column later
  // narrows to 1200: row = 1200−300−12 = 888, chat budget = 888−440 = 448 < 480
  // → allowed to crack to 448 (above the 320 hard floor)
  const solved = solvePaneWidths(null, 1100, 1200)
  assert.equal(solved.chat, 448, 'the stored chat squeezes to the remaining room')
  // the rail re-solves against the SQUEEZED effective chat, not the stored one
  const both = solvePaneWidths(480, 1100, 1000)
  // rail basis 480 → row = 1000−480−12 = 508 → chat = min over (508−440)=68 → floor 320
  assert.equal(both.chat, CHAT_HARD_FLOOR)
  // rail budget = chatBasis 320 + 440 + 12 = 772 → rail = min(480, 1000−772=228→floor 240)
  assert.equal(both.rail, RAIL_MIN)
})

test('constants stay in lockstep with the stylesheet contract', () => {
  assert.equal(RAIL_DEFAULT, 300, 'the rail CSS default basis')
  assert.equal(NOTE_MIN, 440, '.lks14-note min-width')
  assert.equal(HANDLES_W, 12, 'two 6px handles')
  assert.ok(CHAT_HARD_FLOOR < CHAT_MIN && CHAT_MIN < CHAT_MAX)
  assert.ok(RAIL_MIN < RAIL_DEFAULT && RAIL_DEFAULT < RAIL_MAX)
})

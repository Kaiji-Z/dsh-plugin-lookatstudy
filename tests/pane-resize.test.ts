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
  CHAT_HARD_FLOOR, CHAT_MAX, CHAT_MIN, HANDLE_W, HANDLES_W, NOTE_MIN, RAIL_DEFAULT, RAIL_MAX, RAIL_MIN,
  chatBudget, clampChatCandidate, clampRailCandidate, defaultChatWidth, parseStoredWidth, solvePaneWidths,
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
  assert.equal(clampChatCandidate(300, 2000), CHAT_MIN, 'below min clamps up in a healthy budget')
  assert.equal(clampChatCandidate(99999, 2000), CHAT_MAX)
  // row 1000 − 440 notebook − 6 handle = 554 budget: 480..554 all valid (the
  // handle is reserved too, 2026-11-26 — leaving it out put the notebook at
  // 434px with the chat dragged to its ceiling)
  assert.equal(clampChatCandidate(554, 1000), 554)
  assert.equal(clampChatCandidate(600, 1000), 554, 'a tight budget caps below CHAT_MIN but not under the remaining room')
  // row 690 − 446 = 244 < hard floor → the floor engages (layout integrity over the golden width)
  assert.equal(clampChatCandidate(500, 690), CHAT_HARD_FLOOR)
})

test('clampChatCandidate: a budget under CHAT_MIN opens the floor to the hard one, so the handle still moves where the default itself sits (the 960–1232px band)', () => {
  // row 774 = a 1366 window with the host sidebar expanded: budget 774−446 = 328
  assert.equal(clampChatCandidate(9999, 774), 328, 'the ceiling keeps the notebook at NOTE_MIN')
  assert.equal(clampChatCandidate(250, 774), CHAT_HARD_FLOOR, 'the floor is the hard one — the golden 480 sits above the ceiling, where a frozen handle would pin the chat')
  assert.equal(clampChatCandidate(324, 774), 324, 'the range is live between them (320..328 at this row)')
  // the moment the budget reaches CHAT_MIN (row 926) the golden floor is back
  assert.equal(clampChatCandidate(400, 926), CHAT_MIN)
  assert.equal(clampChatCandidate(400, 925), 400)
  assert.equal(chatBudget(926), CHAT_MIN)
})

test('defaultChatWidth mirrors the budgeted CSS clamp(320px,min(clamp(480px,45%,800px),100% - 446px),800px) at the row width', () => {
  assert.equal(defaultChatWidth(1000), 480, '45% of 1000 = 450 → clamps up to 480; the 554 budget does not bind')
  assert.equal(defaultChatWidth(2000), 800, '45% of 2000 = 900 → clamps down to 800')
  assert.equal(defaultChatWidth(1300), 585)
  assert.equal(defaultChatWidth(846), 400, 'the budget binds: 846 − 446 leaves the notebook exactly 440')
  assert.equal(defaultChatWidth(774), 328, 'a 1366 window with the host sidebar expanded (used to clip the notebook by 146px)')
  assert.equal(defaultChatWidth(649), CHAT_HARD_FLOOR, 'the floor: the notebook gives way only below row 766')
  assert.equal(defaultChatWidth(300), CHAT_HARD_FLOOR, 'never negative, never under the floor')
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
  // narrows to 1200: row = 1200−300−6 = 894 (the RAIL's handle — the chat's
  // own handle is inside the row), chat budget = 894−440−6 = 448 < 480
  // → allowed to crack to 448 (above the 320 hard floor), notebook exactly 440
  const solved = solvePaneWidths(null, 1100, 1200)
  assert.equal(solved.chat, 448, 'the stored chat squeezes to the remaining room')
  // …and no further: with BOTH handles subtracted here the budget would be
  // 442 — a 6px snap-back on release, caught live by scripts/probe-columns.mjs
  assert.equal(1200 - RAIL_DEFAULT - HANDLES_W - solved.chat, NOTE_MIN, 'the notebook lands on its design minimum, not 6px past it')
  // the rail re-solves against the SQUEEZED effective chat, not the stored one
  const both = solvePaneWidths(480, 1100, 1000)
  // rail basis 480 → row = 1000−480−6 = 514 → chat budget = 514−446 = 68 → floor 320
  assert.equal(both.chat, CHAT_HARD_FLOOR)
  // rail budget = chatBasis 320 + 440 + 12 = 772 → rail = min(480, 1000−772=228→floor 240)
  assert.equal(both.rail, RAIL_MIN)
})

test('the two row-width readings agree — the drag measures the live row, the solve derives it (a mismatch snaps the chat 6px on release)', () => {
  // container 1640: rail 300 → the live row (.lks14-row) is 1640−300−6 = 1334 wide;
  // a chat dragged to the ceiling lands on chatBudget(1334) = 888 and the
  // render-time solve must hand back the SAME number
  const draggedToCeiling = clampChatCandidate(9999, 1640 - RAIL_DEFAULT - HANDLE_W)
  assert.equal(draggedToCeiling, 888)
  assert.equal(solvePaneWidths(null, draggedToCeiling, 1640).chat, 888, 'no snap-back')
  assert.equal(defaultChatWidth(1640 - RAIL_DEFAULT - HANDLE_W), 1334 * 0.45, 'the default reads the same row (45% of it)')
})

test('the three columns always add up to the container (2026-11-26 clipping fix) — default widths', () => {
  // from the narrowest row that can hold the chat floor + its handle (in the
  // real panel the trio only exists from the 960px switch floor — row 649)
  let prev = 0
  for (let rowW = HANDLE_W + CHAT_HARD_FLOOR; rowW <= 3000; rowW += 1) {
    const chat = defaultChatWidth(rowW)
    const note = rowW - HANDLE_W - chat
    assert.ok(chat >= CHAT_HARD_FLOOR && chat <= 800, `row ${String(rowW)}: chat ${String(chat)} inside [floor, 800]`)
    assert.ok(note >= 0, `row ${String(rowW)}: the notebook is never pushed past the container (note ${String(note)})`)
    // the notebook keeps its design minimum whenever the chat floor allows it
    if (rowW >= CHAT_HARD_FLOOR + HANDLE_W + NOTE_MIN) assert.ok(note >= NOTE_MIN - 1e-9, `row ${String(rowW)}: notebook ${String(note)} < NOTE_MIN while the chat floor would fit`)
    assert.ok(chat >= prev - 1e-9, `row ${String(rowW)}: the chat never narrows as the row widens`)
    prev = chat
  }
})

test('the three columns always add up to the container — stored widths re-solved at every container width', () => {
  // a drag commits on a wide container; the host column then narrows to
  // anything. Whatever was stored, the solved rail + handles + chat leave the
  // notebook its room — never a negative sliver pushed off-screen.
  for (const containerW of [700, 800, 961, 1000, 1086, 1200, 1232, 1300, 1600, 2400]) {
    for (const railStored of [null, 240, 300, 360, 480]) {
      for (const chatStored of [null, 320, 400, 480, 700, 1100]) {
        const solved = solvePaneWidths(railStored, chatStored, containerW)
        const rail = solved.rail ?? RAIL_DEFAULT
        // the solve reads the row the same way: container − rail − the rail's handle
        const chat = solved.chat ?? defaultChatWidth(containerW - rail - HANDLE_W)
        // container = rail + handle + chat + handle + notebook
        const note = containerW - rail - HANDLES_W - chat
        const combo = `container ${String(containerW)} rail ${String(railStored)} chat ${String(chatStored)}`
        assert.ok(note >= 0, `${combo}: notebook ${String(note)} pushed off-screen`)
        // …and wherever the trio has its full room the notebook gets its whole design minimum
        if (containerW >= RAIL_DEFAULT + HANDLES_W + CHAT_HARD_FLOOR + NOTE_MIN) {
          assert.ok(note >= NOTE_MIN - 1e-9, `${combo}: notebook ${String(note)} squeezed for no reason`)
        }
      }
    }
  }
})

test('the stylesheet and the budget are one source of truth', async () => {
  const { STUDY_CSS } = await import('../src/client/styles.ts')
  const m = /\.lks14-chat\{flex:0 0 auto;width:var\(--lks-chat-w,clamp\((\d+)px,min\(clamp\((\d+)px,45%,(\d+)px\),calc\(100% - (\d+)px\)\),(\d+)px\)\)/.exec(STUDY_CSS)
  assert.ok(m !== null, 'the budgeted chat default is in the base sheet')
  assert.equal(Number(m![1]), CHAT_HARD_FLOOR, 'the clamp floor is the hard floor')
  assert.equal(Number(m![2]), CHAT_MIN, 'the inner clamp floor is the golden width')
  assert.equal(Number(m![3]), 800, 'the inner clamp ceiling')
  assert.equal(Number(m![4]), NOTE_MIN + HANDLE_W, 'the reservation is the notebook minimum plus the chat pane\'s own handle')
  assert.equal(Number(m![5]), 800, 'the outer ceiling')
  // the notebook carries no floor of its own: these clamps ARE its protection
  assert.doesNotMatch(STUDY_CSS, /\.lks14-note\{[^}]*min-width:[1-9]/, 'a notebook min-width is the one thing flex cannot honor')
})

test('constants stay in lockstep with the stylesheet contract', () => {
  assert.equal(RAIL_DEFAULT, 300, 'the rail CSS default basis')
  assert.equal(NOTE_MIN, 440, "the notebook's design minimum — protected by the chat budget (the stylesheet carries no min-width for it)")
  assert.equal(HANDLE_W, 6, 'one 6px handle')
  assert.equal(HANDLES_W, 12, 'two 6px handles')
  assert.ok(CHAT_HARD_FLOOR < CHAT_MIN && CHAT_MIN < CHAT_MAX)
  assert.ok(RAIL_MIN < RAIL_DEFAULT && RAIL_DEFAULT < RAIL_MAX)
})

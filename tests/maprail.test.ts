/**
 * The course rail as a list (2026-09-08 owner pivot — the upstream balloon/
 * physics map is a deliberate deviation): the rail's pure folds + the D6
 * world derivation + the P16 theme resolution.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { rowStateClass, rowMasteryPct, sectionWorldOf } from '../src/client/maprail.tsx'

test('rowStateClass ports the state mapping (the list successor of bubbleClasses)', () => {
  assert.equal(rowStateClass({ kind: 'study', status: 'locked' }, true), 'locked')
  assert.equal(rowStateClass({ kind: 'study', status: 'available' }, true), 'available')
  assert.equal(rowStateClass({ kind: 'study', status: 'in_progress' }, true), 'in-progress')
  assert.equal(rowStateClass({ kind: 'study', status: 'mastered' }, true), 'mastered')
  assert.equal(rowStateClass({ kind: 'exam', status: 'available' }, false), 'exam-locked', 'exam gates on the chapter, never on its own status')
  assert.equal(rowStateClass({ kind: 'exam', status: 'available' }, true), 'exam')
  assert.equal(rowStateClass({ kind: 'exam', status: 'mastered' }, true), 'exam-passed', 'a mastered exam is the passed boss')
  assert.equal(rowStateClass({ kind: 'study', status: 'garbage' }, true), 'locked', 'unknown status degrades to locked')
})

test('rowMasteryPct: mastered reads full, in-progress reads live, others stay barless', () => {
  assert.equal(rowMasteryPct({ status: 'mastered', masteryPct: null }), 100)
  assert.equal(rowMasteryPct({ status: 'in_progress', masteryPct: 62 }), 62)
  assert.equal(rowMasteryPct({ status: 'in_progress', masteryPct: null }), 0)
  assert.equal(rowMasteryPct({ status: 'available', masteryPct: 40 }), null)
  assert.equal(rowMasteryPct({ status: 'locked', masteryPct: null }), null)
})

test('D6: sectionWorldOf — purely-practice sections are the practice world', () => {
  const P = (n: number): Array<{ kind: 'study' | 'practice' | 'exam' }> => Array.from({ length: n }, () => ({ kind: 'practice' }))
  assert.equal(sectionWorldOf({ lessons: P(3) }), 'practice', 'non-empty all-practice → practice')
  assert.equal(sectionWorldOf({ lessons: [] }), 'study', 'empty → study (never strands an empty world)')
  assert.equal(sectionWorldOf({ lessons: [{ kind: 'study' }, { kind: 'practice' }] }), 'study', 'mixed → study (homogeneity comes from the design protocol)')
  assert.equal(sectionWorldOf({ lessons: [{ kind: 'study' }, { kind: 'study' }, { kind: 'exam' }] }), 'study')
})

// ——— P16: the panel theme resolution (host preference → panel theme) ———

import { hostPanelTheme } from '../src/client/theme.ts'

test('P16: hostPanelTheme resolves the host preference into the panel theme', () => {
  assert.equal(hostPanelTheme('light', false), 'light')
  assert.equal(hostPanelTheme('dark', true), 'dark')
  assert.equal(hostPanelTheme('system', true), 'light', 'system + prefers-light → light')
  assert.equal(hostPanelTheme('system', false), 'dark', 'system + prefers-dark → dark')
  assert.equal(hostPanelTheme(undefined, true), 'light')
  assert.equal(hostPanelTheme(undefined, false), 'dark')
  assert.equal(hostPanelTheme('garbage', true), 'light', 'unknown preference degrades to the media query')
})

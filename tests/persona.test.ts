/**
 * Persona structure lock (upstream v0.27.0 port): the tutor core must be
 * tiered 红线→行为→偏好 with an anti-forgery redline, and the proposal path
 * must be named in the tool guidance. Born from upstream's live incident:
 * the model hand-wrote「[工具调用已执行]」markers instead of calling
 * mark_mastered, leaving the learner with no confirmation card. The dormant
 * gate itself is covered by activation.test.ts; this file locks the SHAPE of
 * the active text.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { tutorCoreText } from '../src/surface.ts'
import { emptyState } from '../src/state.ts'

const state = emptyState()
state.active = true
const core = tutorCoreText(state)

test('tutor core is tiered redlines → behavior → formatting, in that order', () => {
  const redline = core.indexOf('Safety redlines')
  const behavior = core.indexOf('Teaching behavior')
  const formatting = core.indexOf('Answer formatting')
  assert.ok(redline > 0, 'a redline tier exists')
  assert.ok(behavior > redline, 'the behavior tier follows the redline tier')
  assert.ok(formatting > behavior, 'the formatting tier comes last (subordinate)')
  assert.ok(core.includes('redlines win'), 'conflicts resolve to the redline tier explicitly')
})

test('anti-forgery redline: hand-written tool markers produce no artifact', () => {
  assert.ok(core.includes('[工具调用已执行]'), 'the marker literal the model imitates is named')
  assert.ok(core.includes('no card, no button'), 'the consequence of forging is spelled out')
  assert.ok(/only way to act on the study state/i.test(core), 'real tool calls are declared the only acting path')
})

test('grounding redline survived the restructure verbatim', () => {
  assert.ok(core.includes('never invent'), 'quiz answers stay grounded in lesson content')
  assert.ok(core.includes('Never claim progress you did not record through the tools'))
})

test('tool guidance names the mastery-proposal pair and the exam recorder', () => {
  assert.ok(core.includes('study_propose_mastery'))
  assert.ok(core.includes('study_resolve_proposal'))
  assert.ok(core.includes('study_exam_result'), 'the exam path (a state mutation) is governed too')
})

test('behavior and preference clauses survived the restructure', () => {
  assert.ok(core.includes("learner's own language"))
  assert.ok(core.includes('ONE question or interactive block per reply'))
  assert.ok(core.includes('Feynman-style explanation'))
  assert.ok(core.includes('mermaid code blocks'))
  assert.ok(core.includes('3000-8000 chars'))
})

/**
 * The activation gate (on-demand 学习模式): dormant states render no persona
 * text and register no tools; activation flips both, deactivation retires
 * them, and the surface stays idempotent per state.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { parseMarkdownToCourse } from '../src/vendor/markdown-course.ts'
import { emptyState, importCourse } from '../src/state.ts'
import { createStudySurface, snapshotSectionText, soulText, tutorCoreText } from '../src/surface.ts'

test('dormant states render every persona text empty', () => {
  const state = emptyState()
  assert.equal(state.active, false, 'fresh installs start dormant')
  assert.equal(tutorCoreText(state), '')
  assert.equal(soulText(state), '')
  assert.equal(snapshotSectionText(state), '')
})

test('active states render the tutor core, the chosen soul, and the snapshot', () => {
  const state = emptyState()
  state.active = true
  state.mode = 'practice'
  const course = importCourse(state, parseMarkdownToCourse('# Course\n## Part\n### Lesson\nbody'), 'markdown', 'fixture')
  state.focus = { lessonId: `${course.id}:0:0` }
  assert.ok(tutorCoreText(state).includes('Study tutor'))
  assert.ok(tutorCoreText(state).includes("learner's own language"), 'the output-language directive rides the tutor core')
  assert.ok(soulText(state).includes('Soul: practice'))
  assert.ok(snapshotSectionText(state).includes('【学习者当前状态】'), 'a focused active state renders the learner snapshot')
  // The texts are the real prompt surfaces, not copies: they react to the
  // state's own facts.
  state.mode = 'guide'
  assert.ok(soulText(state).includes('Soul: guide'))
})

test('the study surface registers tools on activation and retires them on exit', () => {
  const state = emptyState()
  const registered: string[] = []
  const disposed: string[] = []
  const registry = {
    register(tool: ToolDefinition): () => void {
      registered.push(tool.name)
      return () => { disposed.push(tool.name) }
    },
  }
  const surface = createStudySurface(registry, { get: () => state, save: () => {} })

  surface.sync()
  assert.equal(registered.length, 0, 'a dormant boot registers nothing')

  state.active = true
  surface.sync()
  assert.equal(registered.length, 20, 'activation registers the full study_* toolset')
  assert.equal(disposed.length, 0)
  surface.sync()
  assert.equal(registered.length, 20, 'sync is idempotent while the flag is unchanged')

  state.active = false
  surface.sync()
  assert.equal(disposed.length, 20, 'deactivation disposes every live registration')

  state.active = true
  surface.sync()
  assert.equal(registered.length, 40, 're-activation registers a fresh batch')
  surface.dispose()
  assert.equal(disposed.length, 40, 'teardown retires whatever is live regardless of the flag')
})

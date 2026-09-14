/**
 * Audit A3 (2026-09-14): cross-process persistence hardening. Multi-profile
 * setups share ONE state.json, so saveState must never interleave two writers
 * on the same temp path, keep one .bak generation for recovery, and loadState
 * must recover instead of throwing out of the host's apply().
 */

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyState, importCourse, loadState, saveState } from '../src/state.ts'
import { parseMarkdownToCourse } from '../src/vendor/markdown-course.ts'

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'lks-persist-'))
}

function stateWithCourse(): ReturnType<typeof emptyState> {
  const state = emptyState()
  importCourse(state, parseMarkdownToCourse('# Course\n## S\n### a\nbody a\n### b\nbody b'), 'markdown', 'persist-fixture')
  return state
}

test('A3: saveState uses unique tmp names — a stale fixed-name tmp is never consumed', () => {
  const dir = tempDir()
  try {
    const path = join(dir, 'state.json')
    writeFileSync(`${path}.tmp`, 'STALE', 'utf8')
    const state = stateWithCourse()
    saveState(path, state)
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).courses.length, 1, 'the new save landed')
    assert.equal(readFileSync(`${path}.tmp`, 'utf8'), 'STALE', 'the old fixed-name tmp is untouched (each save mints its own unique tmp)')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('A3: saveState keeps the previous generation as .bak', () => {
  const dir = tempDir()
  try {
    const path = join(dir, 'state.json')
    const a = emptyState()
    a.memoryGlobal = 'gen-a'
    saveState(path, a)
    assert.equal(existsSync(`${path}.bak`), false, 'the first save has no previous generation to keep')
    const b = emptyState()
    b.memoryGlobal = 'gen-b'
    saveState(path, b)
    assert.equal(JSON.parse(readFileSync(`${path}.bak`, 'utf8')).memoryGlobal, 'gen-a', 'the .bak holds the PREVIOUS generation')
    assert.equal(loadState(path).memoryGlobal, 'gen-b', 'the live file holds the newest')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('A3: a corrupt primary recovers from .bak instead of killing apply', () => {
  const dir = tempDir()
  try {
    const path = join(dir, 'state.json')
    const first = stateWithCourse()
    first.memoryGlobal = 'first-generation'
    saveState(path, first)
    const second = stateWithCourse()
    second.memoryGlobal = 'second-generation'
    saveState(path, second)
    writeFileSync(path, '{torn mid-write', 'utf8')
    const recovered = loadState(path)
    assert.equal(recovered.courses.length, 1, 'the course came back from the backup')
    assert.equal(recovered.memoryGlobal, 'first-generation', 'the backup holds the PREVIOUS durable generation')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('A3: corrupt primary with no backup is quarantined and degrades to empty state', () => {
  const dir = tempDir()
  try {
    const path = join(dir, 'state.json')
    writeFileSync(path, 'garbage', 'utf8')
    const state = loadState(path)
    assert.equal(state.courses.length, 0, 'degrades to a usable empty state')
    assert.ok(readdirSync(dir).some(f => f.includes('.corrupt-')), 'the bad file was renamed to .corrupt-*')
    assert.equal(existsSync(path), false, 'the corrupt bytes no longer sit at the live path')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('A3: a newer-version file with no backup degrades the same way', () => {
  const dir = tempDir()
  try {
    const path = join(dir, 'state.json')
    writeFileSync(path, JSON.stringify({ version: 99, courses: [] }), 'utf8')
    const state = loadState(path)
    assert.equal(state.courses.length, 0, 'a future-version file no longer throws out of apply')
    assert.ok(readdirSync(dir).some(f => f.includes('.corrupt-')), 'it was quarantined for the owner to inspect')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('A3: crash window — primary missing but .bak present restores the backup', () => {
  const dir = tempDir()
  try {
    const path = join(dir, 'state.json')
    const first = stateWithCourse()
    first.memoryGlobal = 'durable-generation'
    saveState(path, first)
    saveState(path, stateWithCourse())
    rmSync(path)
    const restored = loadState(path)
    assert.equal(restored.courses.length, 1, 'the backup generation comes back when the primary disappears')
    assert.equal(restored.memoryGlobal, 'durable-generation', 'the .bak holds the last fully-durable generation')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

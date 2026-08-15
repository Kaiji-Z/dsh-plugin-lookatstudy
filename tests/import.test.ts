/**
 * Import pipelines: local-folder scan → course assembly, and GitHub import
 * with an offline mocked fetch (single-file pattern), plus URL parsing.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanFolder } from '../src/vendor/local-folder-scanner.ts'
import { buildCourseFromFiles, importRepoToParsedCourse } from '../src/vendor/repo-fetcher.ts'

test('folder scan reads md/ipynb/code and the tree assembly groups lessons', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lookatstudy-folder-'))
  try {
    mkdirSync(join(dir, 'week1-intro'))
    mkdirSync(join(dir, 'week2-nn'))
    writeFileSync(join(dir, 'README.md'), '# Course\n## Overview\nblurb\n', 'utf8')
    writeFileSync(join(dir, 'week1-intro', 'README.md'), '### Neurons\nA neuron computes a weighted sum.\n', 'utf8')
    writeFileSync(join(dir, 'week1-intro', 'lab.py'), '"""A tiny lab."""\nx = 1\n', 'utf8')
    writeFileSync(
      join(dir, 'week2-nn', 'perceptron.ipynb'),
      JSON.stringify({
        cells: [
          { cell_type: 'markdown', source: ['### Perceptron\n'] },
          { cell_type: 'code', source: ['w = [1, 2]\n'] },
        ],
        metadata: {},
        nbformat: 4,
      }),
      'utf8',
    )

    const docs = await scanFolder(dir)
    const paths = docs.map(d => d.path)
    assert.ok(paths.includes('week1-intro/README.md'), 'per-directory READMEs must survive dedup')
    const kinds = docs.map(d => d.kind).sort()
    assert.ok(kinds.includes('md'))
    assert.ok(kinds.includes('code'))
    assert.ok(kinds.includes('ipynb'))

    const files = docs.map(d => ({ path: d.path, title: d.title, md: d.content }))
    const course = buildCourseFromFiles('Fixture', files)
    const titles = course.sections.flatMap(s => s.lessons.map(l => l.title))
    assert.ok(titles.some(t => /neuron/i.test(t)), `lessons: ${titles.join(' | ')}`)
    assert.ok(titles.some(t => /perceptron/i.test(t)), `lessons: ${titles.join(' | ')}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('github single-file repo imports offline through a mocked fetch', async () => {
  const prose = Array.from({ length: 60 }, (_, i) => `Paragraph ${i} of substantial teaching prose.`).join('\n\n')
  const readme = `# AI Primer\n\n${prose}\n\n## Basics\n\n### Terms\n\nSome definitions.\n`
  const fetchFn: typeof fetch = async (input) => {
    const url = String(input)
    if (url.includes('README.md')) {
      return new Response(readme, { status: 200 })
    }
    return new Response('not found', { status: 404 })
  }
  const result = await importRepoToParsedCourse('owner', 'repo', 'main', fetchFn)
  assert.equal(result.detection.pattern, 'single-file')
  assert.equal(result.course.title, 'AI Primer')
  assert.ok(result.course.sections.length >= 1)
})

test('github fetch failure surfaces a clear error', async () => {
  const fetchFn: typeof fetch = async () => new Response('gone', { status: 404 })
  await assert.rejects(
    () => importRepoToParsedCourse('owner', 'repo', 'main', fetchFn),
    /README/,
  )
})

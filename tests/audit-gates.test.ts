/**
 * Audit round gate tests that assert repo-level invariants rather than unit
 * behavior: the declared peer surface matches the bundle's real requirements
 * (C22), hostile numeric entities degrade instead of crashing the article
 * extractor (C21), and the phantom-tool reference is gone from every prompt
 * surface (C19 grep gate).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { extractArticle } from '../src/vendor/html-article.ts'

test('audit C22: the client bundle\'s react-dom requirement is declared as a peer', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { peerDependencies?: Record<string, string> }
  assert.ok(pkg.peerDependencies?.react !== undefined, 'react stays declared')
  assert.ok(pkg.peerDependencies?.['react-dom'] !== undefined, 'react-dom is declared — the bundle requires react-dom/client at load (undeclared peers break host generations that predate it)')
})

test('audit C21: out-of-range numeric entities degrade to U+FFFD instead of crashing the import', () => {
  const body = Array.from({ length: 12 }, (_v, i) => `<p>第${i + 1}段正文,讲一个完整的概念并给出例子,保证正文密度足够被抽取器识别为文章。</p>`).join('')
  const hostile = `<html><head><title>Entity Hostile</title></head><body><article><h1>Entity Hostile</h1>${body}<p>&#x110000; and &#xFFFFFFFF;</p></article></body></html>`
  const article = extractArticle(hostile, 'https://example.com/entities')
  assert.ok(article !== null, 'the extraction survives hostile entities')
  assert.ok(article.markdown.includes('\uFFFD'), 'the bad code points degrade to the replacement character')
})

test('audit C19 grep gate: no prompt surface points at the phantom study_view tool', () => {
  const surfaces = ['src/tools.ts', 'src/state.ts', 'src/client/locale.ts']
  for (const f of surfaces) {
    const body = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
    assert.ok(!body.includes('study_view'), `${f} references study_view — the tool does not exist; recovery text must point at study_lesson`)
  }
})

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

test('audit C24: the KaTeX walker fences shiki/mermaid cards (source gate)', async () => {
  const { readFileSync: read } = await import('node:fs')
  const body = read(new URL('../src/client/enhance.ts', import.meta.url), 'utf8')
  assert.ok(body.includes("closest('.lks-shiki, .lks-mermaid')"), 'the math walker skips highlighted code and diagram cards — $..$ inside shiki tokens must not render')
})

test('audit C29: a stale design brief renders as stale after a newer import', async () => {
  const { studyTools } = await import('../src/tools.ts')
  const { emptyState } = await import('../src/state.ts')
  const articleHtml = () => {
    const paras = Array.from({ length: 12 }, (_v, i) => `<p>Paragraph ${i} of a real article body with teaching substance.</p>`).join('')
    return `<html><head><title>Stub Article ${String(Math.random()).slice(2, 6)}</title></head><body><article><h1>Stub</h1>${paras}</article></body></html>`
  }
  const state = emptyState()
  const tools = studyTools({ get: () => state, save: () => {} }, { fetch: async () => new Response(articleHtml(), { status: 200 }) })
  const byName = new Map(tools.map(t => [t.name, t]))
  const run = async (name: string, args: Record<string, unknown>): Promise<any> => byName.get(name)!.execute(args, { signal: new AbortController().signal } as never)
  const first = await run('study_import_url', { url: 'https://a.example/one' })
  const second = await run('study_import_url', { url: 'https://b.example/two' })
  const tool = byName.get('study_import_url')!
  const stale = tool.output.render({ url: 'x' }, first)[0]!.text
  assert.ok(stale.includes('STALE'), 'the superseded brief renders as stale instead of the newer import\'s brief')
  const fresh = tool.output.render({ url: 'y' }, second)[0]!.text
  assert.ok(!fresh.includes('STALE'), 'the current brief renders normally')
  assert.ok(first.designSeq !== second.designSeq, 'the two briefs carry distinct sequence numbers')
})

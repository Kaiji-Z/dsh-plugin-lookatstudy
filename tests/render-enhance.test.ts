/**
 * SPEC Phase 2 — the render layer's pure half (the CDN/degrade halves are
 * bundle-gated in verify and live-verified in the web-profile livetest):
 *  - math-normalize (vendored verbatim): \(..\)→$..$, \[..\]→$$..$$, fences untouched, idempotent
 *  - mermaid-elk-rewrite (vendored verbatim): flowchart→flowchart-elk prefix, idempotent, other diagram types untouched
 *  - mindmap-markdown (vendored verbatim): fences → 代码块 placeholder, images → alt, comments stripped
 *  - cmap-elk-layout pure parts: CJK width estimation, label wrapping, node boxes, adjacency clustering fallback
 *  - the math-span detector the DOM enhancer walks with
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeMathNotation } from '../src/vendor/math-normalize.ts'
import { rewriteFlowchartToElk } from '../src/vendor/mermaid-elk-rewrite.ts'
import { mindmapMarkdown } from '../src/vendor/mindmap-markdown.ts'
import { estTextWidth, wrapLabel, cmNodeBox, clusterByAdjacency, resolveGroups } from '../src/vendor/cmap-elk-layout.ts'

test('math-normalize: LaTeX delimiters fold to $, fences untouched, idempotent', () => {
  assert.equal(normalizeMathNotation('inline \\(a+b\\) here'), 'inline $a+b$ here')
  assert.equal(normalizeMathNotation('block:\n\\[E=mc^2\\]\nafter'), 'block:\n$$E=mc^2$$\nafter')
  assert.equal(normalizeMathNotation('```\ncode \\( x \\) stays\n```'), '```\ncode \\( x \\) stays\n```')
  const once = normalizeMathNotation('a \\(b\\)')
  assert.equal(normalizeMathNotation(once), once, 'idempotent')
})

test('mermaid-elk-rewrite: flowchart family gets -elk, idempotent, others untouched', () => {
  assert.match(rewriteFlowchartToElk('flowchart TD\n  A-->B'), /^flowchart-elk TD/)
  assert.match(rewriteFlowchartToElk('graph LR\n  A-->B'), /^flowchart-elk LR/)
  const rewritten = rewriteFlowchartToElk('%%{init}%%\nflowchart TD\n  A-->B')
  assert.match(rewritten, /flowchart-elk TD/)
  const already = rewriteFlowchartToElk('flowchart-elk TD\n  A-->B')
  assert.equal(rewriteFlowchartToElk(already), already, 'idempotent')
  const seq = 'sequenceDiagram\n  A->>B: hi'
  assert.equal(rewriteFlowchartToElk(seq), seq, 'sequence untouched')
  const state = 'stateDiagram-v2\n  [*] --> S1'
  assert.equal(rewriteFlowchartToElk(state), state, 'state untouched')
})

test('mindmap-markdown: fences collapse to placeholders, images to alt, comments drop', () => {
  const md = [
    '# L',
    '## A',
    'text with ![alt text](img.png) inline',
    '```python',
    'print(1)',
    '```',
    '<!-- hidden -->',
    '## B',
    '```',
    'raw fence',
  ].join('\n')
  const out = mindmapMarkdown(md)
  assert.ok(out.includes('# L'))
  assert.ok(out.includes('alt text'), 'image alt survives')
  assert.ok(!out.includes('img.png'))
  assert.ok(!out.includes('print(1)'), 'fence body dropped')
  assert.ok(out.includes('- 代码块'), 'fence placeholder keeps structure')
  assert.ok(!out.includes('hidden'), 'HTML comment stripped')
})

test('cmap pure layout: CJK-aware widths, label wrapping, hub boxes, adjacency fallback clusters', () => {
  assert.ok(estTextWidth('中文') > estTextWidth('ab'), 'CJK chars are full-width')
  assert.deepEqual(wrapLabel('短'), ['短'])
  const long = 'a'.repeat(60)
  const lines = wrapLabel(long)
  assert.ok(lines.length >= 2, 'long labels wrap')
  const hub = cmNodeBox('中心概念', true)
  const leaf = cmNodeBox('叶子', false)
  assert.ok(hub.width > leaf.width, 'hub boxes are wider')
  // two hubs of degree 3 over 8 nodes → k=ceil(8/4)=2 seeds → two clusters
  const nodes = [
    { id: 'ha', label: 'HA' }, { id: 'a1', label: 'A1' }, { id: 'a2', label: 'A2' }, { id: 'a3', label: 'A3' },
    { id: 'hb', label: 'HB' }, { id: 'b1', label: 'B1' }, { id: 'b2', label: 'B2' }, { id: 'b3', label: 'B3' },
  ]
  const edges = [
    { from: 'ha', to: 'a1' }, { from: 'ha', to: 'a2' }, { from: 'ha', to: 'a3' },
    { from: 'hb', to: 'b1' }, { from: 'hb', to: 'b2' }, { from: 'hb', to: 'b3' },
  ]
  const clusters = clusterByAdjacency(nodes, edges)
  assert.ok(clusters.length >= 2, `expected fallback clustering, got ${clusters.length}`)
  // too-small graphs don't cluster
  assert.deepEqual(clusterByAdjacency(nodes.slice(0, 3), edges.slice(0, 2)), [])
  // resolveGroups: invalid group (missing node) falls back to adjacency clusters
  const resolved = resolveGroups(nodes, edges, [{ id: 'g', label: '坏组', nodeIds: ['h', 'ghost'] }])
  assert.ok(resolved.groups.length >= 1)
})

test('the lesson pipeline normalizes math before rendering (host-side wiring)', async () => {
  const { renderMarkdown } = await import('../src/markdown.ts')
  const html = renderMarkdown(normalizeMathNotation('公式 \\(a^2\\) 出现'))
  assert.ok(html.includes('$a^2$'), 'the $ form survives into HTML for the DOM enhancer')
})

test('sanitize invariant: the render pipeline is escape-first — hostile markdown never yields executable HTML', async () => {
  const { renderMarkdown } = await import('../src/markdown.ts')
  const hostile = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '[click](javascript:alert(1))',
    '```html',
    '<iframe src="https://evil.example"></iframe>',
    '```',
  ].join('\n')
  const html = renderMarkdown(normalizeMathNotation(hostile))
  // executable HTML = RAW tag openings; escaped text (&lt;script&gt;) is inert
  assert.ok(!/<\s*(script|iframe|img|svg)/i.test(html), `raw hostile tags leaked: ${html}`)
  assert.ok(!/href=("|')?javascript:/i.test(html), 'javascript: hrefs are not emitted')
})

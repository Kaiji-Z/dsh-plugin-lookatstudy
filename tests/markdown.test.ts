/**
 * The sanitized markdown renderer for the workbench 讲解 view: syntax subset
 * behavior and, above all, the guarantee that raw HTML never passes through.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { renderMarkdown } from '../src/markdown.ts'

test('headings, paragraphs, and emphasis render', () => {
  const html = renderMarkdown('# Title\n\nplain **bold** and *italic* and `code`\n')
  assert.ok(html.includes('<h1>Title</h1>'))
  assert.ok(html.includes('<strong>bold</strong>'))
  assert.ok(html.includes('<em>italic</em>'))
  assert.ok(html.includes('<code>code</code>'))
  assert.ok(html.includes('<p>plain'))
})

test('fenced code keeps content verbatim and unformatted', () => {
  const html = renderMarkdown('before\n```python\nx = <b>1</b> **raw**\n```\nafter')
  assert.ok(html.includes('<pre><code class="lang-python">x = &lt;b&gt;1&lt;/b&gt; **raw**</code></pre>'))
  assert.ok(!html.includes('<strong>raw</strong>'))
})

test('raw HTML is escaped everywhere', () => {
  const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>')
  assert.ok(!html.includes('<script'))
  assert.ok(!html.includes('<img'))
  assert.ok(html.includes('&lt;script&gt;'))
  assert.ok(html.includes('&lt;img'))
})

test('lists render as ul/ol', () => {
  const html = renderMarkdown('- a\n- b\n\n1. first\n2. second\n')
  assert.ok(html.includes('<ul><li>a</li><li>b</li></ul>'))
  assert.ok(html.includes('<ol><li>first</li><li>second</li></ol>'))
})

test('tables render header and body cells', () => {
  const html = renderMarkdown('| A | B |\n| --- | --- |\n| 1 | 2 |\n')
  assert.ok(html.includes('<th>A</th>'))
  assert.ok(html.includes('<td>1</td>'))
})

test('blockquote and rule render; links are http(s)-only', () => {
  const html = renderMarkdown('> quoted\n\n---\n\n[site](https://x.co) and [bad](javascript:alert(1))\n')
  assert.ok(html.includes('<blockquote>'))
  assert.ok(html.includes('<hr>'))
  assert.ok(html.includes('<a href="https://x.co"'))
  assert.ok(!html.includes('<a href="javascript:'))
})

test('headings inside code fences are not headings', () => {
  const html = renderMarkdown('```\n# not a heading\n```\n')
  assert.ok(!html.includes('<h1>'))
  assert.ok(html.includes('# not a heading'))
})

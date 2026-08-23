/**
 * text-chunk (vendored verbatim from upstream; SPEC 1.2): sentence-boundary
 * chunking of headingless text and the single-doc preprocessor decision
 * (structured → one file, long+unstructured → chunked).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { chunkHeadinglessText, prepareSingleDoc } from '../src/vendor/text-chunk.ts'

test('chunkHeadinglessText splits at paragraph/sentence boundaries into ~target parts', () => {
  const text = Array.from({ length: 100 }, (_v, i) => `第${i + 1}段。这是没有标题的长文本,用来验证分段器。句子边界也认英文 punctuation!真的吗?是的.`).join('\n\n')
  const parts = chunkHeadinglessText(text, 'notes', 4000)
  assert.ok(parts.length >= 2, 'long text must split')
  for (const [i, p] of parts.entries()) {
    assert.ok(p.path.startsWith('notes-') && p.path.endsWith('.md'))
    assert.ok(p.content.startsWith(`# 第 ${i + 1} 部分`))
    assert.ok(p.content.length < 4000 + 700, 'each part stays near target (sentence slack)')
  }
  // nothing lost: all paragraph fragments present across parts
  const joined = parts.map((p) => p.content).join('\n')
  assert.ok(joined.includes('第1段。'))
  assert.ok(joined.includes('第30段。'))
})

test('chunkHeadinglessText returns [] for empty/whitespace input', () => {
  assert.deepEqual(chunkHeadinglessText('   \n  ', 'x'), [])
})

test('prepareSingleDoc keeps structured docs whole, chunks headingless over-8000 docs', () => {
  const structured = '# Title\n\n' + Array.from({ length: 6 }, (_v, i) => `## Section ${i}\n\ncontent`).join('\n\n')
  assert.equal(prepareSingleDoc('doc', structured).length, 1)
  const headingless = '长文本。'.repeat(4000) // > 8000 chars, no H2s
  const parts = prepareSingleDoc('doc', headingless)
  assert.ok(parts.length >= 2, `expected chunking, got ${parts.length}`)
  const short = '短文一个。'
  assert.deepEqual(prepareSingleDoc('doc', short), [{ path: 'doc.md', content: short }])
})

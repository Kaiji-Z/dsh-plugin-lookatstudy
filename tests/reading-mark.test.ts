/**
 * 0.25.3 — the reading karaoke's PURE alignment core (ported from upstream
 * highlightText.ts v9): canonical matching collapses punctuation/full-width
 * differences, extends over quote/punctuation edges so the highlight covers
 * the complete visible sentence, self-heals monotonic-cursor drift, and lets
 * unspoken display runs (inline code) ride inside the match as gaps.
 * The DOM parts (Highlight registration, line-box centering) are probe-gated.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { canonicalSpeechIndex, matchSentenceAligned } from '../src/client/reading-mark.ts'

test('canonicalSpeechIndex: full-width folds to half, punctuation/space vanish, map stays aligned', () => {
  const { canon, map } = canonicalSpeechIndex('Ａｂｃ，　ｄｅ！')
  assert.equal(canon, 'abcde')
  assert.equal('Ａｂｃ，　ｄｅ！'.charAt(map[0]!), 'Ａ', 'the map points at the original full-width chars')
  assert.equal(map.length, 5)
})

test('matchSentenceAligned: punctuation/width differences collapse; edges extend to the visible sentence', () => {
  const dom = '前文。「这是第一句，讲梯度。」后续。'
  const m = matchSentenceAligned(dom, '这是第一句，讲梯度。')
  assert.ok(m !== null)
  assert.equal(dom.slice(m[0], m[1]), '「这是第一句，讲梯度。」', 'the mark swallows the opening quote and full closing punctuation')
})

test('matchSentenceAligned: monotonic cursor + self-heal; inline code rides as a gap', () => {
  const dom = '第一句。中段 code span 不朗读 第二句结束。'
  const sentence = '中段第二句结束。'
  // whole-canonical fails (code words interrupt); the token-interval fallback
  // bridges the gap: head anchors 中段, tail anchors 结束
  const m = matchSentenceAligned(dom, sentence)
  assert.ok(m !== null)
  assert.ok(dom.slice(m[0], m[1]).includes('code span'), 'the unspoken display run rides inside the marked span')
  assert.ok(dom.slice(m[0], m[1]).endsWith('第二句结束。'))
  // repeated sentence: the cursor moves forward instead of re-marking the first
  const repeat = '同句。间隔。同句。'
  const first = matchSentenceAligned(repeat, '同句。', 0)
  const second = matchSentenceAligned(repeat, '同句。', first![1])
  assert.ok(second !== null && second[0] > first![0], 'the cursor advances past the first occurrence')
})

test('matchSentenceAligned: no match returns null (the read continues, only the highlight skips)', () => {
  assert.equal(matchSentenceAligned('完全不同的正文。', '不存在的句子内容'), null)
  assert.equal(matchSentenceAligned('任何正文。', '   '), null)
})

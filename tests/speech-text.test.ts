/**
 * The vendored read-aloud pure functions (upstream LookatStudy v0.28.0):
 * markdown → speakable text, sentence splitting, and LaTeX → spoken Chinese.
 * These pin the behavior the plugin's TTS pipeline builds on.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeSpeechText, speechSentencesOf, splitSentences, endsWithSentenceEnd } from '../src/vendor/speech-text.ts'
import { mathToSpokenZH, speakMathInSentence } from '../src/vendor/math-speech.ts'

test('normalizeSpeechText strips layout but keeps content and math', () => {
  const md = [
    '# 标题',
    '',
    '正文 **加粗** 与 [链接文字](https://example.com)。',
    '',
    '```python',
    'print("不朗读我")',
    '```',
    '',
    '- 列表项一',
    '- 列表项二',
    '',
    '行内代码 `x=1` 与图片 ![alt](img.png) 结束。',
    '公式 $x^2$ 保留原文。',
  ].join('\n')
  const out = normalizeSpeechText(md)
  assert.ok(!out.includes('不朗读我'), 'fenced code blocks are removed entirely')
  assert.ok(!out.includes('`'), 'inline code backticks are stripped with their content')
  assert.ok(!out.includes('img.png'), 'images are removed')
  assert.ok(out.includes('链接文字'), 'links keep their text')
  assert.ok(out.includes('加粗'), 'emphasis keeps its content')
  assert.ok(out.includes('$x^2$'), 'math delimiters survive normalization (synthesis side converts them)')
  assert.ok(!out.includes('#'), 'heading markers are stripped')
})

test('speechSentencesOf splits on Chinese punctuation; decimals do not split', () => {
  assert.deepEqual(speechSentencesOf('第一句。第二句！第三句？'), ['第一句。', '第二句！', '第三句？'])
  const decimal = speechSentencesOf('圆周率是 3.14 没错。')
  assert.equal(decimal.length, 1, 'a dot after a digit is a decimal point, not a sentence end')
  assert.equal(speechSentencesOf('无标点短行')[0], '无标点短行', 'a newline-less fragment flushes as one sentence')
})

test('splitSentences is streaming-friendly: rest carries over, flush empties it', () => {
  const first = splitSentences('第一句。第二')
  assert.deepEqual(first.sentences, ['第一句。'])
  assert.equal(first.rest, '第二')
  const settled = splitSentences('第一句。第二句。')
  assert.deepEqual(settled.sentences, ['第一句。', '第二句。'])
  assert.equal(settled.rest, '')
  const tail = splitSentences('第一句。尾巴', { flush: true })
  assert.deepEqual(tail.sentences, ['第一句。', '尾巴'], 'flush emits the trailing remainder')
  assert.equal(tail.rest, '')
})

test('endsWithSentenceEnd separates true sentence ends from maxBuffer force-breaks', () => {
  assert.ok(endsWithSentenceEnd('完整的一句。'))
  assert.ok(endsWithSentenceEnd('整行句\n'), 'a trailing newline marks a display end')
  assert.ok(!endsWithSentenceEnd('被强断的超长片段没有终点标点'))
})

test('mathToSpokenZH converts the common notation table to spoken Chinese', () => {
  assert.equal(mathToSpokenZH('\\frac{1}{2}'), '1 分之 2')
  assert.equal(mathToSpokenZH('x^2'), 'x 的 2 次方')
  assert.equal(mathToSpokenZH('\\sqrt{x}'), '根号 x')
  assert.equal(mathToSpokenZH('\\alpha + \\beta'), '阿尔法 + 贝塔', 'raw ASCII operators pass through; only LaTeX commands map')
  assert.equal(mathToSpokenZH('a \\leq b'), 'a 小于等于 b')
})

test('speakMathInSentence converts $..$ segments and leaves prose untouched', () => {
  const out = speakMathInSentence('当 x^2 满足条件时成立。'.replace('x^2', '$x^2$'))
  assert.equal(out, '当  x 的 2 次方  满足条件时成立。', 'segment substitutions are space-wrapped (upstream behavior; TTS ignores spacing)')
  assert.equal(speakMathInSentence('普通句子没有公式。'), '普通句子没有公式。')
})

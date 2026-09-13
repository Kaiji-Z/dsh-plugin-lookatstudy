/**
 * parseSubtitleToText (vendored verbatim; vectors ported from upstream's
 * verify-video-import.mjs T4/T4b — timing-strip, rolling-window dedup, tag
 * cleanup, entity decode, CJK-aware joining). It had zero direct coverage
 * before the CC path leaned on it.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseSubtitleToText } from '../src/vendor/subtitle-parse.ts'

test('vtt: timing lines strip, inline tags clean, entities decode, rolling repeats dedup', () => {
  const vtt = [
    'WEBVTT', 'Kind: captions', '',
    '00:00:01.000 --> 00:00:03.000', '大家好今天讲<c>梯度</c>下降', '',
    '00:00:03.000 --> 00:00:05.000', '大家好今天讲梯度下降',
    '',
    '00:00:05.000 --> 00:00:07.000', '梯度下降是优化算法&nbsp;的核心', '',
  ].join('\n')
  assert.equal(parseSubtitleToText(vtt), '大家好今天讲梯度下降梯度下降是优化算法 的核心')
})

test('srt: CJK-aware joining (no space across 句号 → next line)', () => {
  const srt = '1\n00:00:01,000 --> 00:00:02,000\n第一句。\n\n2\n00:00:02,000 --> 00:00:03,000\n第二句。\n'
  assert.equal(parseSubtitleToText(srt), '第一句。第二句。')
})

test('T4b: YouTube auto-caption rolling windows dedup ACROSS cues, not just adjacent lines', () => {
  const vtt = [
    'WEBVTT', 'Kind: captions', 'Language: en', '',
    '00:00:00.719 --> 00:00:03.829 align:start position:0%',
    'hello world',
    'this is<00:00:01.099><c> a</c><00:00:01.259><c> test</c>',
    '',
    '00:00:03.829 --> 00:00:05.340 align:start position:0%',
    'hello world',
    'this is a test',
    '',
    '00:00:05.340 --> 00:00:07.000 align:start position:0%',
    'this is a test',
    'now the next sentence',
    '',
    '00:00:07.000 --> 00:00:08.000 align:start position:0%',
    '[Music]',
    '>> now the next sentence',
    '',
  ].join('\n')
  // upstream's pinned T4b vector (verify-video-import.mjs): dedup keys on RAW
  // lines, so the bare replay collapses while the >> speaker-change replay
  // survives (its marker strips on output, the line itself is a new cue)
  assert.equal(parseSubtitleToText(vtt), 'hello world this is a test now the next sentence now the next sentence')
})

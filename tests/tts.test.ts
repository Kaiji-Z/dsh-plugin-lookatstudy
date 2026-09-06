/**
 * Edge read-aloud synthesis: the DRM token (BigInt arithmetic — the silent
 * Number-precision trap is the reason this file exists), SSML building, and
 * the cache-first wrapper. The synth network path itself is exercised by the
 * live smoke script, not here.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { secMsGec, buildSsml, ttsCachePath, cachedTtsMp3, normalizeVoice, DEFAULT_TTS_VOICE } from '../src/tts.ts'

test('secMsGec matches independently computed vectors (BigInt precision)', () => {
  // Vectors computed with Python's arbitrary-precision ints (edge-tts algorithm);
  // a Number-based implementation diverges in the low digits and 403s forever.
  assert.equal(secMsGec(1_700_000_000_000), '42301B335578FEFDAE2637DED1ABD614505D432559EC08032B82048483726AFF')
  assert.equal(secMsGec(1_788_668_997_000), '8805BE1A2F9ACD2838F0DA60776F2332CAEE85FDF58E34885C2EB5525DBB06C1')
})

test('secMsGec is stable inside a 5-minute window and rolls across it', () => {
  const base = 1_700_000_000_000
  assert.equal(secMsGec(base), secMsGec(base + 60_000), 'same 5-min window, same token')
  assert.notEqual(secMsGec(base), secMsGec(base + 301_000), 'past the window boundary the token rolls')
})

test('buildSsml escapes XML and carries voice + lang', () => {
  const ssml = buildSsml("a<b & 'c'", 'zh-CN-XiaoxiaoNeural')
  assert.ok(ssml.includes('a&lt;b &amp; &apos;c&apos;'), 'markup characters are escaped')
  assert.ok(ssml.includes("xml:lang='zh-CN'"), 'lang derives from the voice prefix')
  assert.ok(ssml.includes("<voice name='zh-CN-XiaoxiaoNeural'>"))
})

test('normalizeVoice allowlists and falls back to 晓晓', () => {
  assert.equal(normalizeVoice(undefined), DEFAULT_TTS_VOICE)
  assert.equal(normalizeVoice('zh-CN-XiaoxiaoNeural'), 'zh-CN-XiaoxiaoNeural')
  assert.equal(normalizeVoice('not-a-voice'), DEFAULT_TTS_VOICE, 'arbitrary strings do not reach the endpoint')
})

test('cachedTtsMp3 caches by voice+text and replays from disk', async () => {
  const cacheDir = join(mkdtempSync(join(tmpdir(), 'lks-tts-')), 'tts-cache')
  let synths = 0
  const fake = async (text: string, voice: string): Promise<Buffer> => {
    synths += 1
    return Buffer.from(`mp3:${voice}:${text}`)
  }
  const first = await cachedTtsMp3(cacheDir, '第一句。', 'zh-CN-XiaoxiaoNeural', fake)
  const second = await cachedTtsMp3(cacheDir, '第一句。', 'zh-CN-XiaoxiaoNeural', fake)
  assert.equal(first.toString(), 'mp3:zh-CN-XiaoxiaoNeural:第一句。')
  assert.equal(second.toString(), first.toString())
  assert.equal(synths, 1, 'the second listen replays from the cache')
  assert.equal(readdirSync(cacheDir).length, 1, 'exactly one cache file')
  const other = await cachedTtsMp3(cacheDir, '第一句。', 'zh-CN-YunxiNeural', fake)
  assert.equal(other.toString(), 'mp3:zh-CN-YunxiNeural:第一句。', 'a different voice is a different cache key')
  assert.equal(synths, 2)
  assert.ok(existsSync(ttsCachePath(cacheDir, '第一句。', 'zh-CN-YunxiNeural')))
})

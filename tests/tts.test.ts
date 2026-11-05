/**
 * Edge read-aloud synthesis: the DRM token (BigInt arithmetic — the silent
 * Number-precision trap is the reason this file exists), SSML building, and
 * the cache-first wrapper. The synth network path itself is exercised by the
 * live smoke script, not here.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, readdirSync, rmSync } from 'node:fs'
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
  const dir = mkdtempSync(join(tmpdir(), 'lks-tts-'))
  const cacheDir = join(dir, 'tts-cache')
  try {
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
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/* ── issue #18: the external TTS channel, the failure ratchet, the chain ── */

import { externalSynthesize, externalTtsExt, studyTtsAudio, TtsGate } from '../src/tts.ts'

/** Minimal Response double for the injected fetch. */
class FakeFetchResponse {
  ok: boolean
  status: number
  headers: Map<string, string>
  private bytes: Buffer
  constructor(status: number, body: Buffer, mime = 'audio/wav') {
    this.status = status
    this.ok = status >= 200 && status < 300
    this.headers = new Map([['content-type', mime]])
    this.bytes = body
  }
  arrayBuffer(): Promise<ArrayBuffer> { return Promise.resolve(this.bytes.buffer.slice(this.bytes.byteOffset, this.bytes.byteOffset + this.bytes.byteLength) as ArrayBuffer) }
}

test('externalTtsExt picks the cache extension from the response mime', () => {
  assert.equal(externalTtsExt('audio/wav'), 'wav')
  assert.equal(externalTtsExt('audio/wave'), 'wav')
  assert.equal(externalTtsExt('audio/mpeg'), 'mp3')
  assert.equal(externalTtsExt(null), 'mp3')
  assert.equal(externalTtsExt(undefined), 'mp3')
})

test('externalSynthesize: POSTs {"text"}, fails loud on non-2xx / empty / abort', async () => {
  const calls: Array<{ url: string, body: string }> = []
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), body: String(init.body) })
    return new FakeFetchResponse(200, Buffer.from('WAVDATA'), 'audio/wav') as unknown as Response
  }) as typeof fetch
  const ok = await externalSynthesize('你好', 'http://127.0.0.1:8765', { fetchImpl })
  assert.equal(ok.bytes.toString(), 'WAVDATA')
  assert.equal(ok.mime, 'audio/wav')
  assert.deepEqual(calls, [{ url: 'http://127.0.0.1:8765', body: JSON.stringify({ text: '你好' }) }], 'the contract is exactly {"text"} — voice/keys belong to the endpoint')

  await assert.rejects(externalSynthesize('x', 'http://x/', { fetchImpl: (async () => new FakeFetchResponse(500, Buffer.from(''))) as unknown as typeof fetch }), /HTTP 500/)
  await assert.rejects(externalSynthesize('x', 'http://x/', { fetchImpl: (async () => new FakeFetchResponse(200, Buffer.alloc(0))) as unknown as typeof fetch }), /empty audio/)
  await assert.rejects(
    externalSynthesize('x', 'http://x/', {
      fetchImpl: ((async (_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => { init.signal?.addEventListener('abort', () => { reject(new Error('This operation was aborted')) }) })
      }) as unknown as typeof fetch),
      timeoutMs: 30,
    }),
    /abort/,
    'the AbortController deadline fires',
  )
})

test('TtsGate: two consecutive failures trip it, one success re-arms', () => {
  const gate = new TtsGate(2)
  assert.equal(gate.tripped, false)
  gate.record(false); assert.equal(gate.tripped, false)
  gate.record(false); assert.equal(gate.tripped, true, 'read-aloud is per-sentence — a dead endpoint must not bill a timeout per sentence')
  gate.record(false); assert.equal(gate.tripped, true)
  gate.reset(); assert.equal(gate.tripped, false, 'a settings change re-arms')
  gate.record(true); assert.equal(gate.tripped, false)
  gate.record(false); assert.equal(gate.tripped, false)
  gate.record(false); assert.equal(gate.tripped, true, 'a success resets the consecutive counter')
})

test('studyTtsAudio: an EMPTY endpoint reproduces the Edge-only behavior exactly', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lks-tts-'))
  try {
    let edgeCalls = 0
    const edge = async (text: string): Promise<Buffer> => { edgeCalls++; return Buffer.from(`edge:${text}`) }
    const out = await studyTtsAudio('句子', 'zh-CN-XiaoxiaoNeural', '', dir, { synth: edge })
    assert.equal(out.engine, 'edge')
    assert.equal(out.bytes.toString(), 'edge:句子')
    assert.equal(out.externalError, null)
    assert.equal(edgeCalls, 1)
    // cache replay never re-synthesizes
    const again = await studyTtsAudio('句子', 'zh-CN-XiaoxiaoNeural', '', dir, { synth: edge })
    assert.equal(again.bytes.toString(), 'edge:句子')
    assert.equal(edgeCalls, 1)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('studyTtsAudio: the external channel wins, caches by extension, and falls back to Edge', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lks-tts-'))
  try {
    const gate = new TtsGate(2)
    let extCalls = 0
    let edgeCalls = 0
    const externalOk = (async () => { extCalls++; return new FakeFetchResponse(200, Buffer.from('EXTWAV'), 'audio/wav') as unknown as Response }) as typeof fetch
    const externalDead = (async () => { extCalls++; return new FakeFetchResponse(503, Buffer.alloc(0)) as unknown as Response }) as typeof fetch
    const edge = async (text: string): Promise<Buffer> => { edgeCalls++; return Buffer.from(`edge:${text}`) }

    // 1: external answers wav → cached under .wav
    const a = await studyTtsAudio('一句话', 'zh-CN-XiaoxiaoNeural', ' http://127.0.0.1:8765 ', dir, { gate, synth: edge, fetchImpl: externalOk })
    assert.equal(a.engine, 'external'); assert.equal(a.bytes.toString(), 'EXTWAV'); assert.equal(a.mime, 'audio/wav')
    assert.equal(readdirSync(dir).filter(f => f.endsWith('.wav')).length, 1)
    // 2: cache hit replays without the endpoint (extCalls stays)
    const a2 = await studyTtsAudio('一句话', 'zh-CN-XiaoxiaoNeural', 'http://127.0.0.1:8765', dir, { gate, synth: edge, fetchImpl: externalDead })
    assert.equal(a2.engine, 'external', 'the wav cache entry satisfies the external arm')
    assert.equal(extCalls, 1)
    // 3: two live failures → Edge fallback AND the gate trips
    const b = await studyTtsAudio('第二句', 'zh-CN-XiaoxiaoNeural', 'http://127.0.0.1:8765', dir, { gate, synth: edge, fetchImpl: externalDead })
    assert.equal(b.engine, 'edge', 'a failed external request falls through to Edge'); assert.ok(b.externalError !== null)
    const c = await studyTtsAudio('第三句', 'zh-CN-XiaoxiaoNeural', 'http://127.0.0.1:8765', dir, { gate, synth: edge, fetchImpl: externalDead })
    assert.equal(c.engine, 'edge')
    assert.equal(gate.tripped, true)
    // 4: tripped → the external arm is skipped entirely (no more external calls)
    const extBefore = extCalls
    const d = await studyTtsAudio('第四句', 'zh-CN-XiaoxiaoNeural', 'http://127.0.0.1:8765', dir, { gate, synth: edge, fetchImpl: externalDead })
    assert.equal(d.engine, 'edge'); assert.equal(d.externalError !== null, true, 'the status line explains the trip')
    assert.equal(extCalls, extBefore, 'a tripped gate never bills the dead endpoint again')
    assert.equal(edgeCalls, 3)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

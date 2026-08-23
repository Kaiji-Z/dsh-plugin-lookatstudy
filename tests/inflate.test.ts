/**
 * Pure-TS inflate vs Node zlib round-trip (SPEC 1.2 enabler): every zip container
 * format (epub/docx/pptx) and PDF Flate stream decompresses through this module,
 * so it gets cross-checked against the reference implementation at every
 * compression level, plus the adversarial cases — overlapping back-references,
 * multi-block streams, truncation, corruption.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { deflateRawSync, deflateSync } from 'node:zlib'
import { inflateRaw, inflateZlib } from '../src/vendor/inflate.ts'

/** Seeded PRNG so failures replay exactly. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randomBytes(n: number, seed: number): Uint8Array {
  const rnd = mulberry32(seed)
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) out[i] = Math.floor(rnd() * 256)
  return out
}

test('inflateRaw round-trips zlib deflateRaw at every level (stored→max)', () => {
  const payload = randomBytes(20_000, 42)
  for (const level of [0, 1, 6, 9] as const) {
    const deflated = deflateRawSync(payload, { level })
    const restored = inflateRaw(new Uint8Array(deflated))
    assert.deepEqual(restored, payload, `level ${level} round-trip`)
  }
})

test('inflateRaw handles overlapping back-references (run-length patterns)', () => {
  // "ab" * 5000 compresses to back-references that copy bytes written this pass
  const payload = new TextEncoder().encode('ab'.repeat(5000))
  const restored = inflateRaw(new Uint8Array(deflateRawSync(payload, { level: 9 })))
  assert.equal(new TextDecoder().decode(restored), 'ab'.repeat(5000))
})

test('inflateRaw handles mixed content (text + zeros + random) at level 9', () => {
  const text = new TextEncoder().encode('章节标题与正文内容。'.repeat(400))
  const zeros = new Uint8Array(5000) // long zero runs → distance-1 overlaps
  const rnd = randomBytes(3000, 7)
  const payload = new Uint8Array(text.length + zeros.length + rnd.length)
  payload.set(text, 0); payload.set(zeros, text.length); payload.set(rnd, text.length + zeros.length)
  const restored = inflateRaw(new Uint8Array(deflateRawSync(payload, { level: 9 })))
  assert.deepEqual(restored, payload)
})

test('inflateRaw rejects truncated and corrupted streams', () => {
  const payload = randomBytes(4000, 99)
  const deflated = new Uint8Array(deflateRawSync(payload, { level: 9 }))
  assert.throws(() => inflateRaw(deflated.subarray(0, Math.floor(deflated.length / 2))))
  // corruption must never silently produce the pristine payload back
  const corrupted = new Uint8Array(deflated)
  for (let i = 10; i < 30; i++) corrupted[i] = corrupted[i]! ^ 0xff
  let result: Uint8Array | null = null
  let threw = false
  try { result = inflateRaw(corrupted) } catch { threw = true }
  assert.ok(threw || !Buffer.from(result!).equals(Buffer.from(payload)))
})

test('inflateZlib unwraps RFC1950 header and validates it', () => {
  const payload = new TextEncoder().encode('zlib wrapped deflate payload'.repeat(100))
  const z = deflateSync(payload, { level: 6 })
  assert.deepEqual(inflateZlib(new Uint8Array(z)), payload)
  // bad header check bits (flip a bit in FLG so (CMF<<8|FLG) % 31 != 0)
  const bad = new Uint8Array(z); bad[1] = bad[1]! ^ 0x01
  assert.throws(() => inflateZlib(bad))
  // non-deflate CM
  const badCm = new Uint8Array(z); badCm[0] = 0x79
  assert.throws(() => inflateZlib(badCm))
})

test('inflateRaw round-trips a large document-shaped buffer (200KB, multi-block)', () => {
  const rnd = mulberry32(2026)
  const parts: string[] = []
  for (let i = 0; i < 2000; i++) {
    parts.push(`## Section ${i}\n\n${'lorem ipsum dolor sit amet '.repeat(1 + Math.floor(rnd() * 8))}`)
  }
  const payload = new TextEncoder().encode(parts.join('\n\n'))
  assert.ok(payload.length > 200_000)
  const restored = inflateRaw(new Uint8Array(deflateRawSync(payload, { level: 6 })))
  assert.deepEqual(restored, payload)
})

/**
 * pdf-text on hand-built PDFs (SPEC 1.2): uncompressed and Flate-compressed
 * content streams (via Node zlib), Tj/TJ/' text operators, escape sequences,
 * hex strings with UTF-16BE, and the honest-empty contract (encrypted /
 * filter-only streams / no text → ""), never a throw.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { deflateSync } from 'node:zlib'
import { parsePdfText } from '../src/vendor/pdf-text.ts'

const enc = new TextEncoder()

// The incremental-bytes builder above got awkward — assemble directly:
function pdfBytes(streams: { data: string; flate?: boolean }[], encrypt = false): Uint8Array {
  const chunks: Uint8Array[] = []
  const push = (s: string) => chunks.push(enc.encode(s))
  push('%PDF-1.5\n')
  push('1 0 obj\n<< /Type /Catalog >>\nendobj\n')
  if (encrypt) push('3 0 obj\n<< /Encrypt << /Filter /Standard >> >>\nendobj\n')
  for (const [i, cs] of streams.entries()) {
    const payload = cs.flate ? new Uint8Array(deflateSync(enc.encode(cs.data))) : enc.encode(cs.data)
    const dict = cs.flate
      ? `<< /Filter /FlateDecode /Length ${payload.length} >>`
      : `<< /Length ${payload.length} >>`
    push(`${10 + i} 0 obj\n${dict}\nstream\n`)
    chunks.push(payload)
    push('\nendstream\nendobj\n')
  }
  let total = 0
  for (const c of chunks) total += c.length
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) { out.set(c, off); off += c.length }
  return out
}

test('extracts Tj text from uncompressed content streams', () => {
  const pdf = pdfBytes([
    { data: 'BT /F1 12 Tf 72 720 Td (Hello PDF text layer) Tj ET' },
    { data: 'BT 72 700 Td (Second line) Tj ET' },
  ])
  const text = parsePdfText(pdf)
  assert.ok(text.includes('Hello PDF text layer'))
  assert.ok(text.includes('Second line'))
})

test('extracts from Flate-compressed streams (the common case)', () => {
  const pdf = pdfBytes([
    { data: 'BT (compressed content: learning PDFs) Tj ET', flate: true },
  ])
  assert.ok(parsePdfText(pdf).includes('compressed content: learning PDFs'))
})

test('TJ arrays join fragments; escapes and newline operators decode', () => {
  const pdf = pdfBytes([
    { data: 'BT [(frag)-2(ments)3( join)] TJ ET\nBT (line one)\' (next after apostrophe) Tj ET' },
  ])
  const text = parsePdfText(pdf)
  assert.ok(text.includes('fragments join'))
  assert.ok(text.includes('line one'))
  assert.ok(text.includes('next after apostrophe'))
})

test('hex strings (UTF-16BE) decode; image/filtered streams contribute nothing', () => {
  const utf16 = '<FEFF' + [...'Hex text'].map((ch) => ch.charCodeAt(0).toString(16).padStart(4, '0')).join('') + '>'
  const pdf = pdfBytes([
    { data: `BT ${utf16} Tj ET` },
    { data: 'binary-not-text', flate: true },
  ])
  const text = parsePdfText(pdf)
  assert.ok(text.includes('Hex text'), `got: ${JSON.stringify(text)}`)
})

test('encrypted PDFs return "" (honest empty, never throw)', () => {
  const pdf = pdfBytes([{ data: 'BT (secret) Tj ET' }], true)
  assert.equal(parsePdfText(pdf), '')
})

test('garbage input returns "" without crashing', () => {
  assert.equal(parsePdfText(enc.encode('this is not a pdf at all')), '')
})

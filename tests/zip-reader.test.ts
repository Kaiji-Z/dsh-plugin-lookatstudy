/**
 * zip-reader against a spec-laid-out archive assembled byte-by-byte in the test
 * (local headers + central directory + EOCD), with deflate entries compressed
 * by Node zlib — so both halves are cross-checked against reference
 * implementations. Plus the malformed-input refusals.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { deflateRawSync } from 'node:zlib'
import { readZip, readZipText } from '../src/vendor/zip-reader.ts'

/** Assemble a zip: stored or deflated entries + directories, central directory, EOCD. */
function buildZip(files: { name: string; data: Uint8Array; store?: boolean }[], dirs: string[] = []): Uint8Array {
  const enc = new TextEncoder()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  const offsets: number[] = []
  let offset = 0
  for (const f of files) {
    offsets.push(offset)
    const nameB = enc.encode(f.name)
    const stored = f.store ?? false
    const payload = stored ? f.data : new Uint8Array(deflateRawSync(f.data, { level: 6 }))
    const crc = 0 // reader doesn't validate CRC (upstream fflate usage doesn't either); placeholder bytes
    const lhdr = new Uint8Array(30 + nameB.length)
    const dv = new DataView(lhdr.buffer)
    dv.setUint32(0, 0x04034b50, true)
    dv.setUint16(4, 0, true) // version
    dv.setUint16(6, 0, true) // flags
    dv.setUint16(8, stored ? 0 : 8, true)
    dv.setUint32(14, crc, true)
    dv.setUint32(18, payload.length, true)
    dv.setUint32(22, f.data.length, true)
    dv.setUint16(26, nameB.length, true)
    lhdr.set(nameB, 30)
    locals.push(lhdr, payload)
    offset += lhdr.length + payload.length
  }
  const cenStart = offset
  const all = [...files.map((f, i) => ({ f, off: offsets[i]! })), ...dirs.map((name) => ({ f: { name, data: new Uint8Array(0), store: true } as typeof files[number], off: 0 }))]
  for (const { f, off } of all) {
    const nameB = enc.encode(f.name)
    const stored = f.store ?? false
    const payload = stored || f.data.length === 0 ? f.data : new Uint8Array(deflateRawSync(f.data, { level: 6 }))
    const cen = new Uint8Array(46 + nameB.length)
    const dv = new DataView(cen.buffer)
    dv.setUint32(0, 0x02014b50, true)
    dv.setUint16(10, stored || f.data.length === 0 ? 0 : 8, true)
    dv.setUint32(20, payload.length, true)
    dv.setUint32(24, f.data.length, true)
    dv.setUint16(28, nameB.length, true)
    dv.setUint32(42, off, true)
    cen.set(nameB, 46)
    centrals.push(cen)
  }
  const cenBytes = concat(centrals)
  const eocd = new Uint8Array(22)
  const edv = new DataView(eocd.buffer)
  edv.setUint32(0, 0x06054b50, true)
  edv.setUint16(8, all.length, true)
  edv.setUint16(10, all.length, true)
  edv.setUint32(12, cenBytes.length, true)
  edv.setUint32(16, cenStart, true)
  return concat([...locals, cenBytes, eocd])
}

function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0
  for (const p of parts) total += p.length
  const res = new Uint8Array(total)
  let off = 0
  for (const p of parts) { res.set(p, off); off += p.length }
  return res
}

test('readZip decodes deflated and stored entries, skips directories', () => {
  const enc = new TextEncoder()
  const zip = buildZip([
    { name: 'META-INF/container.xml', data: enc.encode('<container version="1.0"></container>') },
    { name: 'raw.txt', data: enc.encode('plain stored payload'), store: true },
    { name: 'big.md', data: enc.encode('# 标题\n\n正文内容。'.repeat(200)) },
  ], ['chapters/'])
  const entries = readZip(zip)
  assert.equal(entries.size, 3)
  assert.equal(readZipText(entries, 'META-INF/container.xml'), '<container version="1.0"></container>')
  assert.equal(readZipText(entries, 'raw.txt'), 'plain stored payload')
  assert.ok(readZipText(entries, 'big.md').includes('标题'))
  assert.ok(!entries.has('chapters/'))
})

test('readZip tolerates an EOCD trailing comment', () => {
  const enc = new TextEncoder()
  const zip = buildZip([{ name: 'a.txt', data: enc.encode('aaa') }])
  const comment = enc.encode('made by a test')
  const withComment = new Uint8Array(zip.length + comment.length)
  withComment.set(zip.subarray(0, zip.length - 22), 0)
  // rewrite EOCD with comment length set, then append comment bytes
  const eocd = new Uint8Array(22)
  eocd.set(zip.subarray(zip.length - 22), 0)
  new DataView(eocd.buffer).setUint16(20, comment.length, true)
  withComment.set(eocd, zip.length - 22)
  withComment.set(comment, zip.length)
  assert.equal(readZipText(readZip(withComment), 'a.txt'), 'aaa')
})

test('readZip refuses non-zip and corrupted archives', () => {
  assert.throws(() => readZip(new TextEncoder().encode('not a zip at all, just text')))
  const enc = new TextEncoder()
  const zip = buildZip([{ name: 'x.txt', data: enc.encode('xxxx') }])
  const broken = new Uint8Array(zip)
  broken[broken.length - 22] = 0 // destroy EOCD signature
  assert.throws(() => readZip(broken))
})

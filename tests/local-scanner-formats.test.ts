/**
 * SPEC 1.2 acceptance: the new container formats (epub/docx/pptx/pdf) flow
 * through scanFolder → buildPendingDesignFromFolder → renderDesignBrief —
 * i.e. they genuinely reach the tutor-design protocol, not just the parser
 * units. Fixtures are assembled in-test by the zip/pdf builders.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { scanFolder } from '../src/vendor/local-folder-scanner.ts'
import type { ScannedDoc } from '../src/vendor/local-folder-scanner.ts'
import { buildPendingDesignFromFolder, renderDesignBrief } from '../src/import-design.ts'
import { buildZip, buildEpub } from './helpers/zip-build.ts'

const enc = new TextEncoder()

function buildDocx(paras: { style?: string; text: string }[]): Uint8Array {
  const body = paras.map((p) =>
    `<w:p>${p.style ? `<w:pPr><w:pStyle w:val="${p.style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${p.text}</w:t></w:r></w:p>`,
  ).join('')
  return buildZip([{ name: 'word/document.xml', data: enc.encode(`<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${body}</w:body></w:document>`) }])
}

function buildPptx(): Uint8Array {
  const slide = (no: number, title: string, body: string) => ({
    name: `ppt/slides/slide${no}.xml`,
    data: enc.encode(`<p:sld xmlns:p="p" xmlns:a="a"><p:sp><p:txBody><a:p><a:r><a:t>${title}</a:t></a:r></a:p><a:p><a:r><a:t>${body}</a:t></a:r></a:p></p:txBody></p:sp></p:sld>`),
  })
  return buildZip([
    { name: 'docProps/app.xml', data: enc.encode('<Properties><TitlesOfParts><vt:lpstr>讲义</vt:lpstr></TitlesOfParts></Properties>') },
    slide(1, '第一页', '要点内容一'),
    slide(2, '第二页', '要点内容二'),
  ])
}

function buildPdf(): Uint8Array {
  const data = 'BT (Chapter text from the PDF layer) Tj ET'
  const payload = new Uint8Array(deflateSync(enc.encode(data)))
  const chunks: Uint8Array[] = [enc.encode('%PDF-1.5\n10 0 obj\n<< /Filter /FlateDecode /Length ' + payload.length + ' >>\nstream\n'), payload, enc.encode('\nendstream\nendobj\n')]
  let total = 0
  for (const c of chunks) total += c.length
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) { out.set(c, off); off += c.length }
  return out
}

async function scanWithFiles(files: { name: string; data: Uint8Array }[]): Promise<ScannedDoc[]> {
  const dir = mkdtempSync(join(tmpdir(), 'lks-scan-'))
  try {
    for (const f of files) {
      const full = join(dir, f.name)
      writeFileSync(full, f.data)
    }
    const result = await scanFolder(dir)
    return Array.isArray(result) ? result : result.docs
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('scanFolder extracts epub/docx/pptx/pdf into docs with correct kinds and content', async () => {
  const docs = await scanWithFiles([
    { name: 'book.epub', data: buildEpub({ navStyle: 'nav' }) },
    { name: 'handout.docx', data: buildDocx([{ style: 'Heading1', text: '第一章 讲义' }, { text: '讲义正文内容,足够长以通过最小长度校验。' }]) },
    { name: 'slides.pptx', data: buildPptx() },
    { name: 'paper.pdf', data: buildPdf() },
  ])
  const kinds = new Map(docs.map((d) => [d.kind, d]))
  assert.ok(kinds.has('epub'), 'epub doc scanned')
  assert.ok(kinds.get('epub')!.content.includes('## 第一章 起点'), 'epub flat: chapter headings demoted to ##')
  assert.ok(kinds.has('docx'), 'docx doc scanned')
  assert.ok(kinds.get('docx')!.content.includes('## 第一章 讲义'), 'scanner demotes docx headings one level so H1 chapters become sliceable H2 anchors (live-test defect fix)')
  assert.ok(kinds.has('pptx'), 'pptx doc scanned')
  assert.ok(kinds.get('pptx')!.content.includes('## Slide 1: 第一页'))
  assert.ok(kinds.has('pdf'), 'pdf doc scanned')
  assert.ok(kinds.get('pdf')!.content.includes('Chapter text from the PDF layer'))
})

test('new formats reach the tutor design brief (the protocol surface)', async () => {
  const docs = await scanWithFiles([
    { name: 'book.epub', data: buildEpub({ navStyle: 'nav' }) },
    { name: 'handout.docx', data: buildDocx([{ style: 'Heading1', text: '第一章 讲义' }, { text: '讲义正文内容,足够长以通过最小长度校验。' }]) },
  ])
  const pending = buildPendingDesignFromFolder('/x/course-materials', 'course-materials', docs)
  const brief = renderDesignBrief(pending)
  assert.ok(brief.includes('book.epub'))
  assert.ok(brief.includes('handout.docx'))
  // bodyPreview rides the brief only for github source; folder briefs carry bodies via localContents
  assert.ok(pending.localContents.has('book.epub'))
  assert.ok(pending.localContents.get('book.epub')!.includes('第二章 进阶'))
})

test('scanFolder still skips broken containers without crashing the whole scan', async () => {
  const docs = await scanWithFiles([
    { name: 'broken.epub', data: enc.encode('not a zip') },
    { name: 'ok.md', data: enc.encode('# 完好文档\n\n正文内容若干。') },
  ])
  assert.equal(docs.length, 1)
  assert.equal(docs[0]!.kind, 'md')
})

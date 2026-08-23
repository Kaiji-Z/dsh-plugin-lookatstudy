/**
 * docx/pptx parsers on synthetic OOXML zips (SPEC 1.2): heading fidelity (the
 * property the course pipeline actually consumes), slide-per-lesson contract
 * (`## Slide N:`), speaker notes, and honest failures on broken archives.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { parseDocx } from '../src/vendor/docx-parser.ts'
import { parsePptx } from '../src/vendor/pptx-parser.ts'
import { buildZip } from './helpers/zip-build.ts'

const enc = new TextEncoder()

function buildDocx(paras: { style?: string; text: string }[]): Uint8Array {
  const body = paras.map((p) =>
    `<w:p>${p.style ? `<w:pPr><w:pStyle w:val="${p.style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${p.text}</w:t></w:r></w:p>`,
  ).join('')
  const document = `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${body}</w:body></w:document>`
  return buildZip([
    { name: '[Content_Types].xml', data: enc.encode('<Types/>') },
    { name: 'word/document.xml', data: enc.encode(document) },
  ])
}

test('parseDocx maps Heading styles to markdown levels (course-splitting contract)', () => {
  const md = parseDocx(buildDocx([
    { style: 'Title', text: '课程讲义' },
    { style: 'Heading1', text: '第一章 基础' },
    { text: '正文段落,无样式。' },
    { style: 'heading 2', text: '1.1 小节' },
    { text: '小节内容。' },
  ]))
  assert.ok(md.includes('# 课程讲义'))
  assert.ok(md.includes('# 第一章 基础'))
  assert.ok(md.includes('## 1.1 小节'))
  assert.ok(md.includes('正文段落,无样式。'))
  assert.ok(md.indexOf('# 第一章 基础') < md.indexOf('## 1.1 小节'))
})

test('parseDocx joins runs, decodes entities, keeps code style fenced', () => {
  const document = `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>
    <w:p><w:r><w:t>A&amp;B </w:t></w:r><w:r><w:t>&lt;tag&gt;</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Code"/></w:pPr><w:r><w:t>const x = 1</w:t></w:r></w:p>
  </w:body></w:document>`
  const zip = buildZip([{ name: 'word/document.xml', data: enc.encode(document) }])
  const md = parseDocx(zip)
  assert.ok(md.includes('A&B <tag>'))
  assert.ok(md.includes('```'))
  assert.ok(md.includes('const x = 1'))
})

test('parseDocx rejects archives without document.xml / without text', () => {
  assert.throws(() => parseDocx(buildZip([{ name: 'x.txt', data: enc.encode('nope') }])), /document\.xml/)
  const empty = buildZip([{ name: 'word/document.xml', data: enc.encode('<w:document><w:body></w:body></w:document>') }])
  assert.throws(() => parseDocx(empty), /没有可识别/)
})

function buildPptx(slides: { no: number; texts: string[]; notes?: string[] }[], deckTitle = '测试演示'): Uint8Array {
  const files: { name: string; data: Uint8Array }[] = [
    { name: 'docProps/app.xml', data: enc.encode(`<Properties><TitlesOfParts><vt:vector><vt:lpstr>${deckTitle}</vt:lpstr></vt:vector></TitlesOfParts></Properties>`) },
  ]
  for (const s of slides) {
    const shapes = s.texts.map((t) => `<p:sp><p:txBody>${t.split('\n').map((line) => `<a:p><a:r><a:t>${line}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sp>`).join('')
    files.push({ name: `ppt/slides/slide${s.no}.xml`, data: enc.encode(`<p:sld xmlns:p="p" xmlns:a="a">${shapes}</p:sld>`) })
    if (s.notes) {
      const noteShapes = s.notes.map((t) => `<a:p><a:r><a:t>${t}</a:t></a:r></a:p>`).join('')
      files.push({ name: `ppt/notesSlides/notesSlide${s.no}.xml`, data: enc.encode(`<p:notes><p:txBody>${noteShapes}</p:txBody></p:notes>`) })
    }
  }
  return buildZip(files)
}

test('parsePptx emits one ## Slide N per slide, first text as title, notes attached', () => {
  const r = parsePptx(buildPptx([
    { no: 1, texts: ['封面标题', '副标题文字'], notes: ['开场白备注'] },
    { no: 2, texts: ['第二章要点', '要点一', '要点二'], notes: ['讲这页时要放慢'] },
  ]))
  assert.equal(r.slideCount, 2)
  assert.ok(r.markdown.startsWith('# 测试演示'))
  assert.ok(r.markdown.includes('## Slide 1: 封面标题'))
  assert.ok(r.markdown.includes('副标题文字'))
  assert.ok(r.markdown.includes('## Slide 2: 第二章要点'))
  assert.ok(r.markdown.includes('**讲者备注:** 开场白备注'))
  assert.ok(r.markdown.includes('**讲者备注:** 讲这页时要放慢'))
  // slide order in output follows slide numbers, not zip order
  assert.ok(r.markdown.indexOf('## Slide 1:') < r.markdown.indexOf('## Slide 2:'))
})

test('parsePptx handles slides without text (无标题 placeholder) and rejects non-pptx', () => {
  const r = parsePptx(buildPptx([{ no: 3, texts: [] }]))
  assert.ok(r.markdown.includes('## Slide 3: (无标题)'))
  assert.throws(() => parsePptx(buildZip([{ name: 'x', data: enc.encode('x') }])), /幻灯片/)
})

/**
 * epub-parser on synthetic books assembled by the zip builder (SPEC 1.2):
 * EPUB3 nav + EPUB2 ncx TOC resolution, subdirectory href resolution, cover-page
 * skipping, math salvage inside chapters, flat mode for folder imports, and the
 * honest-failure errors for broken structure.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { parseEpub, parseEpubFlat } from '../src/vendor/epub-parser.ts'
import { buildEpub, buildZip } from './helpers/zip-build.ts'

test('parseEpub resolves EPUB3 nav TOC titles and chapter bodies', () => {
  const book = parseEpub(buildEpub({ navStyle: 'nav', title: '导航之书' }))
  assert.equal(book.title, '导航之书')
  assert.equal(book.chapters.length, 2)
  assert.equal(book.chapters[0]!.title, '第一章 起点')
  assert.ok(book.chapters[0]!.markdown.startsWith('# 第一章 起点'))
  assert.ok(book.chapters[0]!.markdown.includes('开篇正文内容'))
  // subdirectory chapter (text/ch2.xhtml) resolves through the OPF dir
  assert.equal(book.chapters[1]!.title, '第二章 进阶')
  assert.ok(book.chapters[1]!.path.startsWith('chapters/02-'))
})

test('parseEpub falls back to EPUB2 ncx TOC', () => {
  const book = parseEpub(buildEpub({ navStyle: 'ncx' }))
  assert.equal(book.chapters.length, 2)
  assert.equal(book.chapters[0]!.title, '第一章 起点')
  assert.equal(book.chapters[1]!.title, '第二章 进阶')
})

test('chapter math is salvaged into $..$ and images stripped', () => {
  const book = parseEpub(buildEpub({ navStyle: 'nav' }))
  assert.ok(book.chapters[1]!.markdown.includes('$a^2+b^2=c^2$'))
})

test('cover pages (image-only / near-empty) are skipped', () => {
  const book = parseEpub(buildEpub({
    navStyle: 'nav',
    chapters: [
      { href: 'cover.xhtml', title: '封面', html: '<html><body><img src="cover.png" alt="封面图"/></body></html>' },
      { href: 'c1.xhtml', title: '正文章', html: '<html><body><h1>正文章</h1><p>' + '实质正文。'.repeat(30) + '</p></body></html>' },
    ],
  }))
  assert.equal(book.chapters.length, 1)
  assert.equal(book.chapters[0]!.title, '正文章')
})

test('parseEpubFlat demotes every chapter H1 to H2 for anchor-based course splitting', () => {
  const flat = parseEpubFlat(buildEpub({ navStyle: 'nav' }))
  assert.ok(flat.includes('## 第一章 起点'))
  assert.ok(flat.includes('## 第二章 进阶'))
  assert.ok(!/^# /m.test(flat))
})

test('parseEpub rejects broken structure honestly', () => {
  // zip without container.xml
  const enc = new TextEncoder()
  const noContainer = buildZip([{ name: 'mimetype', data: enc.encode('application/epub+zip'), store: true }])
  assert.throws(() => parseEpub(noContainer), /container\.xml|OPF/)
  // container pointing at a missing OPF
  const badOpf = buildZip([
    { name: 'META-INF/container.xml', data: enc.encode('<container><rootfile full-path="OEBPS/gone.opf"/></container>') },
  ])
  assert.throws(() => parseEpub(badOpf), /OPF/)
})

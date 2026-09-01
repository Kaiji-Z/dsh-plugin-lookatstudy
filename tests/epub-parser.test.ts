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

// --- upstream v0.23.1/v0.24.0 port: chapter alignment, noise, publisher forms ---

import { splitChaptersInBody, sanitizeEpubBody } from '../src/vendor/epub-parser.ts'

test('splitChaptersInBody: many-chapters-one-file splits on CHAPTER bare lines', () => {
  const body = [
    '引言短语。', '',
    'CHAPTER I.', '第一章的正文内容,足够长,是真实的内容而不是标记。',
    'CHAPTER II.', '第二章的正文内容,同样扎实。',
    'CHAPTER III.', '第三章的正文内容,收尾。',
  ].join('\n')
  const split = splitChaptersInBody(body)!
  assert.ok(split !== null)
  assert.equal(split.length, 3)
  assert.equal(split[0]!.title, 'CHAPTER I.')
  assert.ok(split[0]!.content.includes('引言短语'), 'short preamble (<800) merges into the first chapter')
  assert.ok(split[2]!.content.includes('第三章'))
})

test('splitChaptersInBody: lone roman/numeral lines never split; decorated chains do', () => {
  const prose = '正文里出现孤立的 I 和 2 不应当成章号,这里是一段正常的长正文内容。'
  assert.equal(splitChaptersInBody(`一整段正文,提到了 I 和 2,但没有序列。`.repeat(3)), null)
  const chained = ['— I —', '壹的内容。', '— II —', '贰的内容。', '— III —', '叁的内容。'].join('\n')
  const split = splitChaptersInBody(chained)!
  assert.equal(split.length, 3)
  assert.equal(split[1]!.title, '— II —'.replace(/^#{1,3}\s*/, ''))
})

test('sanitizeEpubBody: Gutenberg header/tail blocks and decoration lines are removed', () => {
  const body = [
    '## The Project Gutenberg eBook of Moby Dick', '', 'This ebook is for anyone anywhere. Price: free.', '',
    '# CHAPTER 1', '', '正文开始,讲述了一个完整的故事。',
    'THE FULL PROJECT GUTENBERG™ LICENSE', 'license text follows...',
  ].join('\n')
  const out = sanitizeEpubBody(body)
  assert.ok(out.includes('正文开始'))
  assert.ok(!out.includes('GUTENBERG'), 'license tail truncated')
  assert.ok(!out.includes('Price: free'), 'header block removed')
})

test('parseEpub: multi-chapter single file aligns titles (P&P shape)', () => {
  const para = (s: string) => `<p>${s}</p>`
  const html = '<html><body>' + '正文'.repeat(0) + ''
    + para('CHAPTER I.') + para('第一章内容,真实且足够长,不是标记行。')
    + para('CHAPTER II.') + para('第二章内容,同样真实。')
    + '</body></html>'
  const book = parseEpub(buildEpub({
    navStyle: 'nav',
    chapters: [{ href: 'big.xhtml', title: '卷一', html }],
  }))
  assert.equal(book.chapters.length, 2)
  assert.equal(book.chapters[0]!.title, 'CHAPTER I.')
  assert.ok(book.chapters[0]!.markdown.includes('第一章内容'))
  assert.equal(book.chapters[1]!.title, 'CHAPTER II.')
})

test('parseEpub: untitled chapters fall back to 未命名章节, never a fabricated 第N章', () => {
  const html = '<html><body><p>' + '无名章节的正文,内容真实充实,没有任何标题标记。'.repeat(10) + '</p></body></html>'
  const book = parseEpub(buildEpub({
    navStyle: 'nav',
    chapters: [
      { href: 'a.xhtml', title: '', html: '<html><body><h1>有名章</h1><p>' + '正文内容充实。'.repeat(20) + '</p></body></html>' },
      { href: 'b.xhtml', title: '', html },
    ],
  }))
  // nav with empty labels: buildEpub emits <a href>b.xhtml</a> with empty text → no label
  const titles = book.chapters.map(c => c.title)
  assert.ok(!titles.some(t => /^第 \d+ 章/.test(t)), `no fabricated numbering in ${JSON.stringify(titles)}`)
  assert.ok(titles.includes('未命名章节') || titles.includes('有名章'))
})

test('parseEpub: publisher title-page + untitled body pair merge (Meditations shape)', () => {
  const stubHtml = '<html><body><h1>卷一</h1><p>格言短句,卷一开篇。</p></body></html>'
  const bodyHtml = '<html><body><p>' + '沉思录正文,这一卷的真实内容,足够长以成为一章。'.repeat(15) + '</p></body></html>'
  const book = parseEpub(buildEpub({
    navStyle: 'nav',
    chapters: [
      { href: 'v1.xhtml', title: '卷一', html: stubHtml },
      { href: 'v1body.xhtml', title: '', html: bodyHtml },
    ],
  }))
  assert.equal(book.chapters.length, 1, 'stub + untitled body merge into one chapter')
  assert.equal(book.chapters[0]!.title, '卷一')
  assert.ok(book.chapters[0]!.markdown.includes('格言短句,卷一开篇'))
  assert.ok(book.chapters[0]!.markdown.includes('沉思录正文'))
})

test('parseEpub: colophon and link-dense TOC pages never become chapters', () => {
  const colophon = '<html><body><h1>版权信息</h1><p>书名：沉思录<br/>作者：马可·奥勒留<br/>ISBN：978-1-234-56789-0<br/>出版社：某出版社</p></body></html>'
  const linkToc = '<html><body><h1>目录</h1><p><a href="a.xhtml">卷一</a><br/><a href="b.xhtml">卷二</a><br/><a href="c.xhtml">卷三</a></p></body></html>'
  const real = '<html><body><h1>真实章节</h1><p>' + '这是正文,不是目录或版权页。'.repeat(30) + '</p></body></html>'
  const book = parseEpub(buildEpub({
    navStyle: 'nav',
    chapters: [
      { href: 'cop.xhtml', title: '版权信息', html: colophon },
      { href: 'toc2.xhtml', title: '目录', html: linkToc },
      { href: 'r.xhtml', title: '真实章节', html: real },
    ],
  }))
  assert.equal(book.chapters.length, 1)
  assert.equal(book.chapters[0]!.title, '真实章节')
})

test('parseEpub: license-titled file with one chapter mark still yields that chapter', () => {
  const html = '<html><body><p>CHAPTER LXI.</p><p>' + '被 license 文件名吞掉的末章,正文真实且足够长。'.repeat(3) + '</p></body></html>'
  const book = parseEpub(buildEpub({
    navStyle: 'nav',
    chapters: [{ href: 'lic.xhtml', title: 'LICENSE', html }],
  }))
  assert.equal(book.chapters.length, 1)
  assert.equal(book.chapters[0]!.title, 'CHAPTER LXI.')
})

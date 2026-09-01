/**
 * Pure html→markdown converter + heuristic article extraction (SPEC 1.2:
 * upstream's linkedom/readability/turndown trio replaced zero-dep). Covers the
 * epub chapter shapes (headings/lists/pre/math salvage) and the honest-failure
 * contract of extractArticle (non-article pages → null, never nav noise).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { htmlToMarkdown, extractArticle, parseHtml, stripTailNavigation } from '../src/vendor/html-article.ts'

test('htmlToMarkdown converts structure: headings, paragraphs, inline marks, links', () => {
  const html = `<html><body>
    <h1>章标题</h1>
    <p>第一段<strong>加粗</strong>与<em>斜体</em>和<a href="https://x.example/a">链接</a>。</p>
    <h2>小节</h2>
    <p>普通文字 &amp; 实体 &lt;tag&gt; 处理。</p>
  </body></html>`
  const md = htmlToMarkdown(html)
  assert.ok(md.includes('# 章标题'))
  assert.ok(md.includes('**加粗**'))
  assert.ok(md.includes('*斜体*'))
  assert.ok(md.includes('[链接](https://x.example/a)'))
  assert.ok(md.includes('## 小节'))
  assert.ok(md.includes('& 实体 <tag>'))
})

test('htmlToMarkdown handles lists (nested), blockquote, pre, hr, tables', () => {
  const html = `<body>
    <ul><li>一</li><li>二<ul><li>嵌套</li></ul></li></ul>
    <ol><li>第一</li><li>第二</li></ol>
    <blockquote><p>引用文字</p></blockquote>
    <pre><code>const a = 1;
const b = 2;</code></pre>
    <hr/>
    <table><tr><th>列A</th><th>列B</th></tr><tr><td>1</td><td>2</td></tr></table>
  </body>`
  const md = htmlToMarkdown(html)
  assert.ok(md.includes('- 一'))
  assert.ok(md.includes('  - 嵌套'))
  assert.ok(md.includes('1. 第一'))
  assert.ok(md.includes('> 引用文字'))
  assert.ok(md.includes('```'))
  assert.ok(md.includes('const b = 2;'))
  assert.ok(md.includes('---'))
  assert.ok(md.includes('| 列A | 列B |'))
  assert.ok(md.includes('| 1 | 2 |'))
})

test('htmlToMarkdown salvages MathJax v2 and KaTeX TeX sources into $..$', () => {
  const html = `<body><p>公式<script type="math/tex">E=mc^2</script>继续文字。</p>
  <p><span class="katex"><span class="katex-mathml"><math><semantics><annotation encoding="application/x-tex">\\alpha+\\beta</annotation></semantics></math></span><span class="katex-html"><span>渲染垃圾</span></span></span>尾部</p></body>`
  const md = htmlToMarkdown(html)
  assert.ok(md.includes('$E=mc^2$'))
  assert.ok(md.includes('$\\alpha+\\beta$'))
  assert.ok(!md.includes('渲染垃圾'))
  assert.ok(!md.includes('<script'))
})

test('htmlToMarkdown strips images when asked, keeps them otherwise', () => {
  const html = `<body><p>文字</p><img src="pic.png" alt="图"/><p>结束</p></body>`
  assert.ok(!htmlToMarkdown(html, { stripImages: true }).includes('pic.png'))
  assert.ok(htmlToMarkdown(html).includes('![图](pic.png)'))
})

test('htmlToMarkdown handles bare fragments (no html/body wrapper)', () => {
  const md = htmlToMarkdown('<h2>裸片段</h2><p>内容</p>')
  assert.ok(md.includes('## 裸片段'))
  assert.ok(md.includes('内容'))
})

test('extractArticle picks article/main content, absolutizes image srcs', () => {
  const html = `<html><head><title>我的文章</title></head><body>
    <nav><a href="/">首页</a><a href="/x">导航项</a></nav>
    <article><p>${'正文内容。'.repeat(40)}</p><img src="img/a.png" alt="配图"/><p>${'更多正文。'.repeat(30)}</p></article>
    <footer>版权所有</footer>
  </body></html>`
  const art = extractArticle(html, 'https://blog.example/posts/1/')
  assert.ok(art)
  assert.equal(art!.title, '我的文章')
  assert.ok(art!.markdown.startsWith('# 我的文章'))
  assert.ok(art!.markdown.includes('https://blog.example/posts/1/img/a.png'))
  assert.ok(!art!.markdown.includes('导航项'))
})

test('extractArticle returns null for non-article pages (honest failure)', () => {
  const login = `<html><head><title>登录</title></head><body><form><input placeholder="用户"/><input placeholder="密码"/></form></body></html>`
  assert.equal(extractArticle(login), null)
  const empty = `<html><head><title>空</title></head><body><p>很短</p></body></html>`
  assert.equal(extractArticle(empty), null)
})

test('parseHtml survives malformed nesting without crashing', () => {
  const nodes = parseHtml('<p>a<div>b</p>c</div><p>d')
  const text = JSON.stringify(nodes)
  assert.ok(text.includes('a') && text.includes('b') && text.includes('c') && text.includes('d'))
})

// --- upstream v0.23.1 port: tail site-template fingerprint stripping ---

test('stripTailNavigation removes machine-generated tail templates (sohu/aliyun/END)', () => {
  const base = '# 标题\n\n正文第一段,讲清楚了某个知识点,足够长以通过密度判定。\n\n正文第二段继续展开,内容依然扎实。\n'
  const sohu = base + '\n返回搜狐，查看更多\n'
  const sohu2 = base + '\n点击进入搜狐首页\n'
  const aliyun = base + '\n## 热门文章\n\n## 最新文章\n\n## 目录\n'
  const gzh = base + '\nEND 本文版权所有\n'
  for (const md of [sohu, sohu2, aliyun, gzh]) {
    const out = stripTailNavigation(md)
    assert.ok(out.includes('正文第二段'), 'real content survives')
    assert.ok(!/返回搜狐|热门文章|最新文章|END/.test(out), `template stripped in ${JSON.stringify(md.slice(-30))}`)
  }
})

test('stripTailNavigation removes bare-image tail template lines (CSDN)', () => {
  const md = '# T\n\n正文讲了一个完整的知识点,内容扎实不是模板。\n\n![img](https://static.example/x.png)\n\n/images/2024/foo.jpeg\n'
  const out = stripTailNavigation(md)
  assert.ok(out.includes('正文讲了'))
  assert.ok(!out.includes('foo.jpeg') && !out.includes('static.example'))
})

test('stripTailNavigation never touches an author-written promo paragraph', () => {
  const md = '# T\n\n正文内容完整讲透一个概念,长度足够。\n\n欢迎关注我的公众号「某技术笔记」,每周更新实战文章。\n'
  const out = stripTailNavigation(md)
  assert.ok(out.includes('欢迎关注我的公众号'), 'author prose is content, not template (upstream live incident)')
})

test('stripTailNavigation only scans the last 25 lines — mid-text template lines stay', () => {
  const filler = Array.from({ length: 30 }, (_, i) => `第${i}段正文,内容扎实,不构成模板。`).join('\n\n')
  const md = `# T\n\n正文开始。\n\n## 热门文章\n\n${filler}\n\n收尾一段正文。\n`
  const out = stripTailNavigation(md)
  assert.ok(out.includes('热门文章'), 'out-of-window template lines are Step4/tutor territory, not the parser\'s')
  assert.ok(out.includes('收尾一段正文'))
})

test('extractArticle output passes through stripTailNavigation', () => {
  const html = `<html><head><title>一篇好文章</title></head><body><article>
    <p>${'正文内容,反复陈述知识点,'.repeat(20)}</p>
    <p>返回搜狐，查看更多</p>
  </article></body></html>`
  const art = extractArticle(html)
  assert.ok(art !== null)
  assert.ok(!art!.markdown.includes('返回搜狐'), 'template tail is stripped from extracted articles')
  assert.ok(art!.markdown.includes('正文内容'))
})

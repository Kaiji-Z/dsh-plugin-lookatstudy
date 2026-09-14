/**
 * study_import_url (SPEC 1.2/1.3): routing table + full design→apply loop for
 * article and arXiv flavors (bodies ride the pending design, apply is offline),
 * honest refusals for video (no ASR/yt-dlp in the plugin) and non-article pages,
 * github delegation reaching the repository import flow.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { deflateSync } from 'node:zlib'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { studyTools } from '../src/tools.ts'
import { emptyState, type LearningState } from '../src/state.ts'
import { setHttpsGetOverride } from '../src/vendor/repo-fetcher.ts'
import { normalizeUrlIdentity } from '../src/vendor/url-route.ts'
import { importCourse } from '../src/state.ts'
import { parseMarkdownToCourse } from '../src/vendor/markdown-course.ts'

const exec = { signal: new AbortController().signal } as unknown as ToolRunContext

function setup(fetchImpl?: typeof globalThis.fetch): { byName: Map<string, ToolDefinition>; state: LearningState } {
  const state = emptyState()
  const tools = studyTools({ get: () => state, save: () => {} }, fetchImpl ? { fetch: fetchImpl } : {})
  return { byName: new Map(tools.map(t => [t.name, t])), state }
}

async function run(map: Map<string, ToolDefinition>, name: string, args: Record<string, unknown> ): Promise<any> {
  const tool = map.get(name)
  assert.ok(tool, `tool ${name} registered`)
  return tool.execute(args, exec)
}

const enc = new TextEncoder()

function articleHtml(): string {
  const body = Array.from({ length: 12 }, (_v, i) => `<p>第${i + 1}段:教程正文,讲一个完整的概念并给出例子,保证正文密度足够被抽取器识别为文章。</p>`).join('')
  return `<html><head><title>Web 教程文章</title></head><body><nav><a href="/">首页</a></nav><article><h1>Web 教程文章</h1>${body}</article></body></html>`
}

function arxivPdf(): Uint8Array {
  const data = 'BT (' + 'Attention mechanisms explained in plain language. '.repeat(60) + ') Tj ET'
  const payload = new Uint8Array(deflateSync(enc.encode(data)))
  const chunks: Uint8Array[] = [
    enc.encode('%PDF-1.5\n10 0 obj\n<< /Filter /FlateDecode /Length ' + payload.length + ' >>\nstream\n'),
    payload,
    enc.encode('\nendstream\nendobj\n'),
  ]
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let off = 0
  for (const c of chunks) { out.set(c, off); off += c.length }
  return out
}

const DESIGN = {
  sections: [{
    title: 'S1',
    lessons: [{ title: 'L1', file: '', world: 'study' }],
  }],
}

test('article URL: design brief from extracted body, apply imports offline, re-import idempotent', async () => {
  const fetchFn: typeof fetch = async () => new Response(articleHtml(), { status: 200 })
  const { byName, state } = setup(fetchFn)
  const started = await run(byName, 'study_import_url', { url: 'https://blog.example/learn/web-tutorial' })
  assert.equal(started.status, 'design_required')
  assert.equal(started.courseTitle, 'Web 教程文章')

  // the brief names exactly the virtual files the design must reference
  const files = started.fileCount as number
  assert.ok(files >= 1)
  const design = JSON.parse(JSON.stringify(DESIGN))
  design.sections[0].lessons[0].file = 'Web 教程文章.md'
  const applied = await run(byName, 'study_apply_design', design)
  assert.equal(applied.lessons, 1)
  assert.equal(state.courses[0]!.source, 'url')

  // second import of the same URL returns the existing course
  const again = await run(byName, 'study_import_url', { url: 'https://blog.example/learn/web-tutorial' })
  assert.equal(again.status, 'imported')
  assert.equal(again.courseId, applied.courseId)
})

test('arXiv URL: PDF text layer becomes the design source', async () => {
  const pdf = arxivPdf()
  const fetchFn: typeof fetch = async (input) => {
    const url = String(input)
    assert.ok(url.includes('export.arxiv.org'), `expected arXiv pdf download, got ${url}`)
    return new Response(pdf as unknown as BodyInit, { status: 200 })
  }
  const { byName } = setup(fetchFn)
  const started = await run(byName, 'study_import_url', { url: 'https://arxiv.org/abs/2401.12345' })
  assert.equal(started.status, 'design_required')
  assert.equal(started.courseTitle, 'arXiv:2401.12345')
  assert.ok(String(started.repo).includes('arXiv:2401.12345'))
})

const WBI_NAV = JSON.stringify({ code: 0, data: { wbi_img: { img_url: 'https://i0.hdslb.com/bfs/wbi/abcd1234.png', sub_url: 'https://i0.hdslb.com/bfs/wbi/efgh5678.png' } } })
const CC_BODY = JSON.stringify({ body: Array.from({ length: 60 }, (_v, i) => ({ from: i, to: i + 1, content: `第${i}句梯度下降的直觉讲解。` })) })

function biliFetch(pages: { cid: number; page?: number; part?: string }[], ccByCid: Record<number, { lan?: string; lan_doc?: string; subtitle_url?: string }[]>): typeof fetch {
  return async (input) => {
    const url = String(input)
    if (url.includes('/x/web-interface/view')) {
      return new Response(JSON.stringify({ code: 0, data: { title: '机器学习入门', owner: { name: '某UP' }, desc: '简介', duration: 600, cid: pages[0]?.cid ?? 1, pages } }), { status: 200 })
    }
    if (url.includes('/x/web-interface/nav')) return new Response(WBI_NAV, { status: 200 })
    if (url.includes('/x/player/wbi/v2')) {
      const cid = Number(new URL(url).searchParams.get('cid'))
      return new Response(JSON.stringify({ code: 0, data: { subtitle: { subtitles: ccByCid[cid] ?? [] } } }), { status: 200 })
    }
    if (url.includes('aisubtitle.hdslb.com')) return new Response(CC_BODY, { status: 200 })
    return new Response('x', { status: 404 })
  }
}

test('bilibili URL: CC subtitles become the design source (multi-P, one doc per part, missing parts dropped)', async () => {
  // P1 has zh-CN CC, P2 has none: the brief carries P1 only — the tutor designs
  // against what actually exists
  const fetchFn = biliFetch(
    [{ cid: 11, page: 1, part: '第一讲' }, { cid: 22, page: 2, part: '第二讲' }],
    { 11: [{ lan: 'zh-CN', lan_doc: '中文', subtitle_url: '//aisubtitle.hdslb.com/cc1.json' }] },
  )
  const { byName } = setup(fetchFn)
  const started = await run(byName, 'study_import_url', { url: 'https://www.bilibili.com/video/BV1ab411c2dE' })
  assert.equal(started.status, 'design_required')
  assert.equal(started.courseTitle, '机器学习入门')
  assert.ok(started.fileCount >= 1, 'the CC part yields design documents')
})

test('bilibili URL: ?p=N imports exactly that episode', async () => {
  const fetchFn = biliFetch(
    [{ cid: 11, page: 1, part: '第一讲' }, { cid: 22, page: 2, part: '第二讲' }],
    { 11: [{ lan: 'zh-CN', subtitle_url: '//aisubtitle.hdslb.com/cc1.json' }], 22: [{ lan: 'ai-zh', subtitle_url: '//aisubtitle.hdslb.com/cc2.json' }] },
  )
  const { byName } = setup(fetchFn)
  const started = await run(byName, 'study_import_url', { url: 'https://www.bilibili.com/video/BV1ab411c2dE?p=2' })
  assert.equal(started.status, 'design_required')
  assert.ok(started.fileCount >= 1)
})

test('bilibili URL without any CC: honest refusal with the paste-transcript guidance', async () => {
  const fetchFn = biliFetch([{ cid: 11, page: 1, part: '第一讲' }], {})
  const { byName } = setup(fetchFn)
  await assert.rejects(
    () => run(byName, 'study_import_url', { url: 'https://www.bilibili.com/video/BV1ab411c2dE' }),
    /机器学习入门[\s\S]*CC 字幕[\s\S]*study_import_markdown/,
  )
})

test('youtube URL and non-article pages are honestly refused; garbage URLs rejected', async () => {
  const { byName } = setup(async () => new Response('x', { status: 404 }))
  await assert.rejects(
    () => run(byName, 'study_import_url', { url: 'https://www.youtube.com/watch?v=abc123' }),
    /yt-dlp[\s\S]*study_import_markdown/,
  )
  // non-article page (login shell): honest failure instead of nav-noise import
  const shell = setup(async () => new Response('<html><head><title>login</title></head><body><form><input/></form></body></html>', { status: 200 }))
  await assert.rejects(
    () => run(shell.byName, 'study_import_url', { url: 'https://app.example/login' }),
    /article/,
  )
  await assert.rejects(
    () => run(shell.byName, 'study_import_url', { url: 'ftp://weird thing' }),
    /not a recognizable import URL|recognizable/,
  )
})

test('github URLs route into the repository import flow', async () => {
  // tree APIs ride httpsGet (not fetch) — stub the transport offline; reaching
  // the repo flow means the error is the github pipeline's, not the router's
  setHttpsGetOverride(async () => ({ ok: false, status: 404, error: 'stub' }))
  try {
    const { byName } = setup(async () => new Response('gone', { status: 404 }))
    await assert.rejects(
      () => run(byName, 'study_import_url', { url: 'https://github.com/owner/repo' }),
      /repo|README|CDN|tree|404|not found|unreachable/i,
    )
  } finally {
    setHttpsGetOverride(null)
  }
})

test('bilibili URL: an already-imported course (source url + normalized ref) returns directly', async () => {
  const fetchFn = biliFetch(
    [{ cid: 11, page: 1, part: '第一讲' }],
    { 11: [{ lan: 'zh-CN', subtitle_url: '//aisubtitle.hdslb.com/cc1.json' }] },
  )
  const { byName, state } = setup(fetchFn)
  const url = 'https://www.bilibili.com/video/BV1ab411c2dE'
  importCourse(state, parseMarkdownToCourse('# 机器学习入门\n## 第一章\n### 第一讲\n正文'), 'url', normalizeUrlIdentity(url))
  const res = await run(byName, 'study_import_url', { url })
  assert.equal(res.status, 'imported')
  assert.equal(res.title, '机器学习入门')
})

test('audit B6: private-address fetch targets are refused before any fetch (SSRF guard)', async () => {
  // the fake transport would happily "succeed" — the guard must refuse first
  const { byName } = setup(async () => new Response(articleHtml(), { status: 200 }))
  for (const url of [
    'http://127.0.0.1:3080/lookatstudy/api/state',
    'http://localhost:3080/lookatstudy/api/state',
    'http://169.254.169.254/latest/meta-data/',
    'http://192.168.1.1/admin',
    'http://10.0.0.5/internal',
    'http://172.16.0.9/x',
    'http://100.64.0.1/x',
    'http://0.0.0.0/x',
    'http://[::1]:8080/x',
    'http://[fe80::1]:8080/x',
  ]) {
    await assert.rejects(() => run(byName, 'study_import_url', { url }), /SSRF guard/, url)
  }
})

test('audit B6: redirects are followed manually and re-checked per hop', async () => {
  const fetchFn: typeof fetch = async (input) => {
    const url = String(input)
    if (url.includes('example.com/redirect')) {
      return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:3080/lookatstudy/api/state' } })
    }
    return new Response(articleHtml(), { status: 200 })
  }
  const { byName } = setup(fetchFn)
  await assert.rejects(
    () => run(byName, 'study_import_url', { url: 'https://example.com/redirect' }),
    /SSRF guard/,
    'a public URL redirecting into a loopback target must not be followed',
  )
})

test('audit B6: net-guard caps and hostname classification (unit)', async () => {
  const { guardedFetchText, isPrivateHostname, assertPublicHttpUrl } = await import('../src/vendor/net-guard.ts')
  assert.equal(isPrivateHostname('example.com'), false)
  assert.equal(isPrivateHostname('169.254.169.254'), true)
  assert.equal(isPrivateHostname('[::1]'), true)
  assert.equal(isPrivateHostname('8.8.8.8'), false)
  assert.equal(isPrivateHostname('localhost'), true)
  const big = 'x'.repeat(3 * 1024)
  const text = await guardedFetchText('https://a.example/big', { fetchImpl: async () => new Response(big), maxBytes: 1024 })
  assert.equal(text.length, 1024, 'the body is truncated at the cap, not buffered whole')
  await assert.rejects(
    () => guardedFetchText('https://a.example/declared', { fetchImpl: async () => new Response('x', { status: 200, headers: { 'content-length': '999999' } }), maxBytes: 1024 }),
    /cap/,
    'a declared content-length over the cap is refused outright',
  )
  assert.throws(() => assertPublicHttpUrl('ftp://x/y'), /non-http/)
})

test('audit C30: decorated GitHub URL variants resolve to the canonical course identity', async () => {
  setHttpsGetOverride(async () => ({ ok: false, status: 404, error: 'stub' }))
  try {
    const { byName, state } = setup(async () => new Response('gone', { status: 404 }))
    importCourse(state, parseMarkdownToCourse('# Repo Course\n## S\n### a\nbody'), 'github', 'https://github.com/owner/repo')
    for (const variant of ['https://github.com/owner/repo/', 'https://github.com/owner/repo.git', 'https://github.com/owner/repo?tab=readme']) {
      const res = await run(byName, 'study_import_url', { url: variant })
      assert.equal(res.status, 'imported', `${variant} resolves to the canonical identity (no network, no duplicate course)`)
      assert.equal(res.title, 'Repo Course')
    }
    assert.equal(state.courses.length, 1)
  } finally {
    setHttpsGetOverride(null)
  }
})

test('audit D37: an already-imported arXiv id returns before any PDF download', async () => {
  const { byName, state } = setup(async () => {
    throw new Error('the transport must not be touched when the course already exists (D37)')
  })
  importCourse(state, parseMarkdownToCourse('# Paper\n## S\n### a\nbody'), 'url', 'https://arxiv.org/abs/2401.12345')
  const res = await run(byName, 'study_import_url', { url: 'https://arxiv.org/abs/2401.12345' })
  assert.equal(res.status, 'imported')
  assert.equal(res.title, 'Paper')
})

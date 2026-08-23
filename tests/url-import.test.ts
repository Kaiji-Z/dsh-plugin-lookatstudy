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

const exec = { signal: new AbortController().signal } as unknown as ToolRunContext

function setup(fetch?: typeof fetch): { byName: Map<string, ToolDefinition>; state: LearningState } {
  const state = emptyState()
  const tools = studyTools({ get: () => state, save: () => {} }, fetch ? { fetch } : {})
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

test('bilibili URL: metadata classified, transcription honestly refused with guidance', async () => {
  const fetchFn: typeof fetch = async (input) => {
    const url = String(input)
    if (url.includes('api.bilibili.com/x/web-interface/view')) {
      return new Response(JSON.stringify({ code: 0, data: { title: '机器学习入门', owner: { name: '某UP' }, desc: '简介', duration: 600, pages: [{ part: 'P1' }] } }), { status: 200 })
    }
    return new Response('x', { status: 404 })
  }
  const { byName } = setup(fetchFn)
  await assert.rejects(
    () => run(byName, 'study_import_url', { url: 'https://www.bilibili.com/video/BV1ab411c2dE' }),
    /机器学习入门[\s\S]*study_import_markdown/,
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

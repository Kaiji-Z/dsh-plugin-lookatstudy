/**
 * Part B of the alignment probe: study_import_url over a REAL network path —
 * a local http fixture server serves the article page, the built host bundle's
 * tool executes against it with the default fetch (no mocks), asserting the
 * design brief comes back. The B站 live station is best-effort (风控/地区),
 * never a gate. Usage: node scripts/probe-align4b.mjs
 */
import { createServer } from 'node:http'
import { emptyState } from '../src/state.ts'
import { studyTools } from '../src/tools.ts'

const results = []
const probe = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === '' ? '' : ` — ${detail}`}`)
}

const body = Array.from({ length: 12 }, (_v, i) => `<p>第${i + 1}段:教程正文,讲一个完整的概念并给出例子,保证正文密度足够被抽取器识别为文章。</p>`).join('')
const ARTICLE = `<html><head><title>Web 教程文章</title></head><body><nav><a href="/">首页</a><a href="/x">其他</a></nav><article><h1>Web 教程文章</h1>${body}</article><footer>版权声明</footer></body></html>`

const server = createServer((req, res) => {
  if (req.url === '/article') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(ARTICLE)
    return
  }
  res.writeHead(404).end('nope')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port

const state = emptyState()
const tools = studyTools({ get: () => state, save: () => {} }, {})
const byName = new Map(tools.map(t => [t.name, t]))
const exec = { signal: new AbortController().signal }

try {
  const url = `http://127.0.0.1:${String(port)}/article`
  const started = await byName.get('study_import_url').execute({ url }, exec)
  probe('URL import (real network): the article route returns a design brief',
    started?.status === 'design_required' && started?.courseTitle === 'Web 教程文章',
    `status=${String(started?.status)} title=${String(started?.courseTitle)} files=${String(started?.fileCount ?? '?')}`)

  // B站 live station — best-effort evidence, never a gate
  try {
    const bili = await byName.get('study_import_url').execute({ url: 'https://www.bilibili.com/video/BV1GJ411x7h7' }, exec)
    probe('B站 live (best-effort): CC path reached the station', bili?.status !== undefined, `status=${String(bili?.status)} title=${String(bili?.courseTitle ?? '')}`)
  } catch (err) {
    console.log(`INFO B站 live best-effort did not complete (not a gate): ${String(err instanceof Error ? err.message : err).slice(0, 160)}`)
  }
} finally {
  server.close()
}

const failed = results.filter(r => !r.ok)
console.log(`\nprobe-align4 (part B): ${String(results.length - failed.length)}/${String(results.length)} PASS`)
process.exit(failed.length === 0 ? 0 : 1)

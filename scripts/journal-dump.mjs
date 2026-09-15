/**
 * Debug utility (NOT part of verify): dump a session journal's event ladder.
 * Usage: node scripts/journal-dump.mjs <session-id-prefix> [maxLines]
 */
import { scanZstdFrames, decompressZstdFrame } from 'file:///D:/Users/kaiji/vibecodingKJ/clones/deepseek-ai/deepseek-harness/packages/session/session-persistence-jsonl/lib/types/zstd.js'
import { readFileSync, readdirSync } from 'node:fs'

const prefix = process.argv[2]
const maxLines = Number.parseInt(process.argv[3] ?? '200', 10)
if (prefix === undefined) {
  console.error('usage: node scripts/journal-dump.mjs <session-id-prefix> [maxLines]')
  process.exit(2)
}
const root = 'D:/Users/kaiji/.dsh/sessions/--D-Users-kaiji-.dsh-lookatstudy-plugin-study-area--'
const dir = readdirSync(root).find(d => d.startsWith(`session-${prefix}`))
if (dir === undefined) {
  console.error(`no session dir starts with ${prefix}`)
  process.exit(1)
}
const buf = readFileSync(`${root}/${dir}/session.v3.jsonl.zstd`)
const lines = []
for (const frame of scanZstdFrames(buf).frames) {
  lines.push(...(await decompressZstdFrame(buf.subarray(frame.start, frame.end))).toString('utf8').split('\n').filter(Boolean))
}
const events = lines.map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
console.log(`session ${dir} — ${events.length} events`)
for (const e of events.slice(-maxLines)) {
  const ev = e.event ?? e
  const t = ev.type ?? '?'
  const seq = ev.seq ?? ''
  const d = ev.data ?? {}
  let extra = ''
  if (d.error !== undefined) extra += ` error=${JSON.stringify(d.error).slice(0, 220)}`
  if (d.message?.source?.name) extra += ` tool=${d.message.source.name}`
  if (d.message?.source?.isError) extra += ' TOOL-ERROR'
  const text = typeof d.text === 'string' ? d.text : (d.message?.content?.[0]?.text ?? d.message?.blocks?.[0]?.text ?? '')
  if (typeof text === 'string' && text !== '') extra += ` text=${text.slice(0, 90).replace(/\n/g, ' ')}`
  console.log(`${seq} ${t}${extra}`)
}

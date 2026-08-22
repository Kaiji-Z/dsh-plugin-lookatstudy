/**
 * Layer-2 acceptance judge (VERIFICATION.md §3.2): scores a livetest transcript
 * against the frozen criteria in judge-criteria.md with a real LLM, through a
 * structurally clean context — the prompt is EXACTLY the criteria file + the
 * transcript + a fixed template (tests assert this), so the judge can never see
 * the implementation. Key discipline: Z_AI_API_KEY enters via env only, is never
 * written to any file, never echoed to stdout/stderr (tests assert this too).
 *
 * Usage:
 *   pnpm run judge                          # live: judge livetest-output.md, write livetest-judge-output.md
 *   pnpm run judge -- --dry-run             # print the exact prompt, no key needed, no LLM call
 *   pnpm run judge -- --transcript <file>   # judge another transcript (e.g. a model-run session dump)
 *
 * Exit code 0 = transcript passes (every criterion >= 8/10), 1 = fail or error.
 * The report file is gitignored output, never committed.
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const PASS_SCORE = 8
export const DEFAULT_MODEL = process.env.JUDGE_MODEL || 'glm-5.2'
export const DEFAULT_BASE_URL = process.env.Z_AI_BASE_URL || 'https://api.z.ai/api/coding/paas/v4'
export const DEFAULT_TRANSCRIPT = 'livetest-output.md'
export const DEFAULT_CRITERIA = 'judge-criteria.md'
export const DEFAULT_OUT = 'livetest-judge-output.md'

/** The fixed prompt scaffold. Placeholders: {criteria} and {transcript} — nothing else enters the prompt. */
export const PROMPT_TEMPLATE = `You are an acceptance judge. You see only two things: the expected correct behavior and the actual run transcript. You do not know how the code is written, and do not need to.

Score each criterion from 0 to 10 (integers only; quantitative scoring, no bare right/wrong). Cite transcript evidence for every deduction. A criterion scores 10 only if the transcript fully satisfies it; missing evidence for a required behavior scores low, not neutral.

<expected-behavior>
{criteria}
</expected-behavior>

<run-transcript>
{transcript}
</run-transcript>

Respond with ONLY a JSON object, no prose outside it, in exactly this shape:
{"criteria":[{"id":"C1","score":<0-10 integer>,"deductions":"<what cost points and why, citing transcript evidence; empty string if none>"}],"summary":"<one short paragraph: what the run did well and where it fell short>"}`

/** Parse the frozen criteria file → [{id, text}]. Throws if no C-ids found or ids duplicate. */
export function parseCriteria(criteriaMd) {
  const out = []
  const seen = new Set()
  for (const m of criteriaMd.matchAll(/^([A-Z]\d+):\s*(\S.*)$/gm)) {
    if (seen.has(m[1])) throw new Error(`duplicate criterion id: ${m[1]}`)
    seen.add(m[1])
    out.push({ id: m[1], text: m[2] })
  }
  if (out.length === 0) throw new Error('no criteria lines found (expected lines like "C1: ...")')
  return out
}

/** Build the judge prompt — template + criteria file + transcript, structurally nothing else. */
export function buildPrompt(criteriaMd, transcript) {
  return PROMPT_TEMPLATE.replaceAll('{criteria}', criteriaMd).replaceAll('{transcript}', transcript)
}

/** Extract a JSON object from model output (fenced or embedded in prose) and validate it against the criteria. */
export function parseJudgement(raw, criteria) {
  const known = new Set(criteria.map(c => c.id))
  let text = raw?.trim() ?? ''
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map(m => m[1])
  const candidates = [...fenced, text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)]
  let parsed = null
  const errors = []
  for (const c of candidates) {
    if (!c) continue
    try { parsed = JSON.parse(c); break } catch (e) { errors.push(e.message) }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`judge output is not a JSON object (first 200 chars: ${text.slice(0, 200)}; parse errors: ${errors.join('; ')})`)
  }
  if (!Array.isArray(parsed.criteria) || parsed.criteria.length === 0) throw new Error('judgement missing "criteria" array')
  const scored = new Map()
  for (const c of parsed.criteria) {
    if (!c || typeof c.id !== 'string' || !known.has(c.id)) throw new Error(`unknown or missing criterion id: ${JSON.stringify(c?.id)}`)
    if (scored.has(c.id)) throw new Error(`duplicate criterion id in judgement: ${c.id}`)
    if (!Number.isInteger(c.score) || c.score < 0 || c.score > 10) throw new Error(`criterion ${c.id}: score must be an integer 0-10, got ${JSON.stringify(c.score)}`)
    if (c.deductions !== undefined && typeof c.deductions !== 'string') throw new Error(`criterion ${c.id}: deductions must be a string`)
    scored.set(c.id, { id: c.id, score: c.score, deductions: c.deductions ?? '' })
  }
  const missing = [...known].filter(id => !scored.has(id))
  if (missing.length > 0) throw new Error(`judgement does not score every criterion; missing: ${missing.join(', ')}`)
  return { criteria: [...scored.values()], summary: typeof parsed.summary === 'string' ? parsed.summary : '' }
}

/** Threshold verdict: PASS iff every criterion >= PASS_SCORE. */
export function evaluateVerdict(judgement) {
  const scores = judgement.criteria.map(c => c.score)
  const min = Math.min(...scores)
  const mean = Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
  return { pass: scores.every(s => s >= PASS_SCORE), minScore: min, meanScore: mean }
}

function parseArgs(argv) {
  const opts = { dryRun: false, transcript: DEFAULT_TRANSCRIPT, criteria: DEFAULT_CRITERIA, out: DEFAULT_OUT, model: DEFAULT_MODEL, baseUrl: DEFAULT_BASE_URL }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') opts.dryRun = true
    else if (a === '--transcript') opts.transcript = argv[++i]
    else if (a === '--criteria') opts.criteria = argv[++i]
    else if (a === '--out') opts.out = argv[++i]
    else if (a === '--model') opts.model = argv[++i]
    else if (a === '--base-url') opts.baseUrl = argv[++i]
    else { console.error(`unknown argument: ${a}`); process.exit(1) }
  }
  return opts
}

/** Call the judge model. The key value never appears in any error or log line. */
async function callModel(prompt, { model, baseUrl }) {
  const key = process.env.Z_AI_API_KEY
  if (!key) {
    console.error('Z_AI_API_KEY is not set. Source the harness checkout\'s gitignored .env first (see AGENTS.md live-testing notes); the key is env-only and never written to disk.')
    process.exit(1)
  }
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0, max_tokens: 4096 }),
    signal: AbortSignal.timeout(180_000),
  }).catch(e => { throw new Error(`judge model request failed: ${e.message}`) })
  if (!res.ok) throw new Error(`judge model HTTP ${res.status}`)
  const data = await res.json().catch(() => { throw new Error('judge model returned non-JSON body') })
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || content === '') throw new Error('judge model returned no content')
  return content
}

function writeReport(out, { criteriaPath, criteriaMd, transcriptPath, model, judgement, verdict }) {
  const digest = createHash('sha256').update(criteriaMd).digest('hex').slice(0, 12)
  const lines = [
    '# Layer-2 judge report', '',
    `- generated: ${new Date().toISOString()}`,
    `- model: ${model} (temperature 0)`,
    `- transcript: ${transcriptPath}`,
    `- criteria: ${criteriaPath} (sha256 ${digest} — changing acceptance means changing that file)`,
    `- verdict: ${verdict.pass ? 'PASS' : 'FAIL'} (rule: every criterion >= ${PASS_SCORE}/10; min ${verdict.minScore}, mean ${verdict.meanScore})`, '',
    '| id | score | deductions |', '|---|---|---|',
    ...judgement.criteria.map(c => `| ${c.id} | ${c.score}/10 | ${c.deductions === '' ? '—' : c.deductions.replaceAll('|', '\\|').replaceAll('\n', ' ')} |`),
    '', '## summary', '', judgement.summary, '', '## raw judgement', '', '```json', JSON.stringify(judgement, null, 2), '```', '',
  ]
  writeFileSync(out, lines.join('\n'))
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const criteriaMd = readFileSync(opts.criteria, 'utf8')
  const transcript = readFileSync(opts.transcript, 'utf8')
  const criteria = parseCriteria(criteriaMd)
  const prompt = buildPrompt(criteriaMd, transcript)
  if (opts.dryRun) {
    process.stdout.write(prompt + '\n')
    console.error(`dry-run: prompt built from ${criteria.length} criteria (${opts.criteria}) + ${opts.transcript}; no LLM call, no key read.`)
    return
  }
  const raw = await callModel(prompt, opts)
  const judgement = parseJudgement(raw, criteria)
  const verdict = evaluateVerdict(judgement)
  writeReport(opts.out, { criteriaPath: opts.criteria, criteriaMd, transcriptPath: opts.transcript, model: opts.model, judgement, verdict })
  console.log(`judge: ${verdict.pass ? 'PASS' : 'FAIL'} — min ${verdict.minScore}/10, mean ${verdict.meanScore}/10 over ${judgement.criteria.length} criteria; report: ${opts.out}`)
  process.exitCode = verdict.pass ? 0 : 1
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) {
  main().catch(e => { console.error(`judge: ${e.message}`); process.exit(1) })
}

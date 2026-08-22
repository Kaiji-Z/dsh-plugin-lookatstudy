/**
 * Layer-2 judge wiring (VERIFICATION.md §3.2): the judge's CONTEXT PURITY and
 * its scoring pipeline are deterministic and must be provable without an LLM —
 * these tests freeze (a) the prompt is exactly criteria + transcript + fixed
 * template, with no implementation paths or code, (b) judgement parsing and the
 * >=8/10 threshold rule over good/bad transcripts, (c) the runner never echoes
 * the API key, and (d) the committed criteria file parses. The live LLM call is
 * the only untested seam, by design (key-gated, user-triggered).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  PASS_SCORE, parseCriteria, buildPrompt, parseJudgement, evaluateVerdict,
} from '../scripts/livetest-judge.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const CRITERIA_MD = readFileSync(`${ROOT}judge-criteria.md`, 'utf8')
const GOOD = readFileSync(`${ROOT}tests/fixtures/judge-good.md`, 'utf8')
const BAD = readFileSync(`${ROOT}tests/fixtures/judge-bad.md`, 'utf8')

const goodJudgement = (scores: Record<string, number>) => JSON.stringify({
  criteria: Object.entries(scores).map(([id, score]) => ({ id, score, deductions: '' })),
  summary: 'ok',
})

test('criteria: the committed judge-criteria.md parses into frozen C-ids', () => {
  const cs = parseCriteria(CRITERIA_MD)
  assert.ok(cs.length >= 6, `expected at least 6 criteria, got ${cs.length}`)
  assert.deepEqual(cs.map(c => c.id), ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'])
  for (const c of cs) assert.ok(c.text.length > 40, `${c.id} must carry a judgeable description`)
  assert.equal(PASS_SCORE, 8, 'the pass threshold is frozen at 8/10')
})

test('criteria: parser refuses empty and duplicated criteria files', () => {
  assert.throws(() => parseCriteria('# nothing here'), /no criteria lines/)
  assert.throws(() => parseCriteria('C1: a\nC1: b'), /duplicate/)
})

test('iron rule: the judge prompt is exactly template + criteria + transcript — no implementation can leak in', () => {
  const prompt = buildPrompt(CRITERIA_MD, GOOD)
  // The two payloads ride verbatim: the judge sees the frozen file and the run, whole.
  assert.ok(prompt.includes(CRITERIA_MD.trim()), 'criteria file embedded verbatim')
  assert.ok(prompt.includes(GOOD.trim()), 'transcript embedded verbatim')
  // Structural: substitution-only assembly — nothing else varies.
  assert.equal(prompt.split('<expected-behavior>')[1]!.split('</expected-behavior>')[0].trim(), CRITERIA_MD.trim())
  assert.equal(prompt.split('<run-transcript>')[1]!.split('</run-transcript>')[0].trim(), GOOD.trim())
  // No source paths, no code, no key names anywhere in the judge's view.
  for (const banned of ['src/', 'import ', 'from "./', 'Z_AI_API_KEY', 'state.json']) {
    assert.ok(!prompt.includes(banned), `prompt must not contain ${JSON.stringify(banned)}`)
  }
})

test('judgement: fenced, bare, and prose-embedded JSON all parse', () => {
  const criteria = parseCriteria(CRITERIA_MD)
  const payload = goodJudgement({ C1: 10, C2: 9, C3: 10, C4: 8, C5: 9, C6: 10 })
  for (const raw of [payload, '```json\n' + payload + '\n```', 'Here is my verdict.\n' + payload + '\nDone.']) {
    const j = parseJudgement(raw, criteria)
    assert.equal(j.criteria.length, 6)
  }
})

test('verdict: threshold rule over the good and the deficient transcript', () => {
  const criteria = parseCriteria(CRITERIA_MD)
  // A judge scoring the good fixture's behavior honestly passes.
  const pass = evaluateVerdict(parseJudgement(goodJudgement({ C1: 10, C2: 9, C3: 10, C4: 8, C5: 10, C6: 9 }), criteria))
  assert.equal(pass.pass, true)
  assert.equal(pass.minScore, 8)
  // The deficient fixture (filler concept, two answers, misgraded, inconsistent readout) fails.
  const fail = evaluateVerdict(parseJudgement(goodJudgement({ C1: 10, C2: 4, C3: 10, C4: 3, C5: 10, C6: 2 }), criteria))
  assert.equal(fail.pass, false)
  assert.equal(fail.minScore, 2)
  // Boundary: exactly the threshold passes; one below fails.
  assert.equal(evaluateVerdict(parseJudgement(goodJudgement({ C1: 8, C2: 8, C3: 8, C4: 8, C5: 8, C6: 8 }), criteria)).pass, true)
  assert.equal(evaluateVerdict(parseJudgement(goodJudgement({ C1: 8, C2: 7, C3: 8, C4: 8, C5: 8, C6: 8 }), criteria)).pass, false)
})

test('judgement: malformed model output is refused, not guessed at', () => {
  const criteria = parseCriteria(CRITERIA_MD)
  assert.throws(() => parseJudgement('not json at all', criteria), /not a JSON object/)
  assert.throws(() => parseJudgement('{"criteria": []}', criteria), /missing "criteria"/)
  assert.throws(() => parseJudgement(goodJudgement({ C1: 10, C2: 9, C3: 10, C4: 8, C5: 9 }), criteria), /missing: C6/)
  assert.throws(() => parseJudgement(goodJudgement({ C1: 10, C2: 9, C3: 10, C4: 8, C5: 9, C9: 9 }), criteria), /unknown or missing/)
  assert.throws(() => parseJudgement(goodJudgement({ C1: 10, C2: 9, C3: 10, C4: 8, C5: 9, C6: '9' } as any), criteria), /integer 0-10/)
  assert.throws(() => parseJudgement(goodJudgement({ C1: 10, C2: 9, C3: 10, C4: 11, C5: 9, C6: 10 }), criteria), /integer 0-10/)
})

test('cli: --dry-run builds the real prompt with no key and no LLM call', () => {
  const res = spawnSync(process.execPath, ['scripts/livetest-judge.mjs', '--dry-run', '--transcript', 'tests/fixtures/judge-good.md'],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, Z_AI_API_KEY: '' } })
  assert.equal(res.status, 0, res.stderr)
  assert.ok(res.stdout.includes('<run-transcript>'))
  assert.ok(res.stdout.includes('C1: Import fidelity'))
  assert.ok(res.stdout.includes('fixture: a transcript that satisfies'))
})

test('cli: the API key is never echoed, even on the failure path', () => {
  const FAKE = 'fake-livetest-key-must-never-appear'
  // Unroutable base URL: the request fails fast; the error path must not print the key.
  const res = spawnSync(process.execPath,
    ['scripts/livetest-judge.mjs', '--transcript', 'tests/fixtures/judge-good.md', '--base-url', 'http://127.0.0.1:1'],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, Z_AI_API_KEY: FAKE } })
  assert.equal(res.status, 1, 'unroutable endpoint must exit 1')
  assert.ok(!res.stdout.includes(FAKE) && !res.stderr.includes(FAKE), 'the key value must not appear in any output')
  const missing = spawnSync(process.execPath, ['scripts/livetest-judge.mjs', '--transcript', 'tests/fixtures/judge-good.md'],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, Z_AI_API_KEY: '' } })
  assert.equal(missing.status, 1)
  assert.ok(missing.stderr.includes('Z_AI_API_KEY'), 'names the env var')
  assert.ok(!missing.stderr.includes('fake-livetest'), 'but never a value')
})

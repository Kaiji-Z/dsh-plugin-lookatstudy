/**
 * The one-command verification gate (VERIFICATION.md §6: "reproducible by one
 * command, no human screen-watching"). Every step checks the child's exit
 * code explicitly — piping a build through grep once shipped a stale bundle
 * as a fake release, so this script trusts nothing but exit codes and
 * asserted bundle content. Prints a GATE line per step; any failure exits 1.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const failed = []

/** Run one step, GATE-declare it, and record pass/fail with evidence. */
function gate(name, run) {
  const evidence = run()
  const ok = evidence.exit === 0 && evidence.checks.every(c => c.ok)
  console.log(`GATE ${name}: ${ok ? 'DONE' : 'FAILED'}`)
  console.log(`- exit: ${evidence.exit}`)
  for (const check of evidence.checks) console.log(`- ${check.ok ? 'ok' : 'FAIL'}: ${check.label}`)
  if (!ok) failed.push(name)
  return ok
}

/** Spawn a command, inheriting stdio; returns its exit code. */
function sh(command, args) {
  const res = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' })
  return res.status ?? 1
}

gate('tests', () => ({
  exit: sh('node', ['--import', 'tsx', '--test', 'tests/*.test.ts']),
  checks: [{ ok: true, label: 'node:test suite (glob quoted for git-bash)' }],
}))

gate('build', () => ({
  exit: sh('pnpm', ['run', 'build']),
  checks: [
    { ok: existsSync('lib/index.mjs'), label: 'lib/index.mjs exists' },
    { ok: existsSync('lib/client.js'), label: 'lib/client.js exists' },
  ],
}))

gate('bundle', () => {
  if (!existsSync('lib/client.js')) return { exit: 1, checks: [{ ok: false, label: 'client bundle missing' }] }
  const client = readFileSync('lib/client.js', 'utf8')
  const host = existsSync('lib/index.mjs') ? readFileSync('lib/index.mjs', 'utf8') : ''
  const required = [
    [client, 'conversation.view', 'study tab registered'],
    [client, 'lookatstudy-study', 'study tab id'],
    [client, 'conversation-composer-overlay', 'fixed-height overlay mode'],
    [client, 'dsh-composer-card-max-width', 'composer-width center strip'],
    [client, 'lks-body', 'container-query direction wrapper'],
    [client, 'lesson-session', 'per-lesson thread binding'],
    [client, '/lookatstudy/api/active', 'activation route wired into the client'],
    [client, '退出学习模式', 'in-tab activation toggle'],
    [client, '开始学习', 'hero starter button'],
    [client, 'M8.00192 6.64454', 'starter icon (ic_ds_think glyph)'],
    [client, 'M2.871 13.1286', 'busy spinner icon (ic_ds_loading glyph)'],
    [client, 'lks-spin', 'spinner animation class'],
    [client, '章节测验', 'exam nodes'],
    [client, 'lks-quiz', 'interactive quiz options'],
    [client, 'lks-opt', 'quiz answer buttons'],
    [client, 'font-size:16px', 'transcript at dsh chat size'],
    [client, '课时掌握度', 'glyph tooltips'],
    [client, '导师思考中', 'thinking indicator'],
    [client, 'data-composer-card', 'composer follows the tutor column (critique P1)'],
    [client, 'lks-composer-follow', 'composer-follow class hook'],
    [client, 'aria-disabled', 'lesson rows are real buttons (keyboard reach, critique P1)'],
    [client, 'sectionDefaultOpen', 'rail sections collapse off the frontier (critique P1)'],
    [client, 'aria-expanded', 'section heads announce their collapse state'],
    [client, 'flex:0 1 260px', 'fixed-preference rail, blackboard takes the rest (critique P1)'],
    [client, 'business-tertiary', 'proposal banner reads positive, not warn (critique P2)'],
    [host, 'attemptLesson', 'attempt-unlock host path'],
    [host, 'in_progress', 'four-state machine'],
    [host, 'createStudySurface', 'activation-gated tool surface'],
    [host, 'data.jsdelivr.com', 'jsdelivr data API tree fallback (upstream 2026-08-16 port)'],
    [host, 'deadlineMs', 'httpsGet hard deadline plumbing'],
    [host, "learner's own language", 'output-language directive'],
    [host, 'study_apply_design', 'tutor-design apply tool'],
    [host, 'design_required', 'import design protocol status'],
    [host, '3000-8000', 'lesson pacing rule rides the brief and prompt'],
  ]
  const forbidden = [
    [client, 'agentReady', 'stale agentReady gate (removed in 0.4.1)'],
    [client, '📚', 'emoji icon on starter/import buttons (replaced by ic_ds glyphs in 0.7.1)'],
  ]
  const checks = [
    ...required.map(([src, needle, label]) => ({ ok: src.includes(needle), label: `bundle contains ${label} (${JSON.stringify(needle)})` })),
    ...forbidden.map(([src, needle, label]) => ({ ok: !src.includes(needle), label: `bundle free of ${label}` })),
  ]
  return { exit: 0, checks }
})

gate('secrets', () => {
  // "The key never enters the public repo" as a machine gate, not a promise.
  // Scans every git-tracked file for (a) KEY=value assignments, (b) sk- token
  // patterns, (c) the actual Z_AI_API_KEY value when it is present in this
  // shell's env (CI has no key → (c) self-skips). Hits report file + kind only,
  // never the matched text — the gate must not become the leak.
  const ls = spawnSync('git', ['ls-files'], { encoding: 'utf8' })
  if (ls.status !== 0) return { exit: 1, checks: [{ ok: false, label: `git ls-files failed: ${ls.stderr?.trim()}` }] }
  const files = ls.stdout.split('\n').map(s => s.trim()).filter(Boolean)
  const ASSIGNMENT = /(API_KEY|SECRET|TOKEN|PASSWORD)[ \t]*=[ \t]*['"]?[A-Za-z0-9_\-+/=]{8,}/
  const TOKEN = /sk-[A-Za-z0-9]{16,}/
  const live = process.env.Z_AI_API_KEY
  const hits = []
  for (const f of files) {
    let body
    try { body = readFileSync(f, 'utf8') } catch { continue }
    const kinds = []
    if (ASSIGNMENT.test(body)) kinds.push('key-assignment')
    if (TOKEN.test(body)) kinds.push('sk-token-pattern')
    if (live && live.length >= 8 && body.includes(live)) kinds.push('live-key-value')
    if (kinds.length > 0) hits.push(`${f} (${kinds.join(', ')})`)
  }
  const artifacts = ['livetest-output.md', 'livetest-judge-output.md', 'livetest-design-output.md', 'livetest-design-state.json', 'livetest-design-err.log']
  const tracked = artifacts.filter(a => files.includes(a))
  return {
    exit: 0,
    checks: [
      { ok: hits.length === 0, label: hits.length === 0 ? `scanned ${files.length} tracked files — no key assignments, no token patterns${live ? ', live key value absent' : ''}` : `LEAK: ${hits.join(' | ')}` },
      { ok: tracked.length === 0, label: tracked.length === 0 ? 'live artifacts (livetest/judge outputs, state) stay untracked' : `tracked live artifacts: ${tracked.join(', ')}` },
    ],
  }
})

if (failed.length > 0) {
  console.log(`\nVERIFY: FAILED at ${failed.join(', ')}`)
  process.exit(1)
}
console.log('\nVERIFY: PASS — tests, build, and bundle assertions all green (machine-checked).')

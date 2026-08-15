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
    [client, '开始学习', 'hero starter button'],
    [client, 'M8.00192 6.64454', 'starter icon (ic_ds_think glyph)'],
    [client, 'M2.871 13.1286', 'busy spinner icon (ic_ds_loading glyph)'],
    [client, 'lks-spin', 'spinner animation class'],
    [client, '章节测验', 'exam nodes'],
    [host, 'attemptLesson', 'attempt-unlock host path'],
    [host, 'in_progress', 'four-state machine'],
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

if (failed.length > 0) {
  console.log(`\nVERIFY: FAILED at ${failed.join(', ')}`)
  process.exit(1)
}
console.log('\nVERIFY: PASS — tests, build, and bundle assertions all green (machine-checked).')

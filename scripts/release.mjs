/**
 * The one-command release (the fixed 发版 ritual): verify gate → version
 * bump → release commit → v* tag → push main + tag → CI (npm trusted
 * publishing) → poll the registry until the version is live. No human gate
 * by owner decision — the verify gate is the only quality barrier, and the
 * CI job re-runs it. Every step checks the child's exit code explicitly and
 * fails loud with its recovery hint; pushes are retriable (commit + tag stay
 * local until both pushes succeed).
 *
 * Usage:
 *   node scripts/release.mjs <version|major|minor|patch> ["commit message"]
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const OWNER_REPO = 'Kaiji-Z/dsh-plugin-lookatstudy'
const NPM_NAME = 'dsh-plugin-lookatstudy'
const POLL_MS = 15_000
const POLL_MAX_MS = 12 * 60_000

const [,, target, ...messageParts] = process.argv
if (target === undefined) {
  console.error('usage: node scripts/release.mjs <version|major|minor|patch> ["commit message"]')
  process.exit(1)
}

/** Run one child; stdio inherited; returns its exit code. */
function sh(command, args, shell) {
  const res = spawnSync(command, args, { stdio: 'inherit', shell })
  return res.status ?? 1
}

/** Bump an x.y.z string by a semver part. */
function bump(version, part) {
  const [major, minor, patch] = version.split('.').map(Number)
  if (part === 'major') return `${major + 1}.0.0`
  if (part === 'minor') return `${major}.${minor + 1}.0`
  if (part === 'patch') return `${major}.${minor}.${patch + 1}`
  return null
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const current = pkg.version
const next = /^\d+\.\d+\.\d+$/.test(target) ? target : bump(current, target)
if (next === null || next === current) {
  // Audit B9: the common re-run window — a previous release bumped+committed+tagged
  // but the PUSH failed. package.json already sits at the target, so the old
  // "cannot go from X to X" message sent the operator nowhere. Detect the
  // pending local tag and hand over the exact recovery.
  if (next === current) {
    const tagHere = spawnSync('git', ['tag', '-l', `v${current}`], { encoding: 'utf8' })
    if (tagHere.status === 0 && (tagHere.stdout ?? '').trim() !== '') {
      console.error(`release: package.json is already ${current} and tag v${current} exists locally — if the previous push failed, recover with: git push origin main v${current}`)
      process.exit(1)
    }
  }
  console.error(`release: cannot go from ${current} to ${JSON.stringify(target)}`)
  process.exit(1)
}
const tag = `v${next}`
const message = messageParts.join(' ') || `${tag}: release`

console.log(`RELEASE ${current} -> ${next} (${tag})`)

// GATE 0 — clean tree, on main, in sync with origin (audit B9: a feature-branch
// release pushes the STALE local main + the tag — the tag triggers publish, so
// npm gets a version main never contains). This script commits ONLY
// package.json; every source change must already be committed or the tag ships
// a version bump over stale code (this exact incident shipped a broken 0.11.0
// on 2026-08-23).
const dirty = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8' })
if (dirty.status !== 0 || (dirty.stdout ?? '').trim() !== '') {
  console.error('release: working tree is dirty — commit your changes first')
  console.error('  (the release commit carries only the version bump; uncommitted code would NOT reach the tag)')
  process.exit(1)
}
const branch = spawnSync('git', ['branch', '--show-current'], { encoding: 'utf8' })
if ((branch.stdout ?? '').trim() !== 'main') {
  console.error(`release: refusing to release from branch ${JSON.stringify((branch.stdout ?? '').trim() || '(detached)')} — switch to main first (a branch release would publish the stale local main under the tag)`)
  process.exit(1)
}
const head = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' })
const originMain = spawnSync('git', ['rev-parse', 'origin/main'], { encoding: 'utf8' })
if (head.status !== 0 || originMain.status !== 0 || (head.stdout ?? '').trim() !== (originMain.stdout ?? '').trim()) {
  console.error('release: local main is not in sync with origin/main — pull (or push) first')
  process.exit(1)
}

// GATE 1 — the verify gate (same as local; CI re-runs it too).
if (sh('pnpm', ['run', 'verify'], process.platform === 'win32') !== 0) {
  console.error('release: verify FAILED — nothing was written')
  process.exit(1)
}

// GATE 2 — bump + commit + tag (local only until the pushes land).
pkg.version = next
writeFileSync('package.json', `${JSON.stringify(pkg, null, 2)}\n`)
if (sh('git', ['add', 'package.json'], false) !== 0 || sh('git', ['commit', '-m', message], false) !== 0) {
  console.error('release: commit failed — fix and rerun (the version bump is written but uncommitted)')
  process.exit(1)
}
if (sh('git', ['tag', tag], false) !== 0) {
  console.error(`release: tag ${tag} already exists — delete it or pass a different version`)
  process.exit(1)
}

// GATE 3 — push main + tag; this tag push IS the publish trigger (trusted publishing).
if (sh('git', ['push', 'origin', 'main', tag], false) !== 0) {
  console.error(`release: push failed — rerun after fixing network: git push origin main ${tag} (commit and tag are already local)`)
  process.exit(1)
}
console.log(`PUSHED ${tag} — CI (Publish to npm) is running on ${OWNER_REPO}`)

// GATE 4 — poll the registry until the version is live.
const deadline = Date.now() + POLL_MAX_MS
for (;;) {
  await new Promise(resolve => setTimeout(resolve, POLL_MS))
  let versions = null
  try {
    const res = await fetch(`https://registry.npmjs.org/${NPM_NAME}`)
    if (res.ok) versions = (await res.json()).versions
  } catch { /* transient network failure: keep polling */ }
  if (versions !== null && versions[next] !== undefined) {
    console.log(`RELEASED ${NPM_NAME}@${next} is live on npm`)
    console.log(`next: reinstall the web profile (remove + add @${next})`)
    process.exit(0)
  }
  if (Date.now() > deadline) {
    console.error(`release: ${NPM_NAME}@${next} did NOT appear on npm within ${POLL_MAX_MS / 60_000} min — check the Actions run on ${OWNER_REPO} (trusted-publisher binding: repo + publish.yml + environment EMPTY)`)
    process.exit(1)
  }
  console.log('waiting for CI publish…')
}

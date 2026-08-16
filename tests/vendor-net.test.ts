/**
 * Network hardening ported from upstream LookatStudy (036d449 + 7c597f0 +
 * a66cd3b, 2026-08-16): httpsGet's hard deadline and abort plumbing, proved
 * offline against a dumb TCP server that accepts connections but never
 * responds — the exact shape of the half-dead-proxy hang the deadline exists
 * to pierce (upstream field report: progress stuck 700s+, idle timeouts
 * perpetually reset by low-level activity).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:net'
import { performance } from 'node:perf_hooks'
import { httpsGet } from '../src/vendor/repo-fetcher.ts'

/** A TCP server that accepts connections and never responds. */
async function dumbServer(): Promise<{ server: Server; port: number }> {
  const server = createServer(() => { /* accept, never respond */ })
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve) })
  return { server, port: (server.address() as { port: number }).port }
}

test('httpsGet deadline pierces a dumb server that never responds', async () => {
  const { server, port } = await dumbServer()
  try {
    const t0 = performance.now()
    const r = await httpsGet(`https://127.0.0.1:${port}/x`, { rejectUnauthorized: false, deadlineMs: 600 })
    const ms = performance.now() - t0
    assert.equal(r.ok, false, 'a hung server must fail')
    assert.equal(r.error, 'deadline', `the hard deadline must pierce the hang: ${r.error}`)
    assert.ok(ms < 3000, `should return near the deadline, took ${ms.toFixed(0)}ms`)
  } finally {
    server.close()
  }
})

test('httpsGet honors a pre-aborted signal without connecting', async () => {
  const ctl = new AbortController()
  ctl.abort()
  const t0 = performance.now()
  const r = await httpsGet('https://192.0.2.1/never-reached', { signal: ctl.signal })
  const ms = performance.now() - t0
  assert.equal(r.ok, false, 'pre-abort must fail')
  assert.equal(r.error, 'aborted', `pre-abort returns aborted without building a connection: ${r.error}`)
  assert.ok(ms < 100, `pre-abort must return immediately, took ${ms.toFixed(0)}ms`)
})

test('httpsGet tears down an in-flight request on abort', async () => {
  const { server, port } = await dumbServer()
  try {
    const ctl = new AbortController()
    setTimeout(() => ctl.abort(), 120)
    const t0 = performance.now()
    const r = await httpsGet(`https://127.0.0.1:${port}/x`, { rejectUnauthorized: false, deadlineMs: 5000, signal: ctl.signal })
    const ms = performance.now() - t0
    assert.equal(r.ok, false, 'an aborted request must fail')
    assert.equal(r.error, 'aborted', `abort tears the socket down instead of waiting out the deadline: ${r.error}`)
    assert.ok(ms < 1500, `abort must act near-immediately, took ${ms.toFixed(0)}ms`)
  } finally {
    server.close()
  }
})

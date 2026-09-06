/**
 * The panel toast store (P6, upstream Toast.tsx port): enqueue with
 * per-severity durations, the exit handshake, timer cancellation, clear on
 * unmount, and subscriber lifecycle — all under a manual scheduler.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { SEVERITY_DURATION, ToastStore, type ToastScheduler } from '../src/client/toast.ts'

/** A manual scheduler: queue jobs, fire them by index, observe cancels. */
function manualClock(): {
  scheduler: ToastScheduler
  fire(index: number): void
  jobCount(): number
  cancelled(index: number): boolean
} {
  const jobs: Array<{ fn: () => void; cancelled: boolean }> = []
  const scheduler: ToastScheduler = (fn) => {
    const job = { fn, cancelled: false }
    jobs.push(job)
    return () => { job.cancelled = true }
  }
  return {
    scheduler,
    fire: (index) => { if (!jobs[index]!.cancelled) jobs[index]!.fn() },
    jobCount: () => jobs.length,
    cancelled: (index) => jobs[index]!.cancelled,
  }
}

test('show enqueues with per-severity default durations and schedules one exit per item', () => {
  const clock = manualClock()
  const store = new ToastStore(clock.scheduler)
  assert.equal(store.show('保存失败', { severity: 'error' }), 1)
  assert.equal(store.show('答对了!', { severity: 'success' }), 2)
  assert.equal(store.show('默认'), 3)
  const snapshot = store.getSnapshot()
  assert.deepEqual(snapshot.map(t => [t.message, t.severity, t.duration, t.exiting]), [
    ['保存失败', 'error', SEVERITY_DURATION.error, false],
    ['答对了!', 'success', SEVERITY_DURATION.success, false],
    ['默认', 'default', SEVERITY_DURATION.default, false],
  ], 'error outlasts success (the learner needs time to read it)')
  assert.equal(clock.jobCount(), 3, 'one scheduled exit per toast')
  assert.equal(SEVERITY_DURATION.error, 6000)
  assert.equal(SEVERITY_DURATION.warning, 5000)
})

test('an explicit duration overrides the severity default', () => {
  const clock = manualClock()
  const store = new ToastStore(clock.scheduler)
  store.show('undo me', { severity: 'info', duration: 5000, action: { label: '撤销', onClick: () => {} } })
  const [item] = store.getSnapshot()
  assert.equal(item!.duration, 5000)
  assert.equal(item!.action!.label, '撤销', 'the action rides the item for the view')
})

test('the exit handshake: timer fire marks exiting, finish removes, cancel disarms', () => {
  const clock = manualClock()
  const store = new ToastStore(clock.scheduler)
  store.show('one')
  store.show('two')
  // the first toast's timer fires → exiting, and its canceller is consumed
  clock.fire(0)
  assert.deepEqual(store.getSnapshot().map(t => [t.message, t.exiting]), [['one', true], ['two', false]])
  // the view reports the exit animation done → removed
  store.finish(1)
  assert.deepEqual(store.getSnapshot().map(t => t.message), ['two'])
  // dismissing the second cancels its pending timer; the stray fire is inert
  store.startExit(2)
  assert.equal(clock.cancelled(1), true, 'dismiss cancels the auto-exit timer')
  clock.fire(1)
  assert.deepEqual(store.getSnapshot().map(t => [t.message, t.exiting]), [['two', true]], 'a cancelled timer never double-fires')
  store.finish(2)
  assert.equal(store.getSnapshot().length, 0)
})

test('clear drops everything and disarms every timer (panel unmount)', () => {
  const clock = manualClock()
  const store = new ToastStore(clock.scheduler)
  store.show('a')
  store.show('b')
  store.clear()
  assert.equal(store.getSnapshot().length, 0)
  assert.ok(clock.cancelled(0) && clock.cancelled(1), 'all timers cancelled')
})

test('subscribers hear every transition and can unsubscribe', () => {
  const clock = manualClock()
  const store = new ToastStore(clock.scheduler)
  let pushes = 0
  const unsubscribe = store.subscribe(() => { pushes += 1 })
  store.show('x')
  store.startExit(store.getSnapshot()[0]!.id)
  assert.equal(pushes, 2)
  unsubscribe()
  store.show('y')
  assert.equal(pushes, 2, 'no notifications after unsubscribe')
})

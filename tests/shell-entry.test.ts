/**
 * issue #17: the shell-entry self-heal observer froze the host on big
 * sessions. A 1000-event history render mutates the DOM in a continuous
 * storm, and the old unconditional `placeRow(); ensureView()` ran
 * full-document `[class*=]` queries per batch (substring selectors can't
 * ride the class index) — the main thread saturated permanently. These
 * tests drive the REAL mount through a fake DOM with injectable
 * MutationObserver/rAF faces and pin the three gates: the hot path never
 * queries, healing coalesces to one frame, and dispose cancels scheduled
 * heals (no zombie row re-insertion).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mountStudyShell, needsHeal } from '../src/client/shell-entry.ts'

/* ── a minimal faithful fake DOM: only the selector grammar shell-entry
   actually uses (comma arms of [attr], [attr="v"], [class*="v"], and
   tag[class*="v"]) plus the child-list mutations placeRow performs. ── */

class FakeElement {
  tagName: string
  ownerDoc: FakeDoc
  attrs = new Map<string, string>()
  children: FakeElement[] = []
  parentElement: FakeElement | null = null
  className = ''
  innerHTML = ''
  dataset: Record<string, string> = {}
  type = ''

  constructor(tag: string, doc: FakeDoc) {
    this.tagName = tag.toUpperCase()
    this.ownerDoc = doc
  }

  setAttribute(k: string, v: string): void { this.attrs.set(k, v) }
  getAttribute(k: string): string | null { return this.attrs.get(k) ?? null }
  removeAttribute(k: string): void { this.attrs.delete(k) }
  addEventListener(): void { /* not exercised here */ }
  removeEventListener(): void { /* not exercised here */ }

  appendChild(el: FakeElement): FakeElement {
    el.parentElement?.removeOwn(el)
    this.children.push(el)
    el.parentElement = this
    return el
  }

  insertBefore(el: FakeElement, anchor: FakeElement | null): FakeElement {
    el.parentElement?.removeOwn(el)
    if (anchor === null || anchor.parentElement !== this) this.children.push(el)
    else this.children.splice(this.children.indexOf(anchor), 0, el)
    el.parentElement = this
    return el
  }

  private removeOwn(el: FakeElement): void {
    const i = this.children.indexOf(el)
    if (i >= 0) this.children.splice(i, 1)
  }

  remove(): void {
    this.parentElement?.removeOwn(this)
    this.parentElement = null
  }

  get isConnected(): boolean {
    let top: FakeElement = this
    while (top.parentElement !== null) top = top.parentElement
    return top === this.ownerDoc.documentElement
  }

  get firstElementChild(): FakeElement | null { return this.children[0] ?? null }

  get nextElementSibling(): FakeElement | null {
    const sibs = this.parentElement?.children
    if (sibs === undefined) return null
    const i = sibs.indexOf(this)
    return i >= 0 ? sibs[i + 1] ?? null : null
  }

  matches(selector: string): boolean {
    return selector.split(',').some(arm => this.matchesArm(arm.trim()))
  }

  private matchesArm(arm: string): boolean {
    const bracket = arm.indexOf('[')
    const tag = bracket > 0 ? arm.slice(0, bracket) : ''
    if (tag !== '' && tag.toUpperCase() !== this.tagName) return false
    const clauses = arm.match(/\[[^\]]+\]/g) ?? []
    return clauses.every(c => {
      const body = c.slice(1, -1)
      const m = /^([a-zA-Z-]+)(\*)?="([^"]*)"$/.exec(body) ?? /^([a-zA-Z-]+)$/.exec(body)
      if (m === null) return false
      const [, name, op, value] = m as unknown as [string, string, string | undefined, string | undefined]
      if (op === '*') {
        if (name !== 'class') return false
        return this.className.includes(value ?? '')
      }
      if (value === undefined) return this.attrs.has(name)
      return this.attrs.get(name) === value
    })
  }

  querySelector(selector: string): FakeElement | null {
    const queue = [...this.children]
    while (queue.length > 0) {
      const el = queue.shift()!
      if (el.matches(selector)) return el
      queue.push(...el.children)
    }
    return null
  }

  closest(selector: string): FakeElement | null {
    let cur: FakeElement | null = this
    while (cur !== null) {
      if (cur.matches(selector)) return cur
      cur = cur.parentElement
    }
    return null
  }
}

class FakeDoc {
  documentElement: FakeElement
  body: FakeElement
  queryCount = 0

  constructor() {
    this.documentElement = new FakeElement('html', this)
    this.body = new FakeElement('body', this)
    this.documentElement.appendChild(this.body)
  }

  createElement(tag: string): FakeElement { return new FakeElement(tag, this) }

  querySelector(selector: string): FakeElement | null {
    this.queryCount++
    return this.documentElement.querySelector(selector)
  }

  addEventListener(): void { /* not exercised here */ }
  removeEventListener(): void { /* not exercised here */ }
}

/** A manually-flushed rAF queue — the coalescing proof rides on it. */
class FakeRaf {
  pending: Array<{ id: number, cb: () => void }> = []
  private next = 1
  request = (cb: () => void): number => {
    const id = this.next++
    this.pending.push({ id, cb })
    return id
  }
  cancel = (id: number): void => { this.pending = this.pending.filter(p => p.id !== id) }
  flush(): void {
    const queued = this.pending
    this.pending = []
    for (const p of queued) p.cb()
  }
}

class FakeMutationObserver {
  static instances: FakeMutationObserver[] = []
  callback: () => void
  observing = false
  disconnected = false

  constructor(callback: () => void) {
    this.callback = callback
    FakeMutationObserver.instances.push(this)
  }
  observe(_t: unknown, _o: unknown): void { this.observing = true }
  disconnect(): void { this.disconnected = true }
  /** simulate one delivered mutation batch */
  fire(): void { if (!this.disconnected) this.callback() }
}

interface Env {
  doc: FakeDoc
  raf: FakeRaf
  row: () => FakeElement
  view: () => FakeElement | null
  mount(): { dispose(): void }
}

function makeEnv(): Env {
  const doc = new FakeDoc()
  const raf = new FakeRaf()
  // the host shell: sidebar column (logoRow + newSession button + list) and
  // the center conversation column.
  const sidebar = doc.createElement('div')
  sidebar.setAttribute('data-pane', 'sidebar')
  doc.body.appendChild(sidebar)
  const root = doc.createElement('div')
  sidebar.appendChild(root)
  const logoRow = doc.createElement('div')
  logoRow.className = 'logoRow_x7'
  root.appendChild(logoRow)
  const newSession = doc.createElement('button')
  newSession.className = 'newSession_abc'
  logoRow.appendChild(newSession)
  root.appendChild(doc.createElement('div')) // the sessions list (insert anchor)
  const center = doc.createElement('div')
  center.setAttribute('data-pane', 'conversation')
  doc.body.appendChild(center)

  const rootsCreated: FakeElement[] = []
  const mount = () => mountStudyShell(() => null, () => '学习', {
    doc: doc as unknown as Document,
    createRoot: (el: HTMLElement) => {
      rootsCreated.push(el as unknown as FakeElement)
      return { render: () => {}, unmount: () => {} }
    },
    MutationObserver: FakeMutationObserver as unknown as new (cb: () => void) => { observe(t: Node, o: unknown): void; disconnect(): void },
    requestAnimationFrame: raf.request,
    cancelAnimationFrame: raf.cancel,
  })
  return {
    doc, raf, mount,
    row: () => doc.documentElement.querySelector('[data-dsh-lookatstudy-entry]')!,
    view: () => rootsCreated[0] ?? null,
  }
}

test('needsHeal: only a detached row or an unmounted view asks for work', () => {
  assert.equal(needsHeal(true, true), false, 'the settled mount is the hot no-op path')
  assert.equal(needsHeal(false, true), true, 'a detached row heals')
  assert.equal(needsHeal(true, false), true, 'a missing view mounts')
  assert.equal(needsHeal(false, false), true)
})

test('issue #17: a mutation storm on a settled mount never touches querySelector', () => {
  const env = makeEnv()
  const handle = env.mount()
  const obs = FakeMutationObserver.instances.at(-1)!
  assert.ok(obs.observing, 'the body observer is wired')
  assert.ok(env.row().isConnected, 'sanity: the entry row placed at mount')
  assert.ok(env.view() !== null, 'sanity: the view container mounted')

  // THE regression: the storm of a 1000-event history render. The old code
  // ran placeRow()+ensureView() per batch — two full-document [class*=]
  // queries against the largest the document ever gets.
  env.doc.queryCount = 0
  for (let i = 0; i < 500; i++) obs.fire()
  assert.equal(env.doc.queryCount, 0, 'hot path: zero document-wide queries across the storm')
  assert.equal(rafPendingCount(env), 0, 'the gate returns before scheduling any heal')

  handle.dispose()
  assert.ok(obs.disconnected, 'dispose disconnects the observer')
})

test('issue #17: self-heal still re-places a detached row, coalesced to one frame', () => {
  const env = makeEnv()
  const handle = env.mount()
  const obs = FakeMutationObserver.instances.at(-1)!
  const row = env.row()

  row.remove() // a host re-render swallowed the row
  env.doc.queryCount = 0
  obs.fire(); obs.fire(); obs.fire()
  assert.equal(rafPendingCount(env), 1, 'three batches coalesce into ONE heal')
  assert.equal(env.doc.queryCount, 0, 'the callback itself stays query-free — work happens in the frame')
  env.raf.flush()
  assert.ok(row.isConnected, 'the row re-placed on the next frame')

  // the known-column memo: a SECOND heal (same surviving sidebar column)
  // must not fall back to the document-wide query either.
  row.remove()
  env.doc.queryCount = 0
  obs.fire()
  env.raf.flush()
  assert.ok(row.isConnected, 'second heal re-places again')
  assert.equal(env.doc.queryCount, 0, 'the connected known column satisfies the lookup without a document query')

  handle.dispose()
})

test('issue #17: dispose cancels a scheduled heal — no zombie row re-insertion', () => {
  const env = makeEnv()
  const handle = env.mount()
  const obs = FakeMutationObserver.instances.at(-1)!
  const row = env.row()

  row.remove()
  obs.fire()
  assert.equal(rafPendingCount(env), 1, 'a heal is scheduled')
  handle.dispose() // BEFORE the frame lands
  env.raf.flush()
  assert.ok(!row.isConnected, 'the canceled heal never re-inserts the row')
  assert.equal(rafPendingCount(env), 0)
})

test('issue #17: a rebuilt sidebar column falls back to the document query and re-places', () => {
  const env = makeEnv()
  const handle = env.mount()
  const obs = FakeMutationObserver.instances.at(-1)!
  const row = env.row()

  // the host tore the whole sidebar down (knownColumn dies with it) and
  // re-rendered a fresh column — the memo must MISS and pay the scoped
  // document query once, then heal into the new structure.
  const oldSidebar = env.doc.body.children.find(c => c.getAttribute('data-pane') === 'sidebar')!
  oldSidebar.remove()
  const sidebar2 = env.doc.createElement('div')
  sidebar2.setAttribute('data-pane', 'sidebar')
  env.doc.body.appendChild(sidebar2)
  const root2 = env.doc.createElement('div')
  sidebar2.appendChild(root2)
  const logoRow2 = env.doc.createElement('div')
  logoRow2.className = 'logoRow_x7'
  root2.appendChild(logoRow2)
  const newSession2 = env.doc.createElement('button')
  newSession2.className = 'newSession_abc'
  logoRow2.appendChild(newSession2)
  root2.appendChild(env.doc.createElement('div'))

  env.doc.queryCount = 0
  obs.fire()
  env.raf.flush()
  assert.ok(row.isConnected, 'the row found the rebuilt column')
  assert.ok(env.doc.queryCount > 0, 'the dead memo falls back to the document-wide query exactly here')

  handle.dispose()
})

function rafPendingCount(env: Env): number {
  return env.raf.pending.length
}

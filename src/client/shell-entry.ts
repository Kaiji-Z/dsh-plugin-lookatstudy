/**
 * The study shell entry — the panel-entry doctrine, stardeck-style: the study
 * surface is CROSS-WORKSPACE (plugin state is workspace-independent by
 * design), so it enters through a sidebar row and takes over the center
 * column, never living inside one conversation. The conversation slot family
 * is single-occupant and external plugins cannot declare shell slots, so both
 * the row and the view are DOM-level: a plain-DOM button (never disturbs the
 * shell's reconciliation) + a container appended to the center column as an
 * extra trailing child React never manages. Visibility toggles via an <html>
 * data attribute; sibling panels evict each other through the dsh-panel-activate
 * event.
 *
 * Differences from stardeck's original: our own attribute namespace, a
 * hand-back SUPPRESSION hook (the panel itself calls sessions.open to stage
 * the focus lesson's thread — an internal navigation must not close the
 * panel; only USER session navigation hands the column back), and dsw-token
 * styling via the injected stylesheet.
 * @module dsh-plugin-lookatstudy/client/shell-entry
 */

import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { ReactNode } from 'react'

const ROW_ATTRIBUTE = 'data-dsh-lookatstudy-entry'
const ROW_SELECTOR = `[${ROW_ATTRIBUTE}]`
const VIEW_ATTRIBUTE = 'data-dsh-lookatstudy-view'
const ACTIVE_ATTR = 'data-dsh-lookatstudy-active'
/** Sibling panels' activation attributes, evicted when the study panel opens. */
const OTHER_ACTIVE_ATTRS = ['data-dsh-warroom-active', 'data-dsh-taskboard-active', 'data-dsh-ssh-active'] as const
/** Cross-plugin activation event; detail is the activating panel name. */
const ACTIVATE_EVENT = 'dsh-panel-activate'
const PANEL_NAME = 'lookatstudy'
/** Family rows we order against (the sibling-panel entry block). */
const FAMILY_SELECTORS = ['[data-dsh-warroom-entry]', '[data-dsh-ssh-entry]', '[data-dsh-taskboard-entry]', ROW_SELECTOR] as const

const SIDEBAR_COLUMN_SELECTOR = '[data-pane="sidebar"], [class*="sidebarCol"]'
const CENTER_COLUMN_SELECTOR = '[data-pane="conversation"], [class*="centerCol"]'

/** Minimal mounting face (injectable for tests). */
interface SidebarMountDeps {
  createRoot(container: HTMLElement): { render(node: ReactNode): void; unmount(): void }
  doc?: Document
}

/** The host session list: current-session changes are the hand-back trigger. */
interface SessionListFace {
  list?: {
    getSnapshot(): { current?: unknown }
    subscribe(listener: () => void): () => void
  }
}

/** The open/close state shared by the sidebar row and the view. */
class ShellOpenState {
  private open = false
  private readonly listeners = new Set<() => void>()
  isOpen(): boolean { return this.open }
  setOpen(next: boolean): void {
    if (this.open === next) return
    this.open = next
    for (const l of this.listeners) l()
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
}

function sidebarRoot(doc: Document): HTMLElement | undefined {
  const column = doc.querySelector<HTMLElement>(SIDEBAR_COLUMN_SELECTOR)
  if (column === null) return undefined
  const logoOwner = column.querySelector<HTMLElement>('[class*="logoRow"]')?.parentElement
  return logoOwner ?? (column.firstElementChild as HTMLElement | undefined)
}

function newSessionButton(root: HTMLElement): HTMLButtonElement | undefined {
  const nested = root.querySelector<HTMLButtonElement>('button[class*="newSession"]')
  if (nested !== null) return nested
  for (const child of root.children) {
    if (child.tagName === 'BUTTON') return child as HTMLButtonElement
  }
  return undefined
}

/** A 16px study glyph: an open book with a mastery spark. */
const STUDY_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 3.2C3.2 2.4 4.9 2.2 8 3.4c3.1-1.2 4.8-1 6-.2v9.2c-1.2-.8-2.9-1-6 .2-3.1-1.2-4.8-1-6-.2V3.2z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M8 3.4v9.2" stroke="currentColor" stroke-width="1.2"/></svg>'

/** The shell surface handle: dispose unmounts everything, close yields the
 * center column back, suppressHandBack wraps internal session opens. */
export interface StudyShellHandle {
  dispose(): void
  close(): void
  /** Run `fn` without the session-change hand-back firing (internal opens). */
  suppressHandBack(fn: () => void): void
}

/**
 * Mount the study shell surface: sidebar row + center-column panel.
 * @param view - the panel COMPONENT (an element factory, e.g. studyPanelView(services)).
 * @param label - the entry label (locale-aware getter, re-read on paints).
 * @param dom - the DOM mounting faces (injectable for tests).
 * @param sessions - the host session list; USER navigation between sessions
 *   hands the center column back (closes the panel). Hydration (the first
 *   current arriving) and suppressed internal opens do not count.
 */
export function mountStudyShell(
  view: () => ReactNode,
  label: () => string,
  dom?: SidebarMountDeps,
  sessions?: SessionListFace,
): StudyShellHandle {
  if (typeof document === 'undefined') {
    return { dispose: () => {}, close: () => {}, suppressHandBack: (fn) => { fn() } }
  }
  const doc = dom?.doc ?? document
  // DOM-level idempotency: an HMR re-injection must not double-mount.
  if (doc.querySelector(ROW_SELECTOR) !== null) {
    return { dispose: () => {}, close: () => {}, suppressHandBack: (fn) => { fn() } }
  }

  const state = new ShellOpenState()
  let suppressed = false

  // --- Sidebar row -------------------------------------------------------
  const row = doc.createElement('button')
  row.type = 'button'
  row.setAttribute(ROW_ATTRIBUTE, '')
  row.setAttribute('data-dsh-plugin', 'lookatstudy')
  row.setAttribute('data-dsh-part', 'sidebar-entry')
  row.className = 'lks14-sidebar-row'
  const paintRow = (): void => {
    const text = label()
    row.setAttribute('aria-label', text)
    row.setAttribute('title', text)
    row.innerHTML = `<span class="lks14-sidebar-icon">${STUDY_ICON}</span><span class="lks14-sidebar-label">${text}</span>`
  }
  paintRow()
  row.addEventListener('click', () => state.setOpen(!state.isOpen()))

  const placeRow = (): boolean => {
    const root = sidebarRoot(doc)
    if (root === undefined) return false
    const button = newSessionButton(root)
    if (button === undefined) return false
    if (row.parentElement !== root) {
      const logoRow = button.closest('[class*="logoRow"]')
      const base = (logoRow !== null && logoRow.parentElement === root) ? logoRow : button
      const family = Array.from(root.children).filter(
        el => el instanceof HTMLElement && (el as HTMLElement).matches(FAMILY_SELECTORS.join(', ')),
      )
      const anchor = family.length > 0 ? family[family.length - 1]!.nextElementSibling : base.nextElementSibling
      root.insertBefore(row, anchor)
    }
    return true
  }

  // --- Center-column view ------------------------------------------------
  let container: HTMLElement | undefined
  let root: { render(node: ReactNode): void; unmount(): void } | undefined
  const roots = dom ?? { createRoot: (el: HTMLElement) => createRoot(el) }
  const ensureView = (): void => {
    if (container !== undefined) return
    const column = doc.querySelector<HTMLElement>(CENTER_COLUMN_SELECTOR)
    if (column === null) return
    container = doc.createElement('div')
    container.setAttribute(VIEW_ATTRIBUTE, '')
    container.setAttribute('data-dsh-plugin', 'lookatstudy')
    container.className = 'lks14-shell-view'
    column.appendChild(container)
    root = roots.createRoot(container)
    root.render(createElement(view))
  }

  // --- Visibility + sibling-panel mutual exclusion -----------------------
  const applyActive = (): void => {
    if (state.isOpen()) {
      for (const attr of OTHER_ACTIVE_ATTRS) doc.documentElement.removeAttribute(attr)
      doc.documentElement.setAttribute(ACTIVE_ATTR, '')
      doc.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: PANEL_NAME }))
    } else {
      doc.documentElement.removeAttribute(ACTIVE_ATTR)
    }
    if (state.isOpen()) row.dataset.active = 'true'
    else delete row.dataset.active
  }
  const onOtherActivate = (event: Event): void => {
    const detail = (event as CustomEvent).detail
    if (detail !== PANEL_NAME) state.setOpen(false)
  }
  // Sidebar context clicks hand the center column back to the conversation
  // (capture phase: close before the shell processes the click).
  const SIDEBAR_ROW_SELECTOR = '[class*="sessionRow"], [class*="projectRow"], [class*="searchResultRow"], [class*="searchResultWorkspace"], [class*="newSession"]'
  const onClickSidebarRow = (event: MouseEvent): void => {
    if (!state.isOpen()) return
    const target = event.target as HTMLElement | null
    if (target === null) return
    if (target.closest(SIDEBAR_ROW_SELECTOR) !== null) state.setOpen(false)
  }

  const bodyObserver = new MutationObserver(() => { placeRow(); ensureView() })
  bodyObserver.observe(doc.body, { childList: true, subtree: true })
  doc.addEventListener('click', onClickSidebarRow, true)
  doc.addEventListener(ACTIVATE_EVENT, onOtherActivate)
  // USER session navigation hands the center column back to the conversation
  // (the panel's own sessions.open runs under suppressHandBack, and the
  // hydration flip — undefined → first current — is not a navigation).
  let unsubscribeSessions: (() => void) | undefined
  if (sessions?.list !== undefined) {
    let lastCurrent = sessions.list.getSnapshot().current
    unsubscribeSessions = sessions.list.subscribe(() => {
      const next = sessions.list!.getSnapshot().current
      if (next === lastCurrent) return
      const wasHydration = lastCurrent === undefined
      lastCurrent = next
      if (shouldHandBack(suppressed, wasHydration)) state.setOpen(false)
    })
  }
  const unsubscribe = state.subscribe(applyActive)
  placeRow()
  ensureView()
  applyActive()

  return {
    close: () => state.setOpen(false),
    /** Internal session navigation (staging the lesson thread) must not hand
     * the column back — only USER navigation does. */
    suppressHandBack: (fn: () => void): void => {
      suppressed = true
      try { fn() } finally { suppressed = false }
    },
    dispose: () => {
      bodyObserver.disconnect()
      doc.removeEventListener('click', onClickSidebarRow, true)
      doc.removeEventListener(ACTIVATE_EVENT, onOtherActivate)
      unsubscribeSessions?.()
      unsubscribe()
      root?.unmount()
      container?.remove()
      row.remove()
    },
  }
}

/** Whether a session change should hand the center column back (suppressible). */
export function shouldHandBack(suppressed: boolean, wasHydration: boolean): boolean {
  return !suppressed && !wasHydration
}

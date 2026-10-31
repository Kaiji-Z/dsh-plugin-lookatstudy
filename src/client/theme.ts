/**
 * P16: the panel's theme follows the HOST's theme switch. Primary signal is
 * the framework theme service (`ctx.theme`, theme/change snapshots —
 * preference light|dark|system); the DOM fallback (body[data-ds-dark-theme]
 * + html color-scheme) covers deployments without the service. `system`
 * resolves through prefers-color-scheme. The resolved value lands on the
 * panel root as data-lks-theme, which the upstream skin's light override
 * block keys off; the host-chrome surfaces (settings/dock/toolviews) already
 * ride the host's own --dsw tokens and need nothing here.
 * @module dsh-plugin-lookatstudy/client/theme
 */

import type { ClientContext } from './faces.ts'

export type PanelTheme = 'light' | 'dark'

/** Pure: resolve the host's preference into the panel's theme. */
export function hostPanelTheme(preference: string | undefined, prefersLight: boolean): PanelTheme {
  if (preference === 'light' || preference === 'dark') return preference
  return prefersLight ? 'light' : 'dark'
}

let current: PanelTheme = 'dark'
const listeners = new Set<() => void>()

export function panelTheme(): PanelTheme {
  return current
}

function setPanelTheme(next: PanelTheme): void {
  if (next === current) return
  current = next
  for (const l of listeners) l()
}

export function subscribePanelTheme(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/* ── issue #16: the opt-in ecosystem-theme hook ──
 * When on, the panel root carries data-lks-follow-host='on' and the upstream
 * skin's neutral ladder (surfaces/ink/borders) resolves through the host
 * --dsw-alias-* platform tokens — the tokens theme plugins such as
 * dsh-markdown-xyy override — so those themes recolor the study panel too.
 * Default OFF: the stock host defines the aliases itself, so wiring them
 * unconditionally would replace the upstream-verbatim palette with the host
 * chrome palette on every install. Brand and semantic hues never bridge (the
 * panel keeps its own identity). Browser-local preference, like the TTS
 * voice. */
const FOLLOW_HOST_KEY = 'dsh-plugin-lookatstudy:follow-host-theme'

function readStoredFollowHost(): boolean {
  try {
    return (typeof localStorage === 'undefined' ? null : localStorage.getItem(FOLLOW_HOST_KEY)) === 'on'
  } catch {
    return false
  }
}

let followHost = readStoredFollowHost()
const followListeners = new Set<() => void>()

export function followHostTheme(): boolean {
  return followHost
}

export function setFollowHostTheme(on: boolean): void {
  if (on === followHost) return
  followHost = on
  try {
    if (typeof localStorage !== 'undefined') {
      if (on) localStorage.setItem(FOLLOW_HOST_KEY, 'on')
      else localStorage.removeItem(FOLLOW_HOST_KEY)
    }
  } catch { /* private mode &c. — the session value still applies */ }
  for (const l of followListeners) l()
}

export function subscribeFollowHostTheme(listener: () => void): () => void {
  followListeners.add(listener)
  return () => { followListeners.delete(listener) }
}

/**
 * Wire the follow machinery (idempotent): the theme service when present,
 * otherwise the DOM-signal observer. Returns a disposer.
 */
export function wirePanelTheme(ctx: ClientContext): () => void {
  // DOM-primary (live P16 catch): the presenter rewrites body[data-ds-dark-theme]
  // + html{color-scheme} on EVERY theme application (boot pre-paint, settings
  // resolution, mid-session flips, system-media changes) — the MutationObservers
  // see them all. The service path (theme/change snapshots) misordered against
  // the async settings load in live boots (panel stranded light on a dark host,
  // non-deterministic by plugin order), so it only nudges a re-read here; the
  // DOM signals stay the source of truth.
  if (typeof document === 'undefined') return () => {}
  const readDom = (): void => {
    const body = document.body
    if (body === null) return
    const dark = body.hasAttribute('data-ds-dark-theme')
      || /dark/i.test(document.documentElement.style.colorScheme ?? '')
    setPanelTheme(dark ? 'dark' : 'light')
  }
  readDom()
  const obs = new MutationObserver(readDom)
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] })
  const bodyObs = new MutationObserver(readDom)
  const attachBody = (): void => {
    if (document.body === null) { requestAnimationFrame(attachBody); return }
    bodyObs.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
    readDom()
  }
  attachBody()
  // boot-order hardening (live P18 catch): the host presenter's theme
  // application is order-nondeterministic against plugin apply — a dark
  // application landing in the read-then-observe gap strands the panel light
  // with no later mutation to wake it. One delayed re-read closes the gap;
  // mid-session flips stay on the observers.
  const settle = setTimeout(readDom, 600)
  // service nudges: any snapshot change → re-read the DOM the presenter just
  // wrote (order-independent: if the event races ahead of the presenter, the
  // observers still catch the attrs).
  const off = (ctx as unknown as { on?: (event: string, cb: () => void) => (() => void) | void }).on?.('theme/change', () => {
    requestAnimationFrame(readDom)
  })
  return () => { clearTimeout(settle); obs.disconnect(); bodyObs.disconnect(); off?.() }
}

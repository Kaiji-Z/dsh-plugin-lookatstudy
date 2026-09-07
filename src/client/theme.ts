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
  // service nudges: any snapshot change → re-read the DOM the presenter just
  // wrote (order-independent: if the event races ahead of the presenter, the
  // observers still catch the attrs).
  const off = (ctx as unknown as { on?: (event: string, cb: () => void) => (() => void) | void }).on?.('theme/change', () => {
    requestAnimationFrame(readDom)
  })
  return () => { obs.disconnect(); bodyObs.disconnect(); off?.() }
}

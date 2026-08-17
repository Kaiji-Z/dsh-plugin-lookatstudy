/**
 * dsh-plugin-lookatstudy — turn any markdown, local folder, or GitHub learning
 * repo into a guided course inside DeepSeek Harness. Registers the `study_*`
 * tool surface (ported from LookatStudy's agent contract), a stable tutor
 * persona plus a switchable soul section, and a dynamic learner-snapshot
 * context — all activation-gated: dormant installs expose none of it until
 * the learner clicks 开始学习. Learning state persists in one JSON file
 * shared across sessions.
 * @module dsh-plugin-lookatstudy
 */

import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { Config } from './config.ts'
import { registerDashboard } from './dashboard.ts'
import { createStudySurface, snapshotSectionText, soulText, tutorCoreText } from './surface.ts'
import { loadState, resolveStatePath, saveState } from './state.ts'

export const name = 'lookatstudy-plugin'
export const inject = ['tools', 'systemPrompt']

/**
 * Register the activation-gated study surface: the 20 `study_*` tools (kept
 * unregistered while dormant), the tutor persona (stable core + soul), and
 * the dynamic learner-snapshot context — every prompt text renders empty
 * while inactive, and empty sections are dropped at assembly.
 * @param ctx - plugin context carrying the tool registry and system prompt.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const statePath = resolveStatePath(config.statePath)
  const fresh = !existsSync(statePath)
  const state = loadState(statePath)
  // Config seeds the initial soul; afterwards the persisted choice (switchable
  // via study_set_mode) wins.
  if (fresh) state.mode = config.mode
  // Boot-time operator override (headless compositions have no dashboard
  // route to click); 'auto' — the default — leaves the persisted choice.
  if (config.active !== 'auto') state.active = config.active === 'on'
  const store = {
    get: () => state,
    save: () => saveState(statePath, state),
  }
  const surface = createStudySurface(ctx.tools, store)
  surface.sync()
  ctx.effect(() => () => surface.dispose(), 'lookatstudy.studySurface()')
  ctx.systemPrompt.section({
    name: 'lookatstudy:tutor-core',
    order: 120,
    text: () => tutorCoreText(store.get()),
  })
  ctx.systemPrompt.section({
    name: 'lookatstudy:soul',
    order: 121,
    text: () => soulText(store.get()),
  })
  ctx.systemPrompt.context({
    name: 'lookatstudy:learner-snapshot',
    order: 50,
    text: () => snapshotSectionText(store.get()),
  })
  // The study tab's HTTP API and its dedicated workspace directory exist only
  // in compositions carrying a webserver (web profile); headless assemblies
  // keep the plain tool surface.
  ctx.inject(['webServer'], (webCtx) => {
    // The one-click starter's dedicated workspace directory: a sibling of the
    // state file, created eagerly so the client can adopt it as a workspace.
    const studyAreaPath = join(dirname(statePath), 'study-area')
    mkdirSync(studyAreaPath, { recursive: true })
    const disposeDashboard = registerDashboard(webCtx.webServer, { store, studyAreaPath, onActiveChange: surface.sync })
    webCtx.effect(() => disposeDashboard, 'lookatstudy.dashboard()')
  })
}

export { Config }

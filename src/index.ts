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
import { registerStudyCommand, type CommandsServiceFace } from './commands.ts'
import { createStudySurface, snapshotSectionText, soulText, tutorCoreText } from './surface.ts'
import { loadState, resolveStatePath, saveState } from './state.ts'

export const name = 'lookatstudy-plugin'
export const inject = ['tools', 'systemPrompt']

/**
 * Register the activation-gated study surface: the 25 `study_*` tools (kept
 * unregistered while dormant), the tutor persona (stable core + soul), the
 * dynamic learner-snapshot context, and the `/study` command — every prompt
 * text renders empty while inactive, and empty sections are dropped at
 * assembly.
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
  // `/study` — the keyboard/headless discovery path. Compositions without a
  // command adapter (none today) simply skip it.
  ctx.inject(['commands'], (cmdCtx) => {
    const disposeCommand = registerStudyCommand((cmdCtx as unknown as { commands: CommandsServiceFace }).commands, {
      store,
      onActiveChange: surface.sync,
    })
    cmdCtx.effect(() => disposeCommand, 'lookatstudy.studyCommand()')
  })
  // E1: the tutor model's REAL context capacity, host-side — the composition's
  // default model resolved through the host's model runtime (the catalog's
  // provider-owned value, not a plugin constant). The faces are reached the
  // only way a plugin scope can reach host services — a runtime inject — and
  // compositions without them keep the resolver null (the meter degrades to
  // the session projection / the labeled estimate).
  type HostModelInfo = { id: string; provider: string; contextWindow: number | null }
  let resolveModelInfo: (() => Promise<HostModelInfo | null>) | null = null
  ctx.inject(['agentDefaultModel', 'llm'], (modelCtx) => {
    const faces = modelCtx as {
      agentDefaultModel: { currentSelection(): { provider: string; model: string } }
      llm: { resolveModelInfo(provider: string, model: string): Promise<{ id: string; context?: { contextWindow?: number } }> }
    }
    resolveModelInfo = async (): Promise<HostModelInfo | null> => {
      try {
        const selection = faces.agentDefaultModel.currentSelection()
        const info = await faces.llm.resolveModelInfo(selection.provider, selection.model)
        return { id: info.id, provider: selection.provider, contextWindow: info.context?.contextWindow ?? null }
      } catch { return null }
    }
  })
  const modelInfo = async (): Promise<HostModelInfo | null> => resolveModelInfo === null ? null : resolveModelInfo()
  // The study tab's HTTP API and its dedicated workspace directory exist only
  // in compositions carrying a webserver (web profile); headless assemblies
  // keep the plain tool surface.
  ctx.inject(['webServer'], (webCtx) => {
    // The one-click starter's dedicated workspace directory: a sibling of the
    // state file, created eagerly so the client can adopt it as a workspace.
    const studyAreaPath = join(dirname(statePath), 'study-area')
    mkdirSync(studyAreaPath, { recursive: true })
    const disposeDashboard = registerDashboard(webCtx.webServer, { store, studyAreaPath, statePath, onActiveChange: surface.sync, modelInfo })
    webCtx.effect(() => disposeDashboard, 'lookatstudy.dashboard()')
  })
}

export { Config }

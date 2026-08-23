/**
 * The `/study` slash command (host side): the keyboard/headless discovery
 * path into the study surface. Bare `/study` activates a dormant install and
 * queues the same kickoff prompt the hero button sends; `/study <text>`
 * queues that text as the learning request. Activation follows the exact
 * dashboard route's semantics (persist + tool-registry sync BEFORE the
 * prompt lands), so the model the prompt meets can already call the tools.
 *
 * Structural slices of the harness command contract keep this module free of
 * a new peer dependency; `agent.followup` is the model-visible user-message
 * path (the /goal command's attachment precedent).
 * @module dsh-plugin-lookatstudy/commands
 */

import { ZH } from './client/locale.ts'
import type { DashboardStore } from './dashboard.ts'

/** Structural `CommandInvocation` (the fields this handler consumes). */
export interface CommandInvocationFace {
  readonly agent: { followup(message: unknown): void }
  readonly rawInput: string
}

/** Structural `CommandResult`. */
export type CommandResultFace =
  | { readonly kind: 'success'; readonly text?: string }
  | { readonly kind: 'error'; readonly text: string }

/** Structural slice of the harness `commands` service. */
export interface CommandsServiceFace {
  register(definition: {
    readonly name: string
    readonly description: string
    readonly input?: { readonly hint: string }
    readonly handler: (invocation: CommandInvocationFace) => CommandResultFace | Promise<CommandResultFace>
  }): () => void
}

/** Wiring shared with the dashboard routes. */
export interface StudyCommandDeps {
  store: DashboardStore
  /** Applies an activation flip to the host surface (tool registry sync). */
  onActiveChange: (active: boolean) => void
}

/** Build one identified user message (createUserMessage's structural twin: uuid + freeze). */
function userMessage(text: string): { id: string; role: 'user'; content: Array<{ type: 'text'; text: string }>; source: { kind: 'plugin'; plugin: string } } {
  const content = Object.freeze([{ type: 'text', text }]) as Array<{ type: 'text'; text: string }>
  return Object.freeze({
    id: crypto.randomUUID(),
    role: 'user',
    content,
    source: Object.freeze({ kind: 'plugin', plugin: 'dsh-plugin-lookatstudy' }),
  })
}

/** The model-facing kickoff (the hero button's prompt; the tutor replies in the learner's own language). */
export function studyKickoffPrompt(): string {
  return ZH['prompt.kickoff']!
}

/** Execute `/study [<text>]` against the live store. Pure over the deps; no HTTP. */
export function executeStudyCommand(deps: StudyCommandDeps, invocation: CommandInvocationFace): CommandResultFace {
  const state = deps.store.get()
  if (!state.active) {
    state.active = true
    deps.store.save()
    // Same ordering guarantee as the dashboard's POST /api/active: the tools
    // exist before the queued prompt reaches the model.
    deps.onActiveChange(true)
  }
  const text = invocation.rawInput.trim() === '' ? studyKickoffPrompt() : invocation.rawInput.trim()
  invocation.agent.followup(userMessage(text))
  return { kind: 'success', text: '学习模式已就位 — 回复马上开始;点上方「学习」页签进入学习界面 / Study mode is on — open the Study tab above for the study UI.' }
}

/**
 * Register `/study` on the harness command runtime (global scope).
 * @param commands - the host `commands` service.
 * @param deps - the shared store wiring.
 * @returns the registration disposer.
 */
export function registerStudyCommand(commands: CommandsServiceFace, deps: StudyCommandDeps): () => void {
  return commands.register({
    name: 'study',
    description: 'start (or resume) a guided study session — activates the tutor and queues the kickoff prompt',
    input: { hint: '[<learning request>]' },
    handler: invocation => executeStudyCommand(deps, invocation),
  })
}

/**
 * Structural faces of the host client services the panel consumes.
 *
 * The harness client packages were restructured after 0.1.2 (dsh-client-runtime
 * dissolved; the conversation transcript split into a per-view Chat target and
 * finally into per-session event windows), so the plugin types the surface it
 * needs locally and never imports host packages. Since 0.14.0 the panel talks
 * to the host purely through the session face (prompt) and the event window
 * (transcript) — the host is the conversation-model + agent-turn engine.
 * @module dsh-plugin-lookatstudy/client/faces
 */

import type { Context } from '@deepseek-ai/cordis'
import type { LocaleServiceFace } from './locale.ts'

/** The per-session prompt face reached through sessions.scope + sessionOf. */
export interface SessionPromptFace {
  prompt(parts: readonly { readonly type: 'text'; readonly text: string }[], mode: 'queue' | 'steer'): Promise<
    { ok: true } | { ok: false; error: { readonly code: string; readonly message: string } }
  >
  /** Cancel the running turn (C2 stop button) — present on host faces since rc.2. */
  cancel?(): Promise<
    { ok: true } | { ok: false; error: { readonly code: string; readonly message: string } }
  >
}

/** The injected client root: cordis context plus the services the manifest pulls in. */
export type ClientContext = Context & {
  slots: {
    inject(name: string, register: () => (() => void) | void): void
    register(meta: Record<string, unknown>, component: (props: never) => unknown): () => void
  }
  workspaces: {
    create(options: { path: string }): Promise<{ workspaceId: string }>
  }
  sessions: {
    /** Create (or adopt) a session on the host — 0.1.3+; the panel's mint path. */
    create(options?: { workspaceId?: string }): Promise<string>
    binding(sessionId: string): unknown | undefined
    open(sessionId: string): void
    scope(sessionId: string): unknown | undefined
    sessionOf(actx: unknown): SessionPromptFace | undefined
    /** Session list + current selection (the hand-back trigger's source). */
    list?: {
      getSnapshot(): { current?: unknown }
      subscribe(listener: () => void): () => void
    }
  }
  locale?: LocaleServiceFace
}

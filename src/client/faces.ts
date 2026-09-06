/**
 * Structural faces of the host client services the plugin consumes.
 *
 * The harness client packages were restructured after 0.1.2 (dsh-client-runtime
 * dissolved; the conversation transcript split into a per-view Chat target with
 * the old node array surviving as `legacy`; `conversation.input.left` lost its
 * owner props), so the plugin types the surface it needs locally and falls
 * back across host generations at runtime instead of importing host types that
 * no longer hold on the hosts it runs against.
 * @module dsh-plugin-lookatstudy/client/faces
 */

import type { Context } from '@deepseek-ai/cordis'
import type { LocaleServiceFace } from './locale.ts'

/** One finalized conversation node — the structural subset transcriptRows folds. */
export interface TranscriptNode {
  readonly kind: string
  readonly seq: number
  readonly content?: readonly { readonly type: string; readonly text?: string }[]
  readonly blocks?: readonly { readonly kind: string; readonly text?: string }[]
  readonly message?: string
}

/** The in-flight assistant partial. */
export interface TranscriptPartial {
  readonly blocks?: readonly { readonly kind: string; readonly text?: string }[]
}

/**
 * What transcriptRows folds. Pre-0.1.3 hosts hand the conversation snapshot
 * itself (nodes + partial + sessionId); 0.1.3+ hosts expose the same pair as
 * the Chat target's `legacy` slice, so both shapes narrow to this face.
 */
export interface TranscriptSlice {
  readonly nodes?: readonly TranscriptNode[]
  readonly partial?: TranscriptPartial | null
  readonly sessionId?: string
}

/** The 0.1.3+ Chat target snapshot: the transcript lives under `legacy`. */
export interface ChatTargetSnapshot {
  readonly legacy?: TranscriptSlice
}

/** The 0.1.3+ session machine snapshot — where input.left's blank flag moved. */
export interface SessionMachineSnapshot {
  readonly blank?: boolean
}

/** The per-session prompt face reached through sessions.scope + sessionOf. */
export interface SessionPromptFace {
  prompt(parts: readonly { readonly type: 'text'; readonly text: string }[], mode: 'queue'): Promise<
    { ok: true } | { ok: false; error: { readonly code: string; readonly message: string } }
  >
}

/** Standard slot props the plugin reads, across host generations. The hooks are absent per host version, never per render, so optional calls keep hook order stable. */
export interface StudyViewProps {
  inputActions: {
    setDraft(text: string): void
    submit(): void
  }
  /** Current session identity (standard prop on every audited host). */
  sessionId?: string
  /** 0.1.3+: selector over the session's Chat target. */
  useChat?: (select: (s: ChatTargetSnapshot) => TranscriptSlice | undefined) => TranscriptSlice | undefined
  /** pre-0.1.3: selector over the conversation snapshot; 0.1.3+: the session machine. */
  useSession?: (select: (s: TranscriptSlice & SessionMachineSnapshot) => TranscriptSlice & SessionMachineSnapshot) => TranscriptSlice & SessionMachineSnapshot | undefined
}

/** Props of `conversation.input.left` entries across host generations. */
export interface StudyInputProps {
  /** pre-0.1.3 owner prop (InputZone); absent on 0.1.3+. */
  session?: { readonly blank?: boolean }
  /** 0.1.3+ session machine selector carrying the blank flag. */
  useSession?: (select: (s: SessionMachineSnapshot) => SessionMachineSnapshot) => SessionMachineSnapshot | undefined
}

/** The injected client root: cordis context plus the services the manifest pulls in. */
export type ClientContext = Context & {
  slots: {
    inject(name: string, register: () => (() => void) | void): void
    register(meta: Record<string, unknown>, component: (props: never) => unknown): () => void
  }
  workspaces: {
    create(options: { path: string }): Promise<{ workspaceId: string }>
    /** pre-0.1.3 mint path: connect a workspace and open a blank session in it. */
    connectWorkspace?(workspaceId: string): Promise<string>
  }
  sessions: {
    /** 0.1.3+ mint path: create (or adopt) a session on the host. */
    create(options?: { workspaceId?: string }): Promise<string>
    binding(sessionId: string): unknown | undefined
    open(sessionId: string): void
    scope(sessionId: string): unknown | undefined
    sessionOf(actx: unknown): SessionPromptFace | undefined
  }
  locale?: LocaleServiceFace
}

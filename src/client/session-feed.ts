/**
 * The panel tutor's chat stream: folds a bound session's event window (the
 * same feed the host conversation assembles) into chat rows — structurally,
 * with zero host imports, because the panel renders OUTSIDE the host's slot
 * system. Durable `user/message` / `assistant/message` events become rows;
 * tool calls stay in the host conversation's toolview cards (the study view
 * never mirrored them); transient `text-delta` live chunks accumulate into
 * one streaming row per attempt so the tutor's reply grows in place.
 * @module dsh-plugin-lookatstudy/client/session-feed
 */

import type { ChatRow } from './views.tsx'

/** Structural shapes of the host's event window (kept local — no host imports). */
export interface FeedEvent {
  readonly type: string
  readonly seq: number
  readonly data?: {
    readonly content?: readonly { readonly type?: string; readonly text?: string }[]
    readonly message?: { readonly content?: readonly { readonly kind?: string; readonly type?: string; readonly text?: string; readonly content?: readonly { readonly type?: string; readonly text?: string }[] }[]; readonly blocks?: readonly { readonly kind?: string; readonly text?: string }[]; readonly isError?: boolean; readonly source?: { readonly callId?: string } }
    readonly chunk?: { readonly type?: string; readonly text?: string }
    readonly attemptId?: string
    readonly source?: { readonly kind?: string }
    readonly tool?: { readonly name?: string }
    readonly name?: string
    readonly callId?: string
    readonly toolCallId?: string
    readonly error?: { readonly message?: string } | string
  }
}

export interface FeedEntry {
  readonly type: 'event' | 'transient'
  readonly event: FeedEvent
}

export interface FeedWindow {
  readonly entries: readonly FeedEntry[]
  readonly hasMore?: boolean
}

function userText(event: FeedEvent): string {
  const content = event.data?.content
  if (content === undefined) return ''
  return content
    .filter(part => (part.type ?? 'text') === 'text')
    .map(part => part.text ?? '')
    .join('\n\n')
    .trim()
}

function assistantText(event: FeedEvent): string {
  const message = event.data?.message
  if (message === undefined) return ''
  const blocks = message.content ?? message.blocks ?? []
  return blocks
    .filter(block => (block.kind ?? block.type) === 'text')
    .map(block => block.text ?? '')
    .join('\n\n')
    .trim()
}

/**
 * Is the bound session's CURRENT turn still generating? The journal's turn
 * lifecycle is turn/start -> (steps, tool traffic, live chunks) -> turn/end
 * (verified against session.v2 logs 2026-09-06: step/end never closes a turn,
 * only turn/end does). The host prompt face resolves at QUEUE time, so the
 * stop twin must ride this fold, not the prompt promise. A window truncated
 * past its turn/start still shows transient live chunks — treat those as
 * active too. `stoppedAt` is the seq watermark of a user stop: the host's
 * cancel path journals attempt+step/end but NEVER turn/end (verified
 * 2026-09-06), so a stopped turn would otherwise read as open forever —
 * events at or before the watermark are ignored and only a fresh turn/start
 * (or orphan live chunk) re-arms.
 * @param window - the bound session's event window snapshot, or undefined.
 * @param stoppedAt - seq watermark set by the stop button, or null.
 */
export function feedTurnActive(window: FeedWindow | undefined, stoppedAt: number | null = null): boolean {
  if (window === undefined || window.entries === undefined) return false
  let depth = 0
  let liveChunkOrphan = false
  for (const entry of window.entries) {
    const seq = entry.event?.seq
    if (stoppedAt !== null && seq !== undefined && seq <= stoppedAt) continue
    const type = entry.event?.type
    if (type === 'turn/start') { depth++; liveChunkOrphan = false }
    else if (type === 'turn/end') { depth = Math.max(0, depth - 1); liveChunkOrphan = false }
    else if (type === 'assistant/live-chunk' && depth === 0) liveChunkOrphan = true
  }
  return depth > 0 || liveChunkOrphan
}

/** The window's highest event seq (the stop watermark's source). */
export function feedLastSeq(window: FeedWindow | undefined): number {
  if (window === undefined || window.entries === undefined) return 0
  let max = 0
  for (const entry of window.entries) {
    const seq = entry.event?.seq
    if (typeof seq === 'number' && seq > max) max = seq
  }
  return max
}

/**
 * The artifact-emitting tools (D4): a settled result row for one of these
 * hydrates into an inline artifact card (the structured payload itself never
 * rides the journal — only the one-line render — so the state feed's
 * lesson.artifacts is the payload source and the render text is the join key).
 */
export const ARTIFACT_TOOLS: Readonly<Record<string, string>> = {
  study_generate_quiz: 'quiz',
  study_pose_guess: 'guess',
  study_compare_table: 'compare_table',
  study_draw_diagram: 'diagram',
  study_code_walkthrough: 'code_walkthrough',
}

/** The rendered text of a tool/result event (live shape: tool-result blocks wrapping text blocks; legacy arm: data.content). */
function resultRenderedText(event: FeedEvent): string {
  const message = event.data?.message
  const blocks = message?.content ?? message?.blocks ?? []
  const parts: string[] = []
  for (const block of blocks) {
    const inner = block.content
    if (inner !== undefined) {
      for (const part of inner) if ((part.type ?? 'text') === 'text' && part.text !== undefined && part.text !== '') parts.push(part.text)
    } else if ((block.kind ?? block.type) === 'text' && block.text !== undefined && block.text !== '') {
      parts.push(block.text)
    }
  }
  if (parts.length === 0) {
    const content = event.data?.content
    if (content !== undefined) {
      for (const part of content) if ((part.type ?? 'text') === 'text' && part.text !== undefined && part.text !== '') parts.push(part.text)
    }
  }
  return parts.join('\n\n').trim()
}

/** Structural slice of a state-feed artifact (the hydration payload source). */
export interface ArtifactLike {
  readonly id: string
  readonly artifactType: string
  readonly title: string
  readonly data?: Record<string, unknown>
}

/** The title (+question count for quizzes) a tool's render text carries, per artifact type. */
function parseRendered(type: string, text: string): { title: string | null; count: number | null } {
  if (type === 'quiz') {
    const m = /^Practice card \((\d+) questions\): ([\s\S]*)$/.exec(text)
    if (m === null) return { title: null, count: null }
    const count = Number(m[1])
    let title: string = m[2] ?? ''
    title = title.replace(/ \(already recorded\)$/, '')
    title = title.replace(/ — warnings: [\s\S]*$/, '')
    return { title, count }
  }
  const arm = type === 'compare_table'
    ? /^Compare table: ([\s\S]*) \(\d+ rows\)$/.exec(text)
    : type === 'diagram'
      ? /^Diagram: ([\s\S]*) \([a-z-]+\)$/.exec(text)
      : type === 'code_walkthrough'
        ? /^Code walkthrough: ([\s\S]*) \(\d+ segments\)$/.exec(text)
        : type === 'guess'
          ? /^Guess posed: ([\s\S]*)$/.exec(text)
          : null
  return { title: arm !== null ? (arm[1] ?? '') : null, count: null }
}

/**
 * Replace settled artifact-tool chip rows with inline artifact rows (D4): the
 * journal carries only the one-line render, so each result joins to a
 * state-feed artifact by type + rendered title (question count for quizzes,
 * prompt for guesses), falling back to the latest unclaimed artifact of the
 * type; one artifact hydrates at most one row (re-sends render `created:false`
 * with the same content hash). Unmatched rows keep their chip — the state
 * poll may lag the journal, and hydration re-runs on every poll.
 * Pure; the panel re-runs it on either input changing.
 */
export function hydrateArtifactRows(rows: readonly ChatRow[], artifacts?: readonly ArtifactLike[]): ChatRow[] {
  if (artifacts === undefined || artifacts.length === 0) return [...rows]
  const claimed = new Set<string>()
  const out: ChatRow[] = []
  for (const row of rows) {
    const type = row.role === 'tool' && row.toolState === 'done' && row.resultText !== undefined
      ? ARTIFACT_TOOLS[row.text]
      : undefined
    if (type === undefined) { out.push(row); continue }
    const parsed = parseRendered(type, row.resultText)
    const unclaimed = artifacts.filter(a => a.artifactType === type && !claimed.has(a.id))
    let match: ArtifactLike | undefined
    if (parsed.title !== null) {
      match = unclaimed.find(a => a.title === parsed.title
        || (type === 'guess' && typeof a.data?.prompt === 'string' && a.data.prompt === parsed.title))
      if (match === undefined && type === 'quiz' && parsed.count !== null) {
        match = unclaimed.find(a => {
          const qs = a.data?.questions
          return Array.isArray(qs) && qs.length === parsed.count && a.title === parsed.title
        })
      }
    }
    if (match === undefined) match = unclaimed[unclaimed.length - 1]
    if (match === undefined) { out.push(row); continue }
    claimed.add(match.id)
    out.push({ key: row.key, role: 'artifact', text: match.title, artifactId: match.id, artifactType: type })
  }
  return out
}

/**
 * The sediment backlog under the stream (D4): the lesson's artifacts minus the
 * ones already rendered inline in this window, unseen ones first — the stack
 * is the not-yet-seen backlog while the stream owns the live thread.
 * Pure (stable sort).
 */
export function sedimentBacklog(artifacts: readonly ArtifactLike[], inlineIds: ReadonlySet<string>, unseen: readonly string[] = []): ArtifactLike[] {
  const u = new Set(unseen)
  return artifacts
    .filter(a => !inlineIds.has(a.id))
    .sort((a, b) => Number(u.has(b.id)) - Number(u.has(a.id)))
}

/**
 * Fold one event-window snapshot into ordered chat rows. The transient
 * `text-delta` chunks of the most recent attempt accumulate into a single
 * streaming row (the durable `assistant/message` replaces it on settlement).
 * @param window - the bound session's event window snapshot, or undefined.
 */
export function feedRows(window: FeedWindow | undefined): ChatRow[] {
  if (window === undefined) return []
  const rows: ChatRow[] = []
  const streams = new Map<string, { text: string; anchor: number; settled: boolean }>()
  let latest: string | undefined
  for (const entry of window.entries) {
    const event = entry?.event
    if (event === undefined) continue
    if (entry.type === 'event') {
      if (event.type === 'user/message') {
        // Machinery rides the log as user messages under their own source
        // kinds — plugin (runtime-context snapshots), agent-instructions
        // (<system-reminder> injections), tool (results). Only the learner's
        // own submits carry source.kind 'user' (live 0.14.0 catch: the panel
        // showed "Current runtime context…" and skill reminders as bubbles).
        if (event.data?.source?.kind !== 'user') continue
        const text = userText(event)
        if (text !== '') rows.push({ key: `u${event.seq}`, role: 'user', text })
      } else if (event.type === 'assistant/message') {
        // C14: reasoning blocks fold into a collapsible row ahead of the text.
        const message = event.data?.message
        const blocks = message?.content ?? message?.blocks ?? []
        const reasoning = blocks
          .filter(block => (block.kind ?? block.type) === 'reasoning')
          .map(block => block.text ?? '')
          .join('\n\n')
          .trim()
        if (reasoning !== '') rows.push({ key: `r${event.seq}`, role: 'reasoning', text: reasoning })
        const text = assistantText(event)
        if (text !== '') rows.push({ key: `a${event.seq}`, role: 'assistant', text })
      } else if (event.type === 'tool/call') {
        // C14: the three-state chip — loading until its result lands.
        const name = event.data?.tool?.name ?? event.data?.name ?? 'tool'
        rows.push({ key: `t${event.data?.callId ?? event.data?.toolCallId ?? event.seq}`, role: 'tool', text: name, toolState: 'loading' })
      } else if (event.type === 'tool/result') {
        // Orphan results (no matching call row — e.g. pre-window history) stay
        // in the host toolviews; only a known call's chip settles. Live host
        // payloads (session.v2 journal, verified 2026-09-06) carry the callId
        // at data.message.source.callId and signal failure via
        // data.message.isError — the plain data.callId arm only exists in
        // test fixtures.
        const rid = event.data?.message?.source?.callId ?? event.data?.callId ?? event.data?.toolCallId
        if (rid !== undefined) {
          const idx = rows.findIndex(r => r.key === `t${rid}` && r.role === 'tool')
          if (idx >= 0) {
            const failed = event.data?.message?.isError === true || event.data?.error !== undefined
            // D4: keep the rendered text — artifact-tool results hydrate into
            // inline cards (the structured payload lives in the state feed).
            rows[idx] = { ...rows[idx]!, toolState: failed ? 'error' : 'done', resultText: failed ? undefined : resultRenderedText(event) }
          }
        }
      }
      // tool/call, tool/result, step/*, assistant/attempt: the study view never
      // mirrored tool traffic — the host conversation's toolviews own it.
      // A durable row appended after an attempt's first chunk marks that
      // attempt settled — its streaming row must not linger.
      for (const s of streams.values()) {
        if (rows.length > s.anchor) s.settled = true
      }
      continue
    }
    // transient live chunk: accumulate text deltas per attempt. The streaming
    // row anchors where the attempt's FIRST chunk appeared in the durable
    // row order (deltas arrive between the rows that precede/follow them).
    const chunk = event.data?.chunk
    if (chunk === undefined || chunk.type !== 'text-delta') continue
    const attemptId = event.data?.attemptId ?? String(event.seq)
    const stream = streams.get(attemptId)
    if (stream === undefined) streams.set(attemptId, { text: chunk.text ?? '', anchor: rows.length, settled: false })
    else stream.text += chunk.text ?? ''
    latest = attemptId
  }
  const stream = latest !== undefined ? streams.get(latest) : undefined
  if (stream !== undefined && !stream.settled) {
    const text = stream.text.trim()
    if (text !== '') rows.splice(stream.anchor, 0, { key: 'streaming', role: 'streaming', text })
  }
  return rows
}

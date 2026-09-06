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
    readonly message?: { readonly content?: readonly { readonly kind?: string; readonly type?: string; readonly text?: string }[]; readonly blocks?: readonly { readonly kind?: string; readonly text?: string }[] }
    readonly chunk?: { readonly type?: string; readonly text?: string }
    readonly attemptId?: string
    readonly source?: { readonly kind?: string }
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
        const text = assistantText(event)
        if (text !== '') rows.push({ key: `a${event.seq}`, role: 'assistant', text })
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

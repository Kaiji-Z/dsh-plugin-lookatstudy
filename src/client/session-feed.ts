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
    readonly message?: { readonly content?: readonly { readonly kind?: string; readonly type?: string; readonly text?: string; readonly content?: readonly { readonly type?: string; readonly text?: string }[] }[]; readonly blocks?: readonly { readonly kind?: string; readonly type?: string; readonly text?: string; readonly content?: readonly { readonly type?: string; readonly text?: string }[] }[]; readonly isError?: boolean; readonly source?: { readonly callId?: string } }
    readonly chunk?: { readonly type?: string; readonly text?: string }
    readonly attemptId?: string
    readonly source?: { readonly kind?: string }
    readonly tool?: { readonly name?: string }
    readonly name?: string
    readonly callId?: string
    readonly toolCallId?: string
    /** tool/call only: the raw arguments (the live journal carries a JSON string). */
    readonly arguments?: string
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

/**
 * Issue #9: how long a turn-liveness window may sit WITHOUT its top seq
 * advancing before the panel reads it as stalled and unlocks the composer.
 * Generous on purpose: a legit in-flight tool call journals nothing for up to
 * its own timeout (the import tools run 180 s), so anything past 240 s with a
 * motionless window is a dead turn (cancel paths never journal turn/end).
 */
export const TURN_STALL_MS = 240_000

/**
 * 0.23.1 issue 3: how long an import funnel may sit with NO live turn before
 * the panel reads the import as failed. The old failure exit armed on the
 * turnActive prop having rendered true once — but a turn that dies inside one
 * event-window notification batch (turn/start + turn/end between two reads,
 * the keyless-provider fast fail; journal-verified: attempt → step/end →
 * turn/end within seconds) never flips the prop, so the exit never armed and
 * the funnel spun forever. This deadline needs no observation: past grace
 * with the turn not active = failed. The grace only covers prompt queue
 * latency (turn/start journals within seconds of the queue-time resolve); a
 * live turn holds the funnel open for its whole life however long the import
 * tools run.
 */
export const IMPORT_FAIL_GRACE_MS = 30_000

/**
 * The funnel's failure decision (pure — the wall clock lives at the poll call
 * site, mirroring {@link turnStalled}).
 */
export function importJobDead(job: { startedAt: number } | null, turnActive: boolean, now: number, grace: number = IMPORT_FAIL_GRACE_MS): boolean {
  return job !== null && !turnActive && now - job.startedAt > grace
}

/**
 * The stall decision (pure — the wall clock lives at the poll call site):
 * an ACTIVE fold stays active while the window's top seq keeps advancing;
 * once it has been frozen for longer than stallMs the panel treats the turn
 * as over. `lastAdvanceAt === 0` means "first observation" — the clock starts
 * now, so a freshly mounted window with an old unpaired turn/start does not
 * insta-clear (it clears one stall window later if truly dead).
 */
export function turnStalled(active: boolean, lastSeq: number, prevLastSeq: number, lastAdvanceAt: number, now: number, stallMs: number = TURN_STALL_MS): boolean {
  if (!active) return false
  if (lastSeq !== prevLastSeq || lastAdvanceAt === 0) return false
  return now - lastAdvanceAt > stallMs
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
    const type = row.role === 'tool' && row.toolState === 'done' && row.resultText !== undefined && row.text !== undefined
      ? ARTIFACT_TOOLS[row.text]
      : undefined
    if (type === undefined || row.resultText === undefined) { out.push(row); continue }
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
 * D7: the import pipeline's observable steps, folded from the bound thread's
 * tool rows (the plugin's import runs as a tutor turn — upstream's five-step
 * job collapses to what the wire can honestly show):
 *   fetch (清点) — the import tool call, loading → done/error
 *   design (设计) — the stretch between fetch done and apply (assistant streaming)
 *   apply (落库) — study_apply_design, loading → done/error
 *   complete (完成) — the course-count watcher (state poll), not a tool row
 * Pure; the pane maps these onto its four step rows.
 */
export interface ImportToolStep {
  readonly state: 'absent' | 'loading' | 'done' | 'error'
}

export function importProgressOf(rows: readonly ChatRow[]): { fetch: ImportToolStep; apply: ImportToolStep } {
  // a tool row is born 'loading' at its call and re-settled by its result —
  // the LAST row for a name carries its current truth.
  const last = (name: string): ImportToolStep => {
    let state: ImportToolStep['state'] = 'absent'
    for (const r of rows) {
      if (r.role === 'tool' && r.text === name) state = r.toolState ?? 'loading'
    }
    return { state }
  }
  let fetch: ImportToolStep = { state: 'absent' }
  for (const name of ['study_import_url', 'study_import_github', 'study_import_folder', 'study_import_markdown']) {
    const s = last(name)
    if (s.state !== 'absent') fetch = s
  }
  return { fetch, apply: last('study_apply_design') }
}

/** The tool names that begin an import turn (D7 — the tab set's funnel). */
export const IMPORT_TOOLS: ReadonlySet<string> = new Set(['study_import_url', 'study_import_github', 'study_import_folder', 'study_import_markdown'])

/**
 * Tool-error visibility (upstream v0.37.1 toolErrorVisibility, part-accumulator):
 * an error tool row that is SUPERSEDED by a later same-tool call within the
 * same turn (no learner message in between) is dropped — weak models fail a
 * zod-validated input on the first try and succeed on the retry (observed
 * live: the quiz error block flashed, then the quiz card landed), and the
 * stale transient failure is pure noise. A real failure — no successor —
 * stays visible; nothing is silently swallowed. Pure.
 */
export function hideSupersededToolErrors(rows: readonly ChatRow[]): ChatRow[] {
  const out: ChatRow[] = []
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    if (row.role === 'tool' && row.toolState === 'error') {
      let superseded = false
      for (let j = i + 1; j < rows.length; j++) {
        const later = rows[j]!
        if (later.role === 'user') break // a new turn began — the error stands alone
        if (later.role === 'tool' && later.text === row.text && (later.toolState === 'loading' || later.toolState === 'done')) {
          superseded = true
          break
        }
      }
      if (superseded) continue
    }
    out.push(row)
  }
  return out
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
  const streams = new Map<string, { text: string; reasoning: string; anchor: number; settled: boolean }>()
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
        const callId = event.data?.callId ?? event.data?.toolCallId
        // 0.23.0: the host's ask_user_question becomes an ANSWERABLE row —
        // the tool parks the turn until the learner picks an option, and the
        // panel (not the hidden host column) owns the answer UI
        if (name === 'ask_user_question') {
          const ask = parseAskArguments(event.data?.arguments, callId ?? String(event.seq))
          rows.push({ key: `t${String(callId ?? event.seq)}`, role: 'ask', text: ask.summary, toolState: 'loading', ask })
          continue
        }
        rows.push({ key: `t${String(callId ?? event.seq)}`, role: 'tool', text: name, toolState: 'loading' })
      } else if (event.type === 'tool/result') {
        // Orphan results (no matching call row — e.g. pre-window history) stay
        // in the host toolviews; only a known call's chip settles. Live host
        // payloads (session.v2 journal, verified 2026-09-06) carry the callId
        // at data.message.source.callId and signal failure via
        // data.message.isError — the plain data.callId arm only exists in
        // test fixtures.
        const rid = event.data?.message?.source?.callId ?? event.data?.callId ?? event.data?.toolCallId
        if (rid !== undefined) {
          const idx = rows.findIndex(r => r.key === `t${rid}` && (r.role === 'tool' || r.role === 'ask'))
          if (idx >= 0) {
            const failed = event.data?.message?.isError === true || event.data?.error !== undefined
            // D4: keep the rendered text — artifact-tool results hydrate into
            // inline cards (the structured payload lives in the state feed).
            rows[idx] = { ...rows[idx]!, toolState: failed ? 'error' : 'done', resultText: failed ? undefined : resultRenderedText(event),
              ...(rows[idx]!.role === 'ask' && rows[idx]!.ask !== undefined && !failed ? { ask: { ...rows[idx]!.ask!, answered: true } } : {}) }
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
    // transient live chunk: accumulate text AND reasoning deltas per attempt
    // (0.24.0: reasoning-delta surfaces as the live thinking row — the host's
    // ReasoningRow contract; until now it was dropped and the learner saw
    // nothing until the message settled). The streaming rows anchor where the
    // attempt's FIRST chunk appeared in the durable row order (deltas arrive
    // between the rows that precede/follow them).
    const chunk = event.data?.chunk
    if (chunk === undefined || (chunk.type !== 'text-delta' && chunk.type !== 'reasoning-delta')) continue
    const attemptId = event.data?.attemptId ?? String(event.seq)
    const delta = chunk.text ?? ''
    const stream = streams.get(attemptId)
    if (stream === undefined) {
      streams.set(attemptId, { text: chunk.type === 'text-delta' ? delta : '', reasoning: chunk.type === 'reasoning-delta' ? delta : '', anchor: rows.length, settled: false })
    } else if (chunk.type === 'text-delta') stream.text += delta
    else stream.reasoning += delta
    latest = attemptId
  }
  // 0.23.0: an ask row with a LATER learner row in the window was answered
  // (history case — the answer's tool result may sit outside the window)
  let askOpen = false
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]!
    if (r.role === 'user') askOpen = true
    else if (r.role === 'ask' && r.ask !== undefined && askOpen && !r.ask.answered) {
      rows[i] = { ...r, ask: { ...r.ask, answered: true } }
    }
  }
  const stream = latest !== undefined ? streams.get(latest) : undefined
  if (stream !== undefined && !stream.settled) {
    // 0.24.0: the live thinking row rides AHEAD of the streaming answer —
    // same order as the settled reasoning+assistant pair (text splices first
    // at the anchor, then reasoning splices in ahead of it)
    const text = stream.text.trim()
    if (text !== '') rows.splice(stream.anchor, 0, { key: 'streaming', role: 'streaming', text })
    const reasoning = stream.reasoning.trim()
    if (reasoning !== '') rows.splice(stream.anchor, 0, { key: 'streaming-reasoning', role: 'reasoning', text: reasoning, running: true })
  }
  return hideSupersededToolErrors(rows)
}


/**
 * Parse an ask_user_question call's arguments into the answerable row payload
 * (0.23.0). The live journal carries a JSON STRING (verified against real
 * journals 2026-09-14: {questions:[{header,id,multi_select,options:[{label,
 * description}]}]}); tolerate an already-parsed object arm for robustness.
 * Unparseable shapes degrade to a header-only row (the composer still answers
 * in free text). Pure.
 */
export function parseAskArguments(raw: string | undefined, callId: string): { callId: string, summary: string, questions: Array<{ id: string, header: string, multiSelect: boolean, options: Array<{ label: string, description: string }> }>, answered: boolean } {
  const empty = { callId, summary: '', questions: [], answered: false }
  if (raw === undefined || raw === '') return empty
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return empty
  }
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as { questions?: unknown }).questions)) return empty
  const questions: Array<{ id: string, header: string, multiSelect: boolean, options: Array<{ label: string, description: string }> }> = []
  for (const q of (parsed as { questions: unknown[] }).questions) {
    if (typeof q !== 'object' || q === null) continue
    const rec = q as { id?: unknown, header?: unknown, question?: unknown, multi_select?: unknown, options?: unknown }
    const id = typeof rec.id === 'string' ? rec.id : String(questions.length)
    const header = typeof rec.header === 'string' && rec.header !== '' ? rec.header : typeof rec.question === 'string' ? rec.question : ''
    const multiSelect = rec.multi_select === true
    const options: Array<{ label: string, description: string }> = []
    if (Array.isArray(rec.options)) {
      for (const o of rec.options) {
        if (typeof o !== 'object' || o === null) continue
        const orec = o as { label?: unknown, description?: unknown }
        if (typeof orec.label === 'string' && orec.label !== '') options.push({ label: orec.label, description: typeof orec.description === 'string' ? orec.description : '' })
      }
    }
    questions.push({ id, header, multiSelect, options })
  }
  if (questions.length === 0) return empty
  return { callId, summary: questions.map(q => q.header).filter(h => h !== '').join(' / '), questions, answered: false }
}
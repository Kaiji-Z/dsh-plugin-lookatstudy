/**
 * Dual-generation session staging. The harness's session-ownership refactor
 * (dsh v0.1.6-alpha line, bundled by DSH Desktop 2.0.13-beta) removed
 * `sessions.open` and `list.current`: history now opens through a plugin-OWNED
 * reference (`retain`), scope/binding resolve only for retained generations,
 * and the host main-view selection moved to the view owner's private
 * `mainView` retention label. rc generations (≤ 0.1.5-rc) keep `open` +
 * `current`. The panel supports both at runtime — the same feature-detect
 * discipline as `sessions.create`/`connectWorkspace` before it.
 *
 * Discipline: we retain under the plugin's OWN source label, never 'mainView'
 * — ui-workspace derives its current selection from `retainedBy.mainView > 0`,
 * and a second owner holding that label would make the host's read ambiguous.
 * @module dsh-plugin-lookatstudy/client/stage-session
 */

/** A held session reference (alpha generations); release is per-reference. */
export interface StageReference {
  readonly sessionId: string
  release(): void
}

/** The staging-relevant slice of the sessions face, either generation. */
export interface StageSessionsFace {
  /** rc generations: select as current (the event window opens ⟺ current). */
  open?(sessionId: string): void
  /** alpha generations: own a reference — retention opens history and makes
   * the id addressable through scope/binding. Navigation is NOT ours to claim. */
  retain?(sessionId: string, options: { source: string }): StageReference
}

/** The plugin's private retention label (never the view owner's 'mainView'). */
export const STAGE_SOURCE = 'lookatstudy'

/** Which staging generation the host speaks ('retain' wins when both exist). */
export function stagingMode(sessions: StageSessionsFace): 'retain' | 'open' {
  return typeof sessions.retain === 'function' ? 'retain' : 'open'
}

// The panel observes ONE session at a time (the pinned chat column), so ONE
// held reference covers it. Staging the next session releases the previous
// only AFTER the new reference exists — no unobserved gap; a refused retain
// keeps the old reference held.
let held: StageReference | null = null

/**
 * Stage `sessionId` for observation + addressability.
 * alpha: holds the plugin's reference. rc: `open()` navigation. Throws
 * whatever the host face throws — callers keep their existing catch policy.
 */
export function stageSession(sessions: StageSessionsFace, sessionId: string): void {
  if (stagingMode(sessions) === 'retain') {
    if (held !== null && held.sessionId === sessionId) return
    const previous = held
    // attached call, always: the host's retain reads its own state through
    // `this` — a detached extraction throws `Cannot read properties of
    // undefined` inside the service (live alpha-probe catch)
    held = sessions.retain!(sessionId, { source: STAGE_SOURCE })
    previous?.release()
  } else {
    sessions.open?.(sessionId)
  }
}

/** Release the held alpha reference (plugin dispose — across open/close
 * toggles the reference stays held, mirroring rc's sticky current). */
export function unstageSession(): void {
  held?.release()
  held = null
}

/** An idempotent lifetime closer for a transient reference. */
export type StageCloser = () => void

/**
 * Hold a TRANSIENT alpha reference for an effect's lifetime so scope/binding
 * resolve for an un-staged session (E1/E6 projections, thread rename).
 * rc: a no-op closer — listed ids are addressable there without help, and
 * calling open() from inside an effect would trip the rc hand-back.
 * alpha: undefined only when the retain is refused (treat as feature-absent).
 */
export function acquireStageReference(sessions: StageSessionsFace, sessionId: string): StageCloser | undefined {
  if (sessions.retain === undefined) return () => {}
  let ref: StageReference | undefined
  try {
    ref = sessions.retain!(sessionId, { source: STAGE_SOURCE }) // attached — see stageSession
  } catch {
    return undefined
  }
  return () => {
    ref?.release()
    ref = undefined
  }
}

/** A byId row's retention counts, as the alpha list snapshot carries them. */
export interface RetainedByRow {
  retainedBy?: Readonly<Record<string, number>>
}

/**
 * Derive the host main-view selection from a list snapshot the way
 * ui-workspace does: alpha removed `list.current`, and the view owner's
 * `mainView` retention is the only public trace of the main selection.
 * Pure; rc snapshots carry no `retainedBy` and read as no selection.
 */
export function mainSelectionOf(
  byId: Readonly<Record<string, Readonly<RetainedByRow> | undefined>> | undefined,
): string | undefined {
  if (byId === undefined) return undefined
  for (const entry of Object.entries(byId)) {
    if ((entry[1]?.retainedBy?.mainView ?? 0) > 0) return entry[0]
  }
  return undefined
}

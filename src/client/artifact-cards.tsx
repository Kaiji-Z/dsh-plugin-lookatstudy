/**
 * The artifact cards (0.15.0 P1b, upstream artifacts port): compare tables,
 * code walkthroughs, mermaid diagrams (with the expand modal), and the
 * opening guess — plus the seen-tracking that feeds the notebook badge and
 * the "new artifact" toast. Rendering is lazy where it is heavy (mermaid via
 * the enhance pipeline); everything else is plain dsw-token DOM.
 * @module dsh-plugin-lookatstudy/client/artifact-cards
 */

import { createElement, useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { tr } from './locale.ts'
import { IconCloseFill16, IconMaximizeOutline16 } from './icons.tsx'
import { CanvasStage } from './canvasstage.tsx'

/** One artifact row from the state feed. */
export interface ArtifactRow {
  readonly id: string
  readonly artifactType: string
  readonly title: string
  readonly data: Record<string, unknown>
}

/** localStorage key for the artifact ids the learner has already seen. */
export function seenArtifactsKey(lessonId: string): string {
  return `dsh-plugin-lookatstudy:seen-artifacts:${lessonId}`
}

/** Which artifact ids are new (not yet seen); pure over the stored set. */
export function unseenArtifacts(lessonId: string, artifacts: readonly ArtifactRow[], storage: Pick<Storage, 'getItem'> = localStorage): string[] {
  let seen: Set<string>
  try {
    const raw = storage.getItem(seenArtifactsKey(lessonId))
    const parsed = JSON.parse(raw ?? '[]') as unknown
    seen = new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    seen = new Set()
  }
  return artifacts.filter(a => !seen.has(a.id)).map(a => a.id)
}

/** Mark artifact ids seen (opening the notebook counts as seeing them). */
export function markArtifactsSeen(lessonId: string, ids: string[], storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): void {
  try {
    let seen: string[] = []
    try {
      const parsed = JSON.parse(storage.getItem(seenArtifactsKey(lessonId)) ?? '[]') as unknown
      if (Array.isArray(parsed)) seen = parsed.filter((x): x is string => typeof x === 'string')
    } catch { /* junk storage starts blank */ }
    storage.setItem(seenArtifactsKey(lessonId), JSON.stringify([...new Set([...seen, ...ids])]))
  } catch { /* storage unavailable */ }
}

/* ---------------- issue #8: artifact-card lifecycle persistence ---------------- */

/** localStorage: artifact id → the picked guess option id. The pick outlives
 *  the component — a remount must not re-enable the buttons (and re-send). */
const GUESS_PICKED_KEY = 'dsh-plugin-lookatstudy:guess-picked'
export function guessPickedOf(artifactId: string, storage: Pick<Storage, 'getItem'> = localStorage): string | null {
  try {
    const parsed = JSON.parse(storage.getItem(GUESS_PICKED_KEY) ?? '{}') as unknown
    if (parsed !== null && typeof parsed === 'object') {
      const v = (parsed as Record<string, unknown>)[artifactId]
      if (typeof v === 'string') return v
    }
  } catch { /* junk storage */ }
  return null
}
export function markGuessPicked(artifactId: string, optionId: string, storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): void {
  try {
    let map: Record<string, string> = {}
    try {
      const parsed = JSON.parse(storage.getItem(GUESS_PICKED_KEY) ?? '{}') as unknown
      if (parsed !== null && typeof parsed === 'object') map = parsed as Record<string, string>
    } catch { /* junk storage */ }
    map[artifactId] = optionId
    storage.setItem(GUESS_PICKED_KEY, JSON.stringify(map))
  } catch { /* storage unavailable */ }
}

/** localStorage: artifact id → explicitly toggled fold state. Absent = the
 *  mount's defaultFolded (feed cards open, sedimented surfaces folded). */
const ACARD_FOLD_KEY = 'dsh-plugin-lookatstudy:acard-folded'
export function acardFoldStoredOf(artifactId: string, storage: Pick<Storage, 'getItem'> = localStorage): boolean | null {
  try {
    const parsed = JSON.parse(storage.getItem(ACARD_FOLD_KEY) ?? '{}') as unknown
    if (parsed !== null && typeof parsed === 'object') {
      const v = (parsed as Record<string, unknown>)[artifactId]
      if (typeof v === 'boolean') return v
    }
  } catch { /* junk storage */ }
  return null
}
export function markAcardFoldStored(artifactId: string, folded: boolean, storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): void {
  try {
    let map: Record<string, boolean> = {}
    try {
      const parsed = JSON.parse(storage.getItem(ACARD_FOLD_KEY) ?? '{}') as unknown
      if (parsed !== null && typeof parsed === 'object') map = parsed as Record<string, boolean>
    } catch { /* junk storage */ }
    map[artifactId] = folded
    storage.setItem(ACARD_FOLD_KEY, JSON.stringify(map))
  } catch { /* storage unavailable */ }
}

/** The cards render mermaid through the shared CDN pipeline
 * (enhanceDiagrams consumes pre > code.lang-mermaid blocks). */
async function renderMermaidInto(el: HTMLElement, code: string, onError: () => void): Promise<void> {
  try {
    const { enhanceDiagrams } = await import('./enhance.ts')
    el.textContent = ''
    const pre = document.createElement('pre')
    const codeEl = document.createElement('code')
    codeEl.className = 'lang-mermaid'
    codeEl.textContent = code
    pre.appendChild(codeEl)
    el.appendChild(pre)
    const count = await enhanceDiagrams(el)
    if (count === 0) onError()
  } catch {
    onError()
  }
}

/** Compare table card (headers + rows). */
export function CompareTableCard({ artifact }: { artifact: ArtifactRow }): ReactNode {
  const headers = (artifact.data.headers ?? []) as string[]
  const rows = (artifact.data.rows ?? []) as string[][]
  return createElement('div', { className: 'lks-acard', 'data-lks-artifact': artifact.id },
    createElement('div', { className: 'lks-acard-head' }, artifact.title),
    createElement('table', { className: 'lks-acard-table' },
      createElement('thead', null, createElement('tr', null, ...headers.map((h, i) => createElement('th', { key: i }, h)))),
      createElement('tbody', null, ...rows.map((row, r) => createElement('tr', { key: r }, ...row.map((c, i) => createElement('td', { key: i }, c)))))))
}

/** Code walkthrough card: line-numbered code + per-segment notes. */
export function CodeWalkthroughCard({ artifact }: { artifact: ArtifactRow }): ReactNode {
  const language = typeof artifact.data.language === 'string' ? artifact.data.language : 'text'
  const code = typeof artifact.data.code === 'string' ? artifact.data.code : ''
  const annotations = (artifact.data.annotations ?? []) as Array<{ lineStart: number; lineEnd: number; note: string }>
  const lines = code.split('\n')
  return createElement('div', { className: 'lks-acard', 'data-lks-artifact': artifact.id },
    createElement('div', { className: 'lks-acard-head' }, `${artifact.title} · ${language}`),
    createElement('pre', { className: 'lks-acard-code' },
      ...lines.map((line, i) => createElement('span', { key: i, className: 'lks-acard-line' },
        createElement('i', null, String(i + 1)), line, '\n'))),
    createElement('div', { className: 'lks-acard-notes' },
      ...annotations.map((a, i) => createElement('div', { key: i, className: 'lks-acard-note' },
        createElement('b', null, `${tr('artifact.lines', { from: a.lineStart, to: a.lineEnd })}`), a.note))))
}

/** The 放大查看 modal's mermaid host — rendered ONCE per mermaid source. The
 * raw-ref-callback version re-ran renderMermaidInto on every parent render
 * (each 3s state poll), and its el.textContent='' clear + async re-render
 * re-mounted the svg twice per tick — the #12 flicker. A stable effect deps
 * chain (string mermaid + useCallback'd onFail) breaks the loop at the
 * source; the CanvasStage gates are the second line of defense. */
function DiagramModalDiagram({ mermaid, onFail }: { mermaid: string; onFail: () => void }): ReactNode {
  const bodyRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (bodyRef.current === null) return
    void renderMermaidInto(bodyRef.current, mermaid, onFail)
  }, [mermaid, onFail])
  return createElement('div', { className: 'lks14-modal-diagram', ref: bodyRef })
}

/** Mermaid diagram card with an expand modal (upstream DiagramViewerModal). */
export function DiagramCard({ artifact }: { artifact: ArtifactRow }): ReactNode {
  const mermaid = typeof artifact.data.mermaid === 'string' ? artifact.data.mermaid : ''
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const [failed, setFailed] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const onFail = useCallback((): void => { setFailed(true) }, [])
  // C10: Escape closes the modal (upstream DiagramViewerModal).
  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setExpanded(false) }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [expanded])
  useEffect(() => {
    if (bodyRef.current === null) return
    void renderMermaidInto(bodyRef.current, mermaid, onFail)
  }, [mermaid, onFail])
  const body = failed
    ? createElement('pre', { className: 'lks-acard-code' }, mermaid)
    : createElement('div', { className: 'lks-acard-diagram', ref: bodyRef })
  return createElement('div', { className: 'lks-acard', 'data-lks-artifact': artifact.id },
    createElement('div', { className: 'lks-acard-head' }, artifact.title,
      createElement('button', { className: 'lks-acard-expand', 'data-tooltip': tr('artifact.expand'), onClick: () => { setExpanded(true) } }, createElement(IconMaximizeOutline16, { size: 13 }))),
    body,
    expanded
      ? createElement('div', {
          className: 'lks-acard-modal',
          onClick: () => { setExpanded(false) },
        },
        createElement('div', { className: 'lks-acard-modal-body', onClick: (e: { stopPropagation: () => void }) => { e.stopPropagation() } },
          createElement('div', { className: 'lks-acard-modal-title' }, artifact.title,
            createElement('button', { className: 'lks-acard-expand', onClick: () => { setExpanded(false) } }, createElement(IconCloseFill16, { size: 13 }))),
          failed
            ? createElement('pre', { className: 'lks-acard-code' }, mermaid)
            : createElement(CanvasStage, { testid: 'diagram-modal-stage' },
              createElement(DiagramModalDiagram, { mermaid, onFail }))))
      : null)
}
/** The opening guess: two big options, click = pick (sent to the tutor, who
 * reveals next turn); unscored — no right/wrong language anywhere.
 * Issue #8 lifecycle: the pick persists per artifact (a remount keeps the
 * buttons disabled — re-clicking used to re-send a message); once a later
 * assistant reply exists (`revealed`), the wait line becomes the reveal note. */
export function GuessCard({ artifact, send, revealed = false }: { artifact: ArtifactRow; send: (text: string) => void; revealed?: boolean }): ReactNode {
  const prompt = typeof artifact.data.prompt === 'string' ? artifact.data.prompt : ''
  const options = (artifact.data.options ?? []) as Array<{ id: string; label: string }>
  const [picked, setPicked] = useState<string | null>(() => guessPickedOf(artifact.id))
  useEffect(() => { setPicked(guessPickedOf(artifact.id)) }, [artifact.id])
  return createElement('div', { className: 'lks-acard lks-acard-guess', 'data-lks-artifact': artifact.id },
    createElement('div', { className: 'lks-acard-head' }, tr('artifact.guess.title')),
    createElement('div', { className: 'lks-acard-guess-prompt' }, prompt),
    createElement('div', { className: 'lks-acard-guess-opts' },
      ...options.map(opt => createElement('button', {
        key: opt.id,
        className: `lks-acard-guess-opt${picked === opt.id ? ' picked' : ''}`,
        disabled: picked !== null,
        onClick: () => {
          setPicked(opt.id)
          markGuessPicked(artifact.id, opt.id)
          send(tr('artifact.guess.pick', { label: opt.label }))
        },
      }, opt.label))),
    picked !== null
      ? createElement('div', { className: `lks-acard-guess-wait${revealed ? ' revealed' : ''}` },
          revealed ? tr('artifact.guess.revealed') : tr('artifact.guess.wait'))
      : null)
}

/** Dispatch one artifact row to its card. */
export function ArtifactCard({ artifact, send, revealed = false }: { artifact: ArtifactRow; send: (text: string) => void; revealed?: boolean }): ReactNode {
  switch (artifact.artifactType) {
    case 'compare_table': return createElement(CompareTableCard, { artifact })
    case 'code_walkthrough': return createElement(CodeWalkthroughCard, { artifact })
    case 'diagram': return createElement(DiagramCard, { artifact })
    case 'guess': return createElement(GuessCard, { artifact, send, revealed })
    default: return null
  }
}

/** The fold bar's kind label (fallback when the artifact carries no title). */
const KIND_LABEL_KEY: Readonly<Record<string, string>> = {
  compare_table: 'artifact.kind.compare_table',
  code_walkthrough: 'artifact.kind.code_walkthrough',
  diagram: 'artifact.kind.diagram',
  guess: 'artifact.guess.title',
}

/**
 * Issue #8: every artifact card wears a fold bar — cards sediment into the
 * notebook by design, so nothing is deleted; folding keeps long conversations
 * readable (a folded card is one thin line). The explicit toggle persists per
 * artifact; absent a stored choice, `defaultFolded` decides (feed cards open,
 * the teach-stage and backlog surfaces start folded — the lesson prose owns
 * the first screen, issue #10).
 */
export function FoldableArtifactCard({ artifact, send, defaultFolded = false, revealed = false }: {
  artifact: ArtifactRow
  send: (text: string) => void
  defaultFolded?: boolean
  revealed?: boolean
}): ReactNode {
  const [folded, setFolded] = useState<boolean>(() => acardFoldStoredOf(artifact.id) ?? defaultFolded)
  const toggle = (): void => {
    setFolded(cur => {
      const next = !cur
      markAcardFoldStored(artifact.id, next)
      return next
    })
  }
  const title = artifact.title.trim() !== '' ? artifact.title : tr(KIND_LABEL_KEY[artifact.artifactType] ?? 'artifact.fold')
  return createElement('div', { className: `lks-acard-foldwrap${folded ? ' folded' : ''}`, 'data-lks-artifact': artifact.id },
    createElement('button', {
      className: 'lks-acard-fold',
      'aria-expanded': String(!folded),
      'data-tooltip': folded ? tr('artifact.unfold') : tr('artifact.fold'),
      onClick: toggle,
    },
      createElement('span', { className: 'lks-acard-fold-caret', 'aria-hidden': 'true' }, folded ? '▸' : '▾'),
      createElement('span', { className: 'lks-acard-fold-title' }, title)),
    folded ? null : createElement(ArtifactCard, { artifact, send, revealed }))
}

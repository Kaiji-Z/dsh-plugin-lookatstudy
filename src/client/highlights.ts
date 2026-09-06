/**
 * 讲解区画线定位（0.15.0 P2, upstream highlightText.ts v0.3.3 方案移植）:
 * 上游历经多轮后放弃绝对字符偏移（mark 存在/清除与 React 重渲会让两个
 * model 不一致导致错位），改用「选区文字 + 前后文指纹」在纯文本 model 上
 * 做文本搜索。这里同样：高亮来源 = 记录区笔记的 quote 本身 —— 删笔记即删
 * 高亮，无需独立锚点状态。纯函数部分（定位与分段规划）node:test 直测。
 * @module dsh-plugin-lookatstudy/client/highlights
 */

/** One prose text node mapped into the model's coordinate space. */
export interface ModelNode<T = unknown> {
  readonly node: T
  readonly start: number
  readonly end: number
}

export interface TextModel<T = unknown> {
  readonly text: string
  readonly nodes: readonly ModelNode<T>[]
}

/**
 * Locate a selection inside the model text: exact `selected` text search,
 * disambiguated by a fuzzy `surrounding` fingerprint (the same sentence
 * appearing twice resolves to the occurrence whose context matches).
 * @returns the global [start, end) in model.text, or null when absent.
 */
export function locateInModel(model: TextModel, selected: string, surrounding: string | undefined): { start: number; end: number } | null {
  const needle = selected.trim()
  if (needle.length < 2) return null
  const hits: number[] = []
  let from = 0
  for (;;) {
    const hit = model.text.indexOf(needle, from)
    if (hit === -1) break
    hits.push(hit)
    from = hit + 1
  }
  if (hits.length === 0) return null
  if (hits.length === 1 || surrounding === undefined || surrounding.trim() === '') {
    return { start: hits[0]!, end: hits[0]! + needle.length }
  }
  // fingerprint: surrounding = ~30 chars around the selection; the right
  // occurrence is the one maximizing overlap with that fingerprint.
  const finger = surrounding.replace(/\s+/g, '')
  let best = hits[0]!
  let bestScore = -1
  for (const hit of hits) {
    const context = model.text.slice(Math.max(0, hit - 30), hit + needle.length + 30).replace(/\s+/g, '')
    let score = 0
    for (let i = 0; i < finger.length; i += 4) {
      if (context.includes(finger.slice(i, i + 4))) score += 1
    }
    if (score > bestScore) {
      bestScore = score
      best = hit
    }
  }
  return { start: best, end: best + needle.length }
}

/** Plan the per-node segments covering global [start, end) — pure. */
export function planSegments(nodes: readonly ModelNode[], start: number, end: number): Array<{ index: number; localStart: number; localEnd: number }> {
  const segments: Array<{ index: number; localStart: number; localEnd: number }> = []
  nodes.forEach((entry, index) => {
    if (entry.end <= start || entry.start >= end) return
    segments.push({
      index,
      localStart: Math.max(0, start - entry.start),
      localEnd: Math.min(entry.end - entry.start, end - entry.start),
    })
  })
  return segments
}

/** Build the DOM text model for the prose container (the walker rules mirror
 *  upstream: skip script/style and KaTeX glyph layers; skip existing marks so
 *  save-time and apply-time models stay symmetric). */
export function getTextModel(container: HTMLElement, opts?: { includeMarks?: boolean }): TextModel<Text> {
  const nodes: ModelNode<Text>[] = []
  let text = ''
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = (node as Text).parentElement
      if (parent === null) return NodeFilter.FILTER_REJECT
      const tag = parent.tagName
      if (tag === 'SCRIPT' || tag === 'STYLE') return NodeFilter.FILTER_REJECT
      if (parent.closest('.katex-html')) return NodeFilter.FILTER_REJECT
      if (parent.closest('.katex-mathml') !== null && parent.closest('annotation') === null) return NodeFilter.FILTER_REJECT
      if (opts?.includeMarks !== true && parent.closest('mark.lks-hl') !== null) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })
  let n: Node | null
  while ((n = walker.nextNode()) !== null) {
    const t = n as Text
    const content = t.textContent ?? ''
    nodes.push({ node: t, start: text.length, end: text.length + content.length })
    text += content
  }
  return { text, nodes }
}

/** The mark class applied to persisted highlights. */
export const HIGHLIGHT_MARK = 'lks-hl'

/**
 * Apply one highlight range to the live DOM: split the boundary text nodes
 * and wrap the covering segments in marks. Returns the created marks.
 */
export function wrapRange(model: TextModel<Text>, start: number, end: number): HTMLElement[] {
  const marks: HTMLElement[] = []
  for (const seg of planSegments(model.nodes, start, end)) {
    const entry = model.nodes[seg.index]!
    const node = entry.node
    if (node.parentElement === null) continue
    if (node.parentElement.closest(`mark.${HIGHLIGHT_MARK}`) !== null) continue
    const mid = seg.localStart > 0 ? node.splitText(seg.localStart) : node
    const localEnd = seg.localEnd - seg.localStart
    if (mid.textContent !== null && mid.textContent.length > localEnd) mid.splitText(localEnd)
    const mark = document.createElement('mark')
    mark.className = HIGHLIGHT_MARK
    mid.parentElement!.insertBefore(mark, mid)
    mark.appendChild(mid)
    marks.push(mark)
  }
  return marks
}

/**
 * Render the persisted highlights for one lesson: each record-zone note with a
 * quote anchors a mark. Idempotent per call — call on a freshly rendered
 * (pre-mark) container; the model skips existing marks so re-entry is safe.
 * @returns how many notes got at least one mark.
 */
export function applyHighlights(container: HTMLElement, quotes: readonly string[]): number {
  let applied = 0
  for (const quote of quotes) {
    const trimmed = quote.trim()
    if (trimmed.length < 2) continue
    const model = getTextModel(container)
    const located = locateInModel(model, trimmed, undefined)
    if (located === null) continue
    if (wrapRange(model, located.start, located.end).length > 0) applied += 1
  }
  return applied
}

/**
 * Reading karaoke — the sentence highlight + follow for the teach prose's
 * read-aloud. Ported subset of upstream LookatStudy src/renderer/lib/
 * highlightText.ts (MIT License, https://github.com/Kaiji-Z/LookatStudy):
 * the v9 canonical whole-sentence alignment (punctuation/full-width
 * differences collapse; edge extension swallows opening quotes and sentence
 * punctuation so the highlight always covers the visible sentence), the v8
 * CSS Custom Highlight API registration (zero DOM mutation — span wrapping
 * fights React's reconciliation on every sentence tick; the span stays only
 * as a fallback), and the v0.18.1 line-box centering follow (a 13k-char
 * paragraph renders 3000px tall — element-box scrollIntoView pins at the
 * paragraph head while the highlight walks on; the sentence's own first-line
 * rect is what must stay in view). Not ported: companion avoidance, played
 * -prefix splitting, display-group spans (companion is retired in this
 * plugin; the controller's sentence index is already authoritative).
 * @module dsh-plugin-lookatstudy/client/reading-mark
 */

const WORD_CHAR_RE = /[0-9A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/
const OPEN_EDGE = '\u300c\u300e(\uff08[\u3010<\u300a"\'\u201c\u2018'
const CLOSE_EDGE = '\u3002\u300f\u300d)\uff09]\u3011>\u300b"\'\u201d\u2019!\uff01?\uff1f\u2026,\uff0c\u3001;\uff1b:\uff1a'

/** One char → canonical form (full-width→half-width, lowercase) or null when
 * the char is punctuation/space/symbol (all filtered). Pure (upstream). */
function canonChar(ch: string): string | null {
  const c = ch.codePointAt(0)!
  let s = ch
  if (c >= 0xff01 && c <= 0xff5e) s = String.fromCharCode(c - 0xfee0)
  return WORD_CHAR_RE.test(s) ? s.toLowerCase() : null
}

/** Text → canonical string + canonical→original offset map. Pure (upstream). */
export function canonicalSpeechIndex(text: string): { canon: string; map: number[] } {
  let canon = ''
  const map: number[] = []
  for (let i = 0; i < text.length; i++) {
    const c = canonChar(text[i]!)
    if (c !== null) {
      canon += c
      map.push(i)
    }
  }
  return { canon, map }
}

/**
 * Align one speech sentence against the prose's full text (pure). Whole
 * canonical indexOf first (the common case — punctuation/width differences
 * vanish); on failure a token-interval match lets displayed-but-unspoken
 * runs (inline code, table pipes) sit inside the match as gaps; the matched
 * span then extends over opening quotes before and sentence punctuation
 * after, so the highlight covers the complete visible sentence.
 * @returns [start, end) offsets into `text`, or null.
 */
export function matchSentenceAligned(text: string, sentence: string, from = 0): [number, number] | null {
  const { canon, map } = canonicalSpeechIndex(text)
  const sen = canonicalSpeechIndex(sentence).canon
  if (sen === '' || canon === '') return null
  let hit = canon.indexOf(sen, Math.min(from, canon.length))
  if (hit === -1) hit = canon.indexOf(sen)
  let start: number
  let end: number
  if (hit !== -1) {
    start = map[hit]!
    end = (map[hit + sen.length - 1] ?? map[map.length - 1]!) + 1
  } else {
    // token-interval fallback: SHORT head/tail anchors (2 canon chars — long
    // anchors break on the very display gaps this path exists for), letting
    // unspoken display runs ride in between as gaps
    const head = sen.slice(0, Math.min(2, sen.length))
    const tail = sen.slice(-Math.min(2, sen.length))
    const h = canon.indexOf(head, Math.min(from, canon.length))
    if (h === -1) return null
    const t = tail === '' ? h + head.length - 1 : canon.lastIndexOf(tail, Math.min(canon.length - 1, h + sen.length + 128))
    if (t < h + head.length - 1) return null
    start = map[h]!
    end = (map[t + tail.length - 1] ?? map[map.length - 1]!) + 1
  }
  while (start > 0 && OPEN_EDGE.includes(text[start - 1]!)) start--
  while (end < text.length && CLOSE_EDGE.includes(text[end]!)) end++
  return [start, end]
}

/** The prose's flat text model: concatenated text nodes (skipping the
 * fallback mark spans themselves) with node/offset boundaries. */
interface TextModel { text: string; nodes: Array<{ node: Text; start: number }> }

function buildTextModel(container: HTMLElement): TextModel {
  const nodes: TextModel['nodes'] = []
  let text = ''
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Node): number {
      let p: Node | null = node.parentNode
      while (p !== null && p !== container) {
        if (p instanceof HTMLElement && (p.tagName === 'SCRIPT' || p.tagName === 'STYLE' || p.classList.contains('lks14-reading-mark'))) return NodeFilter.FILTER_REJECT
        p = p.parentNode
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    const t = n as Text
    nodes.push({ node: t, start: text.length })
    text += t.data
  }
  return { text, nodes }
}

function offsetsToRange(model: TextModel, start: number, end: number): Range | null {
  const range = document.createRange()
  let setStart = false
  let setEnd = false
  for (const { node, start: ns } of model.nodes) {
    const len = node.data.length
    if (!setStart && start >= ns && start <= ns + len) { range.setStart(node, start - ns); setStart = true }
    if (!setEnd && end >= ns && end <= ns + len) { range.setEnd(node, end - ns); setEnd = true; break }
  }
  return setStart && setEnd ? range : null
}

const READING_HIGHLIGHT_NAME = 'lks-reading'
export const READING_MARK_CLASS = 'lks14-reading-mark'
const readingCursors = new WeakMap<HTMLElement, number>()

/** Drop the registry highlight outright (unmount/stop; DOM may be gone). */
export function clearReadingHighlightRegistry(): void {
  const cssLike = CSS as unknown as { highlights?: Map<string, unknown> }
  try { cssLike.highlights?.delete(READING_HIGHLIGHT_NAME) } catch { /* no Highlight API */ }
}

/** Remove the reading mark (registry + fallback spans) from one container. */
export function clearReadingMark(container: HTMLElement): void {
  clearReadingHighlightRegistry()
  container.querySelectorAll(`.${READING_MARK_CLASS}`).forEach(m => {
    const parent = m.parentNode
    if (parent !== null) {
      while (m.firstChild !== null) parent.insertBefore(m.firstChild, m)
      parent.removeChild(m)
    }
  })
  container.normalize()
}

/** A fresh read restarts the monotonic cursor. */
export function resetReadingCursor(container: HTMLElement): void {
  readingCursors.set(container, 0)
}

/**
 * Highlight the currently spoken sentence in the prose. Returns the marked
 * Range (null when the sentence cannot be aligned — the read keeps going,
 * only the highlight skips).
 */
export function markReadingSentence(container: HTMLElement, sentence: string): Range | null {
  clearReadingMark(container)
  const trimmed = sentence.trim()
  if (trimmed === '') return null
  const model = buildTextModel(container)
  const from = readingCursors.get(container) ?? 0
  let m = matchSentenceAligned(model.text, trimmed, from)
  if (m === null && from > 0) m = matchSentenceAligned(model.text, trimmed, 0) // self-heal after a re-render
  if (m === null) return null
  readingCursors.set(container, m[1])
  const range = offsetsToRange(model, m[0], m[1])
  if (range === null) return null
  const cssLike = CSS as unknown as { highlights?: Map<string, unknown> }
  if (typeof Highlight !== 'undefined' && cssLike.highlights !== undefined) {
    try {
      cssLike.highlights.set(READING_HIGHLIGHT_NAME, new Highlight(range))
      return range
    } catch { /* fall through to span */ }
  }
  const mark = document.createElement('span')
  mark.className = READING_MARK_CLASS
  try {
    range.surroundContents(mark)
    return range
  } catch {
    return range
  }
}

/**
 * Keep the marked sentence's FIRST-LINE rect inside the scroll viewport
 * (upstream v0.18.1): element-box centering pins on 3000px paragraphs; the
 * sentence's own line box is what the eye follows. Smooth-centers only when
 * the line leaves a 48px band.
 */
export function centerReadingRangeInView(range: Range, scroller: HTMLElement | null): void {
  const rects = range.getClientRects()
  const line = rects.length > 0 && rects[0]!.height > 0 ? rects[0]! : null
  if (line === null) return
  if (scroller === null) return
  const sTop = scroller.getBoundingClientRect().top
  const rel = line.top - sTop
  if (rel < 48 || rel > scroller.clientHeight - 48) {
    scroller.scrollTo({ top: scroller.scrollTop + rel - scroller.clientHeight / 2, behavior: 'smooth' })
  }
}

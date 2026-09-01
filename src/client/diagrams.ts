/**
 * Blackboard diagram views (SPEC Phase 2): the lesson concept map (ELK layered
 * layout via the vendored cmap-elk-layout + CDN elkjs, draw.io-flavored SVG
 * skin rendered plugin-side). Degrades honestly: any CDN/ELK failure leaves a
 * one-line notice instead of a broken pane.
 *
 * The lesson mind map view was RETIRED with upstream v0.26.0 (2026-09-01
 * port): body text that has headings already shows its structure, text without
 * headings yields a first-line-truncated node graph nobody can read — both
 * lose — and this concept map already covers the semantic-structure need at
 * higher quality. Its three CDN imports went with it.
 */

import { layoutConceptMap, type CmNode, type CmEdge } from '../vendor/cmap-elk-layout.ts'


/** Lesson concept map: the lesson node + its concepts (weak ones accented),
 *  laid out by the vendored ELK pipeline, skinned draw.io-style (plugin-original,
 *  upstream's skin is coupled to its token pipeline). Mastery shades the nodes. */
export async function renderLessonConceptMap(
  container: HTMLElement,
  lessonTitle: string,
  concepts: ReadonlyArray<{ title: string; masteryPct: number }>,
): Promise<void> {
  const nodes: CmNode[] = [{ id: 'lesson', label: lessonTitle }, ...concepts.map(c => ({ id: `c-${c.title}`, label: c.title }))]
  const edges: CmEdge[] = concepts.map(c => ({ from: 'lesson', to: `c-${c.title}` }))
  const layout = await layoutConceptMap(nodes, edges)
  const masteryBy = new Map(concepts.map(c => [`c-${c.title}`, c.masteryPct]))
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('width', String(Math.max(320, layout.width)))
  svg.setAttribute('height', String(Math.max(200, layout.height)))
  svg.setAttribute('viewBox', `0 0 ${layout.width} ${layout.height}`)
  svg.setAttribute('style', 'max-width:100%;background:var(--dsw-surface-1, #fff);border:1px solid var(--dsw-border-1, #d0d7de);border-radius:8px')
  for (const e of layout.edges) {
    const path = document.createElementNS(ns, 'path')
    path.setAttribute('d', e.pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' '))
    path.setAttribute('fill', 'none')
    path.setAttribute('stroke', 'var(--dsw-border-2, #8b949e)')
    path.setAttribute('stroke-width', '1.5')
    svg.append(path)
  }
  for (const n of layout.nodes) {
    const g = document.createElementNS(ns, 'g')
    g.setAttribute('transform', `translate(${n.x},${n.y})`)
    const rect = document.createElementNS(ns, 'rect')
    const isLesson = n.id === 'lesson'
    const mastery = masteryBy.get(n.id)
    rect.setAttribute('width', String(n.w))
    rect.setAttribute('height', String(n.h))
    rect.setAttribute('rx', '6')
    rect.setAttribute('fill', mastery !== undefined && mastery < 70 ? '#fff3d9' : 'var(--dsw-surface-2, #f6f8fa)')
    rect.setAttribute('stroke', isLesson ? 'var(--dsw-accent-1, #0969da)' : 'var(--dsw-border-2, #8b949e)')
    rect.setAttribute('stroke-width', isLesson ? '2' : '1')
    g.append(rect)
    n.lines.forEach((line, li) => {
      const label = document.createElementNS(ns, 'text')
      label.setAttribute('x', String(n.w / 2))
      label.setAttribute('y', String(n.h / 2 - (n.lines.length - 1) * 7 + li * 14 + 4))
      label.setAttribute('text-anchor', 'middle')
      label.setAttribute('font-size', isLesson ? '13' : '12')
      label.setAttribute('font-weight', isLesson ? '600' : '400')
      label.setAttribute('fill', 'var(--dsw-ink-1, #1f2328)')
      label.textContent = line
      g.append(label)
    })
    svg.append(g)
  }
  container.append(svg)
}

/**
 * Post-render blackboard enhancement (SPEC Phase 2): math (KaTeX), code
 * highlighting (shiki), and mermaid diagrams — every dependency loaded from a
 * CDN at runtime (zero-dependency mandate: nothing enters the bundle), every
 * failure degrading silently to the existing plain rendering. Upstream parity:
 * math-normalize runs host-side before renderMarkdown; the CDN + lazy-singleton
 * pattern follows upstream lazy-shiki/lazy-mermaid, pointed at esm.sh/cdnjs.
 *
 * Test seams: every loader is injectable via `setEnhanceDeps` so node:test
 * proves the enhance/degrade paths offline (the structural-test discipline:
 * prove a gate fails first, then trust its green).
 */

/** Map a lang-xxx class to shiki's grammar id (upstream's curated set, aliases included). */
const LANG_ALIAS: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx', mjs: 'javascript', cjs: 'javascript',
  py: 'python', rb: 'ruby', rs: 'rust', 'c++': 'cpp', cs: 'csharp', kt: 'kotlin', sh: 'bash', shell: 'bash', zsh: 'bash',
  yml: 'yaml', md: 'markdown', tex: 'latex', docker: 'dockerfile',
}

import { rewriteFlowchartToElk } from '../vendor/mermaid-elk-rewrite.ts'

type KatexLike = { renderToString(tex: string, opts: Record<string, unknown>): string }
type ShikiLike = { codeToHtml(code: string, opts: Record<string, unknown>): Promise<string> }
type MermaidLike = { registerLayoutLoaders(l: unknown): void; initialize(cfg: Record<string, unknown>): void; render(id: string, code: string): Promise<{ svg: string }> }

export interface EnhanceDeps {
  loadKatex?: () => Promise<KatexLike>
  loadShiki?: () => Promise<ShikiLike>
  loadMermaid?: () => Promise<MermaidLike>
}
let deps: EnhanceDeps = {}
export function setEnhanceDeps(d: EnhanceDeps | null): void { deps = d ?? {} }

/* ---------------- CDN loaders (production defaults) ---------------- */

const CDN = {
  katexJs: 'https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.js',
  katexCss: 'https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.css',
  shiki: 'https://esm.sh/shiki@1.29.2',
  mermaid: 'https://esm.sh/mermaid@11.4.1',
  mermaidElk: 'https://esm.sh/@mermaid-js/layout-elk@0.1.7',
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script')
    el.src = src
    el.onload = () => { resolve() }
    el.onerror = () => { reject(new Error(`script load failed: ${src}`)) }
    document.head.append(el)
  })
}

let katexPromise: Promise<KatexLike> | null = null
function defaultLoadKatex(): Promise<KatexLike> {
  katexPromise ??= (async () => {
    if (!document.querySelector(`link[data-lks-katex]`)) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = CDN.katexCss
      link.setAttribute('data-lks-katex', '1')
      document.head.append(link)
    }
    if ((window as { katex?: KatexLike }).katex === undefined) await loadScript(CDN.katexJs)
    const katex = (window as { katex?: KatexLike }).katex
    if (katex === undefined) throw new Error('katex missing after load')
    return katex
  })()
  return katexPromise
}

let shikiPromise: Promise<ShikiLike> | null = null
function defaultLoadShiki(): Promise<ShikiLike> {
  shikiPromise ??= import(/* @vite-ignore */ CDN.shiki).then((mod: Record<string, unknown>) => {
    const create = mod.createHighlighter as ((opts: Record<string, unknown>) => Promise<ShikiLike>) | undefined
    if (create === undefined) throw new Error('shiki createHighlighter missing')
    return create({ themes: ['github-dark', 'github-light'], langs: ['typescript', 'javascript', 'python', 'bash', 'json', 'yaml', 'css', 'html', 'markdown', 'cpp', 'go', 'rust', 'java', 'sql'] })
  }) as Promise<ShikiLike>
  return shikiPromise
}

let mermaidPromise: Promise<MermaidLike> | null = null
function defaultLoadMermaid(): Promise<MermaidLike> {
  mermaidPromise ??= (async () => {
    const mod = await import(/* @vite-ignore */ CDN.mermaid) as Record<string, unknown>
    const mermaid = mod.default as MermaidLike
    try {
      const elk = await import(/* @vite-ignore */ CDN.mermaidElk) as Record<string, unknown>
      mermaid.registerLayoutLoaders(elk.default)
    } catch { /* ELK unavailable → mermaid falls back to dagre silently */ }
    mermaid.initialize({ startOnLoad: false, theme: 'base', securityLevel: 'loose' })
    return mermaid
  })()
  return mermaidPromise
}

/* ---------------- enhancers ---------------- */

/** Split one text node's data around the FIRST math span; returns null when none. */
function findMathSpan(text: string): { before: string; tex: string; after: string; display: boolean } | null {
  const display = /\$\$([^$]+)\$\$/.exec(text)
  const inline = /\$([^$\n]+)\$/.exec(text)
  if (display === null && inline === null) return null
  const m = display !== null && (inline === null || display.index <= inline.index) ? { ...display, display: true } : inline === null ? null : { ...inline, display: false }
  if (m === null) return null
  return { before: text.slice(0, m.index), tex: m[1]!, after: text.slice(m.index + m[0].length), display: m.display }
}

/** KaTeX every $..$ / $$..$$ in the container; degrades to plain text on any failure. */
export async function enhanceMath(container: HTMLElement): Promise<number> {
  let katex: KatexLike
  try { katex = await (deps.loadKatex ?? defaultLoadKatex)() } catch { return 0 }
  let replaced = 0
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const targets: Text[] = []
  let node: Node | null
  while ((node = walker.nextNode()) !== null) {
    if (findMathSpan((node as Text).data) !== null && (node as Text).parentElement?.tagName !== 'CODE') targets.push(node as Text)
  }
  for (const t of targets) {
    const span = findMathSpan(t.data)
    if (span === null) continue
    try {
      const html = katex.renderToString(span.tex, { displayMode: span.display, throwOnError: false })
      const holder = document.createElement('span')
      holder.innerHTML = html
      if (span.before !== '') t.before(document.createTextNode(span.before))
      t.before(holder)
      t.data = span.after
      replaced++
    } catch { /* leave the text as-is */ }
  }
  return replaced
}

/** shiki-highlight every fenced code block; unknown langs and failures keep the plain <pre>. */
export async function enhanceCode(container: HTMLElement): Promise<number> {
  let shiki: ShikiLike
  try { shiki = await (deps.loadShiki ?? defaultLoadShiki)() } catch { return 0 }
  let replaced = 0
  const blocks = [...container.querySelectorAll<HTMLElement>('pre > code')]
  for (const code of blocks) {
    if (code.dataset.lksEnhanced === '1') continue
    const langClass = [...code.classList].find(c => c.startsWith('lang-'))
    if (langClass === undefined) continue
    const lang = LANG_ALIAS[langClass.slice(5)] ?? langClass.slice(5)
    try {
      const html = await shiki.codeToHtml(code.textContent ?? '', {
        lang,
        themes: { light: 'github-light', dark: 'github-dark' },
        defaultColor: false,
        cssVariables: { '--shiki-dark': 'var(--shiki-dark, #e6edf3)' },
      })
      code.dataset.lksEnhanced = '1'
      const pre = code.parentElement!
      const wrap = document.createElement('div')
      wrap.className = 'lks-shiki'
      wrap.innerHTML = html
      pre.replaceWith(wrap)
      replaced++
    } catch { code.dataset.lksEnhanced = '1' /* don't retry a failing lang */ }
  }
  return replaced
}

/** Render mermaid fence blocks to SVG (ELK layout via the registered loader);
 *  the flowchart prefix rewrite is upstream's mermaid-elk-rewrite, vendored. */
export async function enhanceDiagrams(container: HTMLElement): Promise<number> {
  let mermaid: MermaidLike
  try { mermaid = await (deps.loadMermaid ?? defaultLoadMermaid)() } catch { return 0 }
  let replaced = 0
  const blocks = [...container.querySelectorAll<HTMLElement>('pre > code.lang-mermaid')]
  for (const code of blocks) {
    if (code.dataset.lksEnhanced === '1') continue
    code.dataset.lksEnhanced = '1'
    try {
      const { svg } = await mermaid.render(`lks-mermaid-${replaced}`, rewriteFlowchartToElk(code.textContent ?? ''))
      const wrap = document.createElement('div')
      wrap.className = 'lks-mermaid'
      wrap.innerHTML = svg
      code.parentElement!.replaceWith(wrap)
      replaced++
    } catch { /* keep the code block as-is */ }
  }
  return replaced
}

/** The full pass over one freshly-rendered container. Never throws. */
export async function enhanceRendered(container: HTMLElement): Promise<void> {
  try { await enhanceDiagrams(container) } catch { /* degrade */ }
  try { await enhanceCode(container) } catch { /* degrade */ }
  try { await enhanceMath(container) } catch { /* degrade */ }
}


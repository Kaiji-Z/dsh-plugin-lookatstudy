/**
 * The shared CodeBlock's client half (D8): one delegated click listener for
 * every .lks-codeblock-copy the markdown pipeline emits — chat rows, lesson
 * prose, notebook notes all funnel through the same pipeline, so one
 * document-level wire serves every zone (idempotent; safe to call from any
 * mount). Copy rides the async Clipboard API and the label carries the
 * 1500ms copied state, upstream CodeBlock semantics.
 * @module dsh-plugin-lookatstudy/client/codeblock
 */

import { tr } from './locale.ts'

let wired = false

export function wireCodeBlockCopy(): void {
  if (wired || typeof document === 'undefined') return
  wired = true
  document.addEventListener('click', (e: Event) => {
    const target = e.target instanceof Element ? e.target : null
    const btn = target?.closest('.lks-codeblock-copy')
    if (btn === null || btn === undefined || !(btn instanceof HTMLButtonElement)) return
    const pre = btn.closest('.lks-codeblock')?.querySelector('pre')
    if (pre === null || pre === undefined) return
    const text = pre.textContent ?? ''
    void navigator.clipboard?.writeText(text).then(() => {
      btn.textContent = tr('chat.copied')
      btn.classList.add('copied')
      setTimeout(() => {
        btn.textContent = tr('chat.copy')
        btn.classList.remove('copied')
      }, 1500)
    }, () => { /* clipboard denied — the label simply stays */ })
  })
}

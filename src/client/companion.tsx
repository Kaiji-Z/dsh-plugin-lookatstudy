/**
 * The companion creature — the upstream 伴学生物's minimal honest DOM port
 * (0.15.0 P7): a small being in the panel's bottom-right corner with five
 * forms, a pure mood machine (idle / talking / celebrating / encouraging),
 * and the a11y iron rule carried over — reduced-motion renders it static.
 * Upstream's Electron-native life (mic envelopes, typing squeeze, drag-throw)
 * has no web-panel equivalent and stays unported by design.
 * @module dsh-plugin-lookatstudy/client/companion
 */

import { createElement, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { tr } from './locale.ts'

export type CompanionFormId = 'ember' | 'frost' | 'moss' | 'star' | 'ink'
export type CompanionMood = 'idle' | 'talking' | 'celebrating' | 'encouraging'

export const COMPANION_FORMS: ReadonlyArray<{ id: CompanionFormId; labelKey: string; body: string; accent: string }> = [
  { id: 'ember', labelKey: 'companion.form.ember', body: '#f59e0b', accent: '#dc2626' },
  { id: 'frost', labelKey: 'companion.form.frost', body: '#7dd3fc', accent: '#0284c7' },
  { id: 'moss', labelKey: 'companion.form.moss', body: '#86efac', accent: '#16a34a' },
  { id: 'star', labelKey: 'companion.form.star', body: '#c4b5fd', accent: '#7c3aed' },
  { id: 'ink', labelKey: 'companion.form.ink', body: '#cbd5e1', accent: '#334155' },
]

/** Normalize a stored form id; junk falls back to 小焰 (upstream's default). */
export function normalizeCompanionForm(stored: string | null): CompanionFormId {
  return COMPANION_FORMS.some(f => f.id === stored) ? stored as CompanionFormId : 'ember'
}

export function storedCompanionForm(): CompanionFormId {
  try {
    return normalizeCompanionForm(localStorage.getItem('dsh-plugin-lookatstudy:companion-form'))
  } catch {
    return 'ember'
  }
}

export function storeCompanionForm(id: CompanionFormId): void {
  try {
    localStorage.setItem('dsh-plugin-lookatstudy:companion-form', id)
  } catch { /* storage unavailable — the default renders */ }
}

/**
 * The mood machine — pure. `celebrate` and `encourage` are momentary (the
 * view decays them back through `decay`); `talking` latches while read-aloud
 * runs; poke is a self-echoing celebration.
 */
export function nextCompanionMood(current: CompanionMood, event: 'talk-start' | 'talk-end' | 'celebrate' | 'encourage' | 'decay' | 'poke'): CompanionMood {
  switch (event) {
    case 'talk-start': return 'talking'
    case 'talk-end': return current === 'talking' ? 'idle' : current
    case 'celebrate':
    case 'poke': return 'celebrating'
    case 'encourage': return 'encouraging'
    case 'decay': return current === 'celebrating' || current === 'encouraging' ? 'idle' : current
    default: return current
  }
}

/** One creature face — the shared skin every form wears. */
function CompanionFace({ form, mood }: { form: CompanionFormId; mood: CompanionMood }): ReactNode {
  const skin = COMPANION_FORMS.find(f => f.id === form) ?? COMPANION_FORMS[0]!
  // eyes: happy arcs when celebrating; plain dots otherwise
  const eye = mood === 'celebrating'
    ? 'M -3.4 0 q 1.7 -2.6 3.4 0'
    : 'M -3.4 -1.4 a 1.4 1.4 0 1 0 0.01 0'
  const mouth = mood === 'celebrating'
    ? 'M 20 21 q 4 4 8 0'
    : mood === 'encouraging'
      ? 'M 21 22 q 3 -2.5 6 0'
      : 'M 21 21 q 3 2.4 6 0'
  return createElement('svg', { width: 64, height: 64, viewBox: '0 0 64 64', 'aria-hidden': 'true' },
    createElement('g', null,
      createElement('circle', { cx: 32, cy: 34, r: 20, fill: skin.body, stroke: skin.accent, strokeWidth: 2 }),
      form === 'ember'
        ? createElement('path', { d: 'M32 4 q6 8 3 12 q8 -2 9 6 q4 -1 4 4 l-2 4 H18 l-2 -4 q0 -5 4 -4 q1 -8 9 -6 q-3 -4 3 -12z', fill: skin.accent, opacity: 0.85 })
        : form === 'star'
          ? createElement('path', { d: 'M32 2 l4 8 9 1 -6.5 6 1.5 9 -8.5 -4.5 -8 4.5 1.5 -9 -6.5 -6 9 -1z', fill: skin.accent, opacity: 0.85 })
          : form === 'moss'
            ? createElement('path', { d: 'M32 2 q-2 6 2 10 q-8 0 -8 6 H40 q0 -6 -8 -6 q4 -4 0 -10z', fill: skin.accent, opacity: 0.85 })
            : form === 'ink'
              ? createElement('path', { d: 'M32 2 q8 12 8 18 a8 8 0 1 1 -16 0 q0 -6 8 -18z', fill: skin.accent, opacity: 0.55 })
              : createElement('path', { d: 'M18 12 l3 5 5 -1 -1 5 5 3 -5 3 1 5 -5 -1 -3 5 -3 -5 -5 1 1 -5 -5 -3 5 -3 -1 -5 5 1z', fill: skin.accent, opacity: 0.7 }),
      createElement('path', { d: eye, transform: 'translate(25 30)', stroke: skin.accent, strokeWidth: 1.6, fill: mood === 'celebrating' ? 'none' : skin.accent, strokeLinecap: 'round' }),
      createElement('path', { d: eye, transform: 'translate(14 30)', stroke: skin.accent, strokeWidth: 1.6, fill: mood === 'celebrating' ? 'none' : skin.accent, strokeLinecap: 'round' }),
      createElement('path', { d: mouth, stroke: skin.accent, strokeWidth: 1.8, fill: 'none', strokeLinecap: 'round' })))
}

/** The creature: fixed bottom-right inside the panel, mood-animated, pokeable. */
export function Companion({ mood, onPoke }: { mood: CompanionMood; onPoke?: () => void }): ReactNode {
  const form = storedCompanionForm()
  return createElement('div', {
    className: `lks-companion mood-${mood}`,
    'data-lks-companion': form,
    title: tr('companion.poke'),
    role: 'button',
    tabIndex: 0,
    'aria-label': tr('companion.poke'),
    onClick: () => { onPoke?.() },
    onKeyDown: (e: { key: string; preventDefault: () => void }) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onPoke?.()
      }
    },
  }, createElement(CompanionFace, { form, mood }))
}

/** The hook driving one creature instance: event → mood, momentary decay. */
export function useCompanionMood(): { mood: CompanionMood; emit: (event: Parameters<typeof nextCompanionMood>[1]) => void } {
  const [mood, setMood] = useState<CompanionMood>('idle')
  const moodRef = useRef(mood)
  moodRef.current = mood
  const emit = (event: Parameters<typeof nextCompanionMood>[1]): void => {
    const next = nextCompanionMood(moodRef.current, event)
    if (next !== moodRef.current) {
      moodRef.current = next
      setMood(next)
    }
  }
  // momentary moods decay after 2.4s (upstream celebration 落点 timing, compressed)
  useEffect(() => {
    if (mood !== 'celebrating' && mood !== 'encouraging') return
    const timer = setTimeout(() => {
      moodRef.current = nextCompanionMood(moodRef.current, 'decay')
      setMood(moodRef.current)
    }, 2400)
    return () => { clearTimeout(timer) }
  }, [mood])
  return { mood, emit }
}

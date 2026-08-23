/**
 * The composer dock status pill: one `conversation.composer.dock` entry (the
 * ambient readout band under the composer, next to the token stats) showing
 * due reviews / streak / level while the study surface is ACTIVE — dormant
 * installs render nothing at all, the same visibility the tool registry has.
 * Data rides the shared 3 s poll store (no extra requests). Display-only:
 * conversation-view tab switching is ui-conversation-private (the starter
 * button's limitation), so the tooltip points at the Study tab instead.
 * @module dsh-plugin-lookatstudy/client/dock
 */

import { createElement } from 'react'
import type { ReactNode } from 'react'
import { useStudy } from './data.ts'
import { tr } from './locale.ts'

/** Pure projection of the pill's segments (testable without React). */
export function dockSegments(progress: { dueCount: number; streak: number; level: number }): ReadonlyArray<{ key: string; text: string }> {
  return [
    { key: 'due', text: tr('dock.due', { count: progress.dueCount }) },
    { key: 'streak', text: tr('dock.streak', { days: progress.streak }) },
    { key: 'lv', text: tr('dock.lv', { level: progress.level }) },
  ]
}

/** The dock entry component; renders nothing while data is loading or dormant. */
export function StudyDockPill(): ReactNode {
  const { data } = useStudy()
  if (data === null || data.active !== true) return null
  const segments = dockSegments({ dueCount: data.dueCount, streak: data.progress.streak, level: data.progress.level })
  return createElement('span', {
    className: 'lks-root lks-dockpill',
    title: tr('dock.title', { due: data.dueCount, streak: data.progress.streak, level: data.progress.level }),
  },
  ...segments.map(s => createElement('span', { key: s.key, className: `lks-dockseg lks-dock-${s.key}` }, s.text)),
  )
}

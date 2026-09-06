/**
 * The plugin's settings page: one `settings.section` entry riding the host's
 * settings shell. Teaching style and study mode write through the same host
 * routes the study tab uses (POST /api/mode, /api/active — the latter syncs
 * the tool registry before responding); stats and the state-file path are
 * read-only projections of the shared poll store. Pure display + the store's
 * existing write actions; no new routes, no new requests beyond the poll.
 * @module dsh-plugin-lookatstudy/client/settings
 */

import { createElement, useState } from 'react'
import type { ReactNode } from 'react'
import { useStudy, TTS_VOICES, storedTtsVoice, storeTtsVoice } from './data.ts'
import { tr } from './locale.ts'
import { ActionError } from './views.tsx'

/** The three souls in pill order (same shape as the study tab's pills). */
const MODES: ReadonlyArray<{ id: 'direct' | 'guide' | 'practice'; labelKey: string; hintKey: string }> = [
  { id: 'direct', labelKey: 'soul.direct', hintKey: 'soul.direct.hint' },
  { id: 'guide', labelKey: 'soul.guide', hintKey: 'soul.guide.hint' },
  { id: 'practice', labelKey: 'soul.practice', hintKey: 'soul.practice.hint' },
]

/**
 * The settings section component. Props from the settings shell (`close`) are
 * unused — every control stays on the page.
 */
export function StudySettingsSection(): ReactNode {
  const { data, setMode, activate } = useStudy()
  const [error, setError] = useState<string | null>(null)
  const [voice, setVoice] = useState(storedTtsVoice)
  const fire = (action: Promise<void>): void => {
    action.then(() => { setError(null) }, (err: unknown) => { setError(err instanceof Error ? err.message : String(err)) })
  }
  const progress = data?.progress
  return createElement('div', { className: 'lks-root lks-settings' },
    createElement('section', { className: 'lks-set-row' },
      createElement('h3', null, tr('settings.mode')),
      createElement('p', { className: 'lks-set-hint' }, tr('settings.mode.hint')),
      createElement('div', { className: 'lks-pills' },
        ...MODES.map(mode => createElement('button', {
          key: mode.id,
          className: `lks-pill${data?.mode === mode.id ? ' on' : ''}`,
          title: tr(mode.hintKey),
          onClick: () => { fire(setMode(mode.id)) },
        }, tr(mode.labelKey))),
      ),
    ),
    createElement('section', { className: 'lks-set-row' },
      createElement('h3', null, tr('settings.studyMode')),
      createElement('p', { className: 'lks-set-hint' }, tr('settings.studyMode.hint')),
      createElement('div', null,
        createElement('button', {
          className: `lks-btn ${data?.active === true ? 'ghost' : 'primary'}`,
          onClick: () => { if (data !== null) fire(activate(!data.active)) },
        }, data?.active === true ? tr('settings.turnOff') : tr('settings.turnOn')),
        createElement('span', { className: 'lks-set-state' }, data?.active === true ? tr('settings.on') : tr('settings.off')),
      ),
    ),
    createElement('section', { className: 'lks-set-row' },
      createElement('h3', null, tr('settings.voice')),
      createElement('p', { className: 'lks-set-hint' }, tr('settings.voice.hint')),
      createElement('div', null,
        createElement('select', {
          className: 'lks-set-select',
          value: voice,
          onChange: (e: { target: { value: string } }) => { storeTtsVoice(e.target.value); setVoice(e.target.value) },
        }, ...TTS_VOICES.map(v => createElement('option', { key: v.id, value: v.id }, tr(v.labelKey)))),
      ),
    ),
    progress === undefined ? null : createElement('section', { className: 'lks-set-row' },
      createElement('h3', null, tr('settings.stats')),
      createElement('ul', { className: 'lks-set-stats' },
        createElement('li', null, tr('settings.stats.courses', { count: data?.courses.length ?? 0 })),
        createElement('li', null, tr('settings.stats.xp', { xp: progress.totalXp, level: progress.level, pct: progress.levelPct })),
        createElement('li', null, tr('settings.stats.today', { xp: progress.todayXp, goal: progress.dailyGoal })),
        createElement('li', null, tr('settings.stats.streak', { days: progress.streak, best: progress.longestStreak, freeze: progress.freezeCount })),
      ),
    ),
    createElement('section', { className: 'lks-set-row' },
      createElement('h3', null, tr('settings.about')),
      createElement('p', { className: 'lks-set-hint' }, tr('settings.about.hint')),
      data?.version ? createElement('a',
        { href: `https://github.com/Kaiji-Z/dsh-plugin-lookatstudy/releases/tag/v${data.version}`, target: '_blank', rel: 'noreferrer' },
        `v${data.version}`) : null,
    ),
    createElement('section', { className: 'lks-set-row' },
      createElement('h3', null, tr('settings.stateFile')),
      createElement('p', { className: 'lks-set-hint' }, tr('settings.stateFile.hint')),
      data === null ? null : createElement('code', { className: 'lks-set-path' }, data.statePath),
    ),
    createElement(ActionError, { error }),
  )
}

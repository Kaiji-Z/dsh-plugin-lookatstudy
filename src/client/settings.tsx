/**
 * The plugin's settings page: one `settings.section` entry riding the host's
 * settings shell. Teaching style and study mode write through the same host
 * routes the study tab uses (POST /api/mode, /api/active — the latter syncs
 * the tool registry before responding); stats and the state-file path are
 * read-only projections of the shared poll store. Pure display + the store's
 * existing write actions; no new routes, no new requests beyond the poll.
 * @module dsh-plugin-lookatstudy/client/settings
 */

import { createElement, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useStudy, TTS_VOICES, storedTtsVoice, storeTtsVoice } from './data.ts'
import { MBTI_TYPES, expandMbtiToStyle, MOTIVE_DISPLAY, MOTIVE_STAGES, parseInterestsInput, type MbtiType, type MotiveStage } from '../learner-profile.ts'
import { tr } from './locale.ts'
import { ActionError } from './views.tsx'

/** The three souls in pill order (same shape as the study tab's pills). */
const MODES: ReadonlyArray<{ id: 'direct' | 'guide' | 'practice'; labelKey: string; hintKey: string }> = [
  { id: 'direct', labelKey: 'soul.direct', hintKey: 'soul.direct.hint' },
  { id: 'guide', labelKey: 'soul.guide', hintKey: 'soul.guide.hint' },
  { id: 'practice', labelKey: 'soul.practice', hintKey: 'soul.practice.hint' },
]


/** The four style dims (label key per value), upstream's DIM_LABELS UI face. */
const STYLE_DIMS: ReadonlyArray<{ key: 'start' | 'interaction' | 'feedback' | 'pacing'; values: ReadonlyArray<[string, string]> }> = [
  { key: 'start', values: [['analogy', 'settings.style.analogy'], ['framework', 'settings.style.framework']] },
  { key: 'interaction', values: [['dialogue', 'settings.style.dialogue'], ['lecture', 'settings.style.lecture']] },
  { key: 'feedback', values: [['direct', 'settings.style.direct'], ['encouraging', 'settings.style.encouraging']] },
  { key: 'pacing', values: [['sequential', 'settings.style.sequential'], ['exploratory', 'settings.style.exploratory']] },
]

/**
 * The learner-profile editor + AI-suggestion consumer (upstream v0.36).
 * Form state seeds from the persisted profile; saving writes the human path
 * (which stales older pending suggestions via the updatedAt arbitration).
 */
function ProfileSection({ data, save, resolve, fire }: {
  data: ReturnType<typeof useStudy>['data']
  save: (patch: Record<string, unknown>) => Promise<void>
  resolve: (id: string, accept: boolean) => Promise<void>
  fire: (action: Promise<void>) => void
}): ReactNode {
  const profile = data?.profile ?? null
  const [name, setName] = useState(profile?.name ?? '')
  const [mbti, setMbti] = useState(profile?.mbti ?? '')
  const [style, setStyle] = useState<Record<string, string | null>>(() => ({
    start: profile?.style.start ?? null,
    interaction: profile?.style.interaction ?? null,
    feedback: profile?.style.feedback ?? null,
    pacing: profile?.style.pacing ?? null,
  }))
  const [interests, setInterests] = useState(profile?.interests?.join('、') ?? '')
  const [motive, setMotive] = useState(profile?.motiveStage ?? '')
  const [freeNote, setFreeNote] = useState(profile?.freeNote ?? '')
  const seededFor = useRef<string | null>(null)
  // Re-seed when the persisted profile changes UNDER us (a suggestion applied,
  // another device's edit) — not on every poll tick.
  useEffect(() => {
    const stamp = profile?.updatedAt ?? null
    if (stamp === null || stamp === seededFor.current) return
    seededFor.current = stamp
    setName(profile?.name ?? '')
    setMbti(profile?.mbti ?? '')
    setStyle({
      start: profile?.style.start ?? null,
      interaction: profile?.style.interaction ?? null,
      feedback: profile?.style.feedback ?? null,
      pacing: profile?.style.pacing ?? null,
    })
    setInterests(profile?.interests?.join('、') ?? '')
    setMotive(profile?.motiveStage ?? '')
    setFreeNote(profile?.freeNote ?? '')
  }, [profile?.updatedAt]) // eslint-disable-line react-hooks/exhaustive-deps

  const saveAll = (): void => {
    const patch: Record<string, unknown> = {
      name: name.trim() === '' ? null : name.trim(),
      mbti: mbti === '' ? null : mbti,
      interests: interests, // the server parses the raw line (中英标点/顿号/分号)
      freeNote: freeNote.trim() === '' ? null : freeNote.trim(),
      motiveStage: motive === '' ? null : motive,
      style,
    }
    fire(save(patch))
  }
  const pickMbti = (next: string): void => {
    setMbti(next)
    // MBTI is the shortcut entry: selecting one expands into the four style
    // dims (the dims are the source of truth; each stays hand-adjustable).
    if (next !== '' && (MBTI_TYPES as readonly string[]).includes(next)) {
      const expanded = expandMbtiToStyle(next as MbtiType)
      setStyle({ ...expanded })
    }
  }
  const suggestions = data?.pendingProfileProposals ?? []
  return createElement('section', { className: 'lks-set-row', 'data-testid': 'profile-section' },
    createElement('h3', null, tr('settings.profile')),
    createElement('p', { className: 'lks-set-hint' }, tr('settings.profile.hint')),
    createElement('div', { className: 'lks-profile-grid' },
      createElement('label', null, tr('settings.profile.name'),
        createElement('input', { className: 'lks-set-input', value: name, 'data-testid': 'profile-name', onChange: (e: { target: { value: string } }) => { setName(e.target.value) } })),
      createElement('label', null, tr('settings.profile.mbti'),
        createElement('select', {
          className: 'lks-set-select', value: mbti, 'data-testid': 'profile-mbti',
          onChange: (e: { target: { value: string } }) => { pickMbti(e.target.value) },
        },
          createElement('option', { value: '' }, tr('settings.profile.unset')),
          ...MBTI_TYPES.map(t => createElement('option', { key: t, value: t }, t)))),
      createElement('label', null, tr('settings.profile.interests'),
        createElement('input', { className: 'lks-set-input', value: interests, 'data-testid': 'profile-interests', placeholder: tr('settings.profile.interests.ph'), onChange: (e: { target: { value: string } }) => { setInterests(e.target.value) } })),
      createElement('label', null, tr('settings.profile.note'),
        createElement('input', { className: 'lks-set-input', value: freeNote, onChange: (e: { target: { value: string } }) => { setFreeNote(e.target.value) } })),
      ...STYLE_DIMS.map(dim => createElement('label', { key: dim.key },
        tr(`settings.style.${dim.key}`),
        createElement('span', { className: 'lks-pills' },
          ...dim.values.map(([value, labelKey]) => createElement('button', {
            key: value,
            className: `lks-pill${style[dim.key] === value ? ' on' : ''}`,
            onClick: () => { setStyle(cur => ({ ...cur, [dim.key]: cur[dim.key] === value ? null : value })) },
          }, tr(labelKey)))))),
      createElement('label', null, tr('settings.profile.motive'),
        createElement('span', { className: 'lks-pills' },
          createElement('button', { className: `lks-pill${motive === '' ? ' on' : ''}`, onClick: () => { setMotive('') } }, tr('settings.profile.unset')),
          ...MOTIVE_STAGES.map(stage => createElement('button', {
            key: stage,
            className: `lks-pill${motive === stage ? ' on' : ''}`,
            title: MOTIVE_DISPLAY[stage as MotiveStage].tagline,
            onClick: () => { setMotive(stage) },
          }, MOTIVE_DISPLAY[stage as MotiveStage].name)))),
    ),
    createElement('div', null,
      createElement('button', { className: 'lks-btn primary', 'data-testid': 'profile-save', onClick: saveAll }, tr('settings.profile.save')),
      createElement('span', { className: 'lks-set-state' }, tr('settings.profile.private'))),
    suggestions.length > 0
      ? createElement('div', { className: 'lks-profile-suggests', 'data-testid': 'profile-suggest-card' },
        createElement('h4', null, tr('settings.suggest.head')),
        ...suggestions.map(sg => createElement('div', { key: sg.id, className: 'lks-profile-suggest' },
          createElement('p', null, sg.rationale),
          createElement('div', { className: 'lks-pills' },
            createElement('button', { className: 'lks-btn primary', 'data-testid': 'profile-suggest-apply', onClick: () => { fire(resolve(sg.id, true)) } }, tr('settings.suggest.apply')),
            createElement('button', { className: 'lks-btn ghost', onClick: () => { fire(resolve(sg.id, false)) } }, tr('settings.suggest.ignore'))))))
      : null,
  )
}

/**
 * The settings section component. Props from the settings shell (`close`) are
 * unused — every control stays on the page.
 */
export function StudySettingsSection(): ReactNode {
  const { data, setMode, activate, setHistoryBudget, saveProfile, resolveProfileProposal } = useStudy()
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
      createElement('h3', null, tr('settings.budget')),
      createElement('p', { className: 'lks-set-hint' }, tr('settings.budget.hint')),
      createElement('div', null,
        createElement('button', {
          className: `lks-btn ${data?.historyBudget === true ? 'ghost' : 'primary'}`,
          'data-testid': 'budget-toggle',
          onClick: () => { if (data !== null) fire(setHistoryBudget(!(data.historyBudget === true))) },
        }, data?.historyBudget === true ? tr('settings.budget.off') : tr('settings.budget.on')),
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
        // upstream v0.36 右栏学习回顾: 知识增长显化 (mastered count + due)
        createElement('li', { 'data-testid': 'recap-mastered' }, tr('settings.stats.mastered', {
          count: (data?.courses ?? []).reduce((n, c) => n + c.mastered, 0),
          due: data?.dueCount ?? 0,
        })),
      ),
    ),
    // ── upstream v0.36 learner profile: the declared side (name / MBTI /
    // style dims / interests / motive / free note) + the AI-suggestion
    // consumer. The chat stream is never interrupted — suggestions resolve HERE. ──
    createElement(ProfileSection, { data, save: saveProfile, resolve: resolveProfileProposal, fire }),
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

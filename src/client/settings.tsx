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
import { followHostTheme, setFollowHostTheme, readingWidthPref, setReadingWidthPref } from './theme.ts'
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
  return createElement('section', { className: 'lks-set-row wide', 'data-testid': 'profile-section' },
    createElement('div', { className: 'lks-set-main' },
      createElement('h3', null, tr('settings.profile')),
      createElement('p', { className: 'lks-set-hint' }, tr('settings.profile.hint'))),
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
        createElement('input', { className: 'lks-set-input', value: freeNote, onChange: (e: { target: { value: string } }) => { setFreeNote(e.target.value) } }))),
    // the pill rows live OUTSIDE the input grid: mixed cell heights (a 55px
    // input next to a 3-line pill strip) read as clutter — full-width rows
    // (label above, strip below) give every strip the whole 564px, so the
    // seven motive pills wrap at most once and the rhythm stays even
    createElement('div', { className: 'lks-profile-rows' },
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
          }, MOTIVE_DISPLAY[stage as MotiveStage].name))))),
    createElement('div', { className: 'lks-set-ctrl' },
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

/* ── the 0.30 layout pass primitives ──
 * SetRow: the settings anatomy — label+hint on the left cell, the control on
 * the right (`wide` stacks the control full-width below). SetSwitch: one
 * boolean control (a real role=switch toggle) replacing the old per-row
 * 开启/关闭 buttons. Every data-testid and handler survives the layout. */

function SetRow({ title, hint, wide, ctrl }: { title: string, hint: string | null, wide?: boolean, ctrl?: ReactNode }): ReactNode {
  return createElement('section', { className: `lks-set-row${wide === true ? ' wide' : ''}` },
    createElement('div', { className: 'lks-set-main' },
      createElement('h3', null, title),
      hint === null ? null : createElement('p', { className: 'lks-set-hint' }, hint)),
    ctrl === undefined ? null : createElement('div', { className: 'lks-set-ctrl' }, ctrl))
}

function SetSwitch({ on, onTitle, offTitle, testid, onClick }: { on: boolean, onTitle: string, offTitle: string, testid?: string, onClick: () => void }): ReactNode {
  return createElement('button', {
    className: `lks-set-switch${on ? ' on' : ''}`,
    role: 'switch',
    'aria-checked': String(on),
    'data-testid': testid,
    title: on ? onTitle : offTitle,
    'aria-label': on ? onTitle : offTitle,
    onClick,
  }, createElement('i', null))
}

/**
 * The settings section component. Props from the settings shell (`close`) are
 * unused — every control stays on the page.
 */
export function StudySettingsSection(): ReactNode {
  const { data, setMode, activate, setHistoryBudget, saveProfile, resolveProfileProposal, setTtsEndpoint, testTts } = useStudy()
  const [error, setError] = useState<string | null>(null)
  const [voice, setVoice] = useState(storedTtsVoice)
  const [followHost, setFollowHost] = useState(followHostTheme)
  const [readWidth, setReadWidth] = useState(readingWidthPref)
  // issue #18: the external TTS endpoint — the input starts from the feed's
  // persisted truth; the probe line reports the last 测试 answer
  const [endpoint, setEndpoint] = useState('')
  const [engineProbe, setEngineProbe] = useState<string | null>(null)
  const endpointLoaded = data?.tts?.endpoint ?? ''
  useEffect(() => { setEndpoint(cur => (cur === '' ? endpointLoaded : cur)) }, [endpointLoaded])
  const engineStatusText = engineProbe
    ?? (data?.tts == null ? '' : data.tts.endpoint === ''
      ? tr('settings.ttsEngine.status.edge')
      : data.tts.lastEngine === 'external'
        ? tr('settings.ttsEngine.status.external')
        : data.tts.lastEngine === 'edge'
          ? tr('settings.ttsEngine.status.fallback')
          : data.tts.lastExternalError !== null
            ? tr('settings.ttsEngine.status.dead')
            : tr('settings.ttsEngine.status.untested'))
  const fire = (action: Promise<void>): void => {
    action.then(() => { setError(null) }, (err: unknown) => { setError(err instanceof Error ? err.message : String(err)) })
  }
  const progress = data?.progress
  return createElement('div', { className: 'lks-root lks-settings' },
    // ── 学习 ──
    createElement(SetRow, {
      title: tr('settings.mode'), hint: tr('settings.mode.hint'),
      ctrl: createElement('span', { className: 'lks-pills' },
        ...MODES.map(mode => createElement('button', {
          key: mode.id,
          className: `lks-pill${data?.mode === mode.id ? ' on' : ''}`,
          title: tr(mode.hintKey),
          onClick: () => { fire(setMode(mode.id)) },
        }, tr(mode.labelKey)))),
    }),
    createElement(SetRow, {
      title: tr('settings.studyMode'), hint: tr('settings.studyMode.hint'),
      ctrl: createElement(SetSwitch, {
        on: data?.active === true, onTitle: tr('settings.turnOff'), offTitle: tr('settings.turnOn'),
        onClick: () => { if (data !== null) fire(activate(!data.active)) },
      }),
    }),
    createElement(SetRow, {
      title: tr('settings.budget'), hint: tr('settings.budget.hint'),
      ctrl: createElement(SetSwitch, {
        on: data?.historyBudget === true, onTitle: tr('settings.budget.off'), offTitle: tr('settings.budget.on'),
        testid: 'budget-toggle',
        onClick: () => { if (data !== null) fire(setHistoryBudget(!(data.historyBudget === true))) },
      }),
    }),
    // ── 朗读 ──
    createElement(SetRow, {
      title: tr('settings.voice'), hint: tr('settings.voice.hint'),
      ctrl: createElement('select', {
        className: 'lks-set-select',
        value: voice,
        onChange: (e: { target: { value: string } }) => { storeTtsVoice(e.target.value); setVoice(e.target.value) },
      }, ...TTS_VOICES.map(v => createElement('option', { key: v.id, value: v.id }, tr(v.labelKey)))),
    }),
    // issue #18: the external read-aloud channel — one endpoint URL the
    // user's own TTS bridge serves (POST {"text"} → 2xx audio). The chain
    // prefers it, falls back to Edge, then the client's speechSynthesis; the
    // status line shows which engine ACTUALLY answered last (config ≠ truth).
    createElement(SetRow, {
      title: tr('settings.ttsEngine'), hint: tr('settings.ttsEngine.hint'), wide: true,
      ctrl: [
        createElement('input', {
          key: 'input',
          className: 'lks-set-input lks-set-engine-input',
          'data-testid': 'tts-endpoint-input',
          value: endpoint,
          placeholder: 'http://127.0.0.1:8765',
          onChange: (e: { target: { value: string } }) => { setEndpoint(e.target.value) },
        }),
        createElement('span', { key: 'btns', style: { display: 'inline-flex', gap: '8px', flexWrap: 'wrap' } },
          createElement('button', {
            className: 'lks-btn primary',
            'data-testid': 'tts-endpoint-save',
            onClick: () => { fire(setTtsEndpoint(endpoint.trim())) },
          }, tr('settings.ttsEngine.save')),
          createElement('button', {
            className: 'lks-btn ghost',
            'data-testid': 'tts-engine-test',
            onClick: () => { void testTts().then(r => { setEngineProbe('error' in r ? `${tr('settings.ttsEngine.fail')}: ${r.error}` : r.engine === 'external' ? tr('settings.ttsEngine.probe.external') : tr('settings.ttsEngine.probe.edge')) }) },
          }, tr('settings.ttsEngine.test'))),
        createElement('span', { key: 'status', className: 'lks-set-status', 'data-testid': 'tts-engine-status' },
          engineStatusText,
          // the moved-out second half of the hint rides the status line, small
          createElement('span', { style: { display: 'block', marginTop: '2px', opacity: 0.85 } }, tr('settings.ttsEngine.hint.more'))),
      ],
    }),
    // issue #16: the opt-in ecosystem-theme bridge — dsh-markdown-xyy &c.
    // override the host --dsw-alias-* tokens; when on, the panel's neutral
    // ladder follows them (brand/semantic hues stay native). Default off:
    // the stock host defines the aliases too, so an always-on bridge would
    // replace the upstream-verbatim palette on every install.
    createElement(SetRow, {
      title: tr('settings.followHost'), hint: tr('settings.followHost.hint'),
      ctrl: createElement(SetSwitch, {
        on: followHost, onTitle: tr('settings.followHost.off'), offTitle: tr('settings.followHost.on'),
        testid: 'follow-host-toggle',
        onClick: () => {
          const next = !followHostTheme()
          setFollowHostTheme(next)
          setFollowHost(next)
        },
      }),
    }),
    // C13: the reading-column width — tiers (default, the researched ladder)
    // or free (no cap, for readers who want long lines)
    createElement(SetRow, {
      title: tr('settings.readWidth'),
      hint: tr('settings.readWidth.hint'),
      ctrl: createElement('span', { className: 'lks-pills', 'data-testid': 'read-width-pills' },
        ...([['tiers', 'settings.readWidth.tiers'], ['free', 'settings.readWidth.free']] as const).map(([value, labelKey]) =>
          createElement('button', {
            key: value,
            className: `lks-pill${readWidth === value ? ' on' : ''}`,
            onClick: () => { setReadingWidthPref(value); setReadWidth(value) },
          }, tr(labelKey)))),
    }),
    progress === undefined ? null : createElement(SetRow, {
      title: tr('settings.stats'), hint: null, wide: true,
      ctrl: createElement('ul', { className: 'lks-set-stats' },
        createElement('li', null, tr('settings.stats.courses', { count: data?.courses.length ?? 0 })),
        createElement('li', null, tr('settings.stats.xp', { xp: progress.totalXp, level: progress.level, pct: progress.levelPct })),
        createElement('li', null, tr('settings.stats.today', { xp: progress.todayXp, goal: progress.dailyGoal })),
        createElement('li', null, tr('settings.stats.streak', { days: progress.streak, best: progress.longestStreak, freeze: progress.freezeCount })),
        // upstream v0.36 右栏学习回顾: 知识增长显化 (mastered count + due)
        createElement('li', { 'data-testid': 'recap-mastered' }, tr('settings.stats.mastered', {
          count: (data?.courses ?? []).reduce((n, c) => n + c.mastered, 0),
          due: data?.dueCount ?? 0,
        }))),
    }),
    // ── upstream v0.36 learner profile: the declared side (name / MBTI /
    // style dims / interests / motive / free note) + the AI-suggestion
    // consumer. The chat stream is never interrupted — suggestions resolve HERE. ──
    createElement(ProfileSection, { data, save: saveProfile, resolve: resolveProfileProposal, fire }),
    // ── 关于 ──
    createElement(SetRow, {
      title: tr('settings.about'), hint: tr('settings.about.hint'),
      ctrl: data?.version === undefined ? null : createElement('a',
        { href: `https://github.com/Kaiji-Z/dsh-plugin-lookatstudy/releases/tag/v${data.version}`, target: '_blank', rel: 'noreferrer' },
        `v${data.version}`),
    }),
    createElement(SetRow, {
      title: tr('settings.stateFile'), hint: tr('settings.stateFile.hint'), wide: true,
      ctrl: data === null ? null : createElement('code', { className: 'lks-set-path' }, data.statePath),
    }),
    createElement(ActionError, { error }),
  )
}

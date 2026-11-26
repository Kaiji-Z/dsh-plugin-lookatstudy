/**
 * Browser half of dsh-plugin-lookatstudy (`dsh.client`) — since 0.14.0 the
 * study surface is a SIDEBAR-ENTRY PANEL (the stardeck panel-entry doctrine):
 * a 「学习」 row in the sidebar toggles a center-column takeover arranged like
 * upstream LookatStudy's app (rail | tutor chat | notebook). The host is the
 * conversation-model + agent-turn engine; the panel drives it through the
 * session face and renders from the thread's event window. Host conversation
 * surfaces we still ride: the settings section, the composer dock pill, and
 * the keyed tool cards (visible when a lesson thread is opened in the host
 * conversation). Styles inject once; the locale namespace rides the framework
 * service.
 * @module dsh-plugin-lookatstudy/client
 */

import type { ReactNode } from 'react'
import type { ClientContext } from './faces.ts'
import { ensureStudyStyles } from './styles.ts'
import { studyPanelView, setPanelShell } from './panel.tsx'
import { clickDrawerMask, mountStudyShell } from './shell-entry.ts'
import { StudySettingsSection } from './settings.tsx'
import { StudyDockPill } from './dock.tsx'
import { StudyAnswerView, StudyDueView, StudyExamView, StudyLessonView, type ToolViewPropsFace } from './toolviews.tsx'
import { registerStudyLocale, setStudyTranslator, studyTranslator, tr, type LocaleServiceFace } from './locale.ts'
import { wirePanelTheme } from './theme.ts'

/** The toolview components' expected props (structural slice of ToolCallViewProps). */
type ToolViewProps = ToolViewPropsFace

export { feedRows } from './session-feed.ts'
export type { ChatRow } from './views.tsx'

export const inject = ['slots', 'workspaces', 'sessions', 'locale', 'theme', 'remote', 'remote.session']

/**
 * Register the study surfaces: styles + locale once; the sidebar-entry panel
 * carries the whole study UI; the host-native extras (settings, dock, tool
 * cards) ride their slots as before.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ensureStudyStyles()
  const localeSvc = (ctx as { locale?: LocaleServiceFace }).locale
  ctx.effect(() => registerStudyLocale(localeSvc), 'lookatstudy.locale()')
  setStudyTranslator(studyTranslator(localeSvc))
  // P16: the panel follows the host theme (service snapshots when injected,
  // DOM signals otherwise) — data-lks-theme on the panel root flips the skin.
  ctx.effect(() => wirePanelTheme(ctx), 'lookatstudy.theme()')

  // The study panel: sidebar row in, center-column takeover out. The host
  // session list rides along so USER navigation hands the column back.
  // The phone form (dsh 0.2.2+): the panel is opened from inside the host's
  // modal navigation drawer, which must then shut — the same
  // `ctx.layout.toggleSidebar()` face the host sidebar's own rows call
  // (below the auto-collapse breakpoint it flips `narrowExpanded`). The
  // layout face is reached the only way a plugin scope can (a runtime
  // inject); compositions without the service simply never fire the
  // callback and fall back to the drawer mask click — and a client runtime
  // without the registry mixin at all skips the inject (feature-detect, the
  // staging-mode idiom: one bundle serves every host generation).
  let toggleHostSidebar: (() => void) | undefined
  const injectFace = (ctx as unknown as { inject?: (deps: string[], cb: (scoped: unknown) => void) => unknown }).inject
  if (typeof injectFace === 'function') {
    injectFace.call(ctx, ['layout'], (layoutCtx) => {
      toggleHostSidebar = () => { (layoutCtx as unknown as { layout: { toggleSidebar(): void } }).layout.toggleSidebar() }
      const scoped = layoutCtx as unknown as { effect(setup: () => () => void, label: string): void }
      scoped.effect(() => () => { toggleHostSidebar = undefined }, 'lookatstudy.drawer()')
    })
  }
  const shell = mountStudyShell(studyPanelView(ctx), () => tr('tab.label'), {
    closeDrawer: (frame) => {
      if (toggleHostSidebar !== undefined) {
        toggleHostSidebar()
        return true
      }
      return clickDrawerMask(frame)
    },
  }, ctx.sessions)
  setPanelShell(shell)
  ctx.effect(() => () => {
    setPanelShell(null)
    shell.dispose()
  }, 'lookatstudy.studyPanel()')

  ctx.slots.inject('settings.section', () => ctx.slots.register(
    { name: 'settings.section', id: 'lookatstudy', order: 30, label: () => tr('settings.nav'), locale: 'lookatstudy' },
    StudySettingsSection,
  ))
  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register(
    { name: 'conversation.composer.dock', id: 'lookatstudy-status', order: 10, locale: 'lookatstudy' },
    StudyDockPill,
  ))
  // Learning-aware cards for the conversation tab's tool rows (keyed by wire
  // tool name; unregistered study tools keep the generic row).
  const toolviews: ReadonlyArray<[string, (props: ToolViewProps) => ReactNode]> = [
    ['study_record_answer', StudyAnswerView],
    ['study_lesson', StudyLessonView],
    ['study_due_reviews', StudyDueView],
    ['study_exam_result', StudyExamView],
  ]
  for (const [tool, component] of toolviews) {
    ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
      { name: 'tool.call.toolview', key: tool, locale: 'lookatstudy' },
      component,
    ))
  }
}

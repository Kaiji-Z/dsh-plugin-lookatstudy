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
import { mountStudyShell } from './shell-entry.ts'
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
  const shell = mountStudyShell(studyPanelView(ctx), () => tr('tab.label'), undefined, ctx.sessions)
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

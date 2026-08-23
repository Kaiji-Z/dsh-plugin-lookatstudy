/**
 * Browser half of dsh-plugin-lookatstudy (`dsh.client`): ONE conversation
 * view tab — 「学习」— carrying the whole plugin. Inside the tab it is a
 * simplified LookatStudy in three columns (课程 | 老师 | 黑板); nothing
 * outside the tab modifies dsh chrome. Live study state comes from the shared
 * poll store over the host plugin's `/lookatstudy/api/*` routes; the tutor
 * column additionally reads the session snapshot through the framework
 * standard kit and sends messages via the same reverse channel as the
 * standalone workbench page.
 * @module dsh-plugin-lookatstudy/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ReactNode } from 'react'
import { ensureStudyStyles } from './styles.ts'
import { studyView } from './views.tsx'
import { studyStartButton } from './starter.tsx'
import { StudySettingsSection } from './settings.tsx'
import { StudyDockPill } from './dock.tsx'
import { StudyAnswerView, StudyDueView, StudyExamView, StudyLessonView, type ToolViewPropsFace } from './toolviews.tsx'
import { registerStudyLocale, setStudyTranslator, studyTranslator, tr, type LocaleServiceFace } from './locale.ts'

/** The toolview components' expected props (structural slice of ToolCallViewProps). */
type ToolViewProps = ToolViewPropsFace

export { studyView, transcriptRows } from './views.tsx'
export type { ChatRow } from './views.tsx'

export const inject = ['slots', 'workspaces', 'sessions', 'locale']

/**
 * Register the study surfaces: styles inject once; the single
 * `conversation.view` tab carries the whole plugin; the hero starter button
 * (`conversation.input.left`, blank sessions only) automates the onboarding —
 * study workspace + session + kickoff prompt in one click. The `lookatstudy`
 * locale namespace rides the framework locale service (zh/en) and the
 * client-wide translator is installed before any component renders; both
 * slot entries declare the namespace so the framework synthesizes their `t`
 * seat and follows locale switches for the labels.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ensureStudyStyles()
  const localeSvc = (ctx as { locale?: LocaleServiceFace }).locale
  ctx.effect(() => registerStudyLocale(localeSvc), 'lookatstudy.locale()')
  setStudyTranslator(studyTranslator(localeSvc))
  ctx.slots.inject('conversation.view', () => ctx.slots.register(
    { name: 'conversation.view', id: 'lookatstudy-study', order: 15, label: () => tr('tab.label'), locale: 'lookatstudy' },
    studyView(ctx),
  ))
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register(
    { name: 'conversation.input.left', id: 'lookatstudy-start', order: 10, locale: 'lookatstudy' },
    studyStartButton(ctx),
  ))
  // One settings page in the host settings shell: teaching style + study mode
  // through the same host routes the tab uses, plus read-only stats and the
  // state-file path.
  ctx.slots.inject('settings.section', () => ctx.slots.register(
    { name: 'settings.section', id: 'lookatstudy', order: 30, label: () => tr('settings.nav'), locale: 'lookatstudy' },
    StudySettingsSection,
  ))
  // The ambient study-status pill under the composer (due/streak/level); the
  // component itself renders nothing while dormant or loading.
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

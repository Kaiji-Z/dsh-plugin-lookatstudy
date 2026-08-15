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
import { ensureStudyStyles } from './styles.ts'
import { StudyView } from './views.tsx'

export { StudyView, transcriptRows } from './views.tsx'
export type { ChatRow } from './views.tsx'

export const inject = ['slots']

/**
 * Register the study tab: styles inject once, the single `conversation.view`
 * entry rides the slot service's effect wrapper, so plugin unload removes
 * the whole surface.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ensureStudyStyles()
  ctx.slots.inject('conversation.view', () => ctx.slots.register(
    { name: 'conversation.view', id: 'lookatstudy-study', order: 15, label: '学习' },
    StudyView,
  ))
}

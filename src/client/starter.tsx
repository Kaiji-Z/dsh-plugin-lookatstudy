/**
 * The one-click study starter: a pill button in the blank-session (hero)
 * composer tool row. One click adopts the plugin's dedicated study workspace
 * (created by the host beside the state file), opens a session in it, sends
 * the kickoff prompt through the session API, and makes that session current
 * — the learner lands in the chat with the tutor already responding, one
 * click away from the 学习 tab (view switching is ui-conversation-private,
 * not reachable from an additive plugin).
 * @module dsh-plugin-lookatstudy/client/starter
 */

import { createElement, useState } from 'react'
import type { ReactNode } from 'react'
import { IconLoadingOutline16, IconThinkOutline16 } from './icons.tsx'
import { useStudy } from './data.ts'
import type { InputZone } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

/** The kickoff prompt: starts the tutoring loop and points at the study tab. */
const KICKOFF = '开始学习:查看我的学习状态并打开当前焦点课时。如果我还没有课程,推荐我导入示例课程(AI-For-Beginners)并说明怎么开始。回复最后请提醒我点上方「学习」页签进入学习界面。'

/**
 * Build the hero starter button bound to the framework services.
 * @param ctx - client root context (workspaces + sessions injected).
 * @returns the component for `conversation.input.left`.
 */
export function studyStartButton(ctx: ClientContext): (props: InputZone) => ReactNode {
  return function StudyStartButton({ session }: InputZone): ReactNode {
    if (session.blank !== true) return null
    return createElement(Inner, { key: 'inner', ctx })
  }
}

/** Button body in its own component so hook order stays constant. */
function Inner({ ctx }: { ctx: ClientContext }): ReactNode {
  const { data, activate } = useStudy()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const start = (): void => {
    if (busy) return
    setBusy(true)
    setError(null)
    void (async () => {
      try {
        // Dormant installs activate first: the host registers the study tools
        // before this POST resolves, so the kickoff prompt below meets a model
        // that can already call them.
        if (data?.active !== true) await activate(true)
        const area = await fetch('/lookatstudy/api/study-workspace')
        if (!area.ok) throw new Error(`study area unavailable (HTTP ${area.status})`)
        const { path } = await area.json() as { path: string }
        const workspace = await ctx.workspaces.create({ path })
        const sessionId = await ctx.workspaces.connectWorkspace(workspace.workspaceId)
        const actx = ctx.sessions.scope(sessionId)
        const face = actx === undefined ? undefined : ctx.sessions.sessionOf(actx)
        if (face === undefined) throw new Error('study session is not addressable yet')
        const result = await face.prompt([{ type: 'text', text: KICKOFF }], 'queue')
        if (!result.ok) throw new Error(`kickoff prompt rejected: ${result.error.code}: ${result.error.message}`)
        ctx.sessions.open(sessionId)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        setBusy(false)
      }
    })()
  }
  return createElement('span', { className: 'lks-root', style: { display: 'inline-flex', alignItems: 'center', gap: '8px' } },
    createElement('button', {
      className: 'lks-pill on',
      title: '一键准备学习:建立学习工作区、开启会话并让导师就位',
      disabled: busy,
      onClick: start,
    },
      busy
        ? createElement(IconLoadingOutline16, { className: 'lks-spin' })
        : createElement(IconThinkOutline16, null),
      busy ? '正在准备学习区…' : data?.active === true ? '进入学习' : '开始学习'),
    error !== null ? createElement('span', { className: 'lks-propcard-err', style: { marginTop: 0 } }, error) : null,
  )
}

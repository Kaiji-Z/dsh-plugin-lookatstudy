/**
 * dsh-plugin-lookatstudy — turn any markdown, local folder, or GitHub learning
 * repo into a guided course inside DeepSeek Harness. Registers the `study_*`
 * tool surface (ported from LookatStudy's agent contract), a stable tutor
 * persona plus a switchable soul section, and a dynamic learner-snapshot
 * context. Learning state persists in one JSON file shared across sessions.
 * @module dsh-plugin-lookatstudy
 */

import { existsSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import { Config } from './config.ts'
import { registerDashboard, type FollowupAgent } from './dashboard.ts'
import { learnerSnapshot, loadState, resolveStatePath, saveState } from './state.ts'
import type { StudyMode } from './state.ts'
import { dashboardTools, studyTools } from './tools.ts'

export const name = 'lookatstudy-plugin'
export const inject = ['tools', 'systemPrompt']

/**
 * Stable tutor core (ported from LookatStudy's BASE_AGENT_PROMPT plus its
 * tool contract). Deliberately static so the prefix hits the provider's
 * prompt cache; volatile facts live in the learner-snapshot context below.
 */
const TUTOR_CORE = `## Study tutor (lookatstudy-plugin)

You are the learner's AI study tutor for a course imported via the study tools. Your job is genuine understanding, not reciting the material. When the learner answers wrong, acknowledge the attempt first, then correct it.

### Grounding (hard rule)
Teach strictly from the current lesson's content (study_lesson's body is the source of truth). If asked about something outside the course material, say plainly that it is not in the current material, and offer to relate it back. Answers to quiz questions must be grounded in the lesson content — never invent.

### Vague confusion
When the learner says "我不懂 / 不太理解" without specifics, ask which concept is unclear, or list the lesson's 2–3 core concepts and let them pick. Log it silently with study_report_friction.

### Interaction form
- ONE question or interactive block per reply — never a wall of quiz questions.
- Structure answers with markdown (headings, lists, GFM tables); for structures prefer visuals: concept maps and flow diagrams as mermaid code blocks, comparisons as GFM tables, code walkthroughs as fenced code with line-referenced annotations.
- When the learner quotes text in「」, treat it as quote-to-explain: explain that specific passage in the lesson's context.
- Opening a brand-new lesson: start with a short hook and one fun two-option guess (curiosity-driven, NOT scored, revealed next turn) — no opening lecture, no scored question.
- After opening a lesson, offer its four starters (from study_lesson) as suggestions.
- Celebrate graduations and crowns briefly — earned joy, no confetti spam.

### The tutoring loop
1. Session start: check study_due_reviews; clear due reviews before new material. Open the focus lesson with study_lesson. After importing (or whenever the learner wants visuals), call study_dashboard and share the workbench URL — the learner keeps it open beside this chat; its buttons message you back.
2. First time teaching a lesson: derive 2–7 knowledge components and call study_define_concepts.
3. Quiz after teaching; grade every answer and call study_record_answer — always name the tested \`concept\`. Lesson mastery is the WEAKEST concept, so target ⚡weak ones first.
4. Progression is automatic: ≥50% mastery unlocks the next lesson early; ≥90% graduates and schedules the first review. study_complete_lesson is only the manual override.
5. Mastery ≥85% plus a convincing Feynman-style explanation back: call study_propose_mastery, present your rationale, and WAIT for the learner's yes/no. Resolve only with their explicit answer via study_resolve_proposal. You never graduate a lesson on your own judgment alone.
6. Quietly call study_report_friction when the learner seems confused, blocked, or frustrated; adapt by simplifying or decomposing.
7. When you generate a genuinely useful structure (concept map, compare table, diagram), sediment it into the notebook's understand zone with study_note_save; when the learner writes something worth keeping, save it to the record zone with the verbatim quote.
8. When you learn something durable about how this person learns (style, recurring gap, pattern), merge it into memory with study_remember — read the current slot first, send the merged 1–3 sentences. No transient chat.

### Quiz quality
3–4 questions per quiz block is best (5 max), 4 options each. Distractors must come from real misconceptions, not absurd fillers. Test understanding, not recall: "in scenario Y, use X or Z?" rather than "define X". Every question carries an explanation of why the right answer is right. One scored block at a time.

### Integrity
Never claim progress you did not record through the tools. Never reveal the friction log or mastery mechanics as "being watched" — the numbers surface through maps and reviews.
`

/** The three builtin souls, verbatim from LookatStudy (direct/guide/practice). */
const SOULS: Record<StudyMode, string> = {
  direct:
    `### Soul: direct 精讲
你是讲解型教练。核心原则:**先讲清楚,再确认懂没懂**。
1. 学习者问什么,先用一两句把核心讲透——不绕弯子、不反问让他猜。给定义时配一个最小例子。
2. 讲完一个点,立刻出一个轻量确认题(是非/选择,不计掌握度),答对再往下;答错针对性补一句,不换题海。
3. 抽象概念优先给完整范例(worked example),再让他在范例上动手改一个数。
4. 他说"懂了"时,让他用自己的话复述一遍(费曼检验)——复述不出就再讲。
5. 一次只推进一个核心点。讲透一个,不扫过一片。`,
  guide:
    `### Soul: guide 引导
你是引导型教练。核心原则:**让他自己往前推一步,你只递台阶**。
1. 学习者问"X 是什么/为什么",不直接给答案,先抛一个引导性问题让他用已有知识推。
2. 推对往深推一层;推偏给更具体的提示(不是答案),让他再试。
3. 连着两次推不动、或他明说"直接告诉我",才给答案——给时附一句"为什么",建因果链。
4. 检测到他连续答对三次,主动提议进入更深的子主题(不让他停舒适区)。
5. 鼓励他费曼式复述刚推出的结论,验是否真懂。`,
  practice:
    `### Soul: practice 实战
你是实战型 mentor。核心原则:**在真实世界的乱问题里学,不在干净的练习题里学**。
1. 每个概念落在一个真实的、边界模糊的问题上——不是"已知 A 求 B",而是"给你一笔预算/一个真实场景/一堆乱数据,你怎么决策"这类没有标准答案的问题。
2. 先让他面对问题自己想思路(哪怕错),再把他卡住的地方和刚学的概念连起来——概念是工具,问题是主。
3. 他卡住时给"下一步具体动作"(如"先把你要的变量列出来"),不给完整解;做完一步再推进。
4. 一个问题走完,要求他复盘:哪步用了哪个概念、重来会怎么改。复盘比答对更重要。
5. 主动串联:把当前问题和已学概念织成网,让他看到知识点在真实任务里怎么协作。`,
}

/**
 * Render the learner snapshot (LookatStudy's per-turn volatile tail) as the
 * dynamic runtime context: focus, strategy band, concepts with weak flags,
 * recent friction, memory slots, due count, pending proposal.
 */
function snapshotText(store: { get(): ReturnType<typeof loadState> }): string {
  const snap = learnerSnapshot(store.get(), new Date())
  if (snap.focus === null) {
    return snap.dueCount === 0 ? '' : `【学习者当前状态】\n今日待复习: ${snap.dueCount} 项(study_due_reviews)`
  }
  const lines: string[] = ['【学习者当前状态】']
  lines.push(`焦点: ${snap.focus.courseTitle} / ${snap.focus.lessonTitle}(${snap.focus.status}${snap.focus.masteryPct === null ? '' : `, 掌握度 ${snap.focus.masteryPct}%`})`)
  if (snap.strategy !== null) lines.push(`教学策略: ${snap.strategy}`)
  if (snap.concepts !== null && snap.concepts.length > 0) {
    lines.push(`知识点(课级掌握度 = 最薄弱知识点): ${snap.concepts.map(c => `${c.title} ${c.masteryPct}%${c.weak ? ' ⚡薄弱' : ''}`).join(' · ')}`)
  }
  if (snap.friction.length > 0) {
    lines.push(`近期卡点(共 ${snap.friction.length} 条): ${snap.friction.map(f => `${f.category}${f.summary === null ? '' : `: ${f.summary}`}`).join(' / ')}`)
  }
  const memory = [
    snap.memoryGlobal === null ? '' : `整体: ${snap.memoryGlobal}`,
    snap.memoryLesson === null ? '' : `本课: ${snap.memoryLesson}`,
    snap.memoryPattern === null ? '' : `模式: ${snap.memoryPattern}`,
  ].filter(Boolean)
  if (memory.length > 0) lines.push(`记忆: ${memory.join(' | ')}`)
  if (snap.dueCount > 0) lines.push(`今日待复习: ${snap.dueCount} 项`)
  if (snap.pendingProposal !== null) lines.push(`待决提案 ${snap.pendingProposal.id}: ${snap.pendingProposal.rationale}(等学习者表态)`)
  return lines.join('\n')
}

/**
 * Register the study tools, the tutor persona (stable core + soul), and the
 * dynamic learner-snapshot context.
 * @param ctx - plugin context carrying the tool registry and system prompt.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const statePath = resolveStatePath(config.statePath)
  const fresh = !existsSync(statePath)
  const state = loadState(statePath)
  // Config seeds the initial soul; afterwards the persisted choice (switchable
  // via study_set_mode) wins.
  if (fresh) state.mode = config.mode
  const store = {
    get: () => state,
    save: () => saveState(statePath, state),
  }
  // The workbench's reverse channel messages the last agent that ran a study tool.
  const agentRef: { current: FollowupAgent | undefined } = { current: undefined }
  for (const tool of studyTools(store, agentRef)) {
    ctx.tools.register(tool)
  }
  ctx.systemPrompt.section({
    name: 'lookatstudy:tutor-core',
    order: 120,
    text: TUTOR_CORE,
  })
  ctx.systemPrompt.section({
    name: 'lookatstudy:soul',
    order: 121,
    text: () => SOULS[store.get().mode],
  })
  ctx.systemPrompt.context({
    name: 'lookatstudy:learner-snapshot',
    order: 50,
    text: () => snapshotText(store),
  })
  // The self-served study workbench exists only in compositions carrying a
  // webserver (web profile); headless assemblies keep the plain tool surface.
  ctx.inject(['webServer'], (webCtx) => {
    const disposeDashboard = registerDashboard(webCtx.webServer, { store, agentRef })
    webCtx.effect(() => disposeDashboard, 'lookatstudy.dashboard()')
    const url = () => `http://${webCtx.webServer.host}:${webCtx.webServer.port}/lookatstudy/`
    for (const tool of dashboardTools(url)) {
      webCtx.tools.register(tool)
    }
  })
}

export { Config }

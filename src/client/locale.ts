/**
 * The study tab's locale surface: one `lookatstudy` namespace registered with
 * the framework locale service (zh + en, key sets identical — the service
 * enforces balance at register time and this module's tests re-assert it).
 * `makeT` is the pure lookup (own chain: locale → zh → key, `{name}` template
 * interpolation — the same semantics as the service's translate) so unit
 * tests and non-slot code can translate without a live context;
 * `bindStudyT` prefers the service's stable `bind()` when present.
 * @module dsh-plugin-lookatstudy/client/locale
 */

/** Flat key → template string, `{name}` placeholders (LocaleDict shape). */
export type StudyDict = Record<string, string>

/** Simplified Chinese dictionary (also the fallback locale). */
export const ZH: StudyDict = {
  'tab.label': '学习',
  'col.rail': '课程',
  'col.tutor': '导师',
  'col.bb': '黑板',
  'pane.rail': '课程',
  'pane.tutor': '导师',
  'pane.bb': '黑板',
  'viewtab.teach': '讲解',
  'viewtab.cmap': '概念图',
  'viewtab.cmap.title': '本课概念之间的关系图',
  'loading': '加载中…',
  'start.title': '一键准备学习:建立学习工作区、开启会话并让导师就位',
  'start.go': '开始学习',
  'start.enter': '进入学习',
  'start.busy': '正在准备学习区…',
  'soul.direct': '直讲',
  'soul.direct.hint': '精讲:先讲清楚,再确认懂没懂',
  'soul.guide': '引导',
  'soul.guide.hint': '引导:让你自己往前推一步,导师递台阶',
  'soul.practice': '实战',
  'soul.practice.hint': '实战:在真实世界的乱问题里学',
  'zone.understand': '🧠 理解区 — 知识结构',
  'zone.record': '📝 记录区 — 我的话',
  'zone.practice': '✍️ 练习区 — 答题日志',
  'rail.empty.title': '暂无课程',
  'rail.empty.hint': '粘贴 markdown → 说「导入为课程」',
  'rail.empty.hint2': '本地文件夹 → 说「导入 D:/path/to/folder」',
  'rail.empty.placeholder': 'GitHub 仓库链接,如 microsoft/AI-For-Beginners',
  'rail.empty.button': '导入',
  'composer.send': '发送',
  'quiz.card.title': '练习',
  'quiz.progress': '{cur}/{total}',
  'quiz.next': '下一题',
  'quiz.finish': '看成绩单',
  'quiz.score': '成绩：{correct}/{total}',
  'quiz.right': '答对了',
  'quiz.wrong': '答错了',
  'quiz.youChose': '你选了',
  'quiz.answer': '正确答案',
  'quiz.hook': '练习卡完成：{correct}/{total} 正确。请简短点评，针对错题讲讲思路。',
  'quiz.action.explain-wrong': '讲讲错题',
  'quiz.action.retry': '再来一组',
  'quiz.action.go-deeper': '深入原理',
  'quiz.action.mark-mastered': '标记我掌握了',
  'quiz.action.markMastered.hint': '会让导师出综合题检验，通过即标记掌握',
  'quiz.action.next-topic': '下一个知识点',
  'artifact.lines': '第 {from}-{to} 行：',
  'artifact.expand': '放大查看',
  'artifact.guess.title': '猜一猜',
  'artifact.guess.pick': '我选「{label}」',
  'artifact.guess.wait': '已记下你的直觉——导师下回合揭晓，看看你想得对不对',
  'artifact.sedimented': '有新的学习产物沉淀进笔记',
  'zone.artifacts': 'AI 产物',
  'note.quote.ask': '提问这段',
  'note.quote.save': '加到笔记',
  'note.quote.template': '请讲解这段：「{text}」',
  'note.saved': '已存入记录区笔记',
  'quiz.msg.explain-wrong': '我刚才有题答错了，帮我讲讲为什么错、正确的思路是什么。',
  'quiz.msg.retry': '再来一组类似的题巩固一下。',
  'quiz.msg.go-deeper': '这组我答得不错，帮我深入讲讲背后的原理和容易混淆的地方。',
  'quiz.msg.mark-mastered': '这课我觉得掌握了，帮我确认一下——出个综合题检验，通过了就标记为掌握。',
  'quiz.msg.next-topic': '进入下一个知识点。',
  'toast.region': '通知',
  'toast.close': '关闭',
  'composer.busy': '导师正在回复…',
  'rail.empty.demo': '导入示例课程',
  'rail.mastered': '毕业 {mastered}/{total} 课',
  'rail.avg': '平均掌握度 {pct}%',
  'rail.avg.none': '尚无掌握度数据',
  'rail.search': '搜索课时…(多关键词空格分隔)',
  'rail.locate.title': '在课程树中定位当前焦点课时(自动展开所在章节)',
  'rail.locate': '回到当前课时',
  'rail.due': '待复习 {count}',
  'rail.due.over': '超{days}天',
  'rail.due.start': '开始复习',
  'rail.due.tag': '这课时的复习今天到期(SM-2)',
  'rail.delete': '删除本课程',
  'rail.delete.confirm': '确认删除?',
  'rail.delete.title.confirm': '再点一次确认删除(含全部进度与笔记)。反悔前可先在设置页备份状态文件',
  'note.delete': '删除本条笔记',
  'note.delete.confirm': '确认删除?',
  'read.play': '朗读本课',
  'read.stop': '停止朗读',
  'read.pause': '暂停朗读',
  'read.resume': '继续朗读',
  'read.engine.system': '网络合成不可用，已切换为系统语音',
  'read.unavailable': '朗读不可用',
  'rail.section.collapse': '折叠本章节',
  'rail.section.expand': '展开本章节({count} 课时)',
  'rail.section.count': '{count} 课',
  'rail.lesson.opening': '正在打开课时会话…',
  'rail.lesson.openHint': '（点击将打开本课专属会话）',
  'rail.import.toggle': '导入课程',
  'rail.import.close': '收起导入',
  'tag.weak': '{count} 个薄弱知识点,测验会优先考察',
  'tag.friction': '{count} 次卡点记录(你说"不懂"时导师记下的)',
  'tag.mastery': '课时掌握度 {pct}%(取最薄弱知识点)',
  'tag.mastery.short': '课时掌握度 = 最薄弱知识点的掌握度',
  'status.exam': '章节测验:本节全部课时掌握度 ≥50% 后开放',
  'status.mastered': '已毕业:掌握度 ≥90%(或你接受了掌握提案)',
  'status.in_progress': '学习中:已开课,掌握度从 50% 起步',
  'status.available': '可开始:已解锁,尚未学习',
  'status.locked': '未解锁:先完成前面的课时',
  'chip.unattributed': '未归因',
  'chip.correct': '✓ 答对 · {concept}',
  'chip.wrong': '✗ 答错 · {concept}',
  'row.thinking': '导师思考中…',
  'row.thinking.title': '导师正在推理,回复马上就来',
  'quiz.title': '点击选项作答,也可以直接打字回答',
  'quiz.answer': '选 {letter}:{text}',
  'tutor.dormant': '学习模式已关闭 — 点右上「▶ 开始学习」开启导师,按钮恢复可用。',
  'tutor.empty': '对话会出现在这里',
  'tutor.empty.hint': '在下方输入框和导师说话',
  'proposal.text': '导师提议你已掌握「{lesson}」:{rationale}',
  'proposal.accept': '接受',
  'proposal.decline': '再练练',
  'bb.empty': '黑板还空着',
  'bb.empty.hint': '在左侧课程树选择一课',
  'bb.mastery': '掌握度 {pct}%',
  'cmap.legend': '琥珀色 = 薄弱知识点(掌握度 <70%)',
  'cmap.node.pct': '掌握度 {pct}%',
  'bb.strategy': '本课学法',
  'bb.fallback.cmap.empty': '概念图需要先由导师定义本课概念',
  'bb.fallback.cmap': '概念图渲染不可用(布局引擎加载失败) — 已回退讲解视图',
  'bb.notes': '笔记',
  'bb.notes.empty': '这一课还没有笔记',
  'tv.exam.stars': '本次 {n}★(历史最佳 {best}★)',
  'tv.exam.fail': '这轮没拿到星——错题就是下一课的地图,从每题的解析看起。',
  'active.off.title': '注册 study 工具并载入导师人格,之后普通对话和现在一样',
  'active.on.title': '注销 study 工具与导师人格;学习进度保留,可随时重新开启',
  'active.off': '▶ 开始学习',
  'active.on': '⏻ 退出学习模式',
  'prompt.kickoff': '开始学习:查看我的学习状态并打开当前焦点课时。如果我还没有课程,推荐我导入示例课程(AI-For-Beginners)并说明怎么开始。回复最后请提醒我点上方「学习」页签进入学习界面。',
  'settings.nav': '学习',
  'settings.mode': '教学风格',
  'settings.mode.hint': '导师的讲解风格;也可在学习页随时切换',
  'settings.studyMode': '学习模式',
  'settings.voice': '朗读语音',
  'settings.voice.hint': '「朗读本课」使用的神经网络声音（浏览器本地偏好）',
  'voice.xiaoxiao': '晓晓 · 中文女声',
  'voice.yunxi': '云希 · 中文男声',
  'voice.yunyang': '云扬 · 中文男声（新闻）',
  'voice.xiaoyi': '晓伊 · 中文女声（轻快）',
  'voice.aria': 'Aria · English female',
  'voice.guy': 'Guy · English male',
  'settings.studyMode.hint': '开启后注册 study_* 工具并载入导师人格;进度与笔记始终保留',
  'settings.on': '状态：已开启',
  'settings.off': '状态：已关闭',
  'settings.turnOn': '开启',
  'settings.turnOff': '关闭',
  'settings.stats': '学习统计',
  'settings.stats.courses': '课程 {count} 个',
  'settings.stats.xp': 'XP {xp} · Lv{level}({pct}%)',
  'settings.stats.today': '今日 {xp}/{goal}',
  'settings.stats.streak': '连续 {days} 天(最长 {best},剩冻结 {freeze})',
  'settings.about': '关于',
  'settings.about.hint': '当前运行的构建版本,点击查看该版更新内容。',
  'settings.stateFile': '状态文件',
  'settings.stateFile.hint': '学习进度存放于本机 JSON,换机可迁移',
  'dock.title': '学习状态:待复习 {due} · 连续 {streak} 天 · Lv{level} — 点上方「学习」页签进入',
  'dock.due': '{count}',
  'dock.streak': '{days}天',
  'dock.lv': 'Lv{level}',
  'prompt.import': '导入课程:用 study_import_github 抓取 {url}',
  'prompt.lesson': '学习「{title}」:用 study_lesson 打开这一课开始学习。',
  'prompt.exam': '开始「{section}」的章节测验:按本节课时出题,答完逐题判分',
  'prompt.review': '开始今天的复习,从最到期的课时开始',
  'prompt.proposal.accept': '接受提案 {id} —— 确认标记这课为已掌握',
  'prompt.proposal.decline': '拒绝提案 {id} —— 我想再练练',
}

/** English dictionary — key set must equal {@link ZH}'s (test-asserted). */
export const EN: StudyDict = {
  'tab.label': 'Study',
  'col.rail': 'Courses',
  'col.tutor': 'Tutor',
  'col.bb': 'Blackboard',
  'pane.rail': 'Courses',
  'pane.tutor': 'Tutor',
  'pane.bb': 'Board',
  'viewtab.teach': 'Teach',
  'viewtab.cmap': 'Concepts',
  'viewtab.cmap.title': 'The lesson\'s concepts relate',
  'loading': 'Loading…',
  'start.title': 'One click to study: workspace + session + tutor, all set up',
  'start.go': 'Start learning',
  'start.enter': 'Enter study',
  'start.busy': 'Preparing the study area…',
  'soul.direct': 'Direct',
  'soul.direct.hint': 'Explain first, then check understanding',
  'soul.guide': 'Guide',
  'soul.guide.hint': 'You push one step forward; the tutor hands you the stairs',
  'soul.practice': 'Practice',
  'soul.practice.hint': 'Learn inside real, messy problems',
  'zone.understand': '🧠 Understand — knowledge structure',
  'zone.record': '📝 Record — in my own words',
  'zone.practice': '✍️ Practice — answer log',
  'rail.empty.title': 'No courses yet',
  'rail.empty.hint': 'Paste markdown → say "import as a course"',
  'rail.empty.hint2': 'Local folder → say "import D:/path/to/folder"',
  'rail.empty.placeholder': 'GitHub repo link, e.g. microsoft/AI-For-Beginners',
  'rail.empty.button': 'Import',
  'composer.send': 'Send',
  'quiz.card.title': 'Practice',
  'quiz.progress': '{cur}/{total}',
  'quiz.next': 'Next',
  'quiz.finish': 'See score',
  'quiz.score': 'Score: {correct}/{total}',
  'quiz.right': 'Correct',
  'quiz.wrong': 'Wrong',
  'quiz.youChose': 'You chose',
  'quiz.answer': 'Answer',
  'quiz.hook': 'Practice card finished: {correct}/{total} correct. Please comment briefly and walk through the wrong ones.',
  'quiz.action.explain-wrong': 'Explain my wrong answers',
  'quiz.action.retry': 'Another set',
  'quiz.action.go-deeper': 'Go deeper',
  'quiz.action.mark-mastered': 'Mark me as mastered',
  'quiz.action.markMastered.hint': 'Asks the tutor to verify with a final question, then marks mastery',
  'quiz.action.next-topic': 'Next topic',
  'artifact.lines': 'Lines {from}-{to}: ',
  'artifact.expand': 'Expand',
  'artifact.guess.title': 'Take a guess',
  'artifact.guess.pick': 'I pick "{label}"',
  'artifact.guess.wait': 'Your instinct is noted — the tutor reveals next turn',
  'artifact.sedimented': 'A new artifact settled into the notebook',
  'zone.artifacts': 'AI artifacts',
  'note.quote.ask': 'Ask about this',
  'note.quote.save': 'Add note',
  'note.quote.template': 'Please explain this passage: "{text}"',
  'note.saved': 'Saved to the record zone',
  'quiz.msg.explain-wrong': 'I got some questions wrong — walk me through why and the right line of thinking.',
  'quiz.msg.retry': 'Give me another similar set to consolidate.',
  'quiz.msg.go-deeper': 'I did well on this set — go deeper into the principles and common confusions.',
  'quiz.msg.mark-mastered': 'I feel I have mastered this lesson — verify me with a final question and mark it mastered if I pass.',
  'quiz.msg.next-topic': 'Move on to the next topic.',
  'toast.region': 'Notifications',
  'toast.close': 'Close',
  'composer.busy': 'The tutor is replying…',
  'rail.empty.demo': 'Import the demo course',
  'rail.mastered': '{mastered}/{total} lessons graduated',
  'rail.avg': 'avg mastery {pct}%',
  'rail.avg.none': 'no mastery data yet',
  'rail.search': 'Search lessons… (space-separated keywords)',
  'rail.locate.title': 'Locate the current focus lesson in the tree (auto-expands its section)',
  'rail.locate': 'Back to current lesson',
  'rail.due': '{count} due',
  'rail.due.over': '{days}d overdue',
  'rail.due.start': 'Start reviewing',
  'rail.due.tag': 'this lesson\'s review is due today (SM-2)',
  'rail.delete': 'Delete this course',
  'rail.delete.confirm': 'Delete?',
  'rail.delete.title.confirm': 'Click again to confirm (all progress and notes included). Back up via the state file in Settings first',
  'note.delete': 'Delete this note',
  'note.delete.confirm': 'Delete?',
  'read.play': 'Read aloud',
  'read.stop': 'Stop reading',
  'read.pause': 'Pause reading',
  'read.resume': 'Resume reading',
  'read.engine.system': 'Network synthesis unavailable — switched to the system voice',
  'read.unavailable': 'Read-aloud unavailable',
  'rail.section.collapse': 'Collapse this section',
  'rail.section.expand': 'Expand this section ({count} lessons)',
  'rail.section.count': '{count} lessons',
  'rail.lesson.opening': 'Opening the lesson session…',
  'rail.lesson.openHint': ' (opens this lesson\'s own session)',
  'rail.import.toggle': 'Import a course',
  'rail.import.close': 'Collapse import',
  'tag.weak': '{count} weak concepts — quizzes target them first',
  'tag.friction': '{count} friction marks (logged when you said you were stuck)',
  'tag.mastery': 'lesson mastery {pct}% (the weakest concept)',
  'tag.mastery.short': 'lesson mastery = the weakest concept\'s mastery',
  'status.exam': 'Section exam: opens when every lesson in the section reaches ≥50% mastery',
  'status.mastered': 'Graduated: mastery ≥90% (or you accepted a mastery proposal)',
  'status.in_progress': 'Learning: opened, mastery starts at 50%',
  'status.available': 'Ready: unlocked, not started',
  'status.locked': 'Locked: finish the preceding lessons first',
  'chip.unattributed': 'unattributed',
  'chip.correct': '✓ correct · {concept}',
  'chip.wrong': '✗ wrong · {concept}',
  'row.thinking': 'tutor is thinking…',
  'row.thinking.title': 'The tutor is reasoning; the reply is coming',
  'quiz.title': 'Click an option to answer, or just type',
  'quiz.answer': 'Choose {letter}: {text}',
  'tutor.dormant': 'Study mode is off — click "▶ Start learning" above to wake the tutor and re-enable these controls.',
  'tutor.empty': 'The conversation will appear here',
  'tutor.empty.hint': 'Talk to the tutor in the input below',
  'proposal.text': 'The tutor proposes you have mastered "{lesson}": {rationale}',
  'proposal.accept': 'Accept',
  'proposal.decline': 'Keep practicing',
  'bb.empty': 'The blackboard is empty',
  'bb.empty.hint': 'Pick a lesson in the course tree on the left',
  'bb.mastery': 'mastery {pct}%',
  'cmap.legend': 'Amber = weak concept (mastery < 70%)',
  'cmap.node.pct': 'mastery {pct}%',
  'bb.strategy': 'Approach',
  'bb.fallback.cmap.empty': 'The concept map needs the tutor to define this lesson\'s concepts first',
  'bb.fallback.cmap': 'Concept map unavailable (layout engine failed to load) — fell back to the teach view',
  'bb.notes': 'Notes',
  'bb.notes.empty': 'No notes for this lesson yet',
  'tv.exam.stars': 'This attempt {n}★ (best {best}★)',
  'tv.exam.fail': 'No stars this round — the wrong answers are the map for the next one; start with their explanations.',
  'active.off.title': 'Register the study tools and load the tutor persona; plain chats stay as they are',
  'active.on.title': 'Retire the study tools and tutor persona; progress is kept and you can re-enable anytime',
  'active.off': '▶ Start learning',
  'active.on': '⏻ Exit study mode',
  'prompt.kickoff': 'Start learning: check my study state and open the current focus lesson. If I have no course yet, suggest importing the demo course (AI-For-Beginners) and explain how to begin. Remind me at the end to open the "Study" tab above to enter the study UI.',
  'settings.nav': 'Study',
  'settings.mode': 'Teaching style',
  'settings.mode.hint': 'The tutor\'s explanation style; switchable anytime in the study tab too',
  'settings.studyMode': 'Study mode',
  'settings.voice': 'Read-aloud voice',
  'settings.voice.hint': 'The neural voice used by 朗读本课 (a browser-local preference)',
  'voice.xiaoxiao': 'Xiaoxiao · Chinese female',
  'voice.yunxi': 'Yunxi · Chinese male',
  'voice.yunyang': 'Yunyang · Chinese male (news)',
  'voice.xiaoyi': 'Xiaoyi · Chinese female (lively)',
  'voice.aria': 'Aria · English female',
  'voice.guy': 'Guy · English male',
  'settings.studyMode.hint': 'On registers the study_* tools and the tutor persona; progress and notes are always kept',
  'settings.on': 'Status: on',
  'settings.off': 'Status: off',
  'settings.turnOn': 'Turn on',
  'settings.turnOff': 'Turn off',
  'settings.stats': 'Study stats',
  'settings.stats.courses': '{count} courses',
  'settings.stats.xp': 'XP {xp} · Lv{level} ({pct}%)',
  'settings.stats.today': 'Today {xp}/{goal}',
  'settings.stats.streak': 'Streak {days}d (best {best}, {freeze} freeze left)',
  'settings.about': 'About',
  'settings.about.hint': 'The version of the running build — click to see its release notes.',
  'settings.stateFile': 'State file',
  'settings.stateFile.hint': 'Your progress lives in a local JSON file — copy it to migrate machines',
  'dock.title': 'Study status: {due} due · {streak}d streak · Lv{level} — open the Study tab above to continue',
  'dock.due': '{count}',
  'dock.streak': '{days}d',
  'dock.lv': 'Lv{level}',
  'prompt.import': 'Import a course: fetch {url} with study_import_github',
  'prompt.lesson': 'Study "{title}": open this lesson with study_lesson and start teaching.',
  'prompt.exam': 'Start the section exam for "{section}": quiz me on this section\'s lessons and grade each answer',
  'prompt.review': 'Start today\'s review, from the most overdue lesson first',
  'prompt.proposal.accept': 'Accept proposal {id} — confirm marking this lesson as mastered',
  'prompt.proposal.decline': 'Reject proposal {id} — I want to practice more',
}

/** Both dictionaries under their locale ids (the service's register shape). */
export const STUDY_DICTS = { zh: ZH, en: EN }

/** The namespace id this plugin registers with the framework locale service. */
export const STUDY_NS = 'lookatstudy'

/** Translate function for the study namespace. */
export type StudyT = (key: string, params?: Record<string, unknown>) => string

/**
 * Pure translator with the service's semantics: own-locale dict → zh
 * fallback → the key itself, `{name}` interpolation left untouched when the
 * param is missing.
 * @param locale - active locale id ('zh'/'en'; unknown ids fall back to zh).
 * @returns a stable-shaped translate function.
 */
export function makeT(locale: string): StudyT {
  const dict = locale === 'en' ? EN : ZH
  return (key, params) => {
    const template = dict[key] ?? ZH[key] ?? key
    if (params === undefined) return template
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in params ? String(params[name]) : match)
  }
}

/** Minimal shape of the framework locale service this plugin consumes. */
export interface LocaleServiceFace {
  register(ns: string, dicts: Record<string, StudyDict>): () => void
  bind(ns: string): StudyT
  subscribe(fn: () => void): () => void
}

/**
 * Register the namespace with the framework locale service.
 * @param locale - the client locale service when present.
 * @returns the registration disposer (a no-op when the service is absent or
 *          a hostile re-registration was refused).
 */
export function registerStudyLocale(locale?: LocaleServiceFace): () => void {
  if (locale === undefined) return () => {}
  try {
    return locale.register(STUDY_NS, STUDY_DICTS)
  } catch {
    // A namespace/locale already claimed by someone else must not break the
    // tab — fall back to the pure translator everywhere.
    return () => {}
  }
}

/**
 * The live translator: the service's stable `bind` when present (reads the
 * active locale at call time, so a locale-change re-render picks new
 * strings), the pure zh translator otherwise.
 * @param locale - the client locale service when present.
 */
export function studyTranslator(locale?: LocaleServiceFace): StudyT {
  return locale === undefined ? makeT('zh') : locale.bind(STUDY_NS)
}

/** The module's active translator — zh until the view factory installs the live bind. */
let activeT: StudyT = makeT('zh')

/**
 * Install the client-wide translator (called once at client apply, before
 * any component renders).
 */
export function setStudyTranslator(t: StudyT): void {
  activeT = t
}

/**
 * Translate through the active translator — the import every client module
 * uses for user-visible copy. Pure helpers take an optional explicit `t`
 * defaulting to the current active translator, evaluated per call.
 */
export function tr(key: string, params?: Record<string, unknown>): string {
  return activeT(key, params)
}

# 全量对齐移植 SPEC · 上游 LookatStudy v0.28.0 → dsh-plugin-lookatstudy（目标 0.15.0）

上游基准：`D:/Users/kaiji/vibecodingKJ/projects/LookatStudy` @ v0.28.0（commit 0266714，只读参照，禁改；本地 CRLF，diff 时 strip-trailing-cr）。
插件基线：0.14.1（面板架构已立：侧栏入口、三栏、自有 composer、懒铸线程、事件窗口流；221 测试绿）。
执行环境：web-lks profile @ 3081（隔离实测）；发版走 `node scripts/release.mjs`。
**执行顺序：P6 → P1 → P2 → P3 → P4 → P5 → P7 → P8**（Toast 先行是基座；每轮只做一项，P1 可拆轮）。
每完成一项勾选下方复选框；全部勾完才算本轮完成。

## 基线（开工前实测一次留档）

- [x] `pnpm run verify` PASS；测试数 N₀ = 221（2026-09-07 记录；开工实测 VERIFY: PASS）

## 排除清单（不移植——用户已定案：归宿主的能力一律不对齐）

1. **模型/供应商/effort 选择器**（ModelPicker / CustomProviderForm / EffortPicker）— 宿主拥有模型面。【用户指定】
2. **ContextMeter + v0.27 对话历史预算裁剪**（resolveActiveContextWindow）— 宿主拥有 agent loop 与窗口管理。【用户指定】
3. **exam-v2 后台题库**（后台出题、SQLite 结算、重考洗牌）— 需要后台模型客户端，插件没有；考试保持对话式。【归宿主/结构性，用户认可】
4. **composer 附件/语音输入** — 附件投递归宿主 composer 的 intake。【归宿主，用户认可】
5. **CommandPalette** — 宿主 chrome 层；课程搜索由 P4 覆盖。【归宿主，用户认可】

## 移植清单

### P6 · 面板级 Toast 系统（先行基座）
上游：`Toast.tsx`。插件落点：`panel.tsx` 轻量 toast 栈（面板右上角、自动消退、dsw token 样式、面板关闭即清）。
验收：due 提醒与「有新笔记」等通知有统一出口；单测覆盖入队/消退。

- [x] P6 完成（2026-09-07：toast.ts store + panel StudyToastStack + lks-toast 样式 + verify 3 针；VERIFY: PASS @ 226；视觉/消费方实测并入 P3 与 P1 轮）

### P1 · 产物卡体系（上游 artifacts/* + canvas 持久化）
上游：`src/renderer/components/artifacts/`（Quiz/CompareTable/CodeWalkthrough/Mermaid/Guess + DiagramViewerModal）、`App.tsx` 的 extractArtifacts→canvas 自动持久化、`lib/quiz-progress`、`lib/post-quiz-actions`。
插件落点：
- 后端：新增 `study_generate_quiz` 工具（输出 `{questions[]}`，带 output.schema，schema-conformance 测试覆盖）；compare-table / code-walkthrough 产物走同一结构化通道（工具结果带 `artifactType`）；导师人格更新何时出卡。
- 前端：事件窗口订阅扩展出产物流（tool/call+tool/result → 产物卡数据；与聊天流共用同一订阅，不另开窗口）；聊天流内渲染产物卡；QuizArtifact 可交互：作答→判分→进度持久化（localStorage，对齐上游 quizProgressKey）→ post-quiz 动作；Mermaid 查看器模态。
- 持久化：产物自动存入课时笔记 understand 区（幂等 key：`artifactType`+内容 hash——上游用消息 id 被重复咬过）；笔记 tab 数字角标 + toast；讲解底部展示最新重产物（上游 CanvasStage 黑板语义）。
- GuessArtifact：开场两选一猜（不计分、下回合揭晓）— 人格提示词 + 卡。

验收：单测（产物提取 fold、quiz 进度、幂等去重）+ 3081 实测（练习卡渲染→作答→判分→重开面板进度留存；产物自动进笔记区带角标）。

- [ ] P1 完成
  - [x] P1a（2026-09-07）：quiz 产物端到端 —— study_generate_quiz 工具、内容哈希幂等记录、QuizCard 交互卡（本地判分/进度留存/答完 hook/去向动作）、verify PASS @ 233、3081 实测全过（含同上下文 reload 进度恢复）
  - [ ] P1b：compare_table / code_walkthrough 工具+卡、Mermaid 查看器模态、GuessArtifact、笔记 understand 区自动沉淀+角标+toast、讲解底部最新重产物

### P2 · 画线笔记（上游 NotebookPanel 选区交互）
上游：讲解区选区浮动菜单「提问这段 / 加到笔记」、user_note 带 quote 溯源、持久高亮。
插件落点：讲解 prose selectionchange → 浮动菜单；「提问这段」把引文拼进面板 send；「加到笔记」经 dashboard 新路由存 user_note（zone=record，带 quote）；文本位置锚点（稳定字符偏移，非 DOM 引用）跨重渲还原高亮；笔记区渲染 user 笔记与溯源。

验收：单测（锚点计算、user_note 路由）+ 3081 实测（选区加笔记→笔记区出现带引用条目→重开面板高亮还原）。

- [ ] P2 完成

### P3 · 复习面（上游 ReviewPanel + 自评卡 + 复习提醒）
上游：复习抽屉（due 列表）、讲解底部 SM-2 自评卡（again/hard/good/easy）、due 主动 toast（每会话一次）。
插件落点：rail 复习盒升级为抽屉；自评卡四键 → `study_record_review`（工具已存在，补 UI）；due 提醒 toast（P6 之上，每开面板一次）。

验收：单测（自评→工具参数映射）+ 3081 实测（自评打分→state 的 review 记录变化；due>0 开面板出提醒）。

- [ ] P3 完成

### P4 · 全文课程搜索（上游 CourseSearchPanel）
插件落点：rail 搜索升级——标题未命中走全文（dashboard 路由代理 store 全文搜索，`study_courses` 已有该能力）；结果面板列 命中课时+片段，点击 setFocus 跳转。

验收：单测（搜索代理路由）+ 3081 实测（输入正文关键词→命中→跳转 focus）。

- [ ] P4 完成

### P5 · 提案横幅 + 面板尾巴（0.14.0 重构欠账）
- 掌握度提案横幅（上游 ConfirmCard 语义）：pendingProposals 非空时聊天列顶部横幅，接受/再练练 → 面板内 send（对应 `study_resolve_proposal`）。
- 栏分区真实折叠（点击切换，记忆分区状态）。
- 首字前思考指示（attempt 进行中、无 text-delta 时显示思考行）。
- 窄屏堆叠（容器断点：三栏→单栏+列切换）。

验收：单测（折叠记忆、横幅动作文本）+ 3081 实测（构造 pendingProposal→横幅出现→点接受→state 清空；窄容器列切换可用）。

- [ ] P5 完成

### P7 · 伴学生物 DOM 移植（上游 companion/*）
上游：五形态注册表（astro/ember/frost/ink/moss）、Mascot、朗读避让（整句行盒）、庆祝落点、v0.28 打磨。
插件落点：面板右下角 SVG/CSS creature；订阅朗读控制器与毕业/答对事件做表情动作；朗读时避让当前句（面板内 DOM；粒子降级 CSS）；形态选择进 settings。
**刹车：此单项超 4 轮仍无可用形态 → 停下问用户砍/降级。**

验收：单测（事件→动作映射）+ 3081 实测（生物随朗读/答对有动作）。

- [ ] P7 完成

### P8 · 终审与发版
- 对照本 SPEC 逐项 grep/读码核对，无一未解释缺项；上游 `git diff v0.27.0..v0.28.0` 复扫（伴学视觉打磨之外是否有漏）。
- AGENTS.md / README / backlog 重写；judge-criteria 若导师行为有变则同步。
- `pnpm run judge` 复跑 PASS；`node scripts/release.mjs 0.15.0`。

- [ ] P8 完成

## 已知坑（执行时带brain）
- 事件窗口只对 current 会话开；产物提取与聊天流共用同一订阅。
- 机制 user/message 白名单（source.kind==='user'）别被产物通道破坏；tool/result 只进产物卡，不进聊天气泡。
- 上游 canvas 重复保存教训：内容 key 幂等，不用消息 id。
- file: 依赖是拷贝：每轮实测前 remove→restore→install；3080 是 stardeck 活服务，禁碰。
- 发版前 verify 必绿；`pnpm run build | grep` 会吞退出码。
- 新工具走 schema-conformance 门：先证红再信绿。

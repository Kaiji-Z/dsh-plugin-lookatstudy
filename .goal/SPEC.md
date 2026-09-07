# UI 1:1 还原 SPEC · 上游 LookatStudy v0.28.0 → dsh-plugin-lookatstudy（0.17.0 → 0.21.x 分轨发版）

上游基准：`D:/Users/kaiji/vibecodingKJ/projects/LookatStudy` @ v0.28.0（只读参照，禁改；本地 CRLF，diff 时 strip-trailing-cr）。
插件基线：0.16.0 已上线（面板 + 上游皮肤第一层 + 静态气球地图；248 测试绿，verify PASS）。
执行环境：web-lks profile @ 3081（kill→remove→restore file: dep→corepack install→reboot with env；token 从启动日志抓）。
审计基座：六路子智能体扫描报告已并入本 SPEC（组件层/CSS 层/DOM 孤岛普查/布局骨架/token+动画/交互逻辑 48 项）；DOM 审计探针 `probe-audit.mjs` 语义（明暗两主题 suspect=0）是本目标的机器验收面。
**执行顺序（2026-09-07 修订：取消中间发版——0.17.0 已上线后，剩余全部完成才一次性终态发版 0.18.0）**：P11a → P11b → P12 → P13 → P14 → P15 → P0 探测 → P16 → P17 →(一次性发版 0.18.0)→ P18 终审收尾。每轮只做一个 P 项或一个实测修复批次；每项完成勾选；中途任何时刻不运行 release.mjs。

## 基线（开工实测留档）

- [x] `pnpm run verify` PASS；测试数 N₀ = 248（2026-09-07 开工实测：249 绿，AUDIT exit 0 @ suspect=0）

## 用户拍板记录（2026-09-07，覆盖旧 SPEC 的排除清单）

1. **ABCD 四轨全量移植**（清单见下）。
2. **B6 按上游**：assistant 消息全文无卡排版（去掉现在的 surface-2 卡片）。
3. **D5 上物理引擎**：vendor matter-js + 上游 mapPhysics 物理岛（拖拽/碰撞/绳链）+ 天气画布 + 吹哨召唤。
4. **明暗双主题**：移植上游 html.light 全套 token；面板主题跟随宿主明暗切换（无需刷新）。
5. **宿主分工修订**：宿主只负责后端模型（= 上游 BYOK 的等价物）。原"归宿主"清单（ContextMeter、v0.27 历史预算裁剪、composer 附件、CommandPalette、exam-v2 后台题库、线程切换 UI、模型/effort 切换面）全部改为**插件内置替换宿主能力**。
6. **宿主 API 缺口策略**：等价降级（用插件侧可得数据做等价实现，如 ContextMeter 用会话事件估算）+ SPEC 缺口清单记录，不阻塞不追问。
7. **语音听写不移植**（VoicePanel/按住说话——本地 ASR 模型，明确排除）。
8. 预算 60 轮；【修订】不做中间发版——0.17.0 之后全部完成，终态一次发版 0.18.0；judge 全项 ≥8；终态 1:1。

## 修订后排除清单

1. **语音听写**（VoicePanel + ChatComposer 语音模式 + mic 工具栏钮）— 本地 ASR 模型。【用户指定】
2. **CustomProviderForm / API key 管理** — 宿主即模型后端，密钥管理归宿主。【结构性】
3. 上游 Electron 专属：桌面宠物窗口（PetCompanion）、titlebar 栖息、系统托盘。

## 移植清单

### A 轨 · 外观孤岛清零（并入 P10a）

来源：DOM 普查 27 孤岛 + 6 半盖 + CSS 审计缺规则。

- [x] A1 聊天内 quiz `.lks14-opt/.lks14-optletter`、`.lks14-starter`、`.lks14-chatlesson`、`.lks14-meta`、`.lks14-dueitem`、`.lks14-hint`、`.lks-readbar-notice`、`.lks-cmap-legend` 补 `.lks-ui` 暗色覆盖
- [x] A2 quiz 卡正文族（prompt/count/ans/expl；review-wrong→`--warning-light`）+ artifact 细节（expand/modal-title/guess-prompt/guess-wait/note b）+ 笔记正文族（text/src/del/title + 表格边框→`--border`）
- [x] A3 选区弹泡 `.lks-quote-btn` → surface-0 浮卡 + shadow-pop + confirm-enter
- [x] A4 正文链接 accent + hover 下划线、`li::marker` 品牌绿、`strong` ink-strong、hr
- [x] A5 面板内 `::-webkit-scrollbar`（暗色 thumb，hover surface-3）
- [x] A6 补 token：10 个 `-dark-rgb/-light-rgb` 通道 + `--cm-c0..c4` 十色 + shadow-pop/brand-soft/accent-soft 等价规则
- [x] A7 补动画：crown-sparkle、energy-breathe/flame-flicker、answer-correct/wrong、confirm-enter、tab-slide、artifact-render；toast 进出对齐上游值（-12px scale.96 / out-back 220ms）
- [x] A8 聊天气泡内表格、对比表四边、笔记表格边框 dsw-l2 → `--border`
- [x] A9 emoji→SVG：⚡🔥（头标）、↑（发送）、⤢×（展开/关闭）、toast ×——icons.tsx 已有等价字形
- [x] A10 审计探针固化：probe-audit 语义进 `scripts/audit-ui.mjs`（border-style 过滤误报、饱和色豁免），verify 外独立跑，明暗两主题 suspect=0 为判据

### B 轨 · 布局骨架（P10b，对齐上游 App.tsx/MapRail 骨架）

- [x] B1 rail 300px；天幕升 rail 全高（.lks14-rail 承载）；砍掉 课程/导师/黑板 三条 colhead；悬浮玻璃 tab 胶囊（地图/导入双面板横滑）+ 悬浮标题卡（标题/掌握条+%/搜索 pill/复习 pill+due 数/删课）；内容区独立滚动 + pt-48 顶部预留
- [x] B2 地图章节 space-y-6（24px）+ py-3/px-2 节奏
- [x] B3 宽度对调：聊天 `clamp(480px,36vw,800px)`、黑板 `flex-1 min-width:440px`
- [x] B4 模式药丸（风格：直讲/引导/实战 + 图标）移入 composer 胶囊第一行；导师列头位置改为细行显示当前课时（ThreadSwitcher 空态样式）
- [x] B5 黑板 tab 胶囊化（px-3 pt-3 pb-1）+ 内容 max-w-960 居中 + p-5；朗读条改 sticky 圆钮
- [x] B6 assistant 消息全文无卡排版（上游 ChatStream：prose max-w-80ch，无气泡卡）；user 右对齐 max-w-85% 圆角气泡保留
- [x] B7 starters 单行横滚 + `rows.length>0` 门控；空会话显示摘要卡 +「开始学习」3D CTA（发 starters[0]/专用提示词）
- [x] B8 聊天流 px-5 py-6 space-y-6；空态卡化（居中问候+摘要+CTA）

### C 轨 · 交互逻辑（P11a 快赢 + P11b 闭环）

P11a：
- [x] C1 滚动 sticky-follow（80px 贴底容差，上滑脱钩）+ 回底 FAB + 流式红点
- [x] C2 停止生成按钮（send↔stop 状态机）+ Esc 中止流式（host session face abort/interrupt 语义，缺则降级：停止后续轮询标记）
- [x] C3 焦点球 scrollIntoView（视口外 ±60px 平滑居中）
- [x] C4 代码块复制按钮（语言标签 + hover 复制 + 1.5s ✓，enhance 后注入头条）
- [x] C5 quiz 提交步进（先选后提交，保留犹豫窗口；本地持久化随步进改）
- [x] C7 窄屏选球后自动切 chat 栏
- [x] C8 proposal 状态闭环（决策后 applied 金勾 / rejected 徽章只读卡）
- [x] C9 删课 toast；复习「随机抽一个 due」交错按钮
- [x] C12 点球乐观聚焦（本地先置 focus 再等快照）；armed 确认 Enter=确认；coarse 指针 settle 600ms 分档；触屏水平滑切栏（上游 swipeTarget 阈值语义）
- [x] C13 点空白吹哨→companion poke 事件（物理版并入 P15）

P11b：
- [x] C6 笔记溯源闭环：「回到原文」定位+闪烁；备注编辑；pin；三区折叠+新笔记自动展开 ✅ 2026-09-07：探针 10/10（zone 折叠 0↔全隐、pin 置顶 idx3→0、编辑保存、notes-tab 溯源→teach tab mark.lks-flash）。实catch：溯源按钮在 notes tab 上 proseRef 为 null 静默无效——pendingLocate 排队切 tab 后闪烁
- [x] C10 模态 Esc + CanvasStage 缩放（并入 P14 大件） ✅ Esc 部分 2026-09-07：ConfirmCard Esc/外点/Enter 实测；CanvasStage 缩放随 P14
- [x] C11 对话流逐消息朗读（🔊 + n/total + 句级 karaoke 高亮，复用 readaloud/highlights） ✅ 2026-09-07：data-row-key 行锚 + mark.lks-reading 句级 karaoke + playMessage/stopMessage（edge+system 双引擎）
- [x] C14 流内 reasoning 折叠块 + 工具调用三态 chip（loading/ready/error；宿主事件流有则渲染，无则降级占位行） ✅ 2026-09-07：探针 done chip + reasoning 折叠实测。实catch×2：①宿主 tool/result 的 callId 藏在 data.message.source.callId、错误是 isError（journal zstd 解码实证），首版折叠读不到→chip 永久 loading；②face.prompt 在 queue 时即 resolve，busy 不能骑 prompt promise——feedTurnActive(turn/start..turn/end) 折叠 + stop 水位线（宿主 cancel 只记 attempt+step/end 永不记 turn/end，不设水位线则永久忙）
- [x] C15 GlobalTooltip（portal + hover 跟随 + 长按 500ms 通道 + 视口钳制）；ConfirmCard 锚定浮层化（outside/Esc/Enter + 翻转） ✅ 2026-09-07：clampTip/anchorPlacement 纯函数冻结 + hover 进出/固定定位/Esc 取消实测

### D 轨 · 大件（P12-P15 + P17）

- [ ] D1/P12 考试作答 UI（ExamView 五态：generating 进度→ready 元信息+开始+重出题确认→answering 逐题限时 60/90s+超时自动记+KC chip→submitting→result 星级+KC 分解+逐题回顾+重考/重出题）+ 考试离开守卫（导航拦截警告模态）+ exam-v2 后台题库语义（宿主模型经 tutor 出题，题库状态入 state.json）
- [ ] D2/P13 庆祝粒子层（CelebrationLayer：correct/wrong/mastery/unlock/streak/energy-full/exam-pass；锚定 quiz 卡/解锁球；reduced-motion 静态降级）
- [ ] D3/P14 黑板 board tab + CanvasStage（平移/捏合/滚轮/双击适屏 + −/%/适屏/+ 浮动工具条；mermaid/对比表/代码走查/概念图模态全部接入）
- [ ] D4 流内 artifact 内联渲染（quiz 可直接作答）——sediment 模型并存（流内优先展示未见过的）
- [ ] D5/P15 物理地图：vendor matter-js + 上游 mapPhysics.ts（createSectionIsland/classifyPointer/squash/绳链粒子）；拖拽（阈值分类点击 vs 拖拽、锁定球禁拖、300ms click 抑制、touch-action pan-y）；天气画布（attachSky/attachOrbWeather：雨/雪/雾 preset、碰撞事件队列、雪载真值）；视口 ±200px 冻结节流；FPS 实测 ≥40（低于两轮→停：降级需用户确认）
- [ ] D6 地图氛围补全：季节滤镜 env-*、解锁庆祝锚点、流式球 spinner、世界切换器（study/practice 分组）
- [ ] D7 导入面板：六来源 tab 化（URL/MD/文件夹/EPUB/课程包；语音 tab 不做）+ 安装式进度屏（步骤打勾/耗时/自动滚底）+「导入进行中」占位（轮询 courses 数变化）；agent 代办管线不变
- [ ] D8 ErrorBoundary（prose/markdown 危险区包裹）+ 代码块共享（chat+notebook 同一 CodeBlock 头条）

### P0 · 宿主能力探测（P16/P17 前置一轮）

- [ ] 探测宿主 API：模型/effort 切换接口、上下文用量（token/事件）、附件注入、全局快捷键注册、主题信号（html 属性/事件）、tab 切换。产出：可行性矩阵写入本节；缺口项按"等价降级+记录"处理

### P16 · 明暗双主题

- [ ] 上游 html.light 全套 token 移植为 `.lks-ui[data-lks-theme=light]`（或宿主属性直连）覆盖块；浅色 surface/ink/语义色/shiki 翻转（--shiki-light）；map-rail-scope 暗锁等价物；主题跟随宿主切换（监听宿主主题属性/事件，无 API 则 MutationObserver html 属性 + prefers-color-scheme）；审计探针两主题 suspect=0

### P17 · 替换宿主能力（宿主只留模型后端）

- [ ] E1 ContextMeter（上下文用量条：宿主有用量 API 用之；缺→会话事件字符量估算，标注估算口径）
- [ ] E2 v0.27 历史预算裁剪（面板侧配置 + tutor 提示词指令化；裁剪执行在导师层）
- [ ] E3 composer 附件（图片粘贴/拖入/选择→study 工作区落盘 + 导师可见路径；宿主 intake 缺则走 dashboard 路由）
- [ ] E4 CommandPalette（Cmd+K 面板内版：课程/课时搜索+跳转、开始复习、切课、开始学习；宿主快捷键冲突则面板聚焦时捕获）
- [ ] E5 线程切换器（lessonSessions 会话列表 pill 行：当前课时线程 + 已开线程跳转，宿主 sessions API 驱动）
- [ ] E6 模型/effort 切换面（宿主有 API→完整 UI；缺→只读显示当前模型 + 缺口记录）
- [ ] E7 字号 A−/A+（面板根字号三档持久化）

### P18 · 终审发版

- [ ] judge 全项 ≥8；全量 Playwright 验收矩阵（下节）逐项过；README 截图重拍（明暗两套）；AGENTS.md 更新（新架构/新 vendor/主题机制）；发版 0.21.0 + web-lks 重装验证 + 共享 web profile 依赖行升级（若 3080 空闲）

## Playwright 验收矩阵（终态逐项一条可复核断言）

1. 明/暗主题切换跟随宿主，两主题审计 suspect=0（`scripts/audit-ui.mjs` 退出码 0）
2. 物理地图：球可拖拽（pointer 事件位移>阈值判定拖拽）、松手回弹、绳链跟随、点击仍跳焦点；FPS≥40
3. 天气画布渲染（preset 按课程哈希）；点空白→伴学召唤响应
4. 考试五态链路可走通（开始→作答→提交→星级结算→重考）；answering 中点其他球→离开守卫弹窗
5. 答对 quiz→庆祝粒子锚定卡片喷发；解锁新课→unlock 粒子锚定球
6. CanvasStage：模态内滚轮缩放/拖拽平移/适屏钮；mermaid 大图可读
7. 滚动：上滑脱钩+回底 FAB 出现+红点；停止按钮中断流式（busy 复位）
8. ContextMeter 显示用量；附件粘贴→工作区落盘→导师可引用；Cmd+K 面板搜索跳转
9. B6：assistant 长文全文排版（无卡片背景），user 气泡右对齐
10. 线程切换器列出已开课时线程并可切换；A−/A+ 三档字号持久化
11. 笔记「回到原文」定位闪烁；代码块复制 ✓ 反馈
12. 逐消息朗读 n/total + 当前句 karaoke 高亮

## 技术注记（跨轮次有效）

- 零依赖客户端包铁律：matter-js 必须 vendor 进 `src/vendor/`（上游 mapPhysics 依赖 matter-js；vendor 其最小构建或源码子集，带 provenance 头）；react 仍是唯一 external。
- 上游文件本地 CRLF；diff 用 `git diff --no-index --strip-trailing-cr` 或先 dos2unix 临时副本。
- heredoc 陷阱：`<<'PYEOF'` 会吞反斜杠/引号——CSS/TSX 大改用 Edit/Write 工具。
- Playwright：domcontentloaded（非 networkidle）；无限动画元素（球/伴学）点击用 `dispatchEvent('click')`；localStorage 持久化用同 context reload；截图不可读（CDN quirk）——以 getComputedStyle/DOM 断言为证据。
- web-lks 轮换：kill 3081 PID（taskkill //PID x //T //F）→ `corepack pnpm -C <profile> remove dsh-plugin-lookatstudy` → restore file: dep → `corepack pnpm -C <profile-dir> add file:...`（必须 remove+add，plain install 保 stale copy）→ harness 根目录 reboot（`set -a; source .env; set +a; node --import tsx/esm apps/cli/src/bin.ts --profile web-lks --port 3081 --no-open`）→ token 从日志抓。
- 3080 是 stardeck 共享 web profile 直连——全程禁碰；共享 state（~/.dsh/lookatstudy-plugin/state.json）改动前先看内容。
- 禁改测试/判据凑达标；每轨测试只增不减（N₀=248）。
- dsh 宿主 API 现状（2026-08 审计）：42 slots、无 tab 切换 API——P0 探测以此为起点复核 rc.2+ 新增。

### P10a 完成记录（2026-09-07）

- A1-A10 全部落地：upstream-theme.ts A-track 块（token 补全/孤岛覆盖/六个上游动画/toast 上游值/滚动条/prose 链接）、emoji→SVG（bolt/flame/arrow-up/close/maximize 五处）、scripts/audit-ui.mjs 审计门。
- 审计探针抓到真 bug：UA `button{color:buttontext}`（黑）——修复为 `.lks-ui button{color:inherit;background-color:transparent;border-color:transparent}`（低特异性，组件规则全胜）。
- 实测：249 tests + verify PASS + audit suspect=0 (exit 0)。

### P10b 完成记录（2026-09-07）

- B1-B8 全部落地：rail 300px + 全高天幕 + 悬浮 tab 胶囊（地图/导入横滑 translateX）+ 玻璃标题卡（标题/掌握条+%/搜索 pill/复习 pill+due 数/删课）；三条 colhead 全删；搜索/复习改全栏 overlay；宽度模型 chat `clamp(480px,45%,800px)`（行相对百分比——vw 基准在宿主容器内失真，实测 row 980 时 vw 版互踩最小宽）+ note flex 吃余量 min-440；模式药丸入 composer 首行（风格：+图标）；lesson 细行替代导师列头；notebody 960px 居中；assistant 全文无卡（B6 按上游）；starters 门控 rows>0 + 空态卡+3D CTA；readbar sticky。
- 实测：250 tests + verify PASS + audit suspect=0 + 结构探针（colheads=0/rail 300/chat 480/note 500/tab 滑动/overlay 开合全过）。
- 遗留到后续轨：空态摘要卡内容增强（上游含课程摘要）并入 C 轨；readbar 圆钮化并入 P11b。

### P11a 完成记录（2026-09-07）

- C1 滚动跟随（isStuck 80px 容差 + 自己发言强制贴底）+ 回底 FAB（流式红点脉冲）；C2 停止生成（宿主 session face 有 cancel() —— faces.ts 补结构类型，真中断非降级）+ busy 时 Esc 中止；C3 焦点球 scrollIntoView（data-node-id 锚 + ±60px 规则）；C4 代码块头（语言标签大写 + 复制 ✓ 1.5s，enhanceCode 注入）；C5 quiz 先选后提交（optionTone 纯函数：提交前不泄对错）；C7 窄屏跳转切 chat 栏；C8 proposal 决策徽章（applied 金/declined 弱化，重提议自动重臂）；C9 删课 toast + Enter 确认 + 复习 overlay 随机抽一课；C12 乐观聚焦 + coarse settle 600/250 分档 + 触屏滑动切栏（swipePane）；C13 点空白吹哨→companion poke。
- 实测：253 tests + verify PASS + audit suspect=0；探针证实：搜索跳转→选中球+锚点、随机复习→跳转关闭、shiki×2+代码头 PYTHON+katex×3（种子课加了 python 围栏）。
- 本轮踩坑：①TDZ——effect 依赖数组引用了声明在后的 const（courseId），渲染期即炸，已上移；②活体服务器的内存态会遮蔽重播种的 state.json（改文件后必须重启）；③seed 脚本模板字面量里写 ``` 围栏会终结模板（AGENTS 已有记载），改 ${FENCE} 构造；④enhance 管线"全静默失败"实为轮换/启动竞态的脏状态，干净轮换后一切正常。
- 停止按钮的完整模型回合实测并入 P11b/P12 的 live 会话轮（send→streaming→stop 全链）。✅ 2026-09-07 P11b 完成：send→streaming row→stop 武装→点击解除 全链实测通过（探针 scripts/probe-p11b.mjs 第 8/9 项）。

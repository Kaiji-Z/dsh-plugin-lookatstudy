# dsh 原生适应轮 · SPEC（harness dsh-v0.1.1-rc.2 基准）

上游对齐轮（见 SPEC.archive-2026-08-23-alignment.md，40/40 完成）之后，本插件的功能面已齐，
但它对 dsh 宿主的"原生感"还停在两个 slot（conversation.view + conversation.input.left）。
本轮把审计出的六项宿主能力全部接上。审计基准：harness 已 checkout 到 tag `dsh-v0.1.1-rc.2`
（b150a551b8），七项关键 API 逐条 grep 复核过（locale / settings.section / commands /
composer.dock / toolview / immediately / connectWorkspace），契约与审计结论一致。

## 前置步骤（一次性）

- [x] harness 根 `corepack pnpm install`（937 包，30.3s 完成；tests/client-node.test.ts 两个新 locale 测试）

## 基线（2026-08-23，全部本会话实测）

- 测试 169/169 绿；`pnpm run verify` PASS
- 依赖数 0；lib/client.js gzip 30,708B
- 审计证据行号基于 rc.2 复核后的位置（见各工作流）

## W1 · 客户端 i18n 双语（最大差距）

现状：学习页/启动按钮全部硬编码中文；dsh 有第一方 locale 系统
（`ctx.locale.register(ns, {zh, en})`，zh/en 平衡由 API 强制；slot `register` 传
`locale: 'lookatstudy'` 即给组件注入 `t` 标准席位；`FALLBACK_LOCALE='zh'`）。
证据：packages/client/locale/src/client/index.ts:253-254、packages/client/runtime/src/client/slots.ts:82。

- [x] 建 `src/client/locale.ts`：`lookatstudy` 命名空间 zh/en 两份字典（78 键），键集一致
      （tests/client-node.test.ts 'lookatstudy locale dictionaries keep zh/en parity'）
- [x] views.tsx / starter.tsx 全部用户可见文案走 `tr()`（含 viewtab 标签、按钮 title、
      空态、窄模式切换器、quiz 选项、发给模型的提示词模板）；两处 register 都带
      `locale: 'lookatstudy'`，view tab label 走 thunk 跟随 locale；locale/change 订阅触发重渲
- [x] 回归测试：键集 deepEqual + 全 78 键双语非空 + 插值/回退/占位语义 + 纯投影注入
      en 翻译器（'pure projections translate through an injected translator'）
- [x] live：设置→通用→语言切 English 后,DOM 断言通过:页签名 Study,列头 Courses/Tutor/
      Blackboard,视图页签 Teach/🧠 Mind map/🕸 Concepts,窄模式切换器/激活条全英文,chrome
      元素中文残留扫描为空(2026-08-23,rc.2 web profile + file: 构建)

## W2 · 插件设置页

现状：mode/statePath/active 只能手编 cordis.yml。宿主有 `settings.section`
（一插件一页，root 作用域，证据 packages/client/ui-settings/src/client/contract/slots.ts:53）。
我们已有 POST /api/mode、POST /api/active 两条写路由，直接复用。

- [x] 注册 `settings.section` 一页（label 走 W1 字典）：教学风格三选（→ POST /api/mode）、学习模式
      开关（→ POST /api/active，onActiveChange 同步）、statePath 与统计只读展示（src/client/settings.tsx +
      dashboard.ts progress 块与 statePath 注入；tests/dashboard.test.ts state-feed 断言）
- [x] 回归测试：state feed 携带 progress 三项 + statePath（dashboard.test.ts）；组件走共享 store 既有
      mode/activate 写路径（client-node.test.ts 已覆盖 store 层）
- [x] live：设置页翻 mode 引导→实战后 /api/state 回读 mode=practice;翻学习模式关闭后
      feed active=false 且 dock pill 随之消失(渲染级门控 live 证实),再翻回;mode 恢复 guide

## W3 · /study 斜杠命令（发现入口）

现状：headless/键盘用户没有发现路径。宿主 `ctx.commands.register(CommandDefinition)`
（全局或 agent 域，execute 绕过模型；证据 packages/interaction/commands/src/index.ts:262）。

- [x] 注册全局 `/study`：激活（若 dormant）+ followup 注入 kickoff（与 hero 按钮同文，zh 字典单源）；
      带参数透传（src/commands.ts；宿主侧命令发现 UI 即列出，客户端 commandUi 贡献判定为冗余未加）
- [x] 客户端 commandUi 判定为冗余未加:宿主命令注册已进发现 UI——composer 输入 /study
      即出现 Commands→study 建议项(live 证实);命令经宿主 execute 通道,无需客户端贡献
- [x] 回归测试：dashboard.test.ts '/study activates a dormant install...'（激活顺序/幂等/透传/注册形状）
- [x] live：composer 输入 /study(命令建议列表命中)回车 → 命令结果(学习模式已就位)+
      中文 kickoff 入队,模型真实跑完一轮;headless 冒烟:Config.active=on 语义不变,rc.2
      一-shot 跑通,回复含新 id 格式(course-materials:0:1)

## W4 · composer 环境状态条

现状：XP/连续/待复习只在插件页内。`conversation.composer.dock`（list、session 作用域，
token 统计条同款位置；证据 packages/client/ui-conversation/src/client/contract/slots.ts:214）。

- [x] 注册 dock 条目（src/client/dock.tsx）：active 时显示 ⚡n · 🔥d · Lvn，数据来自共享 poll store；
      dormant/加载中渲染 null（渲染级门控——conversation.view 页签切换是 ui-conversation 私有，
      点击跳转不可达，改为 tooltip 指路，与 starter 按钮同一约束）
- [x] 点击行为改为 tooltip 指路:conversation.view 页签切换是 ui-conversation 私有 API
      (与 starter 按钮同一约束),live 证实 dock tooltip 完整显示学习状态并指路学习页签
- [x] 回归测试：dockSegments 投影（client-node.test.ts）；dormant null 分支在组件内（live 检查单覆盖）
- [x] live：真实 state(已激活)下 dock 渲染 ⚡0 · 🔥0d · Lv0 且数值与 /api/state 一致;
      dormant 翻面后 dock 消失(settings live 检查中一并证实)

## W5 · 对话页 toolview（study_* 自定义视图）

现状：对话页签里 study_* 调用是通用样式。`tool.call.toolview`（keyed by 工具名、
session 作用域；证据 packages/client/ui-tool/src/client/contract/slots.ts:24）。

- [x] 为高价值工具注册 keyed 视图（src/client/toolviews.tsx）：record_answer（args 实时 ✓/✗ 色 +
      meta 行）、lesson/due/exam（meta 行卡片，meta 即 presentationMeta 卡片线，回放安全）——其余走默认
- [x] 回归测试：answerTone 解析 + metaLines 两条来源（meta 数组 / content 文本）（client-node.test.ts）
- [x] live：对话页签 .lks-tv 卡 7 张(study_due_reviews/study_lesson 各带 meta 行);真实模型
      一轮出题判分后 study_record_answer 卡落位:✓ correct — mastery 50% → 50% (crown 3) /
      concept: conda环境 84%

## W6 · 预取与类型清理（收尾）

- [x] package.json `dsh.client` 加 `"immediately": true` + locale 注入边；verify bundle 门禁新增
      manifest 断言（scripts/verify.mjs）+ 六条新 bundle 内容断言（settings.section/dock/toolview 等）
- [x] `as never` 换本地 SessionId 品牌助手（views.tsx sessionId()）
- [x] README 增补 'dsh-native surfaces' 一节；AGENTS.md Layout 增补新客户端模块与 src/commands.ts
- [x] index.ts 注释更正为 25 并纳入 /study 命令

## 完成判据（逐条可验证）

1. `grep -c '\[ \]' .goal/SPEC.md` = 0
2. `pnpm run verify` exit 0，测试数 ≥ 169 + 本轮新增
3. 依赖数仍为 0；lib/client.js gzip 相对 30,708B 增量 < 20KB
4. live 检查单（Playwright 结构断言，web profile + 本地 file: 构建）：
   a. en locale 下学习页无中文残留；b. 设置页翻 mode/active 生效；c. /study 命令
   注入 kickoff；d. dock 显示 XP/连续/待复习；e. 对话页 study_record_answer 自定义视图
5. headless 冒烟：`Config.active` 语义不变，`pnpm dsh --profile headless` 一-shot 可跑

## 范围与停止条件

- 只许动：src/、tests/、scripts/、docs/、README.md、AGENTS.md、package.json
  （仅 dsh.client 字段与版本号）、.goal/SPEC.md
- 禁碰：../deepseek-harness（已按指示更新至 dsh-v0.1.1-rc.2，之后只读参照）；
  不装任何新依赖；工具 output schema 只增不删；不发版（等 owner 口令）
- 停止条件：rc.2 之后宿主再变导致 API 与本 SPEC 证据不符（需用户决策是否追）；
  同一思路连续 3 次失败；gzip 增量判据无法满足（需用户放宽或砍 W5）

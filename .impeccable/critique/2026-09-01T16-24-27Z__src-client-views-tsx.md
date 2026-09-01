---
target: 学习页签 src/client/views.tsx + styles.ts
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
timestamp: 2026-09-01T16-24-27Z
slug: src-client-views-tsx
---
# Critique · 学习页签 src/client/views.tsx + styles.ts（0.12.0 实机）

Method: dual-agent (A: design review · B: detector + browser overlay), independent.

## Design Health Score: 26/40 (Acceptable)

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | 系统状态可见性 | 3 | 思考行/⏳/aria-expanded 良好；黑板 viewtab 无 .on 激活样式，当前面板不可辨 |
| 2 | 贴近真实世界 | 2 | 黑板元行泄原始 `in_progress` 枚举 + 导师私有策略指令；工具提示露「ELK 布局」；zh 界面「🔥0d」 |
| 3 | 用户控制与自由 | 2 | 删除有确认但无撤销；点击课时静默换会话无解释 |
| 4 | 一致性与标准 | 2 | 课程条蓝 vs 课时条绿；emoji 与 ic_ds 双符号系；三组切换器均缺 aria-pressed |
| 5 | 错误预防 | 3 | 两步删除、aria-disabled 带原因、考试门槛说明、空导入禁用 |
| 6 | 识别而非回忆 | 3 | 工具提示诚实且到位；但截断标题的 tooltip 被状态占用，标题本身不可恢复 |
| 7 | 灵活与效率 | 2 | 除搜索回车外零快捷键，20 个学习动词全鼠标 |
| 8 | 美学与极简 | 3 | 克制符合品牌；元行与 9 行原始 🔧 study_* 堆是噪点；viewtab 无样式破坏整体感 |
| 9 | 错误恢复 | 3 | 行内 ActionError + 概念图诚实回退；但裸 err.message 无恢复指引 |
| 10 | 帮助与文档 | 3 | tooltip 即文档；入门仅 hero 一处提示 |

## 设计特异性判定

**LLM 评审**：为本产品而作，非品类通用——📖/🎯/⭐/🔒 轨道符号、Cornell 笔记、三魂模式、「掌握度=最薄弱知识点」全部内置；host-native 可验证（零硬编码色，全走 `--dsw-*`，窄屏容器查询，composer follow 实测导师列几何）。客居感只在未完成处：无样式的 viewtab、泄出的模型机制原文。

**确定性扫描**：CLI 2 条（styles.ts:188 side-tab 强调边框、styles.ts:76 width 过渡），tsx 全净。浏览器注入 45 条（学习页）/48 条（设置弹层）——主体是 low-contrast（36 条 3.7:1 `#81858c`：列头/轨道副行/13 条工具消息/元行/笔记节标；10+3 条 2.6:1 `#dd8629` 琥珀：节号/⚡weak 标签与 chips；2.3:1 `#22c55e` ✓答对；4.5:1 红色 😣 标签）、text-occlusion 2 条（starter 按钮盖住导师末段「要继续吗？」95–100%）、em-dash 36 处、h2→h4 跳级 1 处。宿主壳层发现（HwyUHG_*/YECgWq_*）已验证归属非插件。

**覆盖层**：注入取证在隔离子代理的独立标签页完成并按清理协议关闭，无遗留覆盖层。

## 总体印象

骨架是同类插件里少见的好：数据诚实、host-native、双语文案有产品嗓音。失分集中在「最后一层皮肤」没上：激活态不可见（viewtab 无 .on 样式）、大量 3:1 上下的灰字、以及把内部机制原文当 UI 文案。最大机会：一轮 polish 把对比度和切换器语义补齐，分数可进 Good。

## 做得好的

1. **数据挣得像素且有自我解释**——⚡3=薄弱、😣=摩擦、🔁=到期，tooltip 带规则原文（「课时掌握度 = 最薄弱知识点的掌握度」），原则 5 的模范执行。
2. **Host-native 真实可验证**——零硬编码色、容器查询窄屏、自清除的 composer follow；是 dsh 长出来的标签页，不是换皮 iframe。
3. **文案有产品嗓音**——「再练练」「已毕业:掌握度 ≥90%(或你接受了掌握提案)」，zh/en 键级平衡。

## 优先问题

1. **[P1] 插件铬层对比度大面积不达 AA**——列头/副行/工具消息 3.7:1、琥珀节号与 weak chips 2.6:1、✓绿 2.3:1、设置页 4 条 hint 同病；根因之一是 `.lks-tv-chip` 引用了宿主未定义的 `--dsw-alias-state-success-label/error-label`，回退色扛不住。修：色值加深至 4.5:1（文本级），补齐或替换未定义 alias。建议命令：`$impeccable audit` → `$impeccable polish`。
2. **[P1] 黑板 viewtab（讲解/概念图）零样式 + 三组切换器无 aria-pressed**——`.on` 无 CSS 规则（实机验证），点击目标 17×27px，无 hover/focus；模式胶囊/视图签/窄屏切换的状态纯视觉。修：styles.ts 仿 `.lks-switch-btn` 胶囊语言补规则，views.tsx 三处按钮加 `aria-pressed`。建议命令：`$impeccable polish`。
3. **[P1] 休眠态死路 + starter 遮挡**——休眠时启动器/模式胶囊仍可点，点了就是把 prompt 发给不存在的角色（违原则 4）；实测 starter 按钮盖住导师末段正文 95–100%。修：休眠时禁用 pills/启动器并加一行说明条；starter 改为流末内联或让出空间。建议命令：`$impeccable onboard`。
4. **[P2] 模型机制泄入文案**——黑板元行裸 `in_progress` + 导师私有策略指令原文；9 条 🔧 study_* 原始 chip（B 实测这批同时是对比度最差元素）；「ELK 布局」、direct/guide/practice 内部 id 入 copy。修：statusTitle() 映射状态、策略进 tooltip 或折叠注、toolChipLabel 补覆盖、文案去内部词。建议命令：`$impeccable clarify`。
5. **[P2] 笔记区渲染原始 markdown**——理解区（产品情感产物）管道表格成 pipe-soup（n.text 直出 + pre-wrap）；该区 h2→h4 跳级。修：走既有 renderMarkdown 管道或最低限转表格可读。建议命令：`$impeccable polish`。

## 人物红旗

- **Alex（行家）**：零快捷键——面板切换/跳课时/触发启动器全鼠标；搜索回车是唯一加速器。
- **Sam（键盘/读屏）**：`.lks-btn/.lks-starter/.lks-viewtab` 无 `:focus-visible` 规则（实机验证聚焦时 box-shadow:none）；三组切换器无 aria-pressed；⚡/😣/🔁 语义仅在 title 属性；viewtab 命中区 17px。
- **Jordan（新手）**：hero 是 94×28px 的 composer 按钮胶囊，无语境说明；9 条连续 🔧 study_map/study_lesson 原文行；点课时静默传送到新会话无任何解释。

## 次要观察

- 到期 0 时悬浮胶囊 ⚡0 用警示琥珀（空态用警示色）；zh 界面「🔥0d」英文单位；Lv0 三段双色。
- 已毕业/已掌握/0/104 已掌握 术语漂移；同指标双色（课程条蓝/课时条绿）。
- emoji 与 ic_ds 双符号系统并存；删除确认武装态不解除、无导出路径提示。
- 截断标题不可恢复（rail 362px→219px 无 tooltip；节点 tooltip 被状态独占）。

## 启发性问题

1. 课时行同时有进度条和百分比数字——若每个字形都必须真实，条与数字完全一致时，条还挣得到像素吗？
2. 插件在导师列维护了一个宿主对话的迷你镜像，但 toolview 卡只存在于宿主侧——迷你记录该不该消失，让导师列纯粹做角色（胶囊+提案+启动器）？
3. 点课时静默换会话是线程系统的正确行为，但这个副作用是否应该是用户可见的决定（「在新会话中打开这一课？」）？

## Run Notes

- target slug: src-client-views-tsx；ignore list: 无
- 评审独立性: dual-agent 并行隔离（A: agent_0d3b3e5c · B: agent_6751c26e）
- CLI 检测器: 运行成功（exit 2, 2 findings）；浏览器可视化: 成功（可变注入 preflight 通过）
- 覆盖层注入: 成功（live-server :8401，两个视图）；live-server 已停止（taskkill + netstat 验证）；临时文件: 待本轮清理

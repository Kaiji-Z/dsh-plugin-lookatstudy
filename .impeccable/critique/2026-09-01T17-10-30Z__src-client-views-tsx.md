---
target: 学习页签 src/client/views.tsx + styles.ts
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
timestamp: 2026-09-01T17-10-30Z
slug: src-client-views-tsx
---
# Critique · 学习页签 src/client/views.tsx + styles.ts（0.12.0+修复轮复评）

Method: dual-agent (A: design review · B: detector + browser overlay), independent, same contracts as the 26/40 round for comparability.

## Design Health Score: 25/40 (Acceptable)

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | 系统状态可见性 | 3 | 思考/流式/⏳ 齐全；rail 点击静默换会话+花一次模型轮 |
| 2 | 贴近真实世界 | 3 | 毕业/卡点嗓音一致；SM-2/XP/冻结未解释；⭐=可开始 非常规 |
| 3 | 用户控制与自由 | 2 | 启动器/quiz/rail 全部即时发 prompt 无撤销；笔记不可删 |
| 4 | 一致性与标准 | 2 | emoji 图标 vs ic_ds 双体系；cmap 用宿主不发布的 token；中英标点混排 |
| 5 | 错误预防 | 3 | 两步删除+Esc/外点解除、锁定/考试门槛有解释 |
| 6 | 识别而非回忆 | 3 | sticky 章头/焦点行/工具提示 everywhere；但状态解释 hover-only |
| 7 | 灵活与效率 | 2 | 零快捷键，启动器/quiz 无键盘路径 |
| 8 | 美学与极简 | 3 | 无渐变玻璃、密度诚实；rail 行 5 微元素、meta 行掌握度×2 |
| 9 | 错误恢复 | 2 | ActionError/cmap 回退在，但无重试、错误是 12px 脚注 |
| 10 | 帮助与文档 | 2 | tooltip 即全部文档；XP/冻结/开始学习会发 prompt 均无解释 |

## 设计特异性判定

**LLM 评审**：骨架确系本产品所造（毕业/卡点/最薄弱知识点/Cornell 分区/公式化 tooltip 层）；但皮肤两处违背自家品牌——①图标语言是 locale 词典里的 emoji（PRODUCT.md 明言 emoji-as-icon 是 anti-reference，而仓库 vendored 了 ic_ds 却几乎没用）；②概念图走宿主不发布的 token 兜底（GitHub primer 色，暗色模式破）。

**确定性扫描**：CLI 从 2 条降到 1 条（blockqute 引用线 side-tab，属 markdown 惯例可辩护；width 过渡已由 scaleX 消灭）。浏览器注入：插件归属发现从 45+48 条崩落到 **4 条**——viewtab.on 白字蓝底 4.2:1（4.5 临界下）、笔记表 TD 竖 padding 3px<4px ×2、em-dash（CJK 双破折号误报，已 DOM 验证）；设置弹层零发现；对话视图插件元素零发现。宿主壳层发现全部经 `.lks-root` 祖先检查正确排除。

## 本轮抓到的上轮回归（已当场修复）

1. **chip.correct/chip.wrong/chip.unattributed 从 locale 丢失**——上轮删迷你记录时漏算 toolviews.tsx 这个第二消费者，答题卡会渲染字面 "chip.correct"。评审中发现，随即补回两语词典并 amend 进修复提交（1563583）。
2. **focus-visible 光环 1.15:1**——上轮补的 ring 用 border-l3，太淡（A 实测），键盘用户找不到焦点。
3. viewtab.on 4.2:1 与笔记表 3px padding——上轮新样式的临界遗漏。

## 优先问题

1. **[P1] 键盘焦点环 1.15:1**（border-l3 太淡）——换 business-primary，8 处 focus-visible 规则一次改。
2. **[P1] emoji-as-icon 违背自家 anti-reference**——扩展已 vendored 的 ic_ds 图标集替换 rail/actbar/viewtab/dock 的 emoji；⚡ 可保留为文本徽章。
3. **[P1] 概念图 guest token**——diagrams.ts 的 --dsw-surface-1 系换成 styles.ts 同款 --dsw-alias-* 系 + 节点 title 带 {concept} {pct}% + 琥珀编码加图例。
4. **[P2] rail 点击三合一**——title 补「点击将打开本课专属会话」+ 首次 mint 行内确认。
5. **[P2] 考试失败无设计时刻**——study_exam_result 走 generic 卡，最高摩擦时刻零安抚文案。

## 次要观察

dock 零值段 12px 灰近乎隐形；uppercase 嘶喊原始目录 id（0-COURSE-SETUP）；meta 行掌握度双写且 527px 折三行；笔记不可删；rail 行掌握度四重编码（glyph/条/%/tooltip）；en cmap.title 语法;（已修）settings 开关文案连读「关闭已开启」。

## 启发性问题

1. 若明天全部 emoji 被剥离，rail 还能一眼传达课时状态吗——还是 emoji 一直在替设计做语义工作？
2. 打开课时值得花一次模型轮吗——黑板已经能从状态确定性渲染课文，rail 是导航树还是 prompt 启动器，能诚实地两者都是吗？
3. 导师列在复述黑板、启动器在复述选项——三栏学习页是一个决策面还是两个产品在 composer 处粘连？

## Run Notes

- target slug: src-client-views-tsx（与 26/40 轮同口径可比）；ignore list: 无
- 评审独立性: dual-agent 并行隔离；CLI 检测器成功（exit 2, 1 条）；覆盖层注入成功（live-server :8400，三个视图，`.lks-root` 归属检查）
- B 披露一次误路由（一个 evaluate 落到并发 tab 1，已在自家 tab 重做完整 settings 遍历；tab 1 可能残留惰性覆盖层 div）
- live-server 已停（taskkill+netstat 验证）；3080 已停、web profile 依赖已恢复 npm 0.12.0；chip 键回归已在评审窗口内修复并 amend（1563583）

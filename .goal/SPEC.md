# SPEC · 上游 v0.23.0–v0.27.0 七项迭代跟进（目标 0.12.0）

上游本地 checkout：`D:/Users/kaiji/vibecodingKJ/projects/LookatStudy`（main == remote @ v0.27.0）。
本插件当前对齐 v0.22.1（0.11.1）。上一轮（dsh-native，见 SPEC.archive-2026-08-31-dsh-native.md）已完成。
本地文件 CRLF，diff 上游时 strip-trailing-cr。

**执行顺序：批次 A（persona/行为）→ 批次 B（解析器四修）→ 批次 C（markmap 退役 + 版本行）→ live livetest + judge → 发版 0.12.0。**
每个批次内：先证新守卫红（mutation），再实现转绿，再跑 `pnpm test`。
每完成一项勾选下方复选框；全部勾完才算本轮完成。

## 基线（2026-09-01，开工前实测一次留档）

- [x] `pnpm run verify` PASS（2026-09-01，main @ cdb26dd，树干净）；测试数 N₀ = 174

## 批次 A · persona 反伪造 + 三级分层（上游 0.27.0）

上游事故：模型不真正调用 `mark_mastered`，在正文手写「[工具调用已执行]」假标记 → 无确认卡片。
我们同暴露面：`study_propose_mastery` / `study_resolve_proposal`（src/tools.ts:1365/1412）。
现状：src/surface.ts persona 为英文本体（上游「英文本体」项天然满足），有工具指引（:43-53），
**无反伪造条款**。

- [x] A1. persona 重组为三级（全部现有条款原句保留，仅重组 + 优先级标记）：
  - 【Safety redlines · highest priority】反幻觉 + 工具调用真实性（新增反伪造条款：markers are
    injected by the system into history ONLY; hand-writing them in reply text produces NO UI
    artifact; the only way to propose mastery is a REAL tool call）+ 显式声明冲突时以本段为准。
  - 【Teaching behavior】模糊提问引导、工具使用流程（现有 numbered flow）。
  - 【Answer formatting · preferences】自声明次级地位。
- [x] A2. 工具指引补全：propose/resolve 使用时机在指引里点名（现有 :47，检查上下文完整）。
- [x] A3. 回归测试（tests/activation.test.ts 扩或新 tests/persona.test.ts）：
  三级结构锁（分块存在 + 顺序）；反伪造关键句存在（先证红：临时删句确认红，复原，记录）；
  工具清单点名 propose/resolve。
- [x] A4. judge 判据扩充：judge-criteria.md 增「正文零手写工具标记」「提议必须真调
  study_propose_mastery」两判据；scripts/livetest-judge.mjs 模板若动则同步
  tests/livetest-judge.test.ts（结构性铁律）。判据只增不减。

## 批次 B · 解析器四修（上游 0.23.1 / 0.24.0）

全部零依赖红线内移植（纯字符串/XML 处理），每项更新 vendor 文件 provenance header 记录偏差。

- [x] B1. **html-article 尾部模板清理**（src/vendor/html-article.ts ← 上游
  src/main/services/pure/html-article.ts `stripTailNavigation` :97）：指纹式清尾部机器模板
  （搜狐「返回搜狐」/阿里云侧栏三行/行内导航后缀/CSDN 裸图路径行）。原则写进注释：只删跨文章
  稳定的机器生成模板，作者亲笔推广段是正文（上游教训：「欢迎关注公众号」规则误删过作者亲笔段）。
  挂 extractArticle 的 markdown 出口。测试：tests/html-article.test.ts 增搜狐/CSDN/阿里云各一例
  + 作者推广段不删反例。
- [x] B2. **epub 章节对齐全套**（src/vendor/epub-parser.ts，161 行 → 参照上游 378 行版
  `sanitizeEpubBody`(:202) + `splitChaptersInBody`(:126) + 0.24.0 三修）：Gutenberg 头/尾截断；
  多章一文件拆分（CH/Letter 标记 heading 或裸行两形态，裸行限行长防误切，罗马数字/裸序号连续
  递增 ≥3 才切，license 单标记也切救末章、大内容保附录）；出版社形态（无标题兜底「未命名章节」
  不编造编号；短扉页+紧随无标题正文配对合并、后章有标题绝不合并不连锁；版权页著录字段密度
  ≥3 过滤、目录页链接密度 ≥60% 过滤）。zip-reader 交换不动。测试：tests/epub-parser.test.ts
  增合成 fixture（上游 verify-epub-parser T5-T15 形状，CI 无网络）。
- [x] B3. **pptx 表格提取**（src/vendor/pptx-parser.ts）：slide XML walker 处理 `a:tbl` →
  GFM markdown 表（参照上游 `tableToMarkdown` :42）：竖线转义防破表、全空表整张跳过。
  测试：tests/docx-pptx-parser.test.ts 增含表格 slide fixture。
- [x] B4. **pdf 康熙部首归一**（src/vendor/pdf-text.ts）：`normalizeRadicals` 纯函数
  （U+2F00-2FDF 逐字符 NFKC）挂 parsePdfText 出口。测试：tests/pdf-text.test.ts 增部首区
  字形用例。

## 批次 C · markmap 退役 + 设置页版本行（上游 0.26.0 / 0.24.0）

- [x] C1. **markmap 整体退役**：删 src/client/diagrams.ts mindmap 视图 + CDN 三件套
  （markmap-lib@0.18.12 / markmap-view@0.18.10 / d3）+ src/vendor/mindmap-markdown.ts +
  views.tsx 触发 UI（Brain 按钮/页签）+ 相关 locale 键。ELK concept map / mermaid 不动。
  上游论证随删随记：有标题结构不需画图、无标题截首句图看不懂、LLM 概念图已覆盖且质量更高。
  守卫：测试断言源码 + lib 产物零 markmap 残留（参照上游 verify-build-manifest 思路）。
  AGENTS.md CDN 清单表述同步更新。
- [x] C2. **设置页 About 版本行**（src/client/settings.tsx + locale.ts）：「关于」分组显示
  版本号，构建期内联（bundler JSON import 或 tsdown define），禁止运行时网络取版本；
  点击跳 GitHub releases。zh/en 双语，版本与 package.json 严格一致。测试：client-node.test.ts
  断言 locale 键 + 版本字符串等于 package.json。

## live 验证（批次 C 后）

- [x] L1. 刷新 livetest transcript：harness root 跑 headless livetest（命令见 AGENTS.md
  「Headless livetest」节；key 从 ../deepseek-harness/.env source，绝不写入回显）。
- [x] L2. `pnpm run judge`（live）全判据 ≥8 PASS，报告落 livetest-judge-output.md（gitignored）。

## 发版（owner 已确认）

- [x] R1. `node scripts/release.mjs 0.12.0 "<一轮信息>"` —— verify 重跑、bump、commit、tag、
  push、CI、npm 轮询至 live。
- [x] R2.（可选）web profile 重装验证：按 AGENTS.md 的 profile package.json 编辑法 +
  corepack install，勿用 dsh plugin remove/add。

## 完成判据（逐条可验证）

1. `grep -c '\[ \]' .goal/SPEC.md` = 0
2. `pnpm run verify` exit 0，测试数 ≥ N₀ + 本轮新增（每项新守卫具名）
3. `grep -ril markmap src/ lib/` 零命中
4. 依赖数仍为 0（markmap 是删 CDN import，package.json 本就无此依赖）
5. live judge 全判据 ≥8（新增两条在内）
6. npm registry 出现 0.12.0（release 脚本自轮询确认）

## 范围与禁区（全程）

- 只许动：src/、tests/、judge-criteria.md、scripts/livetest-judge.mjs（判据配套）、
  scripts/verify.mjs（如需加 markmap 残留守卫）、README.md/AGENTS.md（表述同步）、
  package.json（仅版本号，由 release 脚本动）、.goal/SPEC.md（勾选进度）
- 禁碰：零依赖红线（不新增任何 runtime npm 依赖）；../deepseek-harness（只读）；
  dsh profiles（除 R2 可选验证）；state.json 持久化格式；Z_AI_API_KEY 绝不写入仓库/回显；
  不为凑绿删既有测试断言或削减 judge 既有判据；工具 output schema 只增不删
- 上游修复若依赖插件禁区（模型客户端 / yt-dlp spawn / linkedom 等 npm deps）→ 按零依赖
  方式改写并在 provenance header 记录，不是停机理由

## 停止条件（停下来问 owner）

- harness .env 缺 Z_AI_API_KEY → live judge 跑不了，报告后停（勿伪造判据）
- 同一移植思路连续 3 轮失败
- release 脚本 CI 或 npm 轮询失败 → 停，附日志
- 发现必须动零依赖红线或持久化 schema 才能继续

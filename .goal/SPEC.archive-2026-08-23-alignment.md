# 对齐上游 LookatStudy v0.22.1 · 差距清单与适配决议

上游 checkout：`D:/Users/kaiji/ZCodeProject/LookatStudy`（v0.22.1，2026-08-22 时点）。
本文是目标的执行规格：逐项清单 + 每项验收。执行中每完成一项，把未勾标记改为已勾并附测试文件名（或其它证据）。**全部勾完才算达标。**

用户已拍板（2026-08-22）：范围 = 学习内核全量 + 黑板渲染升级 + 旧弃置项恢复；伴学/语音排除；渲染依赖走 CDN 按需加载；预算 ~40 轮。

## Baseline（2026-08-23 开工记录，判据 4/5 基准）

- `lib/client.js`：raw 67,877 B / **gzip 20,346 B** → 收工时 gzip 增量须 < 50KB（即 < 71,546 B）
- package.json `dependencies` 数 = **0**（判据 4：全程保持 0）
- `pnpm run verify` 起点 PASS（2026-08-23）

## 适配 dsh 的四条铁律（覆盖所有项）

1. **无模型客户端**：上游依赖自家 LLM 客户端的能力（结构设计、翻译、vision 转写）一律映射为导师协议工具（参照既有 import-design 两工具模式：brief → validate/apply），绝不引入 model client。
2. **宿主侧零新增运行时依赖**：纯逻辑模块 vendored 进 `src/vendor/`（带 provenance 头）；katex/shiki/mermaid/elkjs/markmap 只允许运行时 CDN 按需加载，禁止进 `package.json` dependencies、禁止打进 CJS bundle。
3. **公开接口只增不破**：20 个 `study_*` 工具的 output.schema 只做加法（新增字段/新增工具）；`state.json` 沿用版本化迁移（loadState 向前迁移），既有课程数据不丢。
4. **每个移植行为同改动携带回归测试**（AGENTS.md 既有法则）；上游对应 `verify-*.mjs` 的语义镜像为 `tests/*.test.ts`，确不适用的项在清单行尾注明原因。

## Phase 1 — 学习内核（纯逻辑，先做）

### 1.1 vendored 模块追平 v0.22.1
对每个模块做三方审计（本仓补丁意图 vs 上游增量），移植上游 delta、保留本仓必要补丁，diff 归零或在行尾注明保留差异：

- [x] `adoc-parser.ts` — 转义风格同步,`--strip-trailing-cr` diff=0（除 provenance 头）tests/vendor 对拍
- [x] `bkt.ts` — diff=0（纯 CRLF 差异,虚警）
- [x] `file-classifier.ts` — diff=0
- [x] `local-folder-scanner.ts` — 上游 epub/docx kind + parsePdf 注入口已并入;保留 dedup-key 补丁与 vendor 解析器路径(残 diff 33 行均为有意保留) tests/local-scanner-formats.test.ts
- [x] `markdown-course.ts` — 正则转义同步;保留 examBody(本仓考试特性,上游无此概念)
- [x] `notebook-parser.ts` — diff=0
- [x] `org-parser.ts` — diff=0
- [x] `repo-fetcher.ts` — 上游 bodyPreview/extractBodyPreview/downloadToBuffer 已并入;保留 test seam 与网络加固头(残 diff 85 行均为有意保留)
- [x] `rmd-parser.ts` — diff=0
- [x] `rst-parser.ts` — diff=0
- [x] 已一致:`sm2.ts`、`code-parser.ts` — diff=0 复核完成

### 1.2 新格式解析器 vendored（上游 `src/main/lib` / renderer 纯模块）
- [x] `epub-parser.ts` — 上游结构逻辑逐字,fflate→自研 zip-reader;tests/epub-parser.test.ts 6 绿
- [x] `docx-parser.ts` — officeparser→直解 OOXML,Heading 保真契约一致;tests/docx-pptx-parser.test.ts
- [x] `pptx-parser.ts` — 同上,`## Slide N:` 契约一致;images 字段留待 Phase 3
- [x] `pdf-text.ts` — pdf-inspector/pdf-parse 依赖→零依赖 Flate+Tj/TJ 文本层;加密/扫描件诚实空串;tests/pdf-text.test.ts 6 绿。pdf-renderer(napi canvas)不移植,已注明
- [x] HTML 文章导入 — html-article 零依赖移植(mini-DOM 替 linkedom/readability/turndown 三件套,诚实失败契约一致);study_import_url article 路由接通 tests/html-article.test.ts tests/url-import.test.ts
- [x] text-chunk 切块语义 — verbatim vendored;tests/text-chunk.test.ts 3 绿
- [x] 音视频源导入(分类与元数据) — url-route/video-meta vendored;B站 view API 元数据 + 诚实拒绝(字幕需 yt-dlp spawn/转写需模型客户端,均禁区,指路 study_import_markdown);本地音频=ASR 模型客户端域,按铁律 1 不移植,已注明 tests/url-import.test.ts
- 验收：各解析器测试样例（上游 fixtures 或自造）+ 设计 brief 协议接入（新格式出现在 `study_import_folder`/`study_import_github` 的 brief 里）

### 1.3 导入 v2 健壮性 → 映射到两工具协议
- [x] import-plan 分批 — token-estimate verbatim vendored + planBriefParts 贪心装箱(48k/批,brief 的 40-heading 上限使成本=真实渲染体积) + import 工具 part 参数(每 part 独立成课,title 加后缀);import-plan.ts 本体 vendored(identity/treeHash/bestEffort 备用) tests/import-plan.test.ts 6 绿
- [x] import-cancel — dsh 原生方案:宿主中断工具调用即取消(exec.signal 全链路贯穿 fetchRepoInventory/fetchFileOutlines/downloadToBuffer),无需 dashboard 路由;预中止信号快速失败已测(导入已取消) tests/import-plan.test.ts
- [x] structure-resilience/section-extract/import-empty-guard — 上游三修复(H2 含 H3 子段/首课吸收 H1+前言/锚点未中退化整文件)已在 sliceLessonBody 实现并被 tests/import-design.test.ts 冻结;空设计守卫(0 usable lessons 抛错)同测;bestEffortStructure 已 vendor 备用
- [x] local-inventory/local-filelist — buildLocalInventory 随 scanner 追平;local-filelist bug(本地 docs 被 github 向的 pathsToDiscoveredFiles 二次过滤)在插件协议中结构性不存在(folder docs 直进 brief,无二次过滤),docsToDiscoveredFiles 已在 repo-fetcher;txt/html/pdf/epub/docx 全格式进 brief 已测 tests/local-scanner-formats.test.ts
- 上游 watchdog/JSON-salvage/bisection：**不移植**（AGENTS.md 既定：导师即 LLM，失败恢复靠 agent loop）——在此注明即可

### 1.4 考试系统
- [x] 星级 — accuracyToStars(≥95/80/60 阈值,上游 exam-service) + state recordExamResult(best-of 持久化 examStars/examAttempts) + study_exam_result 工具(schema 只增) tests/exam.test.ts
- [x] 每题动态限时 — questionTimeLimitSec verbatim(45+cjk/5+words/3+options×8+code25+formula25,clamp60-300) + study_lesson exam 分支携带 examGuide(题量 planExamQuota/KC 并集/限时规则/星级规则);静栖区伴学视觉不移植,已注明 tests/exam.test.ts
- [x] post-quiz-actions + quiz-progress — getPostQuizActions verbatim(≥2 动作灭死胡同,mark-mastered 门控)进 study_exam_result 输出(映射 study_propose_mastery/next-topic);quiz 进度持久化由 dsh 会话日志结构性覆盖(转写可重建,无需上游 localStorage 层),已注明 tests/exam.test.ts

### 1.5 学习闭环
- [x] consolidation — gatherConsolidationWindow 纯读(watermark 切片 friction+practice notes,逐课上限,时序) + study_consolidate 工具(收集窗口+推水位,导师=consolidateFn,产出走 study_remember;对话半窗在 dsh 会话日志,已注明) tests/learn-loop.test.ts
- [x] learner-model — study_lesson 新增 learnerState 组合投影(上游 buildLearnerSnapshot 的【学习者当前状态】语义:status/mastery/strategy/weak/friction/memory 一块) tests/learn-loop.test.ts
- [x] memory/RAG — 记忆=三槽(global/pattern/lesson)+consolidation 系统级兜底(上游 remember 的对齐);RAG 检索由 dsh 会话日志+study_lesson 直读结构性覆盖(单一当前课上下文,无跨库检索面),水位持久化 v2 round-trip 已测 tests/learn-loop.test.ts
- [x] lesson-summary-kc — study_define_concepts 加 summary 参数(1-2 句,随 KC 一次生成语义) + LessonState.summary 持久化 + study_lesson 透出;LLM 返回→结构化参数由 dsh 工具 schema 承担(无需上游 JSON 抢救 parser),已注明 tests/learn-loop.test.ts

### 1.6 课程搜索
- [x] 全文搜索 — searchLessons 纯函数(多关键词 AND,标题+正文,snippet)+ study_courses query 参数(matches+schema 只增) + GET /api/search 路由 + 搜索框回退接线(标题无命中→全文接口→跳转命中课时) tests/progress-pack.test.ts

### 1.7 XP 与连胜
- [x] XP — 常量 10/1/50 + levelFromTotalXp 平方曲线 verbatim(vendor/xp.ts) + recordAnswer 挂钩(答对10/答错1/毕业50,日桶滚动) + study_courses progress 块(totalXp/level/todayXp/dailyGoal) tests/progress-pack.test.ts
- [x] streak — streak-transition verbatim vendor(同日幂等/昨日+1/gap=2 冻结续命/gap≥3 重置) + noteXpActivity 每次 XP 事件打卡 + progress 块透出(streak/longest/freeze) tests/progress-pack.test.ts
- 落点：state + cards 投影 + dashboard feed

### 1.8 导出
- [x] 学习包导出 — courseToPackMarkdown 纯函数(章节##/课时###/正文 verbatim)+ study_export 工具(schema 只增);接收方走既有 study_import_markdown 零新导入路径零网络(round-trip 已测;进度不含——上游 pack 亦是内容包,已注明) tests/progress-pack.test.ts

## Phase 2 — 黑板渲染升级（CDN 按需）

- [x] CSP 探针 — harness 全仓 grep 无任何 Content-Security-Policy 头/meta(源码级证据)，浏览器默认策略放行 CDN 运行时加载；活体加载验证并入 livetest 收尾(判据 3)

- [x] math — math-normalize verbatim vendored 挂进 dashboard 课时管线(括号记法先归一为 $ 记法);KaTeX CDN 渲染器(client/enhance.ts,文本节点 $/$$ 解析,throwOnError:false 降级);题面 LaTeX 经转写区增强覆盖;math-plugins 是 remark 管线件,插件自研渲染器不需要,已注明 tests/render-enhance.test.ts
- [x] shiki — CDN(esm.sh)懒加载单例+双主题(github-dark/light)+别名表;未知语言/失败保持纯 pre(不重试) tests/render-enhance.test.ts + verify bundle 门(esm.sh/shiki 在成品中)
- [x] mermaid+ELK — mermaid-elk-rewrite verbatim vendored(flowchart 前缀改写)+ CDN mermaid@11 + layout-elk 注册;ELK 失败静默退 dagre,渲染失败保持代码块 tests/render-enhance.test.ts
- [x] markmap 脑图 — mindmap-markdown verbatim vendored(围栏占位/图 alt/注释剥)+ CDN markmap-lib/view;黑板「🧠 脑图」入口(讲解/脑图/概念图三态切换);wire 加 lesson.markdown tests/render-enhance.test.ts
- [x] 概念图 v2 — cmap-elk-layout verbatim vendored(ELK layered/正交路由/邻接兜底聚类,elkjs 指向 CDN)+ 插件原创 draw.io 风 SVG 皮肤(--dsw-* 令牌,弱概念琥珀底);「🕸 概念图」入口 tests/render-enhance.test.ts
- [x] markdown-sanitize 收口 — 插件管线本就 escape-first(强于 rehype-sanitize schema,XSS 面构造性为零);裸标签零泄漏不变量已测;上游 schema 的 data: src 放行留给 Phase 3 图片内联 tests/render-enhance.test.ts
- 验收：每项一个「CDN 命中」测试（mock fetch 注入）+ 一个「CDN 失败降级」测试 + `lib/client.js` gzip 增量 < 50KB（见判据 5）

## Phase 3 — 旧弃置项恢复

- [x] 翻译系统 — translations/{lang}/{path} 配对(collectTranslations,scanner 的 translations 扫描接通) + apply 按同锚切译文 + renderBilingual 段落对照(microsoft layout 语义) + study_translate_lesson 导师协议工具(导师即译者,铁律 1);seed-bilingual=内置课种子,上游属课程模板领域(插件无内置课),不移植已注明;无自动翻译管线 tests/translation-images.test.ts
- [x] 图片内联 — folder:buildLocalInventory 图集→data: URL(上限 200KB/张,上游 fetchImageAsDataUrl 同值,超限保持原引用) + inlineLocalImages 目录感知改写;GitHub:rewriteGithubImageRefs 相对引用→jsDelivr gh URL(.. 解析);markdown 渲染白名单 https?/data:image(200KB 帽与白名单均入测试) tests/translation-images.test.ts

## 收尾证据（2026-08-23，判据对照）

- 判据 1：`grep -c` 未勾标记 = **0**（40/40 全勾）
- 判据 2：`pnpm run verify` **PASS**（tests 167/167 → build → bundle+secrets 全绿）
- 判据 3：
  - 活模型转写 `livetest-align-output.md`（glm-5.2，headless profile）覆盖 **5 个新功能域**：docx 新格式导入设计协议 / 翻译配对+study_translate_lesson / 考试域(examGuide 题量+动态限时公式+星级+考后动作) / 全文搜索("Jacobian" 命中正文) / XP+streak+导出包——超出的两个缺陷(docx H1 不切片、examGuide 渲染缺失)已当日修复并带回归测试（tests/local-scanner-formats.test.ts tests/exam.test.ts）
  - 冻结自测 `livetest-output.md` 重跑 + `pnpm run judge` **PASS 10/10**（judge-criteria.md C1 按其自身规则随 v0.5.0 的 exam-node 计数行为更新：3→4 lessons，同提交声明）
- 判据 4：package.json dependencies = **0**（全程未动）
- 判据 5：`lib/client.js` gzip 终值 **30,708 B**（baseline 20,346，增量 10,362 B < 50 KB 上限；渲染依赖全走 CDN，verify bundle 门断言 esm.sh/jsdelivr 引用在成品中）

## 明确排除（不在本目标内，勿顺手做）

伴学/桌宠/卡拉OK/TTS/ASR/voice（上游 v0.17-v0.22 companion 主线）；Electron 专属（mobile/TLS/pet-window/系统 TTS）；模型客户端域（model picker/custom provider/vision routing——dsh host 所有）；线程切换（dsh sessions 所有）；设置页 UI（host 所有）；pdf-renderer（napi canvas）；导入 watchdog/salvage 机器。

## 执行提示

- 上游对应实现先看 `package.json` 的 `verify:core` 清单定位文件名，再读实现；fixtures 在上游 `scripts/` 与 tests 里。
- 三方审计冲突（本仓补丁 vs 上游改动同一处逻辑）且影响工具输出 schema → 停止条件，问用户。
- 每完成一个功能域跑一次 `pnpm run verify` 取证；全部完成后跑 livetest + judge（判据见目标文本）。

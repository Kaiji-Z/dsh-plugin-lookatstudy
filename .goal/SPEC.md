# SPEC · 对抗性审查全修（40 项：P0×3 / P1×9 / P2×19 / P3×9）

来源：2026-09-14 全面对抗性审查（5 个并行审查代理 + dashboard/tts/markdown 亲读，全部 P0/P1 已核到代码行）。owner 拍板「全修」。
上一篇 SPEC（上游对齐四件套）归档于 SPEC.archive-2026-09-14-alignment-four-gaps.md。

## 铁规则（全程有效）

1. **每批次收尾**：`pnpm run verify` 退出码 0 + 本地 commit（不 push、不打 tag、不发版——发版等 owner 说「发版」）。
2. **先证红，再信绿**（仓库自己的验证铁律）：新门禁类测试（A2 的 403、B6 的内网拒绝、B11 的解压上限、B4 的反空转断言）必须先构造攻击/故障输入证明会红，再实现修复转绿，红绿过程记入 commit message。
3. **禁改测试凑绿**：仅允许三类测试改动——(a) 为 dashboard 既有测试补新鉴权必需的头/Host（适配）；(b) 修复 B4 空转测试本身；(c) 新增测试。
4. **零依赖**：不新增运行时依赖（C22 的 peerDependencies 声明除外）。vendored 文件（src/vendor/）改动必须在原 provenance header 追加 patch 注记。
5. **状态格式只增不改**：trash / frictionGlobal / 考试快照等一律 additive，`loadState` 必须继续读懂当前线上 state.json（前向兼容），迁移只升不降。
6. **不碰**：dsh harness checkout、web/web-lks/headless profile、上游 LookatStudy 仓库。
7. 顺序 A→B→C→D；同批次内按编号推进，一项一测试锚点，不裸改。

---

## 批次 A · P0（3 项）

### A1 mermaid 存储型 XSS
- 证据：`src/client/enhance.ts:152`（`securityLevel: 'loose'`）+ `:277-281`（`wrap.innerHTML = svg`）；`src/artifacts.ts:153-160`（sanitizeDiagram 不查内容）。不可信正文（GitHub/arXiv/网页/B站/文件夹导入）经 `renderMarkdown` 保留 ` ```mermaid ` 围栏直达此渲染器。
- 修复：`securityLevel: 'strict'`；确认 strict 下现有 mermaid 渲染（flowchart ELK 重写链）不回归。
- 验收：新增测试注入 fake mermaid（`setEnhanceDeps`）断言 `initialize` 收到 `securityLevel:'strict'`；`grep -r "securityLevel" src/` 无 `loose`。

### A2 dashboard 全路由零鉴权
- 证据：`src/dashboard.ts:364-828`——不查 Origin/Referer/Host/token；`readJsonBody`（:337-355）不看 Content-Type，任意网页可用 `text/plain` JSON fetch（无预检）打全部 POST：删课程/删笔记/污染 BKT 与 SM-2/关闭激活/无限写附件/TTS 外呼。`GET /api/state` 全量学习数据+statePath，无 Host 校验 → DNS rebinding 可读。
- 修复（分层）：
  - 全局：Host 头主机名 ∈ {localhost, 127.0.0.1, [::1]}（端口任意），否则 403。
  - 所有 POST 路由：额外要求自定义头 `X-LKS-Request: 1`（面板 `src/client/data.ts` 等 fetch 统一加头），否则 403。
  - GET 路由不做自定义头要求（`<img src>` 不发自定义头），靠 Host 校验挡 rebinding。
  - `RequestLike` 结构接口扩可选 `headers` 读取。
- 验收：dashboard.test.ts 新增——无头 POST→403、带头+外域 Origin→403、带头+本地 Origin→200、Host=evil.com→403；既有 dashboard 测试统一补头（适配，非削弱）。

### A3 跨进程持久化竞态 + 崩溃无恢复
- 证据：`src/state.ts:396-401`（固定 `${path}.tmp`、`renameSync` 无重试、无 fsync、无备份）；多 profile 共享一个 state.json 是文档化现实。`src/index.ts:36` 裸 `loadState`——坏文件/新版本文件让整个插件 apply 死亡。
- 修复：
  - tmp 名 `${path}.${pid}-${rand}.tmp`；
  - rename EPERM/EACCES 重试（≤5 次，退避）；
  - 保存成功后把上一份 state.json 复制为 `.bak`（写 .bak 失败不阻塞）；
  - `loadState` 失败（JSON 损坏/版本拒读）：先试 `.bak`，再失败把坏文件隔离为 `state.json.corrupt-<ts>` 并以 `emptyState()` 降级启动（console 告警；不杀 apply）。
- 验收：state.test.ts 新增——坏 JSON→隔离+空态、.bak 恢复、并发两次 saveState 断言文件为二者之一的完整内容（无撕裂）、tmp 残留不污染下次。

---

## 批次 B · P1（9 项）

### B4 线程组 fuzz 空转
- 证据：`tests/invariants.test.ts:11-22` 缺 `bindLessonThread/archiveLessonThread/deleteLessonThread/renameLessonThread` 四个 import，:98-104 全抛 ReferenceError 被 :105 裸 catch 吞掉；实测 20ms 假绿。
- 修复：补 import；加反空转守卫（opExecuted 计数，循环后断言 > 0）；按铁规则 2 先证红（临时去掉一个 import 复现红，记录于 commit message）。
- 验收：`node --import tsx --test tests/invariants.test.ts` 绿且含 opExecuted 断言。

### B5 setMemory('pattern') 永远抛错
- 证据：`src/state.ts:1176` `lessonId.slice(0, lessonId.lastIndexOf(':'))`——lesson id 是 `courseId:si:li`，切出 `courseId:si` 必抛。
- 修复：改为首个冒号 `indexOf(':')`。
- 验收：pattern 写→读回 round-trip 测试 + 跨课程隔离断言。

### B6 SSRF：article 通道任意主机 + 跟随重定向 + 无响应上限
- 证据：`src/vendor/url-route.ts:78`（任意 http(s) 落 article）；`src/tools.ts:557-559`（默认跟随重定向、`resp.text()` 无上限）；可打 A2 修复前的本机 dashboard、云 metadata、内网。
- 修复：
  - 新增 `assertPublicHttpUrl(url)`（字面内网 IP/localhost/0.0.0.0/::1/10./172.16-31./192.168./169.254./100.64-127. 拒绝；域名不做 DNS 解析——文档披露边界）；
  - article fetch `redirect: 'manual'`，手动跟随 ≤5 跳且每跳重过判定；
  - `resp.text()` 换 capped 读取（2 MiB 上限，Content-Length 预检 + 流式截断）；
  - bilibili 字幕 `.text()`（video-meta.ts:164）同样加上限。
- 验收：url-import.test.ts 新增 deny 表（127.0.0.1 / 169.254.169.254 / 192.168.1.1 / [::1] / 0.0.0.0 / 10.x）+ 重定向二跳进内网拒绝 + 2 MiB 截断。

### B7 提示注入链闭合（标题消毒 + 注入上限 + 删除护栏）
- 证据：`src/surface.ts:123-126` 标题/概念/friction/rationale 原样插值进系统提示（可含换行伪造小节）；`tools.ts:997` 正文整段入上下文；`tools.ts:1746` study_export 无上限；`tools.ts:1381` study_delete_course 唯一护栏是 description 一句话、不可逆。
- 修复：
  - snapshot 组装加 `sanitizeSnapshotText`：压单行（\r\n→空格）、剥控制字符、长度上限 120；
  - study_lesson 正文注入截断 24k chars（带截断标注）；
  - study_export：markdown > 100k 时截断 + 返回 chars 计数 + render 指引走面板导出（course-pack 路由）；
  - study_delete_course 两步协议：无 `confirmToken` 时返回待确认 token（不删）；带正确 token 才执行；物理删除改为移入 `state.trash[]`（含关联 proposals/artifacts/threads/lessonSessions 条目），新增 `study_restore_course` 工具 + dashboard `POST /api/course/restore`；dashboard 的 course/delete 同样进 trash。
- 验收：注入单测（标题含 `\n### 伪小节` 的课程，snapshot 断言单行无结构逃逸）；两步删除协议测试（无 token 拒、错 token 拒、成功删→trash、恢复往返全量还原）；截断测试。

### B8 同标题重导入吞内容更新
- 证据：`src/state.ts:463-464` 幂等匹配 `id+title`，不比对 source——不同源同标题互相吞、同源更新被静默忽略。
- 修复：`source !== 'markdown'` 时改按 `(source, sourceRef)` 查找幂等；同源不同标题也返回 existing 并在返回值带 `existing:true`（工具 render 提示「该源已导入；要更新请先删除」）；markdown 保持原 title 契约（上游粘贴语义）。
- 验收：同 URL 不同 title / 不同 URL 同 title / markdown 契约三组测试。

### B9 release.mjs 不查分支
- 证据：`scripts/release.mjs:57-83` GATE 0 只查脏树；feature 分支跑发版会把陈旧本地 main+tag 推上去触发发布。:45-48 重跑死胡同报错。
- 修复：GATE 0 增加 `git branch --show-current` 必须是 main 且 HEAD === origin/main（否则提示 pull）；push 失败重跑时检测「package.json 已是目标版本且本地有未推 tag」给出准确恢复指令。
- 验收（手动，记录进 commit message）：临时分支上运行被拒 exit 1；主分支 dry 场景逻辑走查。

### B10 发布物门禁盲区（lib/ 陈旧 chunk + secrets 扫描不覆盖产物）
- 证据：`scripts/verify.mjs:297-306` 只扫 `git ls-files`；lib/ gitignored；`tsdown.config.ts` 两处 `clean: false`——当前 lib/ 实存 3 个 epub-parser-*、2 个 pptx-parser-*、2 个 html-article-* 变体。
- 修复：`clean: true`（两个 config）；verify 增加 lib 产物清单步骤——`pnpm pack --dry-run --json` 的文件列表 + 断言无同前缀多 hash 变体 chunk + secrets 扫描范围扩到 pack 文件清单（读 lib/ 实文件）。
- 验收：`pnpm run verify` 绿；`ls lib/` 无重复 chunk 前缀；pack 清单仅 lib 预期文件。

### B11 解压炸弹（inflate 无输出上限）
- 证据：`src/vendor/inflate.ts` 输出缓冲无限翻倍、逐字节同步循环；上限只压输入侧（repo-fetcher 64MiB 压缩）；arXiv PDF / 本地 epub 可达；epub 本地读取连输入上限都没有（local-folder-scanner.ts:574-577）。
- 修复：inflate 增加 maxOutput 参数（单流 64 MiB），超限抛错走诚实失败；zip-reader/epub 路径传上限；本地文件读取加上限（64 MiB）。provenance header 追加 patch 注记。
- 验收：构造高压缩比流（小输入→大输出）断言抛错不 OOM；>64MiB 本地文件拒绝。

### B12 markdown 课程包对 design 导入不能往返
- 证据：`src/export-pack.ts:15-17` 前提「正文不含 H1-H3」对 design 导入为假（`import-design.ts:404` 正文从锚点标题行起切）；重导入孵化幻影 section 且丢正文。
- 修复：`coursePackMarkdown` 写侧对正文行首 `#{1,3}` ATX 行转义（前置 `\`）；自研 parser 的 heading 正则天然不认 `\#`（验证之）；往返断言 body 去转义后与原 body 相等。
- 验收：design 路径 fixture（正文含 ##/###）导出→重导入，树结构一致、内容无丢失。

---

## 批次 C · P2（19 项，编号 C13-C31）

- **C13** readJsonBody：done 标志停推+可选 `destroy`、补 `error`/`aborted` reject、计数器替代每 chunk reduce（dashboard.ts:337-355）。测试：aborted 挂起修复。
- **C14** `GET /api/exam` 副作用：settleDanglingAttempts 返回 changed，仅真变更才 save（dashboard.ts:540-541）。测试：无 dangling 时二次 GET 不写盘（mock store.save 计数）。
- **C15** exam 节点违约：attemptLesson/recordAnswer 拒绝 `kind==='exam'`（state.ts:695/938 一带）；study_lesson 的 examGuide 分支改只读（不再 attempt）。测试：exam 上 attempt 抛错；invariants 补「exam 恒 available」断言。
- **C16** 考试中途换题库：startExamAttempt 快照当前 questions 进 attempt；submit/settle 用快照；regenerate 前先 settle dangling（state.ts:882-883、dashboard.ts:644）。测试：中途 regenerate 后按原题判分。
- **C17** deleteCourse 清孤儿：lessonThreads/lessonSessions/memoryPatterns 按 `courseId:` 前缀清、focus 命中清（state.ts:510-518；trash 化后关联项一并入 trash 支撑恢复）。测试：删后全键枚举无残留。
- **C18** sanitizeQuiz 索引重映射：过滤空选项时记录原→新索引映射并迁移 answer（artifacts.ts:75-88）。测试：`["","B","C"], answer:1` 判 B。
- **C19** 幻影工具 study_view：四处文案改指 study_lesson（tools.ts:1189、state.ts:785、locale.ts:380/751）。验收：`grep -r study_view src/` 为空。
- **C20** 无 lessonId 的 friction：写入新增 `state.frictionGlobal[]`（cap 50），gatherConsolidationWindow 纳入（state.ts:1145-1149）。测试：null 路径写入+consolidate 可见。
- **C21** decodeEntities 越界：fromCodePoint 包 try/catch → U+FFFD（html-article.ts:31-33）。测试：`&#x110000;` 不抛。
- **C22** react-dom/client 未声明：peerDependencies 加 `react-dom >=18`；tsdown 注释更正「react 与 react-dom/client」。测试：读 package.json 断言。
- **C23** 零类型检查：新增 tsconfig.json（strict、nodenext、allowImportingTsExtensions+noEmit、jsx react-jsx、include src+tests）+ verify 加 `tsc --noEmit` 步骤；存量错误在本批次内修完。停止条件兜底：存量错误 >200 则停报 owner。
- **C24** KaTeX 渗入 shiki 代码：enhanceMath 的 TreeWalker 跳过 `.lks-shiki`/`.lks-mermaid`/`closest('code')` 祖先（enhance.ts:179 vs 254-258）。测试：shiki 输出内 `$x$` 不被渲染。
- **C25** secrets 扫描窄：模式扩（大小写不敏感 key 名、YAML `token:`/`api-key:` 形态、`ghp_`/`github_pat_`/`sk-` 值前缀、跨行拼接的常见形态）；CI 里 live-key 检查保持 owner 本机（键 env-only 红线，GitHub Secrets 配置留 owner 决定，SPEC 披露此边界）。测试：verify 喂脏 fixture 命中（先红后绿）。
- **C26** bindLessonThread 无存在性校验：先 findLesson，未知抛错（state.ts:1006；dashboard 路由随之 404）。测试：未知 lessonId 抛。
- **C27** TLS 校验关闭：移除 `rejectUnauthorized: false`（repo-fetcher.ts:640/653-656）；确需逃生加 `LKS_INSECURE_TLS=1` 显式分支（默认关）。验收：grep 仅 env 分支可见。
- **C28** 状态无限增长：examAttemptLog cap 20（保最新全量）、artifacts per-lesson cap 100（丢最旧+warning）、resolved proposals 清理（保留计数）。阈值写注释。测试：cap 行为。
- **C29** pendingDesign 单槽串台：brief 带 seq，designRequiredValue 产出埋 seq，重渲染/apply 时校验 seq 不匹配则报 stale 错误（tools.ts:267/361-369）。测试：连续两导入，旧 value 报 stale。
- **C30** GitHub URL 字符串身份：parseGithubUrl 后重构 canonical `https://github.com/<o>/<r>` 存 sourceRef（tools.ts:449）。测试：`/r`、`/r/`、`/r.git`、`?tab=readme` 四变体幂等。
- **C31** cdnUrl dot-segment：链接路径归一化后必须仍在 `gh/<o>/<r>@<ref>/` 前缀下，否则丢弃该链接（repo-fetcher.ts:61-112）。测试：`../../evil/x.md` 被拒。

---

## 批次 D · P3（9 项，编号 D32-D40）

- **D32** CDN SRI：katex `<script>` 加 `integrity`（sha384，按 0.16.22 锁定计算写入）+ `crossorigin`；esm.sh 动态 import 无法 SRI——VERIFICATION.md 风险登记一条。验收：integrity 属性测试/bundle 探针。
- **D33** actions SHA 固定：ci.yml/publish.yml 的 checkout/setup-node/pnpm 相关 action 按 commit SHA 固定。验收：yml 无可变 tag。
- **D34** /api/state 变更门控：state 加 rev 计数（每次 save 递增），feed 带 rev + ETag/304。测试：同 rev 二次请求 304。
- **D35** engines 下限 CI：ci.yml matrix 加 node 22.19 一档。验收：yml 含 22.19。
- **D36** dts 门禁：verify 断言 lib/index.d.mts 存在。验收：verify 步骤清单。
- **D37** arXiv existing 前置：下载/解析前先查 existing（tools.ts:537-547 顺序调整）。测试：二次调用 mock fetchFn 未被调用。
- **D38** 锚点匹配保守化：精确唯一匹配优先，否则现状+miss/duplicate warnings 进 apply 结果（import-design.ts:375-383）。测试：重复标题场景告警存在、行为兼容。
- **D39** CSS.escape：panel.tsx:2628 补齐（与 :417/:1164/:1832 同法）。验收：grep 该行。
- **D40** release 重跑死胡同：见 B9 一并修。验收：模拟 tag 存在场景输出正确恢复指令（手动记录）。

---

## 全局完成判据（目标引用）

1. `pnpm run verify` 退出码 0（含 C23 新增 `tsc --noEmit` 与 B10 新增产物清单步骤）。
2. 本 SPEC 每一项的「验收」行全部有对应测试/命令证据，逐项勾选记录在完成汇报里。
3. `node --import tsx --test tests/invariants.test.ts` 绿且含 B4 反空转断言。
4. grep 门（全部必须为空命中）：`securityLevel:\s*'loose'`、`rejectUnauthorized:\s*false`（env 分支除外）、`study_view`。
5. 全部修复以本地 commit 落在 main（按批次分组 commit），不 push 不发版。

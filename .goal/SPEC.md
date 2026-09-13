# SPEC · 上游对齐四件套（线程管理 / 课程包导出 / URL 导入 / 视频导入）

来源：2026-09-14 模型级审查（上游 @ v0.34.0-2）。owner 拍板「全做」。
上一篇 SPEC（issue #11 线程组）归档于 SPEC.archive-2026-09-13-issue11-thread-groups.md（未跟踪）。

## 已定决策（审查时查实，不再重新决策）

- **host 会话面有 `session.rename(title)`，没有 session delete**（packages/api/session-controller/lib/types/client/contract/session.d.ts:116）。→ 线程重命名双写（我们的 meta + host 会话标题，host 侧 best-effort）；线程删除=移出组（dsh 会话留在 host 列表，UI 文案诚实说明），active 指针回滚到组内最新或 null。
- **上游课程包** = `serializePlan(plan)` 自包含 JSON（`<名>.lookatstudy-pack.json`），web 模式回传内容浏览器下载；folder 导入因私有路径不可导。我们没有 plan store——课的 body 在 state 里，**全部来源可导**，格式自定但必须自往返（export→import 还原课程）。
- **上游 html-article 依赖 linkedom+readability+turndown**（三个 npm 包）——违反本仓库零依赖教义 → 自研零依赖子集（title 启发式 + 正文密度抽取 + html→md），接口对齐上游 `extractArticle`。
- **bilibili-wbi.ts(53行) + subtitle-parse.ts(105行) 上游即纯 JS** → 逐字 vendored（provenance header，同 src/vendor/ 惯例）。
- **视频导入只做字幕路径**：音频转写需要模型客户端（插件没有，架构排除）；**yt-dlp 不做**（插件不 spawn 用户二进制——那是桌面 app 行为）。无 CC → 诚实错误（文案说明只支持有字幕的视频）。
- URL 导入的 arXiv 分支：httpsGet PDF → 已 vendored 的 pdf-text → markdown。
- 两个新导入工具走**既有导师设计协议**（brief → study_apply_design），不改任何既有 study_* 工具契约，只新增。

## P1 线程管理三件套（rename / archive / delete）

- `state.ts`：`LessonThreadMeta` 增加 `status?: 'active' | 'archived'`（缺省 active，旧文件不迁移也读得动）；`renameLessonThread(state, lessonId, sessionId, title)`（改 meta.title，active 与 lastAt 不动）；`archiveLessonThread(state, lessonId, sessionId, archived: boolean)`；`deleteLessonThread(state, lessonId, sessionId)`（组内移除，active 命中则回滚到剩余 lastAt 最新者或 null，lessonSessions 保持 lockstep）。
- `dashboard.ts`：新路由 `POST /lookatstudy/api/lesson-thread` `{lessonId, sessionId, op: 'rename'|'archive'|'delete', title?, archived?}`，rename 成功后 host 侧 `ctx` 不在 dashboard——host rename 放在**客户端**（panel 拿到 route 200 后调 session face rename，best-effort，失败 toast 不阻塞）；feed 的 lessonThreads 原样携带 status。
- `views.tsx`：`threadGroupPills` 过滤 archived（新增 archived 计数入返回或独立 fold `threadArchivedCount`）；上游药丸 gear 菜单（hover 出 ⚙：重命名/归档|取消归档/删除）——重命名=行内输入框（Enter 提交），删除=既有 confirm popover 模式（railhead 已有同类）。
- locale：threads.rename/threads.archive/threads.unarchive/threads.delete/threads.delete.hint（dsh 会话保留的诚实文案）等 zh+en。
- 测试：三函数语义（含旧文件无 status 缺省）、路由四 op + 400、pills 过滤、active 回滚。

## P2 课程包导出

- `dashboard.ts`：`GET /lookatstudy/api/course-pack?courseId=` → `{ok, fileName, content}`；content = 自包含 JSON（课程树 + 课时 body + 课级 languageTarget 等；格式带 `kind: 'lookatstudy-course-pack'`, `version: 1`）。
- 客户端：rail 课程操作区（删除旁）「导出课程包」按钮 → fetch route → blob 下载。
- 导入侧：新增 pack 识别（markdown 粘贴通道之外的第四来源？）——**最小实现**：`study_import_pack`？不——owner 没点名导入面。往返验证走**单测**（export 出的 content 喂 import 管线还原课程），导入 UI 不在本轮（pack 文件用户可解开手贴）。SPEC 注明。
- 测试：export route 结构断言、roundtrip（export → 走 folder/markdown 等价管线 → 课程还原：标题树+body 一致）、404。

## P3 URL 导入（study_import_url）

- `src/vendor/html-article.ts`（自研零依赖）：`extractArticleHtml(html, url) → {title, markdown} | null`——title 启发式（og:title / <title> / h1）、正文密度抽取（段落文本/标签比打分，去 nav/aside/script/style/footer）、html→md 子集（h1-h6/p/strong/em/a/img/ul-ol-li/pre-code/blockquote，链接图片绝对化）。**不做**完整 readability parity——判据是 fixture 命中率而非全量对齐。
- `tools.ts`：`study_import_url {url}`——http(s) GET（deadline/abort 复用 vendor repo-fetcher 的加固模式）→ content-type PDF 且 arxiv 域 → PDF→md（vendored pdf-text）→ brief（bodies inline）；html → extractArticleHtml → brief；抽取失败 → 诚实错误（对齐上游文案精神：非文章页/需登录/脚本渲染，指引粘贴导入）。
- 测试：fixture html 字符串（构造：带 nav 干扰的文章页、代码块、相对链接图片）断言 title/段落命中/代码块保留/绝对化；PDF fixture 用最小手造 pdf（或复用既有 pdf 测试件）；brief 结构断言。

## P4 视频导入（study_import_video，B站字幕）

- `src/vendor/bilibili-wbi.ts` + `src/vendor/subtitle-parse.ts`：逐字移植 + provenance header；`parseBilibiliId` 一并（含纯解析部分）。
- `tools.ts`：`study_import_video {url}`——解析 BV/av+p → wbi 签名调 `player/v2` 拿字幕列表 → 下载 CC → subtitle-parse → 每分P一个虚拟文档（无 `?p=` = 全部分P，带 `?p=N` = 单集，对齐上游语义）→ brief；无 CC / 非公开 → 诚实错误。
- 测试：wbi 签名确定性（固定 img_key/sub_key fixture 断言输出）、subtitle parse（json/srt 两种 fixture）、URL 解析（BV/av/带p/非B站拒绝）、多P brief 组装（mock fetch）。

## P5 机器门

- `pnpm test` 全绿且 **≥345**（基线 316——2026-09-13 实测；新增 ≥29）。不得削弱/改写既有断言凑数。
- `pnpm run verify` PASS，新增 bundle 针至少：`lesson-thread`（路由）、`course-pack`、`study_import_url`、`encWbi|getMixinKey`（wbi vendored 标记）、归档 UI 标记（`lks14-threadmenu-gear` 或同等）。

## P6 web-lks 实测

- 线程管理：rename（药丸标题变 + **host 会话列表标题变**——session.rename 生效）、archive（药丸消失、state 持久）、delete（confirm + 组减一 + active 回滚）。
- 导出：route GET 断言 JSON 结构（kind/version/课程树），客户端按钮触发 blob 下载（probe 拦截或断言 route 即可 + 按钮存在可点）。
- URL/视频导入：起本地 http fixture 服务，**node 直调 lib/index.mjs 的 tool execute()**（绕过 LLM 即兴——上轮教训）跑真网络路径；B站真站 best-effort 不作门。
- 零页面错误 + P18 高度链不回归。
- 探针纪律：settle 等 turn 结束（stop twin 消失）；探针后清理（course delete、profile dep 还原 ^0.20.0、杀服务核名进程、核 3081 释放）。

## P7 收尾

- AGENTS.md：线程管理三件套、课程包导出、URL/视频导入（含 yt-dlp/转写的架构排除理由）入 Layout/rationale；上游审计记忆更新。
- 一个（或按phase分多个）本地提交，**不推送不发版**（堆在 7eab07c 后，发版等 owner）。

## 停止条件

- dsh session delete 面缺失是已知事实（降级设计已定），不算阻塞；若 host rename 行为与类型声明不符（实测失败）→ rename 退化为纯 meta 改名，记录。
- html→md 自研子集对 fixture 命中率连续 3 轮上不去（title+正文段落 <90% 命中）→ 停，问 owner 是否接受引入 readability 依赖或砍掉 URL 导入的 html 分支。
- B站 wbi/接口在真机被风控（单测绿但 live 全败 ×3）→ 记录 gap，工具保留（错误诚实），继续其余项。
- 涉及产品取舍的新问题（如导出格式要不要兼容上游 pack）→ 停下问 owner。
- 同一思路连续 3 轮失败 → 停。

## 预算

16 轮迭代。执行顺序 P1→P7（P1/P2 可与 P3/P4 交错，但 P5 门必须全量最后过）。

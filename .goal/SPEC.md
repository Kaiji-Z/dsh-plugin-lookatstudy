# 会话线程组 SPEC · 对齐上游 v0.5+ 线程模型（节点组 + 多线 + 自动命名）

上游基准：`D:/Users/kaiji/vibecodingKJ/projects/LookatStudy` @ v0.33.2（只读参照，禁改；本地 CRLF，diff 时 strip-trailing-cr）。参照文件：`src/main/services/thread-service.ts`（v0.4 课程级 → 模型底座）、`src/renderer/lib/useThreads.ts`（v0.5 节点组现行版）、`src/renderer/components/ThreadSwitcher.tsx`（v0.6 药丸行 UI）、`src/renderer/App.tsx` sendMessage（首发自动建线 + 首条消息自动命名）。
插件基线：本地 main @ `1b87b16`（#8/#9/#10 修复压在本地未发版，本目标在其之上继续，**中途不跑 release.mjs**）；verify 绿基线 = 309 测试。
背景：issue #11 请求课程级会话；上游 v0.4 试过课程级、v0.5 主动退回**节点组**（每线程硬绑 focusNodeId、每节点多条、一条活跃、首发自动建线、首条消息自动命名）。owner 拍板：按上游现状对齐，不做课程级默认。

## 模型翻译（dsh 会话 = 上游 thread）

上游概念 → 插件实现：
- thread = 一个 dsh session（`sessions.create({workspaceId})` 铸造，不变）。
- 节点组 = `lessonId`；每课可挂**多条** session，一条活跃。
- 首发自动建线：send() 无活跃线程时铸造新 session（现有懒铸造保留），**线程标题 = 用户首条完整输入截断**（按钮/预设触发的消息用短动作标签，如「开始复习」），存插件侧（dsh session 无标题概念）。
- 线程切换器（现 E5 threadchip 列全局所有课的线程）→ 改为**当前课时组**：组内线程药丸行 + 「＋ 新建」；点其他线程 = 切活跃指针（suppressHandBack 打开对应 session）；「＋ 新建」= 清活跃指针，下次发言铸新线。跨课跳转保留现状（线程菜单仍按课分组可见，或仅当前课——执行时按改动面取小，SPEC 不锁死）。
- 复习不再制造碎片（#11 第四节）：复习入口路由到**目标课时（最到期课）的现有组**——组内有活跃线程则复用，无则铸线并以「复习：<课名>」命名；不再静默在焦点课 mint。
- 明确排除（本轮不做）：线程重命名/归档/删除菜单（上游有，插件后续轮）、课程级粒度选项（上游已退回，不做）、后台并行流式（v0.23，宿主会话模型不支持，记录为已知缺口）。

## 状态与迁移（v2 additive 铁律）

- 新字段（additive，旧 v2 文件加载 = 迁移）：
  `lessonThreads?: Record<lessonId, { active: string | null; threads: Array<{ id: string; title: string; createdAt: string; lastAt: string }> }>`
- 加载时迁移：旧 `lessonSessions[lessonId] = sessionId` → 一条标题为课时名的线程（active 指向它）；`lessonSessions` 字段保留只读兼容（loadState 迁移后不再写它）。落库只写 `lessonThreads`。
- 上游 dsh-迁移脚本只读 courses/progress 系字段（已核实），本变更对其安全。
- 铸造/切换/活跃指针变更全部走 store 突变 + 同步保存（现有纪律）。

## 执行顺序（每轮一个 P 项，完成勾选）

- [ ] P1 状态层：`lessonThreads` 类型 + loadState 迁移 + save 回环 + state.test（旧档迁移、additive 加载、双线共存、活跃指针切换）。
- [ ] P2 铸造与命名：send() 改走组模型（无活跃→铸线+自动命名；有活跃→复用）；`bindLessonSession` 语义升级为「加入组并置活跃」；tools/state 测试同步。
- [ ] P3 切换器 UI：threadchip → 当前课时组（药丸行 + ＋ 新建 + 活跃点）；locale 键 zh/en；CSS 沿用 lks14 结构类。
- [ ] P4 复习路由：复习入口 → 目标课时组（不静默 mint）；「正在复习：<课名>」提示（报告人建议，顺手）。
- [ ] P5 测试与门：全量测试绿（≥ 309 + 新增）、`pnpm run verify` PASS、bundle 断言（`lessonThreads` + 新 UI 针）。
- [ ] P6 web-lks 实测：①课 A 发言 → 组出现 1 线、chip 标题=首条消息截断；②＋新建 → 再发言 → 2 线、新线活跃；③切回 1 线 → 会话窗口正确换绑；④刷新 → 组/活跃/标题持久；⑤旧版 state.json（只有 lessonSessions）加载 → 迁移为单线组且可继续发言；⑥复习入口落在目标课时组；⑦零页面错误、高度链/P18 不回归。
- [ ] P7 AGENTS.md 勘误（线程系统描述更新）+ 本地提交（不推送不发版，等 owner 指令）。

## 已知坑（从既往轮沉淀，执行时直接避）

- React effect 依赖数组引用后置声明 = TDZ 渲染期崩溃（rowsView 之鉴）。
- 禁 heredoc 写含反斜杠的代码/数据（`\\v`→\x0B 已咬过两次）；种子脚本一律 Write 工具。
- 冷启动 CDN 增强链要数秒，探针等标记不等 sleep；`.lks-codeblock[md-codeblock]` 是兜底卡不是 shiki 卡。
- 提交信息禁反引号（bash 命令替换啃消息）。
- web-lks 流程：kill 3081 → remove → file: dep 恢复 → corepack install（harness 根）→ 带 .env 重启 → token 从日志抓；测完 dep 还原 ^0.20.0。

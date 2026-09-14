# SPEC · 0.23.0：线程粒度开关（course 档）+ 分层上下文装配

来源：issue #11 补充（chutian1245，2026-09-14）+ owner 2026-09-14 设计拍板。
对外已承诺（#11 回复）：每课「跨课时连续对话」开关、平行线照旧、覆盖标注、复习落位、组合题三层链路。
上一篇 SPEC（对抗性审查全修 40 项）归档于 SPEC.archive-2026-09-14-audit-40.md。

## 铁规则（全程有效）

1. **每批次收尾**：`pnpm run verify` 退出码 0 + 本地 commit（不 push、不发版——发版等 owner 说「发版」）。
2. **新测试先红证**（基线上至少 1 条新测试失败）再转绿，修复与测试同批提交。
3. **探针永不进 verify**（probe lane 纪律：booted profile + boot token + 端口检查；与并行会话协调用克隆 profile + 独立端口）。
4. **vendor/ 逐字文件、judge 体系、.github/、主项目仓（LookatStudy）禁碰**。
5. 禁止改测试/判据/阈值凑绿。

## 定位与非目标

- **每课一个 `threadScope: 'lesson' | 'course'`**，默认 lesson（缺省 = 旧行为 = 基线等价，零迁移，关掉开关完全回到 0.22.2）。
- course 档 = **一门课一个线程组**（不是强制单会话）：组内仍可「＋新建对话」开平行线；同一条活跃线跨课时连续。
- `single` 档不做（跨课全局线，无人要求）。不做「自动判断该新开还是继续」——决定权给用户。
- 主项目不移植本功能（owner 2026-09-14 决策：主项目只做尾部注入，插件当试验田）。

## P0 第一步：两个开工前核实（不做完不动手）

1. **surface 装配事实**：确认导师提示段是逐轮装配、随焦点走（快照段每轮重读 state）还是一次性注入。若是一次性注入，course 档必须先迁移为逐轮装配——迁移超过 2 轮迭代解决不了就停下升级 owner。
2. **访问点清单**：枚举全部 `lessonThreads` / `lessonSessions` 的读写点（预期：state.ts、dashboard.ts、panel.tsx、trash 重映射、线程绑定课时校验、tools?），产出收口清单。

## 数据模型

- `CourseState.threadScope?: 'lesson' | 'course'`（additive；loadState 兼容缺省）。
- **owner key 派生**（唯一真源，纯函数导出供测试）：`threadOwnerKey(scope, courseId, lessonId)` → lesson 档返回 `lessonId`，course 档返回 `course:<courseId>`。所有线程组访问一律过它——这是本 SPEC 的承重工程项，漏一处就是半残开关。
- 线程（ThreadGroup 内每条）增加 `touchedLessons: string[]`：send 时追加当前焦点课时（去重、保序）；展示折叠（「覆盖：1.1 · 1.2 · …共 N 课时」），按章节序。
- **legacy `lessonSessions` 镜像**：course 档下从哪个课时发言，就把哪个课时的镜像同步到课级活跃线（宿主对话面 toolview 卡按课时找会话靠它）。
- **trash/restore 重映射**：`course:<id>` 键与 `touchedLessons` 内课时 id 都要跟既有 slug 重映射（撞名 re-id）走；线程绑定的课时存在性校验认识课级键。
- 切档不清 sediment：lesson↔course 来回切，两侧组都在。

## 分层上下文装配（course 档的灵魂）

每轮系统段三层：

1. **当前课时全量**（课文 + 概念 + 该课状态）——跟随焦点，与现状一致；
2. **课程摘要**（新增段）：每课一行（标题 · 掌握% · 摩擦/未决标记），每轮实时刷新，40 课 ≈ 1-2k token；
3. **行为指令**：出跨课时综合题前，先调 `study_lesson` 取相关课时正文。

两条铁律：课文/状态**永不作为消息写进线程**（旧注入会和演化后的状态自相矛盾）；**不预载全课程正文**（会过期、每轮重发成本 × 全课程生命周期、大静态块是检索死角）。

快照段在 course 档下补一行「本线覆盖/当前课时」标注（焦点在线内切换时导师能看出讲到哪课）。

## UI

- 线程药丸菜单（chip menu）内加「跨课时连续对话」toggle（每课生效，状态可见）。
- 线程列表项显示覆盖标注（touchedLessons）。
- course 档下切课时：线程不换、不弹窗不打断（UI 无感，下一轮系统段自动换课文）。
- 「＋新建对话」在 course 档 = 课程组内平行线（touchedLessons 从当前课时起步）。

## 复习与三件套

- 到期复习路由：按 `threadOwnerKey` 落位（course 档 → 到期课时所属课的课程组）。「正在复习」横幅照旧。
- 改名/归档/删除三件套作用在组上，参数从 lessonId 泛化为 owner key（对用户无感）；归档活跃线的滚动指针等既有语义原样继承。

## 测试与探针

- **纯函数单测**：threadOwnerKey 派生、touchedLessons 生命周期（追加/去重/封顶展示）、镜像同步规则。
- **fuzz 扩展**：双档位随机切换 + 双档线程操作，既有不变量全部成立（归档矛盾、active 指针等）；切档往返 sediment 保留断言。
- **探针（probe lane）**：toggle 开 → 跨课时发言落同一条线（session id 不变）→ 覆盖标注出现 → 复习落课程线 → 关档回到课时组；摘要段存在于装配产物（journal 或工具面证据）；组合题行为指令至少被导师遵循一次（可观察 study_lesson 调用）。
- 既有探针（probe-canvasstage / probe-i11 / probe-c23）复跑无回归。

## 阶段划分

- **P0**：两个开工核实 + key 收口 + 数据模型 + send/focus/复习接线（fuzz 绿）。
- **P1**：分层装配（摘要段 + 行为指令 + 覆盖标注行）+ UI（toggle、覆盖标注）。
- **P2（可选）**：lesson 档尾部注入配菜（上一课尾部 4-6 轮 + 未决问题，封顶）——时间盒内做不完就砍，不阻塞发版。

## 预算与停止

- 预算 10 轮迭代。停止条件：key 收口遇到必须改公开接口的访问点；逐轮装配迁移超 2 轮未果；同一思路连续 3 轮失败；任何需要动主项目仓的时刻。

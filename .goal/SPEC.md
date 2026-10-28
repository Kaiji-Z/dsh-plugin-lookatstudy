# SPEC · 0.27.0 — upstream v0.38→v0.41 alignment round(复习会话 + 提议撤销 + 三小项)

Status: EXECUTED — 2026-10-29 goal run complete, committed to main (release awaits owner).
落地与 SPEC 的偏差(实现时定案,均为映射口径而非产品变更):
- 复习回合的双重防重复用**状态驱动**(`reviewState.open` 回合硬闸 + 收束写 `lastOutcome`)取代上游 `[[review-kickoff]]` 文本标记——插件线程状态本就在 state.json,标记是上游无状态线程的替代物,我们不需要第二套。
- 考试题量校验走**软提示**(`study_exam_bank_apply` 回执 `hints[]`:超配额逐 KC + 未覆盖概念),不硬拒——导师可对话修正,与「超纲 KC 硬拒」的既有反幻觉底线分层。
- 复习姿态激活时**替换**课程推进边界块(两条 scope 变体),不是并列注入——复习线不承载课程推进,SPEC 的交互担忧以此收口,无需 owner 裁决。
- 撤销 UI 是 feed 内 undo strip(`.lks-undostrip`,3 项最新已应用提议),非上游常驻卡;3s 二次确认暂未做(strip 即低危入口,撤销可再应用补救)。
- 首启语言:`systemStudyLang(navigator)` 纯函数 + 无偏好回退链(宿主 `<html lang>` → prefs → state 之前),zh* → zh 否则 en。

## Owner directive(2026-10-28 会话)

「我们项目是否需要有更新的内容」→ 审计结论:上游 LookatStudy v0.37.1 之后走了 v0.38→v0.41(33 commits),其中 5 项落在插件面上,值得开对齐轮。本 SPEC 是逐项移植映射,目标文本指向本文件。

## 上游基线

- 上游检出:`D:/Users/kaiji/vibecodingKJ/projects/LookatStudy` @ `v0.41.0+5`(5ca4f0a,与 origin 同步)
- 关键提交:`d053225`(复习会话,v0.39.0)/ `a3f8f18`(提议撤销+幻觉引图红线+语音续录,v0.41.0)/ `6bdd2ce`(考试出题三修,v0.38.0)/ `ce0c4cb`(首启 locale,v0.39.1)

## 五项移植映射

### 1. 幻觉引图红线(v0.41.0,最小)

上游:base-prompt 双语红线加「引用即调用」——指代产物必须本轮真调过工具,想让人看图必须本轮真调 draw_diagram。

移植:`src/surface.ts` 导师红线区加同款双语条款(我们的产物工具是 `study_*` 的 quiz/guess/compare_table/diagram/code_walkthrough 系);`tests/upstream-alignment.test.ts` 冻结条款文本存在性。

### 2. 考试出题三修(v0.38.0)

上游:① 出题 prompt 章节围栏禁超纲;② 题量 `clamp(KC, 3, 15)` 每 KC 恰一题(>15 等距采样首尾必选);③ 上下文摘要前置 800→1500 字。

移植:我们的出题是导师(tutor)经 `study_exam_bank_apply` 落库(已有 KC 反幻觉校验)。①③ 落在 `src/surface.ts` 的考试指导段(围栏条款 + 摘要预算数);② 落在工具描述指导 + `exam_bank_apply` 校验逻辑里对「每 KC 恰一题」的软校验(超纲 KC 已拒,数量建议进 result 提示而非硬拒——导师可对话修正);回归测试覆盖校验行为。

### 3. 首启语言跟随系统 locale(v0.39.1)

上游:非中文环境首启默认英文。

移植:`src/client/locale.ts` 的默认化链(宿主 `<html lang>` → `/api/prefs` → state)在最前面加一层:无任何已存偏好时按 `navigator.language`(zh* → zh,否则 en)。已有偏好的路径不动。测试:无偏好 + 非中文 locale → 英文字典。

### 4. 复习会话(v0.39.0,主打特性)

上游形态:点「复习」→ 开/续该课 `kind=review` 线程(threads 加 kind 列,幂等迁移);【复习导师姿态】(先忆后问不先贴课文/对准 KC 弱项与上轮薄弱点/错了才讲/嵌测验计分/3~6 轮收束);收束工具 `end_review_session`(quality 1~5 → SM-2 + XP + streak,不写 BKT);双重防重复(回合硬闸 + review-kickoff 标记);上轮 weakPoints 经专属摘要进下轮开场;收束卡(质量档/下次天数/弱点/复习下一课直通)+ AI 未收束时的三键自评兜底卡;`srs:record` 返回 SM-2 回执;streak 与红点两处刷新修正。

我们的映射(基建全在):
- **线程模型**:`lessonThreads` 的 `threads[]` 条目加 `kind: 'chat' | 'review'`(loadState 幂等迁移,缺省 chat);每课至多一条 review 线,点复习 = 定位/铸造它并切 active。与 0.23.0 course 档线程语义的交互:**course 档的「继续开讲下一课」只在 chat 线有效;review 线不承载课程推进边界卡**——若实现中发现冲突,停下问 owner(stop 条件)。
- **姿态**:复习导师姿态块只在 active 线是 review 时注入(快照按当前线 fork,与语言教学姿态同机制);文本双语,先忆后问/对准弱点/错了才讲/嵌 `study_record_answer` 测验/3~6 轮收束指引。
- **工具**:`study_end_review_session(quality: 1-5, weakPoints?: string[])` → SM-2 record(与 `study_record_review` 同底座)+ XP(新枚举或复用现有档位)+ `touchStreakToday`;**不写 BKT**;返回 `{intervalDays, nextDueAt}` 回执。回合硬闸:同一 review 线未收束时重复调用拒绝;weakPoints 存线程 sediment(`LessonThread` 加 `reviewState`),下轮开场注入。
- **UI**:due 复习路由(现有:落 prompt 进 due 课的组)改为开/续 review 线;feed 里收束卡(质量档/下次天数/弱点/「复习下一课」→ 下一门 due 课的 review 线)+ 三键自评兜底卡(quality 1/3/5 直接走同一落库路径);`lesson:reverted` 式静默刷新不适用(我们无礼花)。
- **streak/红点修正对齐**:确认我们 `study_record_review` 路径 touchStreak;3 分档无 XP 时 due 红点仍刷新(emitStateChange 等价物——我们的轮询天然覆盖,测试确认)。

### 5. 提议撤销(v0.41.0,git revert 式)

上游形态:apply 时抓受管表(progress/KC/SRS/画像/XP)行级 diff 快照;已应用提议卡常驻「撤销」(3s 二次确认);XP 逆补偿(apply 后再挣的不误伤);任意顺序可撤 + 冲突回执;agent 永不自行回滚(base-prompt 红线);`lesson:reverted` 静默刷新。

我们的映射:
- **快照**:我们的提议两类——完成提议(`study_complete_lesson`/`study_propose_mastery`,apply 后 mastery floor 0.95 + 解锁副作用)与画像提议(`/api/profile/resolve` 消费)。apply 时对**受影响行**做浅快照存进 proposal 记录(`appliedSnapshot: {lessonBefore, kcBefore, srsBefore, profileBefore, xpBefore}` 按类取需)。
- **撤销**:`POST /api/proposal/revoke`;恢复受影响行到快照;mastery 回退不触发重新锁定已在学课(status 不回退到 locked——**只回 mastery/进度数据,不动 status 轴**,这是与上游「行级恢复」的口径差,如需更激进停下问 owner);XP 逆补偿 = 恢复为 `max(snapshotXP, currentXP - 该提议当时授予的XP)`,apply 后新挣的不扣。
- **解锁副作用**:撤销完成提议后,因它解锁的课**保持已解锁**(撤销不连锁,与上游 any-order 语义一致);conflict 回执:快照行此后被人手改过 → 拒撤销并回执冲突明细。
- **红线**:`src/surface.ts` 加「导师永不自行回滚已应用提议,指路撤销按钮」双语条款。
- **UI**:已应用提议卡(banner/历史)加「撤销」钮,3s 二次确认;成功后无庆祝。

## 排除面(既有决策,本轮不动摇)

shimeji/伴学(0.15.0 已移除)、模型管理(宿主自有)、概念图间距(地图已退役为列表)、语音续录(宿主 composer 面)、品牌/发布/CI/截图工程、上游 ui-test 脚手架 30s jsTimeout(非应用 bug)。

## 验证与收尾

- 每项带回归测试进同一变更;`tests/upstream-alignment.test.ts` 扩展冻结本轮五项。
- livetest-task.txt + judge-criteria.md 补复习会话步骤(收束工具真调/先忆后问/不自评兜底);**live judge 跑不进本轮判据**(需真 transcript + key),随发版后 P0 式补跑。
- probe:现有 `probe-alpha-staging.mjs` 9/9 不回归 + 新增复习会话 live probe(review 线开/续、收束落库、撤销提议路径;沿 web-lks@rc21 纪律:强刷 file: 拷贝、seed 先于 boot、收尾 restore+放端口)。
- 完成后 AGENTS.md 记一轮;**发版不算完成判据**,等 owner 口令。
- 收口实录:tests 493/493(新增 upstream-v39-v41.test.ts 27 项);verify PASS;probe-alpha-staging 9/9(rc21);**probe-review-session 6/6**(review 线开/兜底收束落 SM-2+XP+streak/连续性/收束工具/撤销条快照还原 0.95→0.85 + humanGraded 回退/零页面错误);live judge 随发版后补跑(判据 C14 已冻结)。

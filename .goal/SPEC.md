# SPEC · 0.25.1 — the upstream translation method (owner directive)

Status: COMPLETE 2026-09-16 (23f6e87, verify PASS 425/425, live probe 7/7; NOT released — awaiting owner).

## Owner directive (real-usage round)

译文不显示图片；对照错位（原文按锚点切成多课、译文按整文件）；砍掉对照只留原文/译文。→ 上游方法全移植（upstream import-pipeline.ts）：

1. **序数对齐切片**（their core fix, line ~380: 翻译用相同序号 + isFirstOfFile 对齐）: the translation slices at the SAME heading ordinal as the original — cross-language anchor text-matching NEVER worked (English anchor vs 准备) and degraded to the whole translated file per lesson.
2. **F16 错位守卫** (their audit F16): word-overlap(≥0.3) the designed title (learner language) against the translated heading (same language); drift → SKIP the segment (宁缺毋错). Design titles must be real titles, not slugs — the guard compares them.
3. **图片位置映射** replaceImagesByPosition: translated figure i ← original figure i (the original's refs are already absolute CDN/data URLs); extras drop; HTML→markdown in one unified regex pass. translated_images refs never survive.
4. **UI 二态**: 原文/译文 only (renderBilingual deleted; bilingualHtml gone from payload/type/locale), default 原文 (upstream: locale null = original), per-lesson localStorage keeps working ('bilingual' stored values fall to default).

## Verification

Red-first: folder-import ordinal test (exclusivity: the NEXT H2's translation stays out — the H3 child legitimately rides its H2 parent, first-lesson absorbs header), image position-mapping (data-URL swap, relative refs gone, extras dropped), dashboard two-view payload. 425/425 + verify PASS. Live probe 7/7 (two-state control, default 原文, 译文 image renders, zero-change control, persistence, thinking rows re-verified). Probe poll-wait widened to 6500ms (4000 was borderline again).

## Notes

- The seeded-probe translation reflects the POST-pipeline shape (position-mapped, sliced) — the pipeline transform itself is unit-covered end-to-end (folder import through study_apply_design).
- genitive edge: guard trips on slug-titled designs → no translation for that lesson (upstream's own 宁缺毋错 tradeoff).

# SPEC · 0.24.1 — dedicated import sessions (owner decision)

Status: COMPLETE 2026-09-16 (f87c081 + e8272d4 + 6df3574, verify PASS 425/425; NOT released — awaiting owner).

## Round 3 addition (owner real-usage feedback): the unreachable rail bottom

`.lks14-railscroll`/`.lks14-railpane-import` computed content-box (the host's border-box reset never reaches the panel; the repo convention is per-element box-sizing) — height:100% + the 112/16 (map) / 64/12 (import) chrome paddings made the scroller boxes 128px/76px taller than the rail, and overflow:hidden clipped that constant tail at ANY window height. Fix: per-element box-sizing:border-box on both (freeze-asserted). Measured against the owner's real 60-row course: last row 955-984 (under the 940 clip) before → 827-856 after; the read-only probe (probe-railscroll.mjs) rides the real state without seeding.

## Round 2 additions (owner real-usage feedback)

1. **Translation-less import root cause** (interfaceLang never recorded on the owner's desktop): the server chain is fully verified live (README → 54 langs incl. zh-CN, exact match, translations/zh-CN/<path> mirror 200 on jsDelivr) — the ONLY break was the client push reading <html lang> once at mount; desktop hosts set it late or never. Fixes: settle re-reads (600ms/2400ms, theme.ts precedent) + navigator.language fallback + a brief nudge ("pass translationLang explicitly as the language the learner writes in") when translations exist but no interface language is recorded. NOTE: workbenchState does NOT ship interfaceLang (the apply tool reads the store) — feed-blind by design, don't re-diagnose through the feed.
2. **Course-scope adoption** (owner: "到了第二课才能正式启用对吗" — correct): setCourseThreadScope only flipped the flag, so the lesson-1 session stayed in the lesson group and the course group started EMPTY. Now the flip ADOPTS the focused lesson's thread group wholesale into course:<id> (and symmetrically back), carrying titles/sediment/touchedLessons; an occupied target or empty source skips. Red-first: 2 red adoption tests + 1 guard.
## Decision

Owner: 导入课程永远自己新建一个不属于任何课程的会话，导入完成即结束，不复用任何课程的原有会话——会话系统整洁. This supersedes the old model (import prompt rode the focused lesson's thread group, sedimenting there).

## Design

- `sendImport(prompt, label)` in StudyPanelBody mints a course-less session on the study-area workspace (activate-first when dormant), renames it to `importSessionTitle(label, now)` (pure, tested: flat label + YY.MM.DD, locale fallback 课程导入/Course import), stages under suppressHandBack, prompts 'queue'. An in-flight import session is REUSED (host queue semantics for a second submit).
- `boundId = importSessionId ?? lessonBinding` — the chat column PINS to the import session (the event window only opens for the staged session; pinning IS the funnel's observation channel for turnActive + importProgress chips).
- Every funnel exit (course-appears success / importJobDead failure / cancel / mint-error) calls `endImportSession()` → unpin; the binding effect re-runs and restages the focused lesson's thread (fresh installs: empty stream).
- switchLessonThread / startNewThread are inert while pinned (staging another session would close the import window → false funnel failure).
- The dsh session itself stays in the host list (no delete primitive on the face) under the uniform title — the plugin never references it again: no lessonThreads, no lessonSessions, no touchedLessons.
- Fresh-install gap fixed for free: sendImport has no lesson guard (the old send() no-oped silently at zero courses).

## Verification

- 421/421 tests + verify PASS (typecheck 0); importSessionTitle unit test added.
- Live probe (probe-0241, real model turn, markdown tab): funnel + pinned chat column ✓, course landed ✓, lessonThreads 5→5 and lessonSessions byte-identical ✓, un-pin removed the import conversation from the chat column ✓, host list carries the dated import session ✓, probe course deleted (A2 marker on the delete POST — the probe's cleanup originally missed it; the fixed call verified ok).

# SPEC · 0.24.0 — streaming thinking rows + GitHub translation integration

Status: COMPLETE + RELEASED 2026-09-16 (npm dsh-plugin-lookatstudy@0.24.0 live; web profile reinstalled @0.24.0, client.js hash f286693d6abea543 matches the local build).

## Origin

Owner round: 「都做然后一起发版」 — both 0.24.0 features plus the 0.23.1 quick-fix batch (6a47e1c) in one release.

## Features

1. **Streaming thinking rows (issue 4, host parity)**: `reasoning-delta` live chunks now fold into a LIVE reasoning row (host ReasoningRow port): running = Think icon + 「思考」+ latest-line follow-end summary + 2.6s sweep animation; settled = first-line summary; expand = full tertiary-tier pre-wrap body. The settled C14 row already existed — the live path was the gap (`chunk.type !== 'text-delta'` dropped everything else). Wire facts verified against a REAL glm turn (session 25f5b499): live `assistant/live-chunk` chunks carry `{type:'reasoning-delta', text}`; settled `assistant/message` blocks carry `{kind:'reasoning', text}` (kind on the wire here, type in older journals — the fold reads `kind ?? type`).
2. **GitHub translation integration (issue 2, follows host interface language)**: the README's `[名](translations/<code>/README.md)` links (extractLanguagesFromReadme, vendored) ride PendingDesign.availableLangs → brief line + design_required value (schema arm extended). study_apply_design matches the learner's interface language (state.interfaceLang, pushed by the panel from `<html lang>` — the host keeps it in sync with the active locale — via POST /api/prefs; exact code then base subtag: zh-CN↔zh-cn, pt-PT→pt-br) and probes `translations/<code>/<original path>` mirrors (fetchTranslatedContent, 404-skip per file), sliced by the SAME anchor (bidirectional heading match). Output `translations` count + render line. Teach tab: 原文/对照/译文 segmented control on translated lessons (default 对照 = the pre-0.24 look), per-lesson localStorage persistence, html is now ALWAYS the original (the server ships bilingualHtml/translationHtml alongside); read-aloud stays on the original speechText.

## Verification

- Red-proof: 7 red on baseline (5 new blocks + 2 rewritten contracts: the old "reasoning deltas do not surface" test and the P9a freeze). 420/420 green same-batch; verify PASS (typecheck 0).
- Live probes 8/8 (probe-0240): switcher default/swaps/persistence/zero-change-control + REAL model turn: live running row sampled ~25s, settled disclosure ×2 with 5359-char body expandable.
- Probe timing lessons: post-turn settlement replaces transient rows a BEAT after the stop twin vanishes (waitForSelector the durable row, not a fixed sleep); focus-click assertions must wait past the ~2.5s state poll.
- Release: push main first (the script refuses ahead-of-origin), then release.mjs minor → v0.24.0 → CI trusted publish → npm live; web profile dep 0.24.0 + node_modules/lockfile wipe + harness-root corepack install; hash match.

## Residual notes

- Failed turns still journal NO error row (host-level gap, out of plugin scope) — the funnel deadline covers the UX.
- pnpm auto-added dsh-plugin-lookatstudy@0.24.0 to the web profile's minimumReleaseAgeExclude.
- B站/文件夹 imports: folder path was already fully wired (collectTranslations); B站/arXiv/articles have no translation concept.

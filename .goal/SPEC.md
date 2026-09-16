# SPEC · 0.24.1 — dedicated import sessions (owner decision)

Status: COMPLETE 2026-09-16 (f87c081 + this round, verify PASS 424/424; NOT released — awaiting owner).

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

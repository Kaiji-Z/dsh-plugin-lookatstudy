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

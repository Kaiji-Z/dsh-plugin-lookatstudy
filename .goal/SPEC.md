# SPEC · 0.23.1 quick-fix batch (user-reported import round)

Status: COMPLETE 2026-09-16 (all criteria green, probes 5/5 + canvasstage 6/6, committed same-batch).

## Origin

The owner imported microsoft/generative-ai-for-beginners in dsh desktop (glm-5.3-flash) and reported 5 issues; 4 land in this batch (translation integration + streaming reasoning deferred to 0.24.0; course-scope question was operator error).

## Fixes

1. **Click-to-unlock** (issue 1): the focus route (dashboard POST /api/focus) now calls `attemptLesson` for available study lessons — upstream's proceedLessonClick = mark attempted + select. in_progress + BKT prior 0.5 + dual-track unlock (in-section next AND next-section first study lesson), zero LLM. Exam nodes never enter the state machine; locked nodes stay focus-only.
2. **Teach-prose images** (issue 3): `.lks-ui .lks14-prose img{max-width:100%;height:auto}` — remote markdown art no longer overflows the notebook column.
3. **Import funnel failure exit** (issue: eternal 清点): ROOT CAUSE journal-verified (session afc473b6) — the old exit armed on the `turnActive` prop having RENDERED true; a turn that dies inside one event-window notification batch (turn/start + turn/end between two reads — the keyless-provider fast fail: attempt → step/end → turn/end within seconds) never flips the prop, the arming never happens, the funnel spins forever. Fix: `importJobDead(job, turnActive, now, grace=30s)` pure deadline fold — past grace with no live turn = failed; a live turn holds the funnel open however long import tools run (queue latency is the only thing grace covers). NOTE: the 2000+s 清点 the owner saw was the SUCCESSFUL turn (TOOL_TIMEOUT 180s → tutor retry → design → apply) — slowness, not the bug.
4. **applyDesign pacing gate** (issue 5): `buildCourseFromDesign` measures every sliced body — over `LESSON_MAX_CHARS` (8000) WITH splittable in-span headings (H3 children for an H2 anchor; any H2/H3 for whole-file lessons; H3 anchors are terminal) → loud actionable rejection naming cap + remedy + offending files; heading-less monoliths ride through (upstream "accept one long lesson"); coarse-mode briefs (>80 files) now carry the over-8000 anchor-split requirement explicitly (file granularity for the rest).

## Verification

- Red-proof first: 6 red on baseline (img freeze assert, focus-unlock ×2, pacing ×3, importJobDead export) with the split-designs-pass test green on baseline (legit designs unaffected).
- `pnpm run verify` PASS (415/415 tests, typecheck BUDGET 0).
- Live probes (web-lks @3081, seeded fixture course, state restored after): issue 1 ×3 (in_progress + 50% prior, dual-track, precision — third stays locked, exam untouched), issue 3 ×1 (2400px data-URL image clamped to 448px prose column, computed max-width 100%). canvasstage 6/6 re-run — no regression.
- Funnel exit + pacing gate: unit-covered (the funnel's live shape needs a keyless provider route — deliberately not probed).

## Discipline notes

- Seeding state.json requires the server DOWN (bit 3× previously); probe order: kill → seed → boot → probe → kill → restore.
- import-plan.test.ts's part-flow fixture had to turn pacing-compliant (anchored lessons) — the gate is SUPPOSED to break its old whole-file-over-10k design shape.
- journal-dump.mjs (scripts/) = reusable session-journal ladder dumper; decode via the harness zstd helper (`scanZstdFrames(buf).frames` + async `decompressZstdFrame`).
- Not probed: funnel deadline live (needs keyless provider route); queue-behind-long-turn false-negative is pre-existing (old code fired even earlier) — needs prompt-queue introspection the face doesn't expose.

# VERIFICATION PROTOCOL

> **READ THIS FIRST. Opening this file = trigger to execute. No further user instruction required.**
> A trigger phrase such as "read VERIFICATION.md" authorizes all actions defined herein.

**First principle: your work is not done unless there is machine-checkable evidence that it is done.**
"I ran it and it looks right" does not count. "Tests converge under both flag=on and flag=off" counts.

---

## EXECUTION OVERVIEW (every step must emit a GATE declaration, see §0)

### Trigger → Diagnosis Pipeline (7 steps, none may be skipped)

```
1. Read context: this file + AGENTS.md + CLAUDE.md/GEMINI.md + README + build config + directory tree + backend entry + test entry
2. ACI audit (§2): judge 2.1 / 2.2 / 2.3 one by one. Each item MUST carry evidence (file:line).
3. Test infra inventory: regression / assertions / supervisor / flag — four items.
4. Output gap list: a table sorted by P0/P1/P2, with remediation plan.
5. Fill Project Parameters (§8): [auto-fill] items by scanning code with evidence; [must-ask] items by asking the developer in one batch.
6. Update AGENTS.md (the ONLY write operation allowed this round): paste audit / status / backlog + add top-level reference.
7. Stop and report: one-line stage summary + top-3 P0 items + ask "ready to start remediation?"
```

**Modifying production code is FORBIDDEN this round.** Remediation requires user confirmation, next round.

---

## §0 GATE MECHANISM (Declare-Verify-Enforce — the lifeline of the whole protocol)

> This is the core mechanism against "agent skipping steps." LLMs naturally drop steps in multi-step pipelines; "please follow strictly" cannot stop it. This mechanism makes compliance visible, checkable, and blocking-on-mismatch.

**After each step completes, you MUST emit a GATE declaration at the end of that step's output. Fixed format:**

```
GATE [step N]: DONE
- Did: [concrete action + artifact location]
- Evidence: [file:line / command output / developer answer quoted]
- Next: [step N+1 name]
A step without a GATE declaration is considered incomplete.
```

**Verify rules (self-check, every step):**
- Every "Did" must have a matching "Evidence." No evidence = not done.
- No "I think" / "probably" / "maybe" in a declaration. Compliance is boolean, not probabilistic.

**Enforce rules (violation blocks the pipeline):**
- Any step without a GATE → must NOT proceed to the next step
- GATE declaration contradicts the artifact (claims AGENTS.md updated but file unchanged) → redo that step
- A [must-ask] item filled without a developer answer → that step is void, re-ask

---

## §1 YOUR ROLE

Old: write code → human tests → human judges correctness → you fix
New: **first engineer "what counts as correct"** (assertions / regression / acceptance) → write code → **machine judges** → you self-correct until convergence

Humans do not participate in runtime verification. They intervene only once, at the "define what counts as correct" stage.

---

## §2 ACI AUDIT (judgment criteria for Diagnosis step 2)

**If any of the three is below standard, the verification system spins idle.** Fix the architecture first, not write tests first.

### 2.1 Runs without the UI
- [ ] Backend can start independently, not depending on the frontend
- [ ] Triggering a workflow has a CLI/API form, not requiring browser clicks
- [ ] One complete workflow can run end-to-end in a headless environment (terminal/CI)

### 2.2 Intermediate state is logged
- [ ] Each workflow step (tool call / return / branch) has structured records
- [ ] Records are retrievable programmatically, not only by eyeballing a web page
- [ ] History is queryable after the run ends

### 2.3 Programmatic interface
- [ ] "View workflow status" / "fetch trace" have native interfaces
- [ ] Prefer backend/frontend split / native API. **Do NOT** use MCP to simulate web interaction (worse on auth / corner cases / efficiency)

**Judgment standard: MUST have file:line evidence. Never judge "meets standard" without evidence.**

---

## §3 TWO-LAYER JUDGE (the core of the development workflow)

### 3.1 Layer 1: Deterministic assertions — absolutely reliable, zero cost
Never use an LLM where this layer can catch it. Typical form:
```
# Logic form (tool-agnostic):
assert tool_was_called("search", within_steps=[3, 4])
assert records_count_at_step(5) == 3
assert branch_taken == "happy_path"
```
**Land on a tool (decided by §8.7 during diagnosis; do NOT invent your own syntax):**
| Project has | How to assert | Detection signal |
|---|---|---|
| DeepEval | `assert_test(test_case, metrics=[ToolCorrectnessMetric()])` | `import deepeval` |
| LangSmith | replay dataset + compare trace fields | `@traceable` decorator present |
| pytest native | plain `assert` + fixture capturing trace | `pytest` in deps |
| None | go to §8.7 [must-ask], pick a tool first | — |

### 3.2 Layer 2: LLM judge (supervisor) — three iron rules
1. **Context MUST be clean.** The supervisor does no development, knows nothing about how the code is written, sees only "the expected correct behavior." Once it knows the code, it scores its own people high — verification is void.
2. **Quantitative scoring only, no right/wrong verdicts.** Score outputs that have no single answer; measure how much better / worse.
3. **Ideally use a different model/prompt than the generator.**

Supervisor prompt template (must be isolated):
```
You are an acceptance judge. You see only two things: expected correct behavior + actual run trace.
You do not know how the code is written, and do not need to.
Score each dimension 0–10 and give deduction points: [dimension A/B/...]
```
**Land on a tool (by §8.7):**
| Project has | How to call the supervisor |
|---|---|
| DeepEval | `GEval` / `FaithfulnessMetric` or custom metric (built-in scoring, but ensure the judge model differs from the generator) |
| LangSmith | `RunEvalConfig` + `EvaluatorType.SCORE`; judge model specified in the evaluator |
| None | go to §8.7 [must-ask] |

**Landed in this repo (owner-ratified; §7 rule 8/9 honored — no eval framework installed, self-built judge is the explicit owner decision):** `scripts/livetest-judge.mjs` (`pnpm run judge`) + frozen `judge-criteria.md`. The prompt is exactly criteria + transcript + a fixed template — context purity (iron rule 1) is a structural test, not a convention; scoring is 0–10 per criterion (rule 2) with PASS iff every criterion ≥ 8; the judge model defaults to the generator model (rule 3 compromise, documented in the criteria file, `JUDGE_MODEL` overrides). The key (`Z_AI_API_KEY`) is env-only, never written or echoed, and verify's secrets gate re-scans the whole tracked tree every run.

---

## §4 REGRESSION SET + FLAG

- **Happy path = acceptance criteria, not a test case.** Write the happy path for each new feature, freeze it into the regression set.
- **Fuzzy-input set:** collect wild inputs from real users / tests into the regression set.
- **Every new feature MUST have a flag.** Run the SAME regression suite with flag=on and flag=off; compare "what got better / what got silently broken."

**Regression set landing (by §8.7):**
| Project has | Where the regression set lives | How to run flag on/off |
|---|---|---|
| DeepEval | `test_*.py` + `@pytest.mark.eval` | `FEATURE_FLAG=X pytest` |
| LangSmith | `client.create_dataset` + `list_examples` | two runs tagged with different metadata, then `client.compare_datasets` |
| Self-built tests | `tests/regression/` + fixtures | CI matrix runs two envs |

---

## §5 CLOSED-LOOP SOP (develop any feature in this order — order cannot be changed)

```
1. Design the regression test: write the happy path (acceptance) → write assertion points → decide which fuzzy parts go to the supervisor. Not one line of feature code written yet.
2. Design the flag: default off; ensure off == pre-change behavior.
3. Write code: implement the flag=on behavior.
4. Run the closed loop: flag=off records baseline → flag=on runs same suite → assertions + supervisor judge.
5. Fix per feedback: off regressed → fix; on below acceptance → revise. Back to step 4.
6. Convergence stop (see §6 DoD).
```

**Humans do not participate in runtime verification within this flow.** They intervene only once before step 1 (to define acceptance).

---

## §6 DEFINITION OF DONE (machine-checkable "complete")

A feature is done if and only if ALL hold:
- [ ] happy path written as a regression test, in the regression set
- [ ] §3.1 assertions all pass under flag=on
- [ ] supervisor score reaches the preset threshold
- [ ] flag=off runs the same suite, no regression vs baseline
- [ ] the feature has a flag, can be turned off to roll back anytime
- [ ] all of the above reproducible by one command, no human screen-watching

**"Done" is a machine-judged claim, not your subjective opinion.**

---

## §7 RED LINES (violation voids the output) — consolidated here, not repeated elsewhere

1. MUST NOT be your own judge (supervisor context must be clean)
2. MUST NOT claim done without a regression test
3. MUST NOT skip §5 step 1 and jump to code
4. MUST NOT use "feels right" as a convergence stop
5. MUST NOT let verification live only in the UI
6. After changing prompt / model / any non-deterministic component, MUST run full regression
7. **MUST NOT guess-fill any [must-ask] item in §8**
8. **MUST NOT reinvent the wheel**: when the project already has an eval tool (§8.7), §3/§4 MUST use its API; do not invent assertion syntax or a regression framework
9. **MUST NOT install dependencies on your own**: when §8.7 detects no tool, recommend via [must-ask]; the developer decides and installs; the agent MUST NOT `pip install` / `npm install`

---

## §8 PROJECT PARAMETERS (filled during Diagnosis step 5, by category)

**[auto-fill]** = scan code with evidence (file:line); missing evidence → fill "none, needed", no guessing
**[must-ask]** = ask the developer per the template; fill after an answer; before that fill "pending"; guessing forbidden

### 8.1 System entry [auto-fill] — FILLED 2026-09-14
- Backend start command: the plugin loads INSIDE the dsh host (no standalone server). Headless one-shot: `corepack pnpm dsh --profile headless --patch <repo>/cordis.livetest.yml "<livetest-task.txt contents>"` from the harness root (AGENTS.md "Headless livetest"; the overlay sets `Config.active: on` — src/config.ts:31,38). CI form: `pnpm run verify` (.github/workflows/publish.yml:31).
- CLI/API command to trigger a workflow: the host `/study` slash command (src/commands.ts:83 registerStudyCommand, structural CommandInvocation at :63); every learning workflow is 1:1 the `study_*` tool surface (src/tools.ts) driven by the tutor turn; the panel UI is a third seat over the same HTTP API, never the only one.
- Command/API to fetch a trace: the dsh session log (concatenated zstd frames, decoded per-frame with the harness `packages/session/session-persistence-jsonl/lib/types/zstd.js` util — AGENTS.md "Live testing"); deterministic transcript: `node scripts/livetest-run.mjs` → `livetest-output.md`; live plugin state: `GET /lookatstudy/api/state` (src/dashboard.ts:364 route registry).

### 8.2 Test infra [auto-fill] — FILLED 2026-09-14
- Regression run command: `pnpm test` (package.json scripts.test: `node --import tsx --test tests/*.test.ts`); the single machine gate folding tests+build+bundle pins+secrets: `pnpm run verify` (scripts/verify.mjs).
- Regression set directory: `tests/` — 43 files / 347 tests at fill time, including the frozen acceptance paths (tests/acceptance.test.ts), the state-machine invariant fuzz (tests/invariants.test.ts, seeded, plus the thread-group invariant fuzz), schema-conformance (every tool's output vs its declared schema), and issue-born regression tests (the #3-#11 rounds).
- Assertion framework: plain `node:test` + `node:assert/strict` (zero-dependency mandate; no jest/vitest/deepeval in devDependencies — see 8.7).

### 8.3 Flag mechanism [auto-fill] — FILLED 2026-09-14
- Global surface flag: `Config.active: 'auto' | 'on' | 'off'` (src/config.ts:31,38) gates the ENTIRE model-facing surface — tools register/unregister, persona sections render empty (AGENTS.md state-machine invariants). Headless runs force `on` via the cordis overlay.
- Single feature flag in service: `historyBudget` (src/state.ts:227, fed at src/dashboard.ts:161/195) — the context-budget directive toggle.
- Per-feature flag machinery: none, design during remediation — the standing house practice is full-suite regression + additive-only state format instead of flag=on/off comparison runs (P0-2 in the 2026-09-14 gap list; owner decision pending).

### 8.4 Supervisor design — FILLED 2026-09-14 from the standing owner-ratified decision (§3.2 landing paragraph above; judge-criteria.md; scripts/livetest-judge.mjs). Re-confirm at the next criteria refresh.
1. Model: `glm-5.2` at temperature 0; `JUDGE_MODEL` env overrides (livetest-judge.mjs:23,125,140). Known deviation from iron rule 3 (judge defaults to the generator family), documented in the criteria file and ratified by the owner.
2. Scoring dimensions: the frozen criteria in `judge-criteria.md` (one per numbered step of livetest-task.txt; e.g. the mastery-gate discipline at criteria line 28).
3. Passing threshold: 0-10 integer per criterion, PASS iff EVERY criterion ≥ 8 (judge-criteria.md:15; runner exit code 0/1 — livetest-judge.mjs:14).
4. Prompt MUST contain ONLY: criteria + transcript + the fixed template — enforced structurally by `tests/livetest-judge.test.ts` (prompt purity is test-asserted, not conventional). Code / PR description / commits / dev conversation are absent by construction: the assembler reads exactly three inputs.

### 8.5 Acceptance criteria [must-ask] — PENDING (asked 2026-09-14, batch in the diagnosis report; awaiting owner answers)
> Cannot be auto-filled: reverse-engineering from existing tests would freeze existing bugs as "the standard."
Existing approximations, reference only (NOT the frozen standard): judge-criteria.md encodes the live-loop acceptance for the 6-step self-test task; the regression suite freezes per-feature acceptance born from live bugs.
Questions sent (one batch, in the owner's language):
1. 核心工作流的 happy path？（输入 → 工具 → 分支 → 输出）
2. 3-5 条验收标准，形如「在 X 条件下，应该 Y」？
3. 反向验收（绝不允许发生的行为）？
Freeze the answers HERE once given (same commit as any behavior the criteria accept).

### 8.6 Fill status (maintained by the agent)

| Item | Category | Status | Source |
|---|---|---|---|
| 8.1 | auto-fill | FILLED 2026-09-14 | AGENTS.md Live-testing, commands.ts:83, dashboard.ts:364, config.ts:31/38, publish.yml:31 |
| 8.2 | auto-fill | FILLED 2026-09-14 | package.json scripts, tests/ (43 files/347 tests), node:test |
| 8.3 | auto-fill | FILLED 2026-09-14 (per-feature: none, remediation pending) | config.ts:31/38, state.ts:227, dashboard.ts:161/195 |
| 8.4 | must-ask | FILLED from the standing owner-ratified decision (§3.2 landing); re-confirm at next refresh | VERIFICATION.md §3.2 landing paragraph, judge-criteria.md:15/28, livetest-judge.mjs:14/23 |
| 8.5 | must-ask | PENDING — asked 2026-09-14, awaiting owner answers | diagnosis report batch |
| 8.7 | auto-fill→must-ask | FILLED 2026-09-14 — none detected; the self-built path is the ratified standing decision (rules 8/9 honored, no install) | package.json devDependencies, VERIFICATION.md §3.2 landing |

### 8.7 Eval toolchain [auto-fill→must-ask] ⚙️ orchestration item

> **This is the master switch for landing §3/§4.** Detect first, decide second: if the project already has an eval tool, use its API (saves time); if not, recommend via [must-ask], **self-installation forbidden** (introducing a dependency is a decision with side effects, owned by the developer).

**Step 1 [auto-fill]: detect existing tools (scan dependency files)**
Scan `requirements.txt` / `pyproject.toml` / `package.json` / `go.mod` etc., fill "installed" or "none" for each:
- [x] `deepeval`? none (devDependencies: @types/react, react, tsdown, tsx, @types/node, typescript — package.json)
- [x] `langsmith` / `langchain` with eval module? none (same evidence)
- [x] `pytest`? n/a — Node/TypeScript repo
- [x] `jest` / `vitest` (Node)? none (same evidence; the runner is node:test via tsx)
- [x] other eval tool? SELF-BUILT Layer-2 judge: scripts/livetest-judge.mjs + frozen judge-criteria.md + the prompt-purity structural test (tests/livetest-judge.test.ts) — owner-ratified as the explicit no-framework decision (§3.2 landing paragraph; red-line rules 8/9 honored: nothing was installed, nothing needs to be)

**Detected at least one → §3/§4 land on that tool's API. Fill: "using [tool name]".**

**Step 2 [must-ask] (triggers only if Step 1 is all "none"):** recommend per tech stack, **do NOT self-install**, ask in one batch:
```
The project has no eval tool yet. For your stack [fill: detected language/framework],
I recommend one of these to implement the §3/§4 verification system:
  - [rec 1 + one-line reason]
  - [rec 2 + one-line reason]
Which one? Once confirmed I will wire it up (I will NOT pip/npm install myself; wait for you to install).
```
Fill after answer: "awaiting install of [chosen tool]". **Until installed, §3/§4 tool-API lists are written but marked "pending tool readiness".**

---

## §9 AGENTS.md TEMPLATE (used in Diagnosis step 6)

```markdown
# {project name} · Agent Development Guide

## Mandatory protocol
Before developing any feature or changing any code, read and follow `VERIFICATION.md`.
Output that violates a red line in VERIFICATION.md §7 is void.

## Project overview / Build & run / Verification system status / Test infra status / Verification backlog / Project-specific conventions
[filled by the diagnosis pipeline]
```

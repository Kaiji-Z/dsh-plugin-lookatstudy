# Layer-2 judge criteria (FROZEN)

The expected-behavior half of the Layer-2 acceptance judge (VERIFICATION.md §3.2).
The judge sees ONLY this file plus the run transcript — never the implementation.
Changing an acceptance threshold means editing this file, in the same commit as the
behavior change it accepts.

Provenance: frozen from `livetest-task.txt` (the 6-step self-test task) — every
criterion below maps to a numbered step of that task. The transcript under judgment
is a tool-call record (markdown, one `## <tool>` section per call with json args and
result) produced either by the deterministic driver (`livetest-run.mjs`) or by a real
model run of the same task.

Scoring rule (§3.2 rule 2 — quantitative, no bare right/wrong): every criterion is
scored 0–10 (integer). The run PASSES only if every criterion scores ≥ 8.
Judge model note (§3.2 rule 3): the default judge model equals the generator model
(`glm-5.2`, same z.ai endpoint); context isolation is enforced structurally by
`scripts/livetest-judge.mjs` (the prompt is exactly this file + the transcript + a
fixed template). Override the judge model with `JUDGE_MODEL` if a different one is
available.

## Criteria

C1: Import fidelity — `study_import_markdown` is called exactly once with the task's GraphQL markdown verbatim (three lessons: Queries, Mutations, Fragments; not rewritten or summarized), and the result reports course "GraphQL Basics", 2 sections, 3 lessons, first lesson "Queries".
C2: Concept definition — `study_define_concepts` targets that first lesson with 2–4 concepts; each has a short title and a one-line description that is faithful to the lesson bodies (not generic filler).
C3: Lesson opening — `study_lesson` opens the first lesson before any answer is recorded, and the returned status is available or in_progress (a locked or mastered status at first open is a violation).
C4: Attributed quiz — exactly three `study_record_answer` calls follow; each carries a real question about the lesson body, the learner's given answer, a `concept` among the defined titles, and an honest grade: calls 1–2 marked correct with genuinely correct answers, call 3 marked incorrect with an answer that is actually wrong about the material (staged wrongness graded as incorrect is correct behavior; a wrong answer graded correct, or a right answer graded incorrect, is a violation), plus a rationale naming the misconception.
C5: Mastery gate discipline — a proposal cycle (`study_propose_mastery` + `study_resolve_proposal`) appears ONLY if the transcript's own latest recorded lesson mastery is ≥ 85; when mastery is below 85 the transcript shows the recorded value and the skip, and contains no proposal calls.
C6: Wrap-up state readout — `study_due_reviews` and `study_courses` are each called once after the quiz; the courses readout is internally consistent with the recorded answers (course count, current lesson id, mastery level implied by the recorded grades).

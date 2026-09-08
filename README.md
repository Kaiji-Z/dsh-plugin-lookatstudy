# dsh-plugin-lookatstudy

**English** | [简体中文](README.zh-CN.md)

Turn any markdown document, local folder, or GitHub learning repository into a guided course inside [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) — your dsh agent becomes a full AI tutor with the interaction design of [LookatStudy](https://github.com/Kaiji-Z/LookatStudy): per-concept knowledge tracking, mastery-driven progression, spaced repetition, mastery proposals, friction awareness, learner memory, a Cornell notebook, an in-chat proposal card, exam mode with star grades, XP & streak, bilingual lessons, read-aloud (Edge TTS with a system-voice fallback), and a rich blackboard (KaTeX math, syntax-highlighted code, mermaid diagrams, mindmap & concept-map views). Learning engine modules are vendored from LookatStudy (MIT).

## Screenshots

<p align="center">
  <img src="docs/media/overview.png" alt="The three-column study panel (light theme)" width="100%">
</p>
<p align="center"><b>The 学习 panel</b> — LookatStudy's UI 1:1 in the host's light theme (the panel follows the host's dark/light switch live): the floating XP/streak app header, the three-column surface ladder (rail / chat / notebook, depth by color step), 3D push-down buttons, and the chat's typing dots; opened from the sidebar's 学习 row.</p>

| 图 | 说明 |
|---|---|
| <img src="docs/media/course-rail.png" width="280" alt="Course rail list"> | **课程栏** — the course tree as a quiet list (a deliberate deviation from upstream's gamified map): collapsible section heads with done/total counts, lesson rows carrying the status glyph (locked / available / in-progress / mastered crown / purple exam), inline mastery bars, due badges, streaming spinners, and hover tooltips that explain every state; the focused row is brand-edged. |
| <img src="docs/media/blackboard-lesson.png" width="420" alt="讲解 lesson page"> | **讲解** — server-sanitized markdown rendered rich on demand: KaTeX formulas, syntax-highlighted code (shared copy-to-clipboard blocks), mermaid diagrams with a zoomable canvas stage (CDN loaders, silent degrade offline), and the bilingual interleave when a translation exists. |
| <img src="docs/media/concept-map.png" width="420" alt="Concept map"> | **🕸 概念图** — the lesson's knowledge components laid out as a draw.io-style concept graph (bundled ELK layout, no external service); weak concepts (mastery <70%) glow amber. |

## Install

```sh
dsh plugin add dsh-plugin-lookatstudy        # from npm
# or from a tarball:
dsh plugin add ./dsh-plugin-lookatstudy-0.2.1.tgz
```

Works with any profile. In the `web` profile the plugin additionally serves the study tab's HTTP API and loads its browser half; headless profiles get the plain tool surface.

## The two surfaces

**1. The tutor (chat).** Talk to the agent: *"import https://github.com/microsoft/AI-For-Beginners and teach me lesson 1"*, *"what reviews are due today?"*. The tutor persona (stable core + one of three souls — `guide` 引导 / `direct` 直讲 / `practice` 实战) drives the full LookatStudy loop:

- **Knowledge components (KC)** — on first teaching a lesson the tutor derives 2–7 concepts (`study_define_concepts`); every graded answer is attributed (`study_record_answer` with `concept`); per-concept BKT runs and **lesson mastery is the weakest concept** — quizzes target ⚡weak ones first.
- **Mastery-driven progression** — ≥50% unlocks the next lesson early; ≥90% graduates and schedules the first SM-2 review; answers also nudge the review schedule.
- **Mastery proposals (propose → apply)** — at ≥85% plus a convincing Feynman-style explanation the tutor proposes early graduation and **waits for the learner's yes/no**; only the explicit decision applies it.
- **Friction awareness** — confusion/blocks/frustration are silently logged (`study_report_friction`) and surface as ⚡😣 weak spots.
- **Learner memory** — three slots (global style / per-course pattern / per-lesson gap), read-merge-write (`study_remember`).
- A dynamic **learner snapshot** (focus, strategy band, weak concepts, friction, memory, due count, pending proposal) is injected as runtime context every turn.

**2. The study panel (`dsh.client`).** A 「学习」 row in the dsh sidebar (below 新会话, alongside other plugin entries) opens a full-takeover panel arranged like upstream LookatStudy's own app — three columns wearing the upstream v0.28 skin (LookatStudy's verbatim token ladder under `.lks-ui`, riding the host's `--dsw-*` tokens for host-chrome surfaces) and following the host's dark/light theme live; closing it (or navigating to any session) hands the center column straight back to the host:

| Column | What you get |
|---|---|
| 左 · 课程 | Course picker, progress, due box with one-click review kickoff, lesson tree (gating, mastery bars, ⚡😣 weak spots, clickable focus), one-click demo import when empty |
| 中 · 导师 | The tutor conversation with its OWN composer — the panel never touches dsh's host composer. Sending (or tapping a starter) is the single entry into a lesson thread: the panel activates the study surface if dormant, creates the lesson's session on the host, and prompts through the host's session face; replies stream back from the session's event window and render through the plugin's markdown pipeline. Soul pills (直讲/引导/实战) ride the column head; the tutor's quiz options (A–D) render as clickable answer buttons under the latest reply |
| 右 · 黑板 | The focus lesson's 讲解 (server-sanitized markdown, rendered rich on demand: KaTeX / syntax highlighting / mermaid), a 🕸 concept-map view of the same lesson, the Cornell 笔记 three zones (each note deletable with an armed confirm), and the read-aloud bar — 朗读本课 speaks the lesson sentence-by-sentence through Microsoft's Edge neural voices (host-side synthesis, disk-cached; falls back to the browser's system voice offline) with the current sentence highlighted |

Clicking a lesson in the rail only FOCUSES it — progress updates, the blackboard switches, zero model traffic (upstream's exact interaction). The tutor engages only when you send. Every course-tree glyph, tag, and mastery bar carries a hover tooltip explaining its meaning.

**The 0.16–0.18 alignment round** brought the rest of upstream's surface 1:1: celebration particles anchored to the card that earned them, exam-v2's five-state flow (generating → ready → answering with a per-question timer + KC chips → star settlement with KC breakdown and review → retry; a leave guard intercepts mid-exam navigation), in-stream artifact cards you can answer inline, a tabbed import pane with an installer-style progress screen, selection-to-note anchors with 回到原文 locate, the review surface, full-text search with world switching, ErrorBoundary-guarded markdown with shared copyable code blocks, per-message read-aloud with sentence karaoke (n/total), attachments (paperclip/paste → study workspace → the tutor cites them), a context meter + model chip on the composer, Cmd+K lesson palette, a thread switcher for open lesson threads, A−/A+ zoom tiers, and the C1 scroll contract (sticky follow, back-to-bottom FAB with the streaming pulse, stop button mid-turn).

**The 0.20 revision round** answered a full-panel critique: the companion creature was removed entirely (owner decision), section exams moved into the center column at full column width, the unlabeled thread-pill strip became ONE labeled chip (「{n} 条对话」) opening a current-marked menu, tooltips track the cursor exactly under the A−/A+ zoom tiers, and the context meter became the host's own arrangement — a hover ring beside send whose maximum reads the REAL model capacity resolved host-side (the composition's default model → the provider catalog), with a click-open figures panel breaking usage down into system/tools/messages.

All study state comes from one shared 3 s poll over `/lookatstudy/api/state`. The host is exactly the conversation-model + agent-turn engine; the panel owns the UI, the host owns the loop.

## dsh-native surfaces

Beyond the tab, the plugin rides the host's own integration points:

- **Bilingual UI** — the whole client half registers a `lookatstudy` locale namespace (zh/en, key parity enforced); switch the host language and the study panel follows.
- **Settings page** — a `settings.section` entry in the host settings shell: teaching style, study mode on/off, read-only stats (courses/XP/streak) and the state-file path.
- **`/study` command** — bare `/study` activates a dormant install and queues the kickoff prompt; `/study <text>` queues that request. Works wherever slash commands do.
- **Composer dock pill** — `conversation.composer.dock` entry showing ⚡due · 🔥streak · Lv while active (renders nothing while dormant).
- **Tool cards in the conversation tab** — keyed `tool.call.toolview` entries for `study_record_answer` (✓/✗ + concept), `study_lesson`, `study_due_reviews`, `study_exam_result`.
- **Boot-tier prefetch** — `dsh.client.immediately: true`, so the sidebar 学习 row renders on first paint with no bundle fetch.

## Tool surface (31)

Import: `study_import_markdown` / `study_import_folder` (12 doc formats incl. EPUB/DOCX/PPTX/PDF text) / `study_import_github` (jsDelivr CDN, works where github.com is unreachable) / `study_import_url` (articles, arXiv, video metadata) + `study_apply_design` (the tutor-designed structure protocol)
Learn: `study_courses` (progress + full-text search), `study_map`, `study_lesson`
Progress: `study_define_concepts`, `study_record_answer`, `study_complete_lesson`, `study_exam_result` (star grades)
Artifacts (0.15.0): `study_generate_quiz` (interactive practice card), `study_pose_guess`, `study_compare_table`, `study_draw_diagram` (mermaid), `study_code_walkthrough` — each renders as an in-panel card and settles into the notebook
Memory: `study_consolidate`, `study_translate_lesson` (bilingual lessons), `study_export` (course pack markdown)
Proposals: `study_propose_mastery`, `study_resolve_proposal`
Reviews: `study_due_reviews`, `study_record_review`
Awareness: `study_report_friction`, `study_remember`, `study_notes`, `study_note_save`
Misc: `study_set_mode`, `study_delete_course`

## Configuration (cordis.yml patch layer)

```yaml
- id: lookatstudy
  name: dsh-plugin-lookatstudy
  config:
    mode: guide          # direct | guide | practice — initial soul; persists in state afterwards
    statePath: ''        # default: $DSH_HOME/lookatstudy-plugin/state.json
```

## What is intentionally not restored

The companion creature is NOT ported (a minimal DOM port shipped in 0.15.0 and was removed on owner decision after 0.19.0). Persistent text highlighting is ported through text-search anchors (selection → 提问这段/加到笔记, quotes restore as marks). Read-aloud itself IS ported (0.13.0) — Edge neural voices synthesized host-side with the browser's speechSynthesis as fallback. Everything else — engine, contracts, data models, exam mode with star grades, XP & streak, bilingual translation, image inlining, math/code/diagram rendering — is ported (diagram renderers load from CDN on demand and degrade silently offline).

## Development

```sh
pnpm exec tsdown        # build lib/ (host + client entries, peers external)
pnpm test               # node:test cases over the real source (no key needed)

# iterate against a live dsh (needs a deepseek-harness checkout):
pnpm dsh web --patch ../dsh-plugin-lookatstudy/cordis.dev.yml   # run from the harness checkout
# then open the served URL and click the 学习 row in the sidebar
```

Layout: persona + snapshot context in `src/index.ts`, tools in `src/tools.ts`, state transitions in `src/state.ts`, the study panel's HTTP API in `src/dashboard.ts`, sanitized markdown in `src/markdown.ts` (shared by the host routes and the client bundle), the browser half in `src/client/` (`index.ts` registrations, `shell-entry.ts` the DOM sidebar row + center-column takeover, `panel.tsx` the upstream-arranged three columns, `session-feed.ts` the session-event-window → chat-rows fold, `data.ts` shared poll store, `styles.ts` injected `--dsw-*` stylesheet), UI card projections in `src/cards.ts`, vendored zero-dependency engine in `src/vendor/` (see each file's provenance header; the one local modification to the folder scanner's dedup key is documented there).

Publishing note: `exports` must keep `"./package.json": "./package.json"` — the web bundle's client-module scanner resolves it to discover the `dsh.client` browser half. When re-installing a rebuilt tarball into a profile, remove the old one first or bump the version (pnpm reuses same-spec tarballs).

## License

MIT. Engine modules vendored from LookatStudy (MIT).

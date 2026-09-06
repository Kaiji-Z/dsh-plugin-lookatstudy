# dsh-plugin-lookatstudy

Turn any markdown document, local folder, or GitHub learning repository into a guided course inside [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) — your dsh agent becomes a full AI tutor with the interaction design of [LookatStudy](https://github.com/Kaiji-Z/LookatStudy): per-concept knowledge tracking, mastery-driven progression, spaced repetition, mastery proposals, friction awareness, learner memory, a Cornell notebook, an in-chat proposal card, exam mode with star grades, XP & streak, bilingual lessons, read-aloud (Edge TTS with a system-voice fallback), and a rich blackboard (KaTeX math, syntax-highlighted code, mermaid diagrams, mindmap & concept-map views). Learning engine modules are vendored from LookatStudy (MIT).

## Screenshots

| | |
|---|---|
| ![Three-column study tab: course rail, tutor, blackboard](docs/media/overview.png) | **The 学习 panel** — course rail (progress, mastery bars, due box), the tutor chat with its own composer, and the focus lesson's blackboard; opened from the sidebar's 学习 row (0.14.0 screenshot pending — the shot shows the 0.13 tab arrangement of the same three columns). |
| ![Lesson page with rendered math, code and diagrams](docs/media/blackboard-lesson.png) | **讲解** — server-sanitized markdown rendered rich on demand: KaTeX formulas, syntax-highlighted code, mermaid diagrams (CDN loaders, silent degrade offline). |
| ![Concept map view](docs/media/concept-map.png) | **🕸 概念图** — the lesson's knowledge components laid out as a draw.io-style concept graph (bundled ELK layout, no external service). |
| ![Course rail with lesson tree](docs/media/course-rail.png) | **课程栏** — sections, gating, mastery bars, ⚡ weak spots, exam stars, XP & streak. |

## Install

```sh
dsh plugin add dsh-plugin-lookatstudy        # from npm
# or from a tarball:
dsh plugin add ./dsh-plugin-lookatstudy-0.2.1.tgz
```

Works with any profile. In the `web` profile the plugin additionally serves the study tab's HTTP API and loads its browser half; headless profiles get the plain tool surface.

## The two surfaces

**1. The tutor (chat).** Talk to the agent: *"import https://github.com/microsoft/AI-For-Beginners and teach me lesson 1"*, *"what reviews are due today?"*. The tutor persona (stable core + one of three souls — `guide` 引导 / `direct` 精讲 / `practice` 实战) drives the full LookatStudy loop:

- **Knowledge components (KC)** — on first teaching a lesson the tutor derives 2–7 concepts (`study_define_concepts`); every graded answer is attributed (`study_record_answer` with `concept`); per-concept BKT runs and **lesson mastery is the weakest concept** — quizzes target ⚡weak ones first.
- **Mastery-driven progression** — ≥50% unlocks the next lesson early; ≥90% graduates and schedules the first SM-2 review; answers also nudge the review schedule.
- **Mastery proposals (propose → apply)** — at ≥85% plus a convincing Feynman-style explanation the tutor proposes early graduation and **waits for the learner's yes/no**; only the explicit decision applies it.
- **Friction awareness** — confusion/blocks/frustration are silently logged (`study_report_friction`) and surface as ⚡😣 weak spots.
- **Learner memory** — three slots (global style / per-course pattern / per-lesson gap), read-merge-write (`study_remember`).
- A dynamic **learner snapshot** (focus, strategy band, weak concepts, friction, memory, due count, pending proposal) is injected as runtime context every turn.

**2. The study panel (`dsh.client`).** A 「学习」 row in the dsh sidebar (below 新会话, alongside other plugin entries) opens a full-takeover panel arranged like upstream LookatStudy's own app — three columns styled entirely with dsh's `--dsw-*` tokens; closing it (or navigating to any session) hands the center column straight back to the host:

| Column | What you get |
|---|---|
| 左 · 课程 | Course picker, progress, due box with one-click review kickoff, lesson tree (gating, mastery bars, ⚡😣 weak spots, clickable focus), one-click demo import when empty |
| 中 · 导师 | The tutor conversation with its OWN composer — the panel never touches dsh's host composer. Sending (or tapping a starter) is the single entry into a lesson thread: the panel activates the study surface if dormant, creates the lesson's session on the host, and prompts through the host's session face; replies stream back from the session's event window and render through the plugin's markdown pipeline. Soul pills (直讲/引导/实战) ride the column head; the tutor's quiz options (A–D) render as clickable answer buttons under the latest reply |
| 右 · 黑板 | The focus lesson's 讲解 (server-sanitized markdown, rendered rich on demand: KaTeX / syntax highlighting / mermaid), a 🕸 concept-map view of the same lesson, the Cornell 笔记 three zones (each note deletable with an armed confirm), and the read-aloud bar — 朗读本课 speaks the lesson sentence-by-sentence through Microsoft's Edge neural voices (host-side synthesis, disk-cached; falls back to the browser's system voice offline) with the current sentence highlighted |

Clicking a lesson in the rail only FOCUSES it — progress updates, the blackboard switches, zero model traffic (upstream's exact interaction). The tutor engages only when you send. Every course-tree glyph, tag, and mastery bar carries a hover tooltip explaining its meaning.

All study state comes from one shared 3 s poll over `/lookatstudy/api/state`. The host is exactly the conversation-model + agent-turn engine; the panel owns the UI, the host owns the loop.

## dsh-native surfaces

Beyond the tab, the plugin rides the host's own integration points:

- **Bilingual UI** — the whole client half registers a `lookatstudy` locale namespace (zh/en, key parity enforced); switch the host language and the study panel follows.
- **Settings page** — a `settings.section` entry in the host settings shell: teaching style, study mode on/off, read-only stats (courses/XP/streak) and the state-file path.
- **`/study` command** — bare `/study` activates a dormant install and queues the kickoff prompt; `/study <text>` queues that request. Works wherever slash commands do.
- **Composer dock pill** — `conversation.composer.dock` entry showing ⚡due · 🔥streak · Lv while active (renders nothing while dormant).
- **Tool cards in the conversation tab** — keyed `tool.call.toolview` entries for `study_record_answer` (✓/✗ + concept), `study_lesson`, `study_due_reviews`, `study_exam_result`.
- **Boot-tier prefetch** — `dsh.client.immediately: true`, so the sidebar 学习 row renders on first paint with no bundle fetch.

## Tool surface (25)

Import: `study_import_markdown` / `study_import_folder` (12 doc formats incl. EPUB/DOCX/PPTX/PDF text) / `study_import_github` (jsDelivr CDN, works where github.com is unreachable) / `study_import_url` (articles, arXiv, video metadata) + `study_apply_design` (the tutor-designed structure protocol)
Learn: `study_courses` (progress + full-text search), `study_map`, `study_lesson`
Progress: `study_define_concepts`, `study_record_answer`, `study_complete_lesson`, `study_exam_result` (star grades)
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

LookatStudy's Electron-native experiences have no host surface in dsh: the 伴学 companion creature and its celebration particles, and persistent text highlighting with DOM anchors (the read-aloud bar highlights in its own strip instead). Read-aloud itself IS ported (0.13.0) — Edge neural voices synthesized host-side with the browser's speechSynthesis as fallback. Everything else — engine, contracts, data models, exam mode with star grades, XP & streak, bilingual translation, image inlining, math/code/diagram rendering — is ported (diagram renderers load from CDN on demand and degrade silently offline).

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

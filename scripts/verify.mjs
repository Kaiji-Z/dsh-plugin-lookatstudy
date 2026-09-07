/**
 * The one-command verification gate (VERIFICATION.md §6: "reproducible by one
 * command, no human screen-watching"). Every step checks the child's exit
 * code explicitly — piping a build through grep once shipped a stale bundle
 * as a fake release, so this script trusts nothing but exit codes and
 * asserted bundle content. Prints a GATE line per step; any failure exits 1.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const failed = []

/** Run one step, GATE-declare it, and record pass/fail with evidence. */
function gate(name, run) {
  const evidence = run()
  const ok = evidence.exit === 0 && evidence.checks.every(c => c.ok)
  console.log(`GATE ${name}: ${ok ? 'DONE' : 'FAILED'}`)
  console.log(`- exit: ${evidence.exit}`)
  for (const check of evidence.checks) console.log(`- ${check.ok ? 'ok' : 'FAIL'}: ${check.label}`)
  if (!ok) failed.push(name)
  return ok
}

/** Spawn a command, inheriting stdio; returns its exit code. */
function sh(command, args) {
  const res = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' })
  return res.status ?? 1
}

gate('tests', () => ({
  exit: sh('node', ['--import', 'tsx', '--test', 'tests/*.test.ts']),
  checks: [{ ok: true, label: 'node:test suite (glob quoted for git-bash)' }],
}))

gate('build', () => ({
  exit: sh('pnpm', ['run', 'build']),
  checks: [
    { ok: existsSync('lib/index.mjs'), label: 'lib/index.mjs exists' },
    { ok: existsSync('lib/client.js'), label: 'lib/client.js exists' },
  ],
}))

gate('bundle', () => {
  if (!existsSync('lib/client.js')) return { exit: 1, checks: [{ ok: false, label: 'client bundle missing' }] }
  const client = readFileSync('lib/client.js', 'utf8')
  const host = existsSync('lib/index.mjs') ? readFileSync('lib/index.mjs', 'utf8') : ''
  const required = [
    // 0.14.0 panel architecture: sidebar-entry center takeover (stardeck doctrine)
    [client, 'mountStudyShell', 'shell entry mounted'],
    [client, 'data-dsh-lookatstudy-entry', 'sidebar entry row attribute'],
    [client, 'data-dsh-lookatstudy-active', 'center-takeover html attribute'],
    [client, 'lks14-shell-view', 'panel container class'],
    [client, 'lks14-sidebar-row', 'entry row styles'],
    [client, 'dsh-panel-activate', 'sibling-panel mutual eviction'],
    [client, 'suppressHandBack', 'internal session opens do not close the panel'],
    [client, 'feedRows', 'event-window → chat-rows fold (session-feed)'],
    [client, 'lesson-session', 'per-lesson thread binding'],
    [client, '/lookatstudy/api/active', 'activation route wired into the client'],
    [client, 'flex:0 0 300px', 'upstream 300px rail column'],
    [client, 'clamp(480px,45%,800px)', 'upstream chat clamp column (row-relative)'],
    [client, 'lks14-composer', 'the chat pane owns its composer (host composer untouched)'],
    [client, 'M2 3.2C3.2', 'sidebar entry icon (open-book glyph)'],
    // rail/tree contracts that survived the refactor
    [client, '章节测验', 'exam nodes'],
    [client, 'lks14-quiz', 'interactive quiz options'],
    [client, 'lks14-opt', 'quiz answer buttons'],
    [client, '课时掌握度', 'glyph tooltips'],
    [client, 'aria-disabled', 'lesson rows are real buttons (keyboard reach)'],
    [client, 'sectionDefaultOpen', 'rail sections collapse off the frontier'],
    [client, 'aria-expanded', 'section heads announce their collapse state'],
    [client, 'lks-btn-send stop', 'busy = the 3D stop twin (spinner retired from send per upstream; returns with exam-generating in P12)'],
    [client, 'lks-spin', 'spinner animation class'],
    [client, 'business-tertiary', 'soul-pill active tint stays positive'],
    // read-aloud dual-track (0.13.0, restored through the panel)
    [client, 'lks-readbar', 'read-aloud bar'],
    [client, 'read.engine.system', 'read-aloud degradation notice'],
    [client, 'speechSentencesOf', 'sentence splitter rides the client bundle'],
    [client, 'speechSynthesis', 'system-voice fallback engine'],
    [client, 'prewarm', 'next-sentence synthesis prefetch'],
    [host, 'attemptLesson', 'attempt-unlock host path'],
    [host, 'in_progress', 'four-state machine'],
    [host, 'createStudySurface', 'activation-gated tool surface'],
    [host, 'data.jsdelivr.com', 'jsdelivr data API tree fallback (upstream 2026-08-16 port)'],
    [host, 'deadlineMs', 'httpsGet hard deadline plumbing'],
    [host, "learner's own language", 'output-language directive'],
    [host, 'study_apply_design', 'tutor-design apply tool'],
    [host, 'design_required', 'import design protocol status'],
    [host, '3000-8000', 'lesson pacing rule rides the brief and prompt'],
    [client, 'esm.sh/shiki', 'shiki CDN loader (Phase 2 rendering, zero-dep bundle)'],
    [client, 'esm.sh/mermaid', 'mermaid CDN loader'],
    [client, 'esm.sh/elkjs', 'elkjs CDN loader (concept map layout)'],
    [client, 'cdn.jsdelivr.net/npm/katex', 'KaTeX CDN loader'],
    [host, 'normalizeMathNotation', 'math notation normalization rides the lesson pipeline'],
    [host, '/lookatstudy/api/tts', 'tts route (0.13.0)'],
    [host, 'Sec-MS-GEC', 'edge tts DRM token (0.13.0)'],
    [host, 'speechText', 'lesson speech text rides the state feed (0.13.0)'],
    [host, 'api/note/delete', 'note delete route (0.12.5)'],
    [client, 'settings.section', 'plugin settings page (dsh-native round)'],
    [client, 'conversation.composer.dock', 'composer dock status pill'],
    [client, 'tool.call.toolview', 'conversation-tab tool cards'],
    [client, 'lks-dockpill', 'dock pill styles'],
    [client, 'registerStudyLocale', 'locale namespace registration'],
    // 0.15.0 P1: the artifact channel (upstream artifacts/canvas port)
    [host, 'study_generate_quiz', 'practice card tool'],
    [host, 'recordArtifact', 'idempotent artifact recording'],
    [host, 'sanitizeQuiz', 'quiz artifact sanitization'],
    [client, 'QuizCard', 'interactive practice card'],
    [client, 'getPostQuizActions', 'post-quiz exits (never fewer than two)'],
    [client, 'quizProgressKey', 'quiz progress persistence'],
    [host, 'study_compare_table', 'compare-table artifact tool'],
    [host, 'study_code_walkthrough', 'code-walkthrough artifact tool'],
    [host, 'study_draw_diagram', 'diagram artifact tool'],
    [host, 'study_pose_guess', 'opening guess tool'],
    [client, 'ArtifactCard', 'artifact card dispatch (table/walkthrough/diagram/guess)'],
    [client, 'unseenArtifacts', 'notebook badge + sediment tracking'],
    [host, 'api/note/user', 'selection-to-note route (P2)'],
    [client, 'locateInModel', 'text-search highlight anchors (upstream v0.3.3 scheme)'],
    [client, 'applyHighlights', 'persisted highlight rendering'],
    [client, 'lks-quote-btn', 'the selection popover'],
    [host, 'api/review', 'SM-2 self-rating route (P3)'],
    [client, 'lks-ratecard', 'the review self-rating card'],
    [client, 'review.nudge', 'the due nudge toast'],
    [client, 'mergeRailSearch', 'the full-text search results panel (P4)'],
    [client, 'lks14-searchpanel', 'search panel styles'],
    [client, 'lks-propbanner', 'mastery proposal banner (P5)'],
    [client, 'lks14-thinking', 'the pre-text thinking row'],
    [client, 'lks14-switch', 'the narrow-mode pane switcher'],
    [client, 'effectiveOpen', 'user section-collapse overrides'],
    [client, 'useCompanionMood', 'the companion mood machine (P7)'],
    [client, 'lks-companion', 'the companion creature'],
    [client, 'companion.form.ember', 'the five companion forms'],
    // 0.15.0 P6: the panel toast stack (upstream Toast port)
    [client, 'showStudyToast', 'toast entry point'],
    [client, 'SEVERITY_DURATION', 'per-severity toast durations'],
    [client, 'lks-toast', 'toast capsule styles'],
    // 0.16.0 P9a: the upstream v0.28 skin (1:1 UI port)
    [client, 'UPSTREAM_CSS', 'the upstream token+component skin layer'],
    [client, 'lks-ui', 'the skin scope class on the panel root'],
    [client, 'lks14-appheader', 'the floating XP/streak app header'],
    [client, 'lks14-righthalf', 'the header-over-row structural wrapper'],
    // 0.16.0 P9b → 2026-09-08 pivot: the course rail as a list (the balloon/
    // physics map is a deliberate deviation — quiet course tree instead)
    [client, 'ListSectionView', 'the list section renderer (head + lesson rows)'],
    [client, 'lks-raillist', 'the rail list wrapper'],
    [client, 'lks-lessorow', 'the lesson row (glyph + bar + badges)'],
    [client, 'lks-railsec-head', 'the quiet section toggle'],
    // 0.17.0 P10a (A-track): island zeroing + the audit gate
    [client, '.lks-ui .lks14-starter', 'starter chips ride the dark skin'],
    [client, 'lks-crown-sparkle', 'upstream feedback animations'],
    [client, '::-webkit-scrollbar', 'scoped dark scrollbar'],
    [client, '--cm-c0-fill', 'concept-map palette tokens'],
    [client, 'IconArrowUpFill16', 'SVG send glyph (emoji retired)'],
    // 0.17.0 P10b (B-track): the upstream rail frame + column skeletons
    [client, 'lks14-railtrack', 'map/import sliding panes'],
    [client, 'lks14-railtop', 'floating tab capsule + glass title card'],
    [client, 'lks14-emptycard', 'the empty-state card with 3D CTA'],
    [client, 'lks14-soulrow', 'mode pills ride the composer capsule'],
    [client, 'lks14-railcourse', 'course rows in the import pane'],
    // 0.18.0 P11a (C-track quick wins)
    [client, 'lks14-scrollfab', 'the scroll-to-bottom FAB'],
    [client, 'lks-btn-send stop', 'the stop twin of send'],
    [client, 'isStuck', 'sticky-follow fold'],
    [client, 'swipePane', 'touch pane swipe'],
    [client, 'pickRandomDue', 'interleaved random review'],
    [client, 'optionTone', 'select-then-submit quiz tone'],
    [client, 'attachCodeHeader', 'code block lang+copy header'],
    // 0.18.0 P11b (C-track closure)
    [client, 'lks14-reasoning', 'the streaming reasoning fold'],
    [client, 'lks14-toolchip', 'three-state tool call chips'],
    [client, 'lks-tip', 'GlobalTooltip portal'],
    [client, 'lks-confirmcard', 'ConfirmCard popover'],
    [client, 'data-row-key', 'per-message audio row anchor'],
    [client, 'lks-reading', 'karaoke sentence highlight'],
    [client, 'lks-flash-fade', 'note-locate flash'],
    [client, 'note/edit', 'note editing write route'],
    [client, 'note/pin', 'note pin write route'],
    // 0.18.0 P12 (D1): the exam-v2 surface
    [client, 'lks14-examstage', 'the exam five-state stage'],
    [client, 'lks14-examans', 'the answering layout'],
    [client, 'lks14-examresult', 'the settlement page'],
    [client, 'lks14-examleave', 'the leave-guard modal'],
    [client, 'buildAttemptShuffle', 'the attempt shuffle rides the bundle'],
    [client, 'exam/start', 'exam attempt start route'],
    [client, 'exam/submit', 'exam submit route'],
    [client, 'lookatstudy-exam-generate', 'the tutor bank prompt event'],
    // 0.18.0 P13 (D2): the celebration layer
    [client, 'lks14-celfx-canvas', 'the celebration canvas'],
    [client, 'lks14-celfx-reduced', 'the reduced-motion static layer'],
    [client, 'seedBurst', 'the pure burst seeder'],
    [client, 'stepParticle', 'the particle physics step'],
    [client, 'energy-full', 'the energy-full celebration kind'],
    // 0.18.0 P14 (D3): the canvas stage + the board tab
    [client, 'lks14-stage-tools', 'the zoom toolbar'],
    [client, 'canvas-zoom-fit', 'the fit button'],
    [client, 'zoomAtClamped', 'the vendored pan/zoom math'],
    [client, 'lks14-board', 'the board tab layout'],
    [client, 'board-canvas-stage', 'the board canvas stage'],
    [client, 'diagram-modal-stage', 'the mermaid modal stage'],
    [client, 'cmap-modal-stage', 'the concept-map modal stage'],
    [client, 'data-node-id', 'focus row anchor'],
    // 0.18.0 P15 (D5) removed 2026-09-08: the physics map retired with the map
    [client, 'rowStateClass', 'the lesson-row state fold'],
    [client, 'rowMasteryPct', 'the row mastery-bar fold'],
    // 0.18.0 D4: in-stream artifact hydration + the sediment backlog
    [client, 'hydrateArtifactRows', 'the artifact row hydrator'],
    [client, 'sedimentBacklog', 'the sediment backlog fold'],
    [client, 'lks14-inline-artifact', 'the inline artifact wrapper'],
    [client, 'ARTIFACT_TOOLS', 'the artifact tool map'],
    // 0.18.0 D6 → 2026-09-08: world switcher + streaming row spinner stay;
    // the env-* seasonal filters retired with the map
    [client, 'sectionWorldOf', 'the section world derivation'],
    [client, 'lks-lessorow-spin', 'the streaming row spinner badge'],
    [client, 'lks-worldswitch', 'the two-world switcher'],
    [client, 'lks-stream-note', 'the rail streaming notice'],
    // 0.18.0 D7: the import pane tabs + installer progress screen
    [client, 'importProgressOf', 'the import tool-chip fold'],
    [client, 'epubFolderPath', 'the epub tab path fold'],
    [client, 'lks14-importcta', 'the import CTA toggle'],
    [client, 'lks14-importprog', 'the installer progress screen'],
    [client, 'import-tab-', 'the five source tabs'],
    // 0.18.0 D8: the shared CodeBlock + the danger-zone boundaries
    [client, 'lks-codeblock', 'the shared code block card'],
    [client, 'wireCodeBlockCopy', 'the delegated copy wire'],
    [client, 'lks-renderfail', 'the boundary fallback surfaces'],
    [client, 'ContentBoundary', 'the content-zone boundary wrapper'],
    [client, 'md-codeblock', 'the codeblock testid'],
    [host, 'lks-codeblock', 'the pipeline emits the card host-side too'],
    // 0.18.0 P16: dual light/dark theme following the host
    [client, 'wirePanelTheme', 'the host-theme follow machinery'],
    [client, 'mermaidThemeVariables', 'the live mermaid palette'],
    [client, "data-lks-theme='light'", 'the light token override block'],
    [client, '--shiki-light', 'the shiki light flip'],
    // 0.18.0 P17: host-capability replacements
    [client, 'lks14-ctxmeter', 'the context meter'],
    [client, 'lks14-threadpill', 'the thread switcher pills'],
    [client, 'lks14-palette', 'the command palette'],
    [client, 'lks-modelface', 'the model face chip'],
    [client, 'lks-hdr-zoom', 'the font-scale pair'],
    [client, 'lks-btn-attach', 'the composer attach button'],
    [host, 'historyBudget', 'the budget flag + directive host-side'],
    [host, 'registerStudyCommand', '/study slash command'],
  ]
  const forbidden = [
    [client, 'agentReady', 'stale agentReady gate (removed in 0.4.1)'],
    [client, '📚', 'emoji icon on starter/import buttons (replaced by ic_ds glyphs in 0.7.1)'],
    [client, 'markmap', 'retired mind-map view + its CDN trio (upstream v0.26.0 port)'],
    [client, 'conversation.view', 'the conversation.view tab (removed in 0.14.0 — the study surface is a sidebar-entry panel)'],
    [client, 'conversation-composer-overlay', 'the tab-era composer overlay mode (0.14.0 removed the host-composer coupling)'],
  ]
  const checks = [
    ...required.map(([src, needle, label]) => ({ ok: src.includes(needle), label: `bundle contains ${label} (${JSON.stringify(needle)})` })),
    ...forbidden.map(([src, needle, label]) => ({ ok: !src.includes(needle), label: `bundle free of ${label}` })),
    // The dsh.client manifest must keep the boot-tier prefetch flag (the study
    // tab's first open would otherwise pay a bundle fetch) and the locale edge.
    (() => {
      const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
      const decl = pkg.dsh?.client ?? {}
      return {
        ok: decl.immediately === true && Array.isArray(decl.inject) && decl.inject.includes('locale'),
        label: 'dsh.client manifest: immediately:true + locale inject edge',
      }
    })(),
  ]
  return { exit: 0, checks }
})

gate('secrets', () => {
  // "The key never enters the public repo" as a machine gate, not a promise.
  // Scans every git-tracked file for (a) KEY=value assignments, (b) sk- token
  // patterns, (c) the actual Z_AI_API_KEY value when it is present in this
  // shell's env (CI has no key → (c) self-skips). Hits report file + kind only,
  // never the matched text — the gate must not become the leak.
  // PUBLIC_PROTOCOL_CONSTANTS are allowlisted by exact literal before scanning:
  // Microsoft's Edge read-aloud client token ships inside the public Edge
  // extension bundle and every public edge-tts implementation — it is a wire
  // protocol constant, not a credential. Nothing else is exempt.
  const PUBLIC_PROTOCOL_CONSTANTS = ['6A5AA1D4EAFF4E9FB37E23D68491D6F4']
  const ls = spawnSync('git', ['ls-files'], { encoding: 'utf8' })
  if (ls.status !== 0) return { exit: 1, checks: [{ ok: false, label: `git ls-files failed: ${ls.stderr?.trim()}` }] }
  const files = ls.stdout.split('\n').map(s => s.trim()).filter(Boolean)
  const ASSIGNMENT = /(API_KEY|SECRET|TOKEN|PASSWORD)[ \t]*=[ \t]*['"]?[A-Za-z0-9_\-+/=]{8,}/
  const TOKEN = /sk-[A-Za-z0-9]{16,}/
  const live = process.env.Z_AI_API_KEY
  const hits = []
  for (const f of files) {
    let body
    try { body = readFileSync(f, 'utf8') } catch { continue }
    for (const c of PUBLIC_PROTOCOL_CONSTANTS) body = body.replaceAll(c, '<public-protocol-constant>')
    const kinds = []
    if (ASSIGNMENT.test(body)) kinds.push('key-assignment')
    if (TOKEN.test(body)) kinds.push('sk-token-pattern')
    if (live && live.length >= 8 && body.includes(live)) kinds.push('live-key-value')
    if (kinds.length > 0) hits.push(`${f} (${kinds.join(', ')})`)
  }
  const artifacts = ['livetest-output.md', 'livetest-judge-output.md', 'livetest-design-output.md', 'livetest-design-state.json', 'livetest-design-err.log']
  const tracked = artifacts.filter(a => files.includes(a))
  return {
    exit: 0,
    checks: [
      { ok: hits.length === 0, label: hits.length === 0 ? `scanned ${files.length} tracked files — no key assignments, no token patterns${live ? ', live key value absent' : ''}` : `LEAK: ${hits.join(' | ')}` },
      { ok: tracked.length === 0, label: tracked.length === 0 ? 'live artifacts (livetest/judge outputs, state) stay untracked' : `tracked live artifacts: ${tracked.join(', ')}` },
    ],
  }
})

if (failed.length > 0) {
  console.log(`\nVERIFY: FAILED at ${failed.join(', ')}`)
  process.exit(1)
}
console.log('\nVERIFY: PASS — tests, build, and bundle assertions all green (machine-checked).')

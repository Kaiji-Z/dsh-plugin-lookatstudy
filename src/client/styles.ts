/**
 * Style injection for the study surfaces: one `<style>` element carrying the
 * `.lks14-*` panel classes (the sidebar-entry center-takeover, arranged like
 * upstream LookatStudy) plus the shared `.lks-*` classes the host-native
 * surfaces still use (toolview cards, dock pill, settings section, note
 * cards, read-aloud bar). Authored against the dsh `--dsw-*` design tokens so
 * everything follows the app's theme instead of carrying its own palette.
 * CSS Modules are unavailable to patch-layer bundles, so the stylesheet is
 * injected once at client-plugin apply; the `data-` attribute keeps the
 * injection idempotent.
 * @module dsh-plugin-lookatstudy/client/styles
 */

/** Marker attribute proving the stylesheet is already in the document. */
const STYLE_ID = 'data-dsh-plugin-lookatstudy'

/**
 * The study stylesheet. The center-takeover visibility follows the stardeck
 * panel doctrine: the shell view is display:none until the `<html>` active
 * attribute flips, and the host conversation column's own children are hidden
 * behind `!important` so React never fights the takeover.
 */
export const STUDY_CSS = `
/* State inks: small colored text must clear WCAG AA (4.5:1), but the host's
   raw state tokens (success/warn primaries) sit at 2.3–2.6:1 on light
   backgrounds, and success/error *label* aliases are not published by this
   host at all (the tv-chip used to reference them and silently inherit).
   Mixing the state color toward label-primary keeps the hue while pulling
   luminance to the readable pole — and works in BOTH themes, because
   label-primary is always the current theme's high-contrast ink. Declared on
   every surface family that consumes the inks: .lks-root (dock pill,
   settings) and .lks-tv (toolview cards, which render in the host
   conversation with no .lks-root ancestor). */
.lks-root,.lks-tv,.lks14{--lks-warn-ink:color-mix(in srgb,var(--dsw-alias-state-warn-label) 45%,var(--dsw-alias-label-primary));--lks-ok-ink:color-mix(in srgb,var(--dsw-alias-state-success-primary) 40%,var(--dsw-alias-label-primary));--lks-err-ink:color-mix(in srgb,var(--dsw-alias-state-error-primary) 55%,var(--dsw-alias-label-primary))}
.lks-root{font-family:var(--dsw-font-family)}
.lks-root :where(button){font-family:var(--dsw-font-family);cursor:pointer;border:none;background:none;padding:0}

/* ── sidebar entry row (DOM-injected next to the session family) ── */
.lks14-sidebar-row{display:flex;align-items:center;gap:9px;width:100%;padding:7px 10px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;font-family:var(--dsw-font-family);cursor:pointer;border-radius:8px;text-align:left}
.lks14-sidebar-row:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.lks14-sidebar-row[data-active='true']{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-weight:600}
.lks14-sidebar-row:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-state-business-primary);outline:none}
.lks14-sidebar-icon{display:inline-flex;align-items:center;flex:0 0 auto;color:currentColor}
.lks14-sidebar-label{white-space:nowrap}
/* Host sidebar collapsed to the icon rail: hide the label, center the icon. */
[class*='_collapsed'] .lks14-sidebar-row{justify-content:center;padding:7px 0;gap:0}
[class*='_collapsed'] .lks14-sidebar-label{display:none}

/* ── center-column takeover (the study panel) ── */
.lks14-shell-view{display:none}
html[data-dsh-lookatstudy-active] .lks14-shell-view{display:flex;flex-direction:column;height:100%;min-height:0}
html[data-dsh-lookatstudy-active] [data-pane='conversation'] > :not([data-dsh-lookatstudy-view]),
html[data-dsh-lookatstudy-active] [class*='centerCol'] > :not([data-dsh-lookatstudy-view]){display:none !important}
[data-dsh-lookatstudy-view]{container-type:inline-size}
.lks14{position:relative;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);overflow:hidden;font-family:var(--dsw-font-family)}
.lks14 button{font-family:var(--dsw-font-family);cursor:pointer}
.lks14-body{display:flex;flex:1;min-width:0;min-height:0}
.lks14-col{display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden}
.lks14-colhead{flex:none;display:flex;align-items:center;gap:8px;padding:10px 12px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-secondary);border-bottom:1px solid var(--dsw-alias-border-l1)}

/* 左 rail: course picker, tree, review, import */
.lks14-rail{flex:0 0 240px;border-right:1px solid var(--dsw-alias-border-l1);padding:0 10px 10px;overflow-y:auto}
.lks14-railhead{display:flex;align-items:center;gap:6px;margin-top:10px}
.lks14-railtitle{font-weight:600;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.lks14-railsub{font-size:12px;color:var(--dsw-alias-label-secondary);margin:6px 0}
.lks14-masterybar{height:5px;border-radius:3px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;margin-bottom:8px}
.lks14-masterybar i{display:block;height:100%;background:var(--dsw-alias-business-primary);transform-origin:left;transition:transform .3s}
.lks14-masterybar.gold i{background:var(--dsw-alias-state-warn-primary)}
.lks14-search{width:100%;box-sizing:border-box;font:inherit;font-size:12.5px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:5px 8px;margin:4px 0}
.lks14-search:focus{outline:none;border-color:var(--dsw-alias-state-business-primary)}
.lks14-duebox{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:8px 10px;margin:8px 0;font-size:12.5px}
.lks14-dueitem{display:flex;justify-content:space-between;gap:6px;padding:2px 0;color:var(--dsw-alias-label-secondary)}
.lks14-over{color:var(--dsw-alias-state-error-primary)}
.lks14-sechead{display:flex;align-items:center;gap:6px;width:100%;background:none;border:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12.5px;font-weight:600;padding:6px 2px;cursor:pointer;text-align:left}
.lks14-sechead:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-state-business-primary);outline:none}
.lks14-secnum{flex:none;width:18px;height:18px;border-radius:5px;background:var(--dsw-alias-bg-layer-2);display:inline-flex;align-items:center;justify-content:center;font-size:11px}
.lks14-secheadt{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lks14-node{display:flex;align-items:center;gap:6px;width:100%;background:none;border:none;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;padding:5px 6px;border-radius:8px;cursor:pointer;text-align:left}
.lks14-node:hover{background:var(--dsw-alias-bg-layer-1)}
.lks14-node:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-state-business-primary);outline:none}
.lks14-node.focus{background:var(--dsw-alias-bg-layer-2)}
.lks14-node[aria-disabled='true']{color:var(--dsw-alias-label-tertiary);cursor:default}
.lks14-g{flex:none;display:inline-flex}
.lks14-t{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lks14-tag{flex:none;display:inline-flex;align-items:center;gap:2px;font-size:10.5px;border-radius:6px;padding:1px 4px}
.lks14-tag.weak{color:var(--dsw-alias-state-warn-primary)}
.lks14-bar{flex:none;width:26px;height:4px;border-radius:2px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.lks14-bar i{display:block;height:100%;background:var(--dsw-alias-business-primary);transform-origin:left}
.lks14-pct{flex:none;font-size:10.5px;color:var(--dsw-alias-label-tertiary)}
.lks14-empty{color:var(--dsw-alias-label-tertiary);font-size:13px;padding:18px 6px;line-height:1.7}
.lks14-import{margin:8px 0}
.lks14-inputrow{display:flex;gap:6px}
.lks14-hint{font-size:11.5px;color:var(--dsw-alias-label-tertiary);margin-top:6px;line-height:1.6}

/* 中 chat: the tutor stream + its own composer (upstream ChatStream/ChatComposer) */
.lks14-chat{flex:1 1 46%;min-width:340px;border-right:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-0, transparent)}
.lks14-chatlesson{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:400;color:var(--dsw-alias-label-tertiary)}
.lks14-pills{display:inline-flex;gap:2px}
.lks14-pill{border:none;background:none;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;padding:2px 8px;border-radius:7px;cursor:pointer}
.lks14-pill:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-state-business-primary);outline:none}
.lks14-pill.on{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.lks14-stream{flex:1;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:10px}
.lks14-msg{max-width:92%;line-height:1.65;font-size:13.5px}
.lks14-msg-user{align-self:flex-end;background:var(--dsw-alias-bg-layer-2);border-radius:12px 12px 3px 12px;padding:7px 11px;white-space:pre-wrap}
.lks14-msg-assistant{align-self:flex-start;background:var(--dsw-alias-bg-layer-1);border-radius:12px 12px 12px 3px;padding:8px 12px}
.lks14-msg.streaming{opacity:.7}
.lks14-msg-assistant p{margin:4px 0}
.lks14-msg-assistant pre{overflow-x:auto;font-size:12px}
.lks14-msg-assistant table{border-collapse:collapse;margin:6px 0;display:block;max-width:100%;overflow-x:auto}
.lks14-msg-assistant th,.lks14-msg-assistant td{border:1px solid var(--dsw-alias-border-l2);padding:4px 8px;font-size:12px}
.lks14-turn{max-width:92%;align-self:flex-start;display:flex;flex-direction:column;gap:6px}
.lks14-quiz{display:flex;flex-direction:column;gap:4px}
.lks14-opt{display:flex;gap:6px;align-items:baseline;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:6px 10px;font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left}
.lks14-opt:hover{background:var(--dsw-alias-bg-layer-2)}
.lks14-opt:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-state-business-primary);outline:none}
.lks14-optletter{flex:none;font-weight:700;color:var(--dsw-alias-business-primary)}
.lks14-starters{flex:none;display:flex;flex-wrap:wrap;gap:4px;padding:6px 12px}
.lks14-starter{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;border-radius:14px;padding:3px 10px;cursor:pointer}
.lks14-starter:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}
.lks14-starter:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-state-business-primary);outline:none}
.lks14-starter[aria-disabled='true']{opacity:.5;cursor:default}
.lks14-composer{flex:none;display:flex;gap:6px;align-items:flex-end;padding:8px 12px 10px;border-top:1px solid var(--dsw-alias-border-l1)}
.lks14-composertext{flex:1;font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:7px 10px;resize:none;box-sizing:border-box}
.lks14-composertext:focus{outline:none;border-color:var(--dsw-alias-state-business-primary)}

/* 右 notebook: 讲解/概念图/笔记 (upstream NotebookPanel) */
.lks14-note{flex:0 0 clamp(320px, 30vw, 460px);padding:0 12px 12px;overflow-y:auto}
.lks14-lessonhead{margin:10px 0 6px}
.lks14-lessonhead h2{margin:0 0 4px;font-size:16px}
.lks14-meta{font-size:12px;color:var(--dsw-alias-label-secondary);margin:2px 0}
.lks14-viewtabs{display:flex;gap:2px;margin:8px 0}
.lks14-viewtab{border:none;background:none;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12.5px;padding:4px 10px;border-radius:8px;cursor:pointer;display:inline-flex;align-items:center;gap:4px}
.lks14-viewtab:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-state-business-primary);outline:none}
.lks14-viewtab.on{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.lks14-prose{font-size:13.5px;line-height:1.7;color:var(--dsw-alias-label-primary);min-height:200px}
.lks14-prose h1,.lks14-prose h2,.lks14-prose h3{font-size:15px;margin:12px 0 4px}
.lks14-prose p{margin:6px 0}
.lks14-prose pre{overflow-x:auto;font-size:12px;background:var(--dsw-alias-bg-layer-1);border-radius:8px;padding:8px}
.lks14-prose code{font-family:var(--dsw-font-markdown-code);background:var(--dsw-alias-bg-layer-1);border-radius:4px;padding:1px 4px;font-size:.95em}
.lks14-prose table{border-collapse:collapse;margin:6px 0;display:block;max-width:100%;overflow-x:auto}
.lks14-prose th,.lks14-prose td{border:1px solid var(--dsw-alias-border-l2);padding:4px 8px;font-size:12.5px}
.lks14-prose svg{max-width:100%;height:auto}
.lks14-prose .katex-display{overflow-x:auto}
.lks14-zones{min-height:200px}
.lks14-zone{margin-bottom:12px}
.lks14-zoneh{font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-secondary);margin-bottom:6px}


/* toast capsules (P6, upstream Toast port): top-center under the panel head,
   container inert to pointers, items auto; exit is an animation handshake —
   reduced-motion keeps a .01ms duration so the end event still fires. */
.lks-toasts{position:absolute;top:44px;left:50%;transform:translateX(-50%);z-index:40;display:flex;flex-direction:column;align-items:center;gap:6px;pointer-events:none;max-width:min(440px,90%)}
.lks-toast{pointer-events:auto;display:flex;align-items:center;gap:8px;max-width:100%;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:6px 8px 6px 14px;font-size:13px;line-height:1.4;box-shadow:0 6px 24px rgba(0,0,0,.14);animation:lks-toast-in .18s ease}
.lks-toast.exiting{animation:lks-toast-out .18s ease forwards}
.lks-toast .lks-toast-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lks-toast .lks-toast-glyph{flex:none}
.lks-toast .lks-toast-glyph.ok{color:var(--lks-ok-ink)}
.lks-toast .lks-toast-glyph.warn{color:var(--lks-warn-ink)}
.lks-toast .lks-toast-glyph.err{color:var(--lks-err-ink)}
.lks-toast .lks-toast-glyph.info{color:var(--dsw-alias-state-business-primary)}
.lks-toast-action{border:none;background:none;color:var(--dsw-alias-state-business-primary);font-weight:600;font-size:13px;cursor:pointer;padding:4px 8px;border-radius:999px;flex:none}
.lks-toast-action:hover{background:var(--dsw-alias-interactive-bg-hover)}
.lks-toast-action:focus-visible,.lks-toast-close:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-state-business-primary);outline:none}
.lks-toast-close{border:none;background:none;color:var(--dsw-alias-label-tertiary);cursor:pointer;width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;font-size:15px;line-height:1;padding:0;flex:none}
.lks-toast-close:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}
@keyframes lks-toast-in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
@keyframes lks-toast-out{to{opacity:0;transform:translateY(-6px)}}
@media (prefers-reduced-motion:reduce){.lks-toast{animation-duration:.01ms}}


/* practice card (P1, upstream QuizArtifact port): chat column, below the stream */
.lks-qcard{flex:none;margin:2px 12px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:10px 12px;display:flex;flex-direction:column;gap:8px}
.lks-qcard-head{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.lks-qcard-count{margin-left:auto;font-weight:400;color:var(--dsw-alias-label-tertiary)}
.lks-qcard-q{display:flex;flex-direction:column;gap:6px}
.lks-qcard-prompt{font-size:13.5px;line-height:1.55;color:var(--dsw-alias-label-primary)}
.lks-qcard-opts{display:flex;flex-direction:column;gap:4px}
.lks-qcard-opt{text-align:left;font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:6px 10px;cursor:pointer}
.lks-qcard-opt:not(:disabled):hover{border-color:var(--dsw-alias-state-business-primary)}
.lks-qcard-opt:disabled{cursor:default}
.lks-qcard-opt.right{border-color:var(--dsw-alias-state-success-primary);color:var(--lks-ok-ink)}
.lks-qcard-opt.wrong{border-color:var(--dsw-alias-state-error-primary);color:var(--lks-err-ink)}
.lks-qcard-opt.dim{opacity:.75}
.lks-qcard-expl{font-size:12.5px;line-height:1.6;color:var(--dsw-alias-label-secondary);border-left:2px solid var(--dsw-alias-state-business-primary);padding-left:8px}
.lks-qcard-next{margin-top:2px;border:none;background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 86%,#000);color:#fff;font:inherit;font-size:12.5px;font-weight:600;border-radius:8px;padding:5px 14px;cursor:pointer}
.lks-qcard-next:hover{filter:brightness(1.1)}
.lks-qcard-review .lks-qcard-q.review{padding:6px 0;border-bottom:1px dashed var(--dsw-alias-border-l1)}
.lks-qcard-review .lks-qcard-q.review.wrong .lks-qcard-prompt{color:var(--lks-err-ink)}
.lks-qcard-ans{font-size:12.5px;color:var(--dsw-alias-label-secondary)}
.lks-qcard-actions{display:flex;flex-wrap:wrap;gap:6px}
.lks-qcard-action{display:inline-flex;align-items:center;gap:5px;font:inherit;font-size:12.5px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:4px 12px;cursor:pointer}
.lks-qcard-action:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l3)}

/* note cards (shared: panel notebook + settings-era shapes) */
.lks-note{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px 14px;margin-bottom:8px}
.lks-note .lks-note-src{float:right;font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.lks-note-del{float:right;clear:right;border:none;background:none;color:var(--dsw-alias-label-tertiary);cursor:pointer;padding:2px;border-radius:5px;line-height:0}
.lks-note-del:hover{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2)}
.lks-note-del.armed{color:#fff;background:var(--dsw-alias-state-error-primary)}
.lks-note .lks-note-title{font-weight:600;font-size:13px}
.lks-note .lks-note-text{margin-top:4px;font-size:13px;color:var(--dsw-alias-label-secondary);line-height:1.65}
.lks-note .lks-note-text p{margin:4px 0}
.lks-note .lks-note-text table{border-collapse:collapse;margin:6px 0;display:block;max-width:100%;overflow-x:auto}
.lks-note .lks-note-text th,.lks-note .lks-note-text td{border:1px solid var(--dsw-alias-border-l2);padding:4px 8px;font-size:12.5px}
.lks-note .lks-note-text code{font-family:var(--dsw-font-markdown-code);background:var(--dsw-alias-bg-layer-3);border-radius:4px;padding:1px 4px;font-size:.95em}
.lks-note .lks-note-q{margin-top:6px;color:var(--dsw-alias-label-tertiary);font-size:12px;border-left:2px solid var(--dsw-alias-state-warn-primary);padding-left:8px}

/* shared buttons + inline error text */
.lks-btn{display:inline-flex;align-items:center;gap:6px;border-radius:8px;padding:6px 14px;font-size:13.5px;font-weight:600;flex:none;font-family:var(--dsw-font-family);cursor:pointer}
.lks-btn:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-state-business-primary);outline:none}
.lks-btn.primary{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 86%,#000);color:#fff}
.lks-btn.primary:hover{filter:brightness(1.1)}
.lks-btn.primary:disabled{opacity:.5;cursor:default;filter:none}
.lks-btn.ghost{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l2)}
.lks-btn.ghost:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l3)}
.lks-propcard-err{color:var(--dsw-alias-state-error-primary);font-size:12px;margin-top:6px;flex:none}

/* read-aloud bar (notebook teach pane) + busy spinner */
@keyframes lks-spin{to{transform:rotate(360deg)}}
.lks-spin{animation:lks-spin .8s linear infinite}
.lks-readbar{display:flex;align-items:center;gap:6px;margin:0 0 8px;min-height:26px}
.lks-readbar .lks-btn{display:inline-flex;align-items:center;gap:4px}
.lks-readbar-cur{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;color:var(--dsw-alias-label-secondary);border-left:2px solid var(--dsw-alias-state-info-primary,var(--dsw-alias-business-primary));padding-left:8px}
.lks-readbar-notice{flex:none;font-size:11.5px;color:var(--dsw-alias-label-tertiary)}

/* concept map legend (amber = weak) */
.lks-cmap-legend{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--dsw-alias-label-secondary);margin-top:4px}
.lks-cmap-legend i{width:10px;height:10px;border-radius:3px;background:var(--dsw-alias-state-warn-tertiary,#fef5e7);border:1px solid var(--dsw-alias-state-warn-primary,#dd8629)}

/* settings section (settings.section entry inside the host settings shell) */
.lks-settings{display:flex;flex-direction:column;gap:18px;font-family:var(--dsw-font-family);color:var(--dsw-alias-label-primary)}
.lks-set-row h3{margin:0 0 4px;font-size:15px;font-weight:600}
.lks-set-hint{margin:0 0 10px;font-size:13px;color:var(--dsw-alias-label-secondary)}
.lks-set-state{margin-left:10px;font-size:13px;color:var(--dsw-alias-label-secondary)}
.lks-set-select{font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:5px 8px;max-width:100%}
.lks-set-stats{margin:0;padding-left:18px;font-size:14px;line-height:1.9}
.lks-set-path{font-family:var(--dsw-font-markdown-code);font-size:12.5px;background:var(--dsw-alias-bg-layer-3);border-radius:6px;padding:3px 8px;word-break:break-all}

/* soul pills (settings reuse) */
.lks-pills{display:inline-flex;align-items:center;height:28px}
.lks-pill{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border:none;border-radius:24px;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px;font-weight:500;transition:background .12s ease,color .12s ease;font-family:var(--dsw-font-family);cursor:pointer}
.lks-pill:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.lks-pill:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-state-business-primary);outline:none}
.lks-pill.on{background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-label-primary-bluish)}

/* composer dock status pill (conversation.composer.dock entry) */
.lks-dockpill{display:inline-flex;gap:10px;align-items:center;font-size:12px;color:var(--dsw-alias-label-secondary)}
.lks-dockseg{white-space:nowrap;display:inline-flex;align-items:center;gap:3px}
.lks-dock-due{color:var(--lks-warn-ink)}
.lks-dock-streak{color:var(--dsw-alias-state-business-primary)}
.lks-dockseg.lks-muted{color:var(--dsw-alias-label-secondary)}

/* keyed tool.call.toolview cards (conversation tab tool rows) */
.lks-tv{display:flex;flex-direction:column;gap:4px;padding:6px 10px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);font-size:13px}
.lks-tv.err{border-color:var(--dsw-alias-state-error-primary)}
.lks-tv-head{font-weight:600;color:var(--dsw-alias-label-secondary);font-size:12px}
.lks-tv-chip{align-self:flex-start;border-radius:999px;padding:2px 10px;font-size:12.5px;font-weight:600}
.lks-tv-chip.ok{background:var(--dsw-alias-state-success-tertiary);color:var(--lks-ok-ink)}
.lks-tv-chip.bad{background:var(--dsw-alias-state-error-tertiary);color:var(--lks-err-ink)}
.lks-tv-lines{display:flex;flex-direction:column;gap:4px}
.lks-tv-line{color:var(--dsw-alias-label-secondary);line-height:1.6;white-space:pre-wrap}
/* exam star card + the failure moment */
.lks-tv-stars{display:inline-flex;align-items:center;gap:5px;font-size:13px;font-weight:600;color:var(--lks-warn-ink)}
.lks-tv-stars .dim{opacity:.22}
.lks-tv-stars-label{font-weight:400;color:var(--dsw-alias-label-secondary)}
.lks-tv-failnote{margin-top:4px;font-size:12.5px;color:var(--dsw-alias-label-secondary);line-height:1.6}
`

/**
 * Inject the study stylesheet into `document.head` (idempotent).
 * @returns the stylesheet element (existing one when already injected).
 */
export function ensureStudyStyles(): HTMLStyleElement {
  const existing = document.head.querySelector(`style[${STYLE_ID}]`)
  if (existing !== null) return existing as HTMLStyleElement
  const style = document.createElement('style')
  style.setAttribute(STYLE_ID, '')
  style.textContent = STUDY_CSS
  document.head.appendChild(style)
  return style
}

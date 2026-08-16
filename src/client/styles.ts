/**
 * Style injection for the study tab: one `<style>` element of `.lks-*`
 * classes authored against the dsh `--dsw-*` design tokens, so the tab
 * follows the app's theme (light/dark) instead of carrying its own palette.
 * CSS Modules are unavailable to patch-layer bundles, so the stylesheet is
 * injected once at client-plugin apply; the `data-` attribute keeps the
 * injection idempotent.
 * @module dsh-plugin-lookatstudy/client/styles
 */

/** Marker attribute proving the stylesheet is already in the document. */
const STYLE_ID = 'data-dsh-plugin-lookatstudy'

/**
 * The study tab's stylesheet. Class names are `lks-*` namespaced; colors,
 * fonts, and radii come from `--dsw-*` tokens wherever the concept exists.
 */
const CSS = `
.lks-root{font-family:var(--dsw-font-family)}
.lks-root :where(button){font-family:var(--dsw-font-family);cursor:pointer;border:none;background:none;padding:0}
.lks-root :where(a){color:var(--dsw-alias-state-business-primary)}

/* ── the study tab: composer-width center, self-scrolling flanks ──
   data-conversation-composer-overlay (set on the root element) opts the
   view into the host's overlay mode: viewArea becomes a fixed-height
   non-growing host and the composer floats over the tab's bottom band, so
   the tab itself never feeds the page scroll. The bottom padding clears the
   floating composer via the host-published live --dsh-composer-height. The
   center strip reuses the conversation column's width axis
   (--dsh-composer-card-max-width inherits from ConversationRoot's root), so
   the tutor transcript is exactly as wide as the native composer; the
   flanking columns absorb the remaining width and scroll independently. */
.lks-study{height:100%;min-height:0;width:100%;box-sizing:border-box;overflow:hidden;display:flex;flex-direction:column;padding:10px 14px calc(var(--dsh-composer-height, 152px) + 12px);color:var(--dsw-alias-label-primary);container:lksstudy/inline-size}
/* Direction carrier (a container query cannot style the container itself). */
.lks-body{flex:1;min-height:0;min-width:0;display:flex;gap:16px}
.lks-col{display:flex;flex-direction:column;min-width:0}
.lks-colhead{flex:none;font-size:12px;font-weight:600;color:var(--dsw-alias-label-tertiary);letter-spacing:.06em;text-transform:uppercase;margin-bottom:10px}
.lks-col-rail{flex:1 1 0;min-width:190px;overflow-y:auto;padding:2px 6px}
.lks-col-tutor{flex:0 0 auto;width:min(100%,var(--dsh-composer-card-max-width,780px))}
.lks-col-bb{flex:1 1 0;min-width:230px;overflow-y:auto;padding:2px 6px}
/* narrow (<1220px): one composer-width pane at a time, chosen by a centered
   segmented pill group (joined buttons in one capsule — button language, not
   tab language, against the host's view tabs right above). */
.lks-switch{display:none;flex-direction:row;gap:2px;align-self:center;margin-bottom:10px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:3px}
.lks-switch-btn{border-radius:999px;padding:5px 18px;font-size:14px;color:var(--dsw-alias-label-tertiary);background:transparent;transition:background .12s ease,color .12s ease}
.lks-switch-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.lks-switch-btn.on{background:var(--dsw-alias-state-business-primary);color:#fff;font-weight:600}
@container lksstudy (max-width: 1220px){
  .lks-body{flex-direction:column}
  .lks-switch{display:flex}
  .lks-colhead{display:none}
  .lks-col{flex:1 1 auto;min-height:0;width:auto;overflow-y:auto}
  .lks-col-tutor{width:min(100%,var(--dsh-composer-card-max-width,780px));overflow:hidden;display:flex;flex-direction:column}
  .lks-study[data-pane='rail'] .lks-col-tutor,.lks-study[data-pane='rail'] .lks-col-bb,
  .lks-study[data-pane='tutor'] .lks-col-rail,.lks-study[data-pane='tutor'] .lks-col-bb,
  .lks-study[data-pane='bb'] .lks-col-rail,.lks-study[data-pane='bb'] .lks-col-tutor{display:none}
}

/* ── left column: course rail ── */
.lks-rail-head{display:flex;align-items:center;gap:6px;margin-bottom:4px}
.lks-rail-head .lks-rail-select{flex:1;min-width:0;margin-bottom:0}
.lks-rail-head .lks-btn{padding:3px 8px;font-size:13px}
.lks-rail-title{font-size:16px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lks-rail-sub{font-size:13px;color:var(--dsw-alias-label-tertiary);margin:4px 0 6px}
.lks-masterybar{height:5px;border-radius:3px;background:var(--dsw-alias-bg-layer-3);overflow:hidden;margin-bottom:8px}
.lks-masterybar i{display:block;height:100%;background:var(--dsw-alias-state-business-primary);transition:width .3s ease}
.lks-masterybar.gold i{background:var(--dsw-alias-state-warn-primary)}
.lks-search{width:100%;box-sizing:border-box;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:13.5px;padding:5px 9px;margin-bottom:4px}
.lks-search:focus{outline:none;border-color:var(--dsw-alias-state-business-primary)}
.lks-sec-num{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;border-radius:50%;background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-label);font-size:11px;font-weight:700;margin-right:4px}
.lks-tag.due{background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-label)}
.lks-import{margin-top:8px}
.lks-import .lks-inputrow{margin-top:0}
.lks-inputrow{display:flex;gap:8px;align-items:flex-end;flex:none;margin-top:8px}
.lks-input{flex:1;min-width:0;resize:none;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:14px;line-height:1.6;padding:8px 10px}
.lks-input:focus{outline:none;border-color:var(--dsw-alias-state-business-primary)}
.lks-input:disabled{opacity:.55}
.lks-import-hint{font-size:12.5px;color:var(--dsw-alias-label-tertiary);margin-top:6px;line-height:1.7}
.lks-duebox{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px 12px;margin:8px 0 14px;font-size:13.5px}
.lks-duebox .lks-due-item{color:var(--dsw-alias-label-secondary);margin-top:4px;display:flex;justify-content:space-between;gap:10px}
.lks-duebox .lks-over{color:var(--dsw-alias-state-warn-label);flex:none}

.lks-sec{font-size:12px;color:var(--dsw-alias-label-tertiary);text-transform:uppercase;letter-spacing:.05em;margin:14px 0 4px}
.lks-node{display:flex;align-items:center;gap:8px;padding:6px 9px;border-radius:8px;margin:1px 0;cursor:pointer}
.lks-node:hover{background:var(--dsw-alias-interactive-bg-hover)}
.lks-node.focus{background:var(--dsw-alias-bg-layer-3);outline:1px solid var(--dsw-alias-border-l2)}
.lks-node .lks-g{width:18px;text-align:center;flex:none}
.lks-node .lks-t{flex:1;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lks-node.locked{opacity:.45;cursor:not-allowed}
.lks-node.locked:hover{background:none}
.lks-tag{font-size:11px;border-radius:4px;padding:0 4px;flex:none}
.lks-tag.weak{background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-label)}
.lks-tag.fric{background:var(--dsw-alias-state-error-primary);color:#fff}
.lks-bar{width:44px;height:4px;border-radius:2px;background:var(--dsw-alias-bg-layer-3);overflow:hidden;flex:none}
.lks-bar i{display:block;height:100%;background:var(--dsw-alias-state-success-primary)}
.lks-pct{font-size:12px;color:var(--dsw-alias-label-tertiary);flex:none;width:32px;text-align:right}

.lks-empty{color:var(--dsw-alias-label-tertiary);text-align:center;padding:48px 8px;font-size:14px;line-height:2}
.lks-actbar{display:flex;flex-direction:row;justify-content:flex-end;flex:none;padding-bottom:8px}

/* ── middle column: the tutor ── */
.lks-transcript{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:10px;padding:4px 2px}
.lks-msg{max-width:94%;font-size:16px;line-height:1.7;border-radius:12px;padding:8px 12px;word-break:break-word}
.lks-msg.user{align-self:flex-end;white-space:pre-wrap;background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-label-primary-bluish)}
.lks-msg.assistant{align-self:flex-start;background:var(--dsw-alias-bg-layer-2)}
.lks-msg.streaming{opacity:.7}
.lks-msg.thinking{align-self:flex-start;display:inline-flex;align-items:center;gap:8px;font-size:13px;color:var(--dsw-alias-label-tertiary);background:none;border-radius:0;padding:2px}
.lks-msg.tool{align-self:flex-start;font-size:12px;color:var(--dsw-alias-label-tertiary);background:none;border-radius:0;padding:1px 2px}
.lks-msg.tool.ok{color:var(--dsw-alias-state-success-primary)}
.lks-msg.tool.bad{color:var(--dsw-alias-state-error-primary)}
.lks-msg.error{align-self:stretch;color:var(--dsw-alias-state-error-primary);font-size:13px;background:none;border-radius:0;padding:1px 2px}
/* quiz-taking surface: the tutor's A–D options become clickable answers on the last settled reply */
.lks-turn{display:flex;flex-direction:column;align-items:flex-start;max-width:94%}
.lks-quiz{display:flex;flex-direction:column;gap:6px;width:100%;margin:2px 0 4px}
.lks-opt{display:flex;align-items:baseline;gap:10px;text-align:left;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:10px;padding:8px 14px;font-size:14px;line-height:1.5;color:var(--dsw-alias-label-secondary);cursor:pointer;font-family:inherit;transition:border-color .12s ease,color .12s ease,background .12s ease}
.lks-opt:hover{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-state-business-tertiary)}
.lks-opt:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3);outline:none}
.lks-optletter{font-weight:700;color:var(--dsw-alias-label-primary-bluish);flex:none}

/* soul pills (native tool-row trigger language: 28px transparent, tinted active) */
.lks-pills{display:inline-flex;align-items:center;height:28px}
.lks-pill{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border:none;border-radius:24px;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px;font-weight:500;transition:background .12s ease,color .12s ease}
.lks-pill:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.lks-pill:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3);outline:none}
.lks-pill.on{background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-label-primary-bluish)}
.lks-pill.on:hover{background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-label-primary-bluish)}

/* ic_ds_* glyph carriers + busy spinner (native .8s linear spin) */
@keyframes lks-spin{to{transform:rotate(360deg)}}
.lks-spin{animation:lks-spin .8s linear infinite}

/* starter chips */
.lks-dock{display:flex;align-items:center;flex-wrap:wrap;gap:6px;padding:0 2px 6px;flex:none}
.lks-starter{border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:4px 12px;font-size:13px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);transition:border-color .12s ease,color .12s ease}
.lks-starter:hover{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary)}

/* proposal banner + shared buttons */
.lks-banner{display:flex;align-items:center;gap:10px;background:var(--dsw-alias-state-warn-tertiary);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px 14px;margin:8px 0;font-size:14px;flex:none}
.lks-banner .lks-why{flex:1;color:var(--dsw-alias-label-secondary)}
.lks-btn{display:inline-flex;align-items:center;gap:6px;border-radius:8px;padding:6px 14px;font-size:13.5px;font-weight:600;flex:none}
.lks-btn.primary{background:var(--dsw-alias-state-business-primary);color:#fff}
.lks-btn.primary:hover{filter:brightness(1.1)}
.lks-btn.primary:disabled{opacity:.5;cursor:default;filter:none}
.lks-btn.ghost{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l2)}
.lks-btn.ghost:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l3)}

/* ── right column: blackboard ── */
.lks-lessonhead h2{font-size:18px;margin:0 0 4px;font-weight:700}
.lks-lessonhead .lks-meta{color:var(--dsw-alias-label-tertiary);font-size:13px;margin-bottom:4px}
.lks-chips{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
.lks-chip{border-radius:999px;padding:2px 10px;font-size:12.5px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.lks-chip.weak{background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-label)}

/* rendered markdown (host-sanitized lesson bodies and assistant replies) */
.lks-prose{font-size:16px;line-height:1.75}
.lks-prose h1,.lks-prose h2,.lks-prose h3,.lks-prose h4{margin:14px 0 6px;line-height:1.4}
.lks-prose p{margin:6px 0}
.lks-prose pre{background:var(--dsw-alias-markdown-code-block);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px;overflow-x:auto;margin:8px 0;font-size:13.5px;font-family:var(--dsw-font-markdown-code-block-small)}
.lks-prose code{font-family:var(--dsw-font-markdown-code);background:var(--dsw-alias-bg-layer-3);border-radius:4px;padding:1px 5px;font-size:.92em}
.lks-prose pre code{background:none;padding:0}
.lks-prose table{border-collapse:collapse;margin:8px 0}
.lks-prose th,.lks-prose td{border:1px solid var(--dsw-alias-border-l2);padding:5px 11px;font-size:14px}
.lks-prose th{background:var(--dsw-alias-bg-layer-2)}
.lks-prose blockquote{border-left:3px solid var(--dsw-alias-state-business-primary);padding:2px 12px;color:var(--dsw-alias-label-secondary);margin:8px 0}
.lks-prose ul,.lks-prose ol{padding-left:22px;margin:6px 0}
.lks-prose img{max-width:100%}

/* Cornell notes zones */
.lks-bb-notes{margin-top:14px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l1)}
.lks-zone{margin-bottom:14px}
.lks-zone h4{font-size:14px;color:var(--dsw-alias-label-secondary);margin:0 0 8px;font-weight:600}
.lks-note{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px 14px;margin-bottom:8px}
.lks-note .lks-note-src{float:right;font-size:10px;color:var(--dsw-alias-label-tertiary)}
.lks-note .lks-note-title{font-weight:600;font-size:13px}
.lks-note .lks-note-text{margin-top:4px;white-space:pre-wrap;font-size:13px;color:var(--dsw-alias-label-secondary)}
.lks-note .lks-note-q{margin-top:6px;color:var(--dsw-alias-label-tertiary);font-size:12px;border-left:2px solid var(--dsw-alias-state-warn-primary);padding-left:8px}

/* inline error text (write-action failures) */
.lks-propcard-err{color:var(--dsw-alias-state-error-primary);font-size:12px;margin-top:6px;flex:none}
`

/**
 * Inject the study stylesheet into `document.head` (idempotent).
 * @returns the stylesheet element (existing one when already injected).
 */
export function ensureStudyStyles(): HTMLStyleElement {
  const existing = document.head.querySelector(`style[${STYLE_ID}]`)
  if (existing !== null) return existing
  const style = document.createElement('style')
  style.setAttribute(STYLE_ID, '')
  style.textContent = CSS
  document.head.appendChild(style)
  return style
}

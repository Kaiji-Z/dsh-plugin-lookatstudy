/**
 * The upstream LookatStudy skin (0.16.0 P9a) — the 1:1 visual port. Upstream
 * is a Duolingo-style dark-first design system defined in its tailwind.config
 * + index.css :root; this module carries those EXACT tokens (scoped to the
 * panel root `.lks-ui`) and redefines the panel's class vocabulary to match
 * upstream's components: the three-column surface ladder (rail darkest / chat
 * surface-1 / notebook surface-2, no borders — depth by color step), the
 * floating blur app-header, 3D push-down buttons, the claude.ai-style
 * composer capsule, chat bubbles, typing dots, and the toast capsules.
 * Host-chrome surfaces (dock pill, settings, toolviews) keep the dsw tokens —
 * only the study panel wears the upstream skin.
 * @module dsh-plugin-lookatstudy/client/upstream-theme
 */

export const UPSTREAM_CSS = `
/* ── upstream design tokens (index.css :root, verbatim values) ── */
.lks-ui{
  --brand:#58CC01;--brand-rgb:88 204 2;--brand-dark:#46A302;--brand-light:#7ED957;
  --brand-glow:#58CC0159;--brand-ring:#58CC0126;
  --accent:#1DB0F6;--accent-rgb:28 176 246;--accent-dark:#098CDC;--accent-light:#65C6FF;
  --accent-glow:#1DB0F64C;--accent-ring:#1DB0F626;
  --gold:#FFC801;--gold-rgb:255 200 0;--gold-dark:#D59800;--gold-light:#FFE294;
  --gold-glow:#FFC80173;--gold-ring:#FFC80133;
  --warning:#FF4B4B;--warning-rgb:255 75 75;--warning-dark:#D01C29;--warning-light:#FF7E77;
  --warning-glow:#FF4B4B4C;--warning-ring:#FF4B4B26;--warning-tint:#FF4B4B1A;--warning-tint-border:#FF4B4B40;
  --review:#FA6E1D;--review-rgb:255 122 26;--review-glow:#FA6E1D26;--review-tint:#FA6E1D1A;
  --exam:#A855F7;--exam-rgb:168 85 247;--exam-dark:#7E22CE;--exam-light:#C084FC;--exam-locked:#524569;
  --exam-glow:#A855F759;--exam-ring:#A855F726;
  --surface-rail:#08090B;--surface-rail-rgb:8 9 11;
  --surface-0:#0C0D0F;--surface-0-rgb:12 13 15;
  --surface-1:#111114;--surface-1-rgb:17 17 20;
  --surface-2:#1A1A1D;--surface-2-rgb:26 26 29;
  --surface-3:#2A2B2E;--surface-3-rgb:42 43 46;
  --ink:#F1F2F4;--ink-rgb:245 245 250;
  --ink-strong:#FAFAFA;--ink-strong-rgb:250 250 250;
  --ink-muted:#9D9EA2;--ink-muted-rgb:166 166 176;
  --ink-faint:#88898C;--ink-faint-rgb:136 137 140;
  --border:#252629;--border-rgb:37 38 41;--border-faint:#1A1A1D;--border-faint-rgb:26 26 29;
  --shadow-rgb:0 0 0;--inner-highlight:rgb(255 255 255/0.55);
  --ease-out-expo:cubic-bezier(0.16,1,0.3,1);
  --ease-out-back:cubic-bezier(0.34,1.2,0.64,1);
  --ease-spring:cubic-bezier(0.34,1.56,0.64,1);
  --ease-out-quart:cubic-bezier(0.25,1,0.5,1);
  font-family:'DIN Round',system-ui,-apple-system,sans-serif;
  background:var(--surface-1);color:var(--ink);
  font-feature-settings:'cv02','cv03','cv04','cv11';
  -webkit-font-smoothing:antialiased;
}
/* the six-step type scale (rem, follows the host base) */
.lks-ui .lks-t-caption{font-size:.75rem}.lks-ui .lks-t-label{font-size:.825rem}
.lks-ui .lks-t-body{font-size:.875rem}.lks-ui .lks-t-lead{font-size:1rem}
.lks-ui .lks-t-title{font-size:1.125rem}.lks-ui .lks-t-hero{font-size:1.5rem}

/* ── the column ladder: no borders, depth by surface step (v0.6) ── */
.lks-ui .lks14-rail{background:var(--surface-rail);border-right:none}
.lks-ui .lks14-chat{background:var(--surface-1);border-right:none}
.lks-ui .lks14-note{background:var(--surface-2)}
.lks-ui .lks14-colhead{color:var(--ink-muted);border-bottom:1px solid var(--border-faint);letter-spacing:.02em;text-transform:none;font-size:.825rem}

/* ── the floating app-header over the right half (blur + gradient fade) ── */
.lks-ui .lks14-appheader{position:relative;z-index:30;flex:none;display:flex;align-items:center;height:46px;padding:0 14px;gap:10px}
.lks-ui .lks14-appheader::before{content:'';position:absolute;inset:0;z-index:-1;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
  -webkit-mask:linear-gradient(to bottom,black 0%,black 65%,transparent 100%);mask:linear-gradient(to bottom,black 0%,black 65%,transparent 100%);
  background:linear-gradient(to bottom,rgb(var(--surface-1-rgb)/0.85) 0%,rgb(var(--surface-1-rgb)/0.55) 60%,rgb(var(--surface-1-rgb)/0.15) 85%,transparent 100%)}
.lks-ui .lks-hdr-title{flex:1;min-width:0;font-size:.825rem;font-weight:700;color:var(--ink-strong);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lks-ui .lks-hdr-xp{display:flex;align-items:center;gap:5px;flex:none}
.lks-ui .lks-hdr-xpbar{width:92px;height:10px;border-radius:999px;background:rgb(var(--ink-rgb)/0.08);overflow:hidden;box-shadow:inset 0 2px 3px rgb(var(--shadow-rgb)/0.3)}
.lks-ui .lks-hdr-xpbar i{display:block;height:100%;background:linear-gradient(90deg,var(--gold),var(--gold-light));border-radius:999px;transition:width .5s var(--ease-out-expo)}
.lks-ui .lks-hdr-stat{display:inline-flex;align-items:center;gap:4px;font-size:.825rem;font-weight:700;color:var(--ink);flex:none}
.lks-ui .lks-hdr-streak{color:var(--review)}

/* ── 3D push-down buttons (the signature style) ── */
.lks-ui .lks-btn{border-radius:1rem;font-weight:700;transition:all .15s var(--ease-spring)}
.lks-ui .lks-btn.primary{background:var(--brand);color:#fff;box-shadow:0 4px 0 0 var(--brand-dark)}
.lks-ui .lks-btn.primary:hover{background:var(--brand-light)}
.lks-ui .lks-btn.primary:active{transform:translateY(2px);box-shadow:0 1px 0 0 var(--brand-dark)}
.lks-ui .lks-btn.primary:disabled{background:rgb(var(--ink-rgb)/0.15);color:var(--ink-faint);box-shadow:none;transform:none;cursor:not-allowed}
.lks-ui .lks-btn.ghost{background:rgb(var(--ink-rgb)/0.06);color:var(--ink);border:none;box-shadow:0 3px 0 0 rgb(var(--shadow-rgb)/0.2)}
.lks-ui .lks-btn.ghost:hover{color:var(--ink-strong);background:rgb(var(--ink-rgb)/0.1)}
.lks-ui .lks-btn.ghost:active{transform:translateY(2px);box-shadow:0 1px 0 0 rgb(var(--shadow-rgb)/0.2)}

/* ── chat stream: bubbles + typing dots ── */
.lks-ui .lks14-msg-user{background:rgb(var(--ink-rgb)/0.04);border-radius:1rem 1rem .375rem 1rem;padding:.625rem 1rem;color:var(--ink-strong);animation:lks-msg-enter .2s var(--ease-out-expo)}
.lks-ui .lks14-msg-assistant{background:var(--surface-2);border:1px solid var(--border-faint);border-radius:1rem;padding:1rem;box-shadow:0 1px 3px -1px rgb(var(--shadow-rgb)/0.08);animation:lks-msg-enter .2s var(--ease-out-expo);font-size:.875rem;line-height:1.65}
.lks-ui .lks14-msg.streaming{opacity:1;border-style:dashed}
@keyframes lks-msg-enter{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.lks-ui .lks14-thinking{gap:5px}
@keyframes lks-typing-dot{0%,60%,100%{opacity:.3;transform:translateY(0)}30%{opacity:1;transform:translateY(-4px)}}
.lks-ui .lks14-thinking i{width:6px;height:6px;border-radius:999px;background:var(--brand);display:inline-block;animation:lks-typing-dot 1.2s ease-in-out infinite}
.lks-ui .lks14-thinking i:nth-child(2){animation-delay:.15s}
.lks-ui .lks14-thinking i:nth-child(3){animation-delay:.3s}
/* quiz options wear the neutral pill + brand hover */
.lks-ui .lks-qcard-opt{background:rgb(var(--ink-rgb)/0.05);border:2px solid transparent;border-radius:.75rem;color:var(--ink)}
.lks-ui .lks-qcard-opt:not(:disabled):hover{border-color:var(--brand)}
.lks-ui .lks-qcard-opt.right{border-color:var(--brand);color:var(--brand-light);background:rgb(var(--brand-rgb)/0.08)}
.lks-ui .lks-qcard-opt.wrong{border-color:var(--warning);color:var(--warning-light);background:var(--warning-tint)}
.lks-ui .lks-qcard-next{background:var(--brand);color:#fff;box-shadow:0 3px 0 0 var(--brand-dark);border-radius:1rem}
.lks-ui .lks-qcard-next:active{transform:translateY(2px);box-shadow:0 1px 0 0 var(--brand-dark)}
.lks-ui .lks-qcard-action{background:rgb(var(--ink-rgb)/0.06);border:none;color:var(--ink)}
.lks-ui .lks-qcard-action:hover{color:var(--ink-strong);background:rgb(var(--ink-rgb)/0.1)}

/* ── the composer capsule (claude.ai style) + circular 3D send ── */
.lks-ui .lks14-composer{border-top:none;background:linear-gradient(to bottom,transparent 0%,var(--surface-1) 40%)}
.lks-ui .lks14-composer-card{flex:1;display:flex;align-items:flex-end;gap:8px;background:rgb(var(--ink-rgb)/0.05);border-radius:1rem;padding:.625rem .75rem .5rem .875rem;transition:background .15s}
.lks-ui .lks14-composer-card:focus-within{background:rgb(var(--ink-rgb)/0.07)}
.lks-ui .lks14-composertext{background:transparent;border:none;box-shadow:none;color:var(--ink-strong);font-size:.875rem}
.lks-ui .lks14-composertext:focus{border-color:transparent}
.lks-ui .lks14-composertext::placeholder{color:var(--ink-faint)}
.lks-ui .lks-btn-send{width:36px;height:36px;border-radius:999px !important;padding:0 !important;display:inline-flex;align-items:center;justify-content:center;flex:none;background:var(--brand);color:#fff;box-shadow:0 3px 0 0 var(--brand-dark);border:none;cursor:pointer;transition:all .15s var(--ease-spring)}
.lks-ui .lks-btn-send:hover{background:var(--brand-light)}
.lks-ui .lks-btn-send:active{transform:translateY(2px);box-shadow:0 1px 0 0 var(--brand-dark)}
.lks-ui .lks-btn-send:disabled{background:rgb(var(--ink-rgb)/0.15);color:var(--ink-faint);box-shadow:none;transform:none;cursor:not-allowed}

/* ── toast capsules on the upstream tokens ── */
.lks-ui .lks-toast{background:var(--surface-0);color:var(--ink-strong);border:1px solid var(--border);box-shadow:0 8px 24px -4px rgb(var(--shadow-rgb)/0.18),0 2px 6px -2px rgb(var(--shadow-rgb)/0.12)}
.lks-ui .lks-toast .lks-toast-glyph.ok{color:var(--brand)}
.lks-ui .lks-toast .lks-toast-glyph.warn{color:var(--gold)}
.lks-ui .lks-toast .lks-toast-glyph.err{color:var(--warning)}
.lks-ui .lks-toast .lks-toast-glyph.info{color:var(--accent)}
.lks-ui .lks-toast-action{color:var(--brand)}

/* ── rail: signpost section heads + due box ── */
.lks-ui .lks14-sechead{background:rgb(var(--surface-rail-rgb)/0.55);backdrop-filter:blur(7px);-webkit-backdrop-filter:blur(7px);border:1px solid rgb(var(--gold-rgb)/0.18);border-top-color:rgb(var(--gold-rgb)/0.35);border-radius:.75rem;padding:7px 10px;margin:12px 0 6px;box-shadow:0 2px 8px rgb(var(--shadow-rgb)/0.35),inset 0 1px 0 rgb(255 255 255/0.06);color:var(--gold-light)}
.lks-ui .lks14-secnum{background:rgb(var(--gold-rgb)/0.15);color:var(--gold-light)}
.lks-ui .lks14-node{color:var(--ink);border-radius:.75rem}
.lks-ui .lks14-node:hover{background:rgb(var(--ink-rgb)/0.05)}
.lks-ui .lks14-node.focus{background:rgb(var(--accent-rgb)/0.1);outline:1px solid rgb(var(--accent-rgb)/0.25)}
.lks-ui .lks14-node[aria-disabled='true']{color:var(--ink-faint)}
.lks-ui .lks14-search,.lks-ui .lks-set-select{background:rgb(var(--ink-rgb)/0.05);border:1px solid var(--border-faint);color:var(--ink-strong)}
.lks-ui .lks14-search:focus{border-color:var(--accent)}
.lks-ui .lks14-duebox{background:var(--review-tint);border:1px solid rgb(var(--review-rgb)/0.25);color:var(--ink)}
.lks-ui .lks14-over{color:var(--warning-light)}
.lks-ui .lks14-tag.weak{color:var(--gold-light)}
.lks-ui .lks14-masterybar{background:rgb(var(--ink-rgb)/0.08)}
.lks-ui .lks14-masterybar i{background:var(--gold)}
.lks-ui .lks14-bar{background:rgb(var(--ink-rgb)/0.08)}
.lks-ui .lks14-bar i{background:var(--gold)}
.lks-ui .lks14-pill{color:var(--ink-muted);border-radius:999px}
.lks-ui .lks14-pill.on{background:rgb(var(--accent-rgb)/0.12);color:var(--accent-light)}

/* ── notebook: teach prose + view tabs ── */
.lks-ui .lks14-viewtab{color:var(--ink-muted);border-radius:999px}
.lks-ui .lks14-viewtab.on{background:rgb(var(--ink-rgb)/0.08);color:var(--ink-strong)}
.lks-ui .lks14-prose{color:var(--ink);font-size:.9375rem;line-height:1.65}
.lks-ui .lks14-prose h1,.lks-ui .lks-note-text h1{font-size:1.25rem;font-weight:800;color:var(--ink-strong)}
.lks-ui .lks14-prose h2,.lks-ui .lks-note-text h2{font-size:1.1rem;font-weight:700;color:var(--ink-strong);border-bottom:1px solid var(--border);padding-bottom:.3em}
.lks-ui .lks14-prose h3,.lks-ui .lks-note-text h3{font-size:1rem;font-weight:700;color:var(--ink)}
.lks-ui .lks14-prose pre,.lks-ui .lks-note-text pre{background:var(--surface-0);border:1px solid var(--border);color:var(--ink)}
.lks-ui .lks14-prose code,.lks-ui .lks-note-text code{background:rgb(var(--surface-3-rgb)/0.6);color:var(--accent-light)}
.lks-ui .lks14-prose blockquote{border-left:3px solid var(--accent);background:rgb(var(--accent-rgb)/0.06);color:var(--ink-muted)}
.lks-ui .lks14-prose table thead{border-bottom:2px solid var(--brand)}
.lks-ui .lks14-prose th{color:var(--ink-strong)}
.lks-ui .lks14-prose tbody tr:nth-child(odd){background:rgb(var(--surface-3-rgb)/0.3)}
.lks-ui .lks14-prose td,.lks-ui .lks14-prose th{border-color:var(--border)}
.lks-ui .lks-note{background:var(--surface-1);border:1px solid var(--border-faint)}
.lks-ui .lks-note .lks-note-q{border-left-color:var(--gold)}
.lks-ui .lks14-zoneh{color:var(--ink-muted)}
.lks-ui mark.lks-hl{background:rgb(var(--gold-rgb)/0.25);border-bottom:2px solid var(--gold)}

/* ── artifact + rate + proposal cards on surface-card language ── */
.lks-ui .lks-acard,.lks-ui .lks-qcard{background:var(--surface-2);border:1px solid var(--border-faint);border-radius:1rem;box-shadow:0 1px 3px -1px rgb(var(--shadow-rgb)/0.08)}
.lks-ui .lks-acard-head,.lks-ui .lks-qcard-head{color:var(--ink-muted)}
.lks-ui .lks-acard-table th{background:transparent;border-bottom:2px solid var(--brand);color:var(--ink-strong)}
.lks-ui .lks-acard-table td{border-bottom:1px solid var(--border)}
.lks-ui .lks-acard-code{background:var(--surface-0);border:1px solid var(--border)}
.lks-ui .lks-acard-line i{color:var(--ink-faint)}
.lks-ui .lks-acard-note{border-left-color:var(--accent);color:var(--ink-muted)}
.lks-ui .lks-acard-modal-body{background:var(--surface-0);border-color:var(--border)}
.lks-ui .lks-acard-guess-opt{background:rgb(var(--ink-rgb)/0.05);border:2px solid transparent;color:var(--ink)}
.lks-ui .lks-acard-guess-opt:not(:disabled):hover{border-color:var(--accent)}
.lks-ui .lks-acard-guess-opt.picked{border-color:var(--accent);background:rgb(var(--accent-rgb)/0.1);color:var(--accent-light)}
.lks-ui .lks-ratecard{background:rgb(var(--review-rgb)/0.08);border:1px solid rgb(var(--review-rgb)/0.25)}
.lks-ui .lks-ratecard-title{color:var(--ink-strong)}
.lks-ui .lks-ratecard-opt{background:rgb(var(--ink-rgb)/0.05);border:2px solid transparent;color:var(--ink)}
.lks-ui .lks-ratecard-opt:not(:disabled):hover{border-color:var(--brand)}
.lks-ui .lks-ratecard-opt.best{background:var(--gold);color:#3A2E00;box-shadow:0 3px 0 0 var(--gold-dark);border-color:transparent}
.lks-ui .lks-ratecard-opt.best:active{transform:translateY(2px);box-shadow:0 1px 0 0 var(--gold-dark)}
.lks-ui .lks-propbanner{background:rgb(var(--gold-rgb)/0.06);border:1px solid rgb(var(--gold-rgb)/0.3);color:var(--ink)}
.lks-ui .lks-viewtab-badge{background:var(--brand);color:#fff}

/* ── the empty states + readbar + switcher ── */
.lks-ui .lks14-empty{color:var(--ink-muted)}
.lks-ui .lks-readbar-cur{border-left-color:var(--accent);color:var(--ink-muted)}
.lks-ui .lks14-switch{background:rgb(var(--ink-rgb)/0.06);border:1px solid var(--border-faint)}
.lks-ui .lks14-switch-btn.on{background:var(--brand);color:#fff}
.lks-ui .lks14-searchpanel{background:var(--surface-0);border:1px solid var(--border);box-shadow:0 8px 24px -4px rgb(var(--shadow-rgb)/0.18)}
.lks-ui .lks14-searchrow:hover{background:rgb(var(--ink-rgb)/0.05)}
.lks-ui .lks14-searchrow-snip{color:var(--ink-muted)}
.lks-ui .lks-propcard-err{color:var(--warning-light)}
.lks-ui .lks14-thinking{color:var(--ink-muted)}

/* ══════════ P9b: the balloon course map (upstream v0.28 MapRail, static path) ══════════ */
.lks-ui{--exam-locked-mix:#A7A2B2}
/* the sky: upstream's canvas presets reduced to layered gradients (essence port;
   deterministic per-course via pickSky) */
.lks-ui .lks-map{position:relative;min-height:100%;background-repeat:no-repeat}
.lks-ui .lks-sky-day{background-image:
  radial-gradient(1.5px 1.5px at 18% 12%,rgb(255 255 255/0.5),transparent 100%),
  radial-gradient(1px 1px at 64% 8%,rgb(255 255 255/0.35),transparent 100%),
  radial-gradient(1px 1px at 82% 22%,rgb(255 255 255/0.3),transparent 100%),
  radial-gradient(120px 60px at 78% 6%,rgb(124 172 255/0.08),transparent 100%),
  linear-gradient(to bottom,#16233F 0%,#0F1B33 55%,var(--surface-rail) 100%)}
.lks-ui .lks-sky-dusk{background-image:
  radial-gradient(1.5px 1.5px at 24% 10%,rgb(255 255 255/0.45),transparent 100%),
  radial-gradient(1px 1px at 70% 16%,rgb(255 255 255/0.3),transparent 100%),
  radial-gradient(140px 70px at 22% 10%,rgb(255 160 90/0.07),transparent 100%),
  linear-gradient(to bottom,#2A2140 0%,#1D1A38 50%,var(--surface-rail) 100%)}
.lks-ui .lks-sky-night{background-image:
  radial-gradient(1.5px 1.5px at 12% 18%,rgb(255 255 255/0.55),transparent 100%),
  radial-gradient(1px 1px at 38% 6%,rgb(255 255 255/0.4),transparent 100%),
  radial-gradient(1px 1px at 58% 24%,rgb(255 255 255/0.35),transparent 100%),
  radial-gradient(1.5px 1.5px at 88% 10%,rgb(255 255 255/0.5),transparent 100%),
  radial-gradient(1px 1px at 76% 30%,rgb(255 255 255/0.3),transparent 100%),
  radial-gradient(90px 90px at 84% 8%,rgb(200 214 255/0.06),transparent 100%),
  linear-gradient(to bottom,#0B1024 0%,#0A0D1C 55%,var(--surface-rail) 100%)}
.lks-ui .lks-mapsec{padding:12px 8px 4px}
/* the signpost (map-signpost verbatim): frosted board with a gold rim */
.lks-ui .lks-signpost{display:flex;align-items:center;gap:8px;width:100%;padding:6px 10px;border-radius:8px;font:inherit;cursor:pointer;text-align:left;
  background:rgb(var(--surface-rail-rgb)/0.55);backdrop-filter:blur(7px);-webkit-backdrop-filter:blur(7px);
  border:1px solid rgb(var(--gold-rgb)/0.18);border-top-color:rgb(var(--gold-rgb)/0.35);
  box-shadow:0 2px 8px rgb(var(--shadow-rgb)/0.35),inset 0 1px 0 rgb(255 255 255/0.06)}
.lks-ui .lks-signpost-num{width:24px;height:24px;border-radius:999px;background:var(--gold);color:#201500;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;flex:none;box-shadow:0 0 0 2px rgb(var(--gold-rgb)/0.4)}
.lks-ui .lks-signpost-title{flex:1;font-size:12.5px;font-weight:700;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-shadow:0 1px 2px rgba(0,0,0,0.7)}
.lks-ui .lks-signpost-caret{color:rgb(var(--ink-rgb)/0.5);font-size:10px}
.lks-ui .lks-mapfield{position:relative}
.lks-ui .lks-mapropes{position:absolute;inset:0;width:100%;pointer-events:none;overflow:visible}
.lks-ui .lks-mapnode{position:absolute;width:110px;display:flex;flex-direction:column;align-items:center;
  animation:lks-balloon-bob var(--bob-duration,6s) ease-in-out infinite;animation-delay:var(--bob-delay,0s)}
@keyframes lks-balloon-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
@keyframes lks-path-draw{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}
@media (prefers-reduced-motion: reduce){.lks-ui .lks-mapnode{animation:none}.lks-ui .lks-bubble-available{animation:none}}
/* the bubbles (lesson-bubble verbatim): 3D sphere lighting + ::before inner highlight */
.lks-ui .lks-bubble{position:relative;width:56px;height:56px;border-radius:999px;border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;transition:all .2s var(--ease-out-back);background-position:30% 25%}
.lks-ui .lks-bubble::before{content:'';position:absolute;top:12%;left:22%;width:38%;height:28%;border-radius:50%;
  background:radial-gradient(ellipse at center,var(--inner-highlight) 0%,rgb(255 255 255/0) 70%);pointer-events:none;z-index:1}
.lks-ui .lks-bubble[aria-disabled='true']{cursor:not-allowed}
.lks-ui .lks-bubble.selected{outline:4px solid var(--accent);outline-offset:3px}
.lks-ui .lks-bubble-glyph{position:relative;z-index:2;color:#fff;display:inline-flex;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.4))}
.lks-ui .lks-bubble-glyph.dim{opacity:.5}
.lks-ui .lks-bubble-ring{position:absolute;inset:0;width:100%;height:100%;transform:rotate(-90deg);pointer-events:none}
.lks-ui .lks-bubble-due{position:absolute;top:-4px;right:-4px;width:16px;height:16px;border-radius:999px;background:var(--review);color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 2px var(--surface-rail);z-index:3}
.lks-ui .lks-bubble-name{margin-top:4px;max-width:120px;font-size:11px;font-weight:700;color:#fff;background:rgb(var(--brand-rgb)/0.9);padding:2px 6px;border-radius:6px;text-align:center;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* locked: heavy sunken stone */
.lks-ui .lks-bubble-locked{background:radial-gradient(circle at 35% 30%,var(--surface-3) 0%,var(--surface-2) 60%,var(--surface-1) 100%);
  box-shadow:inset 0 3px 6px rgb(var(--shadow-rgb)/0.5),inset 0 -2px 4px rgb(255 255 255/0.04),0 2px 4px rgb(var(--shadow-rgb)/0.3)}
.lks-ui .lks-bubble-locked::before{background:radial-gradient(ellipse at center,rgb(255 255 255/0.12) 0%,rgb(255 255 255/0) 70%)}
/* available: bright glowing sphere, your move */
.lks-ui .lks-bubble-available{background:radial-gradient(circle at 32% 28%,var(--brand-light) 0%,var(--brand) 45%,var(--brand-dark) 100%);
  box-shadow:0 0 0 4px var(--brand-ring),0 0 16px var(--brand-glow),0 4px 10px rgb(var(--shadow-rgb)/0.25)}
.lks-ui .lks-bubble-available:hover{transform:translateY(-3px) scale(1.03);
  box-shadow:0 0 0 5px rgb(var(--brand-rgb)/0.2),0 0 22px rgb(var(--brand-rgb)/0.5),0 6px 14px rgb(var(--shadow-rgb)/0.3)}
.lks-ui .lks-bubble-available:active{transform:translateY(2px) scale(0.97);
  box-shadow:0 0 0 3px var(--brand-ring),0 0 10px rgb(var(--brand-rgb)/0.3),0 2px 6px rgb(var(--shadow-rgb)/0.2)}
@keyframes lks-bubble-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.04)}}
.lks-ui .lks-bubble-available{animation:lks-bubble-pulse 2.4s ease-in-out infinite}
/* in_progress: blue in motion */
.lks-ui .lks-bubble-in-progress{background:radial-gradient(circle at 32% 28%,var(--accent-light) 0%,var(--accent) 45%,var(--accent-dark) 100%);
  box-shadow:0 0 0 4px var(--accent-ring),0 0 14px var(--accent-glow),0 4px 10px rgb(var(--shadow-rgb)/0.25)}
.lks-ui .lks-bubble-in-progress:hover{transform:translateY(-2px) scale(1.03);
  box-shadow:0 0 0 5px rgb(var(--accent-rgb)/0.2),0 0 20px rgb(var(--accent-rgb)/0.45),0 6px 14px rgb(var(--shadow-rgb)/0.3)}
/* mastered: gold crown halo, scaled up */
.lks-ui .lks-bubble-mastered{background:radial-gradient(circle at 32% 28%,var(--gold-light) 0%,var(--gold) 45%,var(--gold-dark) 100%);
  box-shadow:0 0 0 4px var(--gold-ring),0 0 22px var(--gold-glow),0 0 40px rgb(var(--gold-rgb)/0.15),0 4px 12px rgb(var(--shadow-rgb)/0.25);transform:scale(1.1)}
.lks-ui .lks-bubble-mastered::before{background:radial-gradient(ellipse at center,rgb(255 255 255/0.7) 0%,rgb(255 255 255/0) 70%)}
.lks-ui .lks-bubble-mastered:hover{transform:scale(1.13) translateY(-2px);
  box-shadow:0 0 0 5px rgb(var(--gold-rgb)/0.25),0 0 28px rgb(var(--gold-rgb)/0.55),0 0 50px rgb(var(--gold-rgb)/0.2),0 6px 16px rgb(var(--shadow-rgb)/0.3)}
/* exam: the section boss */
.lks-ui .lks-exam{background:radial-gradient(circle at 32% 28%,var(--exam-light) 0%,var(--exam) 45%,var(--exam-dark) 100%);
  box-shadow:0 0 0 4px var(--exam-ring),0 0 16px var(--exam-glow),0 4px 10px rgb(var(--shadow-rgb)/0.25)}
.lks-ui .lks-exam-locked{background:radial-gradient(circle at 35% 30%,var(--exam-locked) 0%,var(--exam-locked-mix) 60%,var(--surface-1) 100%);
  box-shadow:inset 0 3px 6px rgb(var(--shadow-rgb)/0.5),inset 0 -2px 4px rgb(255 255 255/0.04),0 2px 4px rgb(var(--shadow-rgb)/0.3)}
.lks-ui .lks-exam-passed{background:radial-gradient(circle at 32% 28%,rgb(var(--exam-light-rgb,192 132 252)) 0%,var(--exam-light) 40%,var(--exam) 100%);
  box-shadow:0 0 0 4px var(--gold-ring),0 0 18px var(--exam-glow),0 0 28px rgb(var(--gold-rgb)/0.15),0 4px 12px rgb(var(--shadow-rgb)/0.25)}
/* the floating rail head card (upstream map-header card) */
.lks-ui .lks14-railhead{background:rgb(var(--surface-rail-rgb)/0.55);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid rgb(255 255 255/0.06);border-radius:12px;padding:8px 10px}
.lks-ui .lks14-railtitle{color:#fff;font-weight:800;font-size:.875rem;text-shadow:0 1px 3px rgba(0,0,0,0.6)}
.lks-ui .lks14-railsub{color:rgb(var(--ink-rgb)/0.6)}
.lks-ui .lks14-masterybar{height:10px;background:rgb(0 0 0/0.4);border-radius:999px;box-shadow:inset 0 0 0 1px rgb(255 255 255/0.1);overflow:hidden}
.lks-ui .lks14-masterybar i{background:var(--brand)}
.lks-ui .lks14-masterybar.gold i{background:var(--gold)}
.lks-ui .lks14-search{background:rgb(0 0 0/0.25);border:1px solid rgb(255 255 255/0.15);color:var(--ink-strong);border-radius:10px}
.lks-ui .lks14-search:focus{border-color:var(--brand);outline:none}
.lks-ui .lks14-search::placeholder{color:rgb(var(--ink-rgb)/0.35)}
`

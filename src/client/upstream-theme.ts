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

/* ══════════ A-track (P10a): island zeroing — the 27+6 un-skinned leftovers ══════════ */
/* buttons reset to UA buttontext/buttonface (black/light) — the panel's ink must flow through */
.lks-ui button{color:inherit;background-color:transparent;border-color:transparent}
/* A6 token completion: rgb-channel companions + concept-map palette (upstream :root) */
.lks-ui{--brand-dark-rgb:70 163 2;--brand-light-rgb:126 217 87;
  --accent-dark-rgb:10 140 220;--accent-light-rgb:94 212 255;
  --gold-dark-rgb:217 158 0;--gold-light-rgb:255 230 128;
  --warning-dark-rgb:230 43 43;--warning-light-rgb:255 117 117;
  --exam-dark-rgb:126 34 206;--exam-light-rgb:192 132 252;
  --cm-c0-fill:#1C3352;--cm-c0-line:#6F9FD4;--cm-c1-fill:#1F3A29;--cm-c1-line:#7FB37F;
  --cm-c2-fill:#42301A;--cm-c2-line:#CFA05E;--cm-c3-fill:#3D3620;--cm-c3-line:#CBB75E;
  --cm-c4-fill:#33294A;--cm-c4-line:#A48DCB}
/* A1 in-chat quiz options (click = send answer; neutral pill, hover brand) */
.lks-ui .lks14-opt{background:rgb(var(--ink-rgb)/0.05);border:2px solid transparent;color:var(--ink)}
.lks-ui .lks14-opt:hover{border-color:var(--brand);background:rgb(var(--ink-rgb)/0.05)}
.lks-ui .lks14-optletter{color:var(--brand-light)}
.lks-ui .lks14-starter{background:transparent;border:1px solid var(--border-faint);color:var(--ink-muted)}
.lks-ui .lks14-starter:hover{background:rgb(var(--ink-rgb)/0.06);color:var(--ink);border-color:var(--border)}
.lks-ui .lks14-chatlesson{color:var(--ink-muted)}
.lks-ui .lks14-meta{color:var(--ink-muted)}
.lks-ui .lks14-dueitem{color:var(--ink-muted)}
.lks-ui .lks14-hint{color:var(--ink-faint)}
.lks-ui .lks-readbar-notice{color:var(--ink-faint)}
.lks-ui .lks-cmap-legend{color:var(--ink-muted)}
/* A2 quiz-card body family */
.lks-ui .lks-qcard-prompt{color:var(--ink)}
.lks-ui .lks-qcard-count{color:var(--ink-faint)}
.lks-ui .lks-qcard-ans{color:var(--ink-faint)}
.lks-ui .lks-qcard-expl{color:var(--ink-muted);border-left-color:var(--accent)}
.lks-ui .lks-qcard-prompt.review.wrong{color:var(--warning-light)}
.lks-ui .lks-qcard-q.review{border-bottom-color:var(--border)}
/* A2 artifact bits */
.lks-ui .lks-acard-expand{color:var(--ink-faint);border:none;background:none}
.lks-ui .lks-acard-expand:hover{color:var(--ink);background:rgb(var(--ink-rgb)/0.06)}
.lks-ui .lks-acard-modal-title{color:var(--ink-strong)}
.lks-ui .lks-acard-guess-prompt{color:var(--ink)}
.lks-ui .lks-acard-guess-wait{color:var(--ink-faint)}
.lks-ui .lks-acard-note b{color:var(--ink-strong)}
.lks-ui .lks-acard-stage{border-top-color:var(--border)}
/* A2 note family */
.lks-ui .lks-note-text{color:var(--ink-muted)}
.lks-ui .lks-note-text th,.lks-ui .lks-note-text td{border-color:var(--border)}
.lks-ui .lks-note-src{color:var(--ink-faint)}
.lks-ui .lks-note-del{color:var(--ink-faint)}
.lks-ui .lks-note-del:hover{color:var(--warning-light);background:rgb(var(--warning-rgb)/0.08)}
.lks-ui .lks-note-del.armed{color:#fff;background:var(--warning)}
.lks-ui .lks-note-q{color:var(--ink-muted)}
.lks-ui .lks-note-title{color:var(--ink-strong)}
/* A3 selection popover → surface-0 floating card */
.lks-ui .lks-quote-btn{background:var(--surface-0);border:1px solid var(--border);box-shadow:0 4px 12px -2px rgb(var(--shadow-rgb)/0.14),0 1px 3px -1px rgb(var(--shadow-rgb)/0.08);border-radius:10px;overflow:hidden;animation:lks-confirm-enter 160ms var(--ease-out-back)}
.lks-ui .lks-quote-btn button{color:var(--ink)}
.lks-ui .lks-quote-btn button:hover{background:rgb(var(--ink-rgb)/0.06)}
.lks-ui .lks-quote-btn button + button{border-left-color:var(--border)}
/* A4 prose links / markers / strong / hr */
.lks-ui .lks14-prose a,.lks-ui .lks-note-text a{color:rgb(var(--accent-rgb));text-decoration:none;font-weight:500}
.lks-ui .lks14-prose a:hover,.lks-ui .lks-note-text a:hover{text-decoration:underline}
.lks-ui .lks14-prose li::marker,.lks-ui .lks-note-text li::marker{color:rgb(var(--brand-rgb))}
.lks-ui .lks14-prose strong,.lks-ui .lks-note-text strong{color:var(--ink-strong)}
.lks-ui .lks14-prose hr,.lks-ui .lks-note-text hr{border-color:var(--border)}
/* A8 table borders inside bubbles/cards/notes */
.lks-ui .lks14-msg-assistant th,.lks-ui .lks14-msg-assistant td{border-color:var(--border)}
.lks-ui .lks-acard-table th,.lks-ui .lks-acard-table td{border-color:var(--border)}
.lks-ui .lks-acard-table th{border-bottom-color:var(--brand)}
/* A5 scoped scrollbar (host-light chrome otherwise scrolls inside dark columns) */
.lks-ui ::-webkit-scrollbar{width:8px;height:8px}
.lks-ui ::-webkit-scrollbar-track{background:transparent}
.lks-ui ::-webkit-scrollbar-thumb{background:var(--border);border-radius:9999px;border:2px solid transparent;background-clip:padding-box}
.lks-ui ::-webkit-scrollbar-thumb:hover{background:var(--surface-3);background-clip:padding-box}
/* A7 feedback/ambient animations (upstream values verbatim) */
@keyframes lks-crown-sparkle{0%,100%{transform:scale(1);filter:drop-shadow(0 0 0 var(--gold))}50%{transform:scale(1.08);filter:drop-shadow(0 0 6px var(--gold-glow))}}
.lks-ui .lks-bubble-mastered .lks-bubble-glyph{animation:lks-crown-sparkle 1.6s ease-in-out infinite;display:inline-flex}
@keyframes lks-energy-breathe{0%,100%{opacity:.78;filter:drop-shadow(0 0 0 var(--gold))}50%{opacity:1;filter:drop-shadow(0 0 4px var(--gold-glow))}}
@keyframes lks-flame-flicker{0%,100%{transform:scale(1) rotate(-2deg)}25%{transform:scale(1.06) rotate(1deg)}50%{transform:scale(.97) rotate(-1deg)}75%{transform:scale(1.04) rotate(2deg)}}
.lks-ui .lks-hdr-xp .lks-hdr-glyph{display:inline-flex;animation:lks-energy-breathe 2s ease-in-out infinite}
.lks-ui .lks-hdr-streak .lks-hdr-glyph{display:inline-flex;animation:lks-flame-flicker 1.2s ease-in-out infinite}
@keyframes lks-answer-correct{0%{transform:scale(1)}40%{transform:scale(1.05)}100%{transform:scale(1)}}
@keyframes lks-answer-wrong{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-3px)}40%,80%{transform:translateX(3px)}}
.lks-ui .lks-qcard-opt.right{animation:lks-answer-correct 350ms var(--ease-spring)}
.lks-ui .lks-qcard-opt.wrong{animation:lks-answer-wrong 320ms ease-in-out}
@keyframes lks-confirm-enter{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}
/* A7 toast enter/exit at upstream values (replaces the base sheet's simplified pair) */
@keyframes lks-toast-in-up{from{opacity:0;transform:translateY(-12px) scale(.96)}to{opacity:1;transform:translateY(0) scale(1)}}
@keyframes lks-toast-out-up{from{opacity:1;transform:translateY(0) scale(1)}to{opacity:0;transform:translateY(-8px) scale(.97)}}
.lks-ui .lks-toast{animation:lks-toast-in-up 220ms var(--ease-out-back)}
.lks-ui .lks-toast.exiting{animation:lks-toast-out-up 180ms var(--ease-out-quart) forwards}
.lks-ui .lks-toast-close{color:var(--ink-faint)}
.lks-ui .lks-toast-close:hover{color:var(--ink);background:rgb(var(--ink-rgb)/0.08)}
/* search rows: complete the half-covered pair */
.lks-ui .lks14-searchrow{border-bottom-color:var(--border)}
.lks-ui .lks14-searchrow-title{color:var(--ink-strong)}
.lks-ui .lks14-searchrow-course{color:var(--ink-faint)}

/* ══════════ B-track (P10b): the upstream rail frame + column skeletons ══════════ */
/* the floating topbar (absolute over the scrolling panes) */
.lks-ui .lks14-railtop{position:absolute;top:0;left:0;right:0;z-index:40;padding:8px;pointer-events:none}
.lks-ui .lks-railtabs,.lks-ui .lks14-railhead{pointer-events:auto}
.lks-ui .lks-railtabs{display:flex;padding:4px;border-radius:10px;gap:4px;margin-bottom:8px;
  background:rgb(var(--surface-rail-rgb)/0.55);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px)}
.lks-ui .lks-railtab{flex:1;display:flex;align-items:center;justify-content:center;padding:6px 0;border-radius:8px;
  font-size:12.5px;font-weight:700;color:rgb(255 255 255/0.5)}
.lks-ui .lks-railtab.on{background:rgb(var(--brand-rgb)/0.2);color:var(--brand)}
/* the glass title card: title row / mastery row / entry pills row */
.lks-ui .lks14-railhead{display:flex;flex-direction:column;gap:6px}
.lks-ui .lks14-railcard-row{display:flex;align-items:center;gap:8px}
.lks-ui .lks14-railpct{flex:none;font-size:12px;font-weight:800;color:#fff;font-variant-numeric:tabular-nums;text-shadow:0 1px 3px rgba(0,0,0,0.6)}
.lks-ui .lks14-masterybar{flex:1}
.lks-ui .lks-railpill{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:999px;
  background:rgb(255 255 255/0.05);box-shadow:inset 0 0 0 1px rgb(255 255 255/0.1);color:rgb(var(--ink-rgb)/0.6);font-size:11px;font-weight:700}
.lks-ui .lks-railpill:hover{background:rgb(255 255 255/0.1)}
.lks-ui .lks-railpill.due{background:rgb(var(--review-rgb)/0.2);box-shadow:inset 0 0 0 1px rgb(var(--review-rgb)/0.3);color:var(--review)}
.lks-ui .lks-railpill-n{font-weight:800;font-variant-numeric:tabular-nums}
/* the sliding two-pane body */
.lks-ui .lks14-railbody{position:absolute;inset:0;overflow:hidden;z-index:10}
.lks-ui .lks14-railtrack{display:flex;height:100%;width:200%;transition:transform .3s var(--ease-out-expo)}
.lks-ui .lks14-railpane{width:50%;height:100%;position:relative}
.lks-ui .lks14-railscroll{height:100%;overflow-y:auto;overflow-x:hidden;padding:196px 8px 16px}
.lks-ui .lks-mapsec-list{display:flex;flex-direction:column;gap:24px}
.lks-ui .lks-mapsec{padding:12px 8px 0}
.lks-ui .lks14-railpane-import{height:100%;overflow-y:auto;padding:64px 12px 12px}
.lks-ui .lks14-raillist{display:flex;flex-direction:column;gap:8px;margin-bottom:10px}
.lks-ui .lks14-railcourse{text-align:left;padding:10px 12px;border-radius:12px;background:rgb(255 255 255/0.05);display:flex;flex-direction:column;gap:2px}
.lks-ui .lks14-railcourse:hover{background:rgb(255 255 255/0.1)}
.lks-ui .lks14-railcourse.on{background:rgb(var(--brand-rgb)/0.12);box-shadow:inset 0 0 0 1px rgb(var(--brand-rgb)/0.4)}
.lks-ui .lks14-railcourse-title{font-size:13px;font-weight:700;color:var(--ink-strong);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lks-ui .lks14-railcourse.on .lks14-railcourse-title{color:var(--brand)}
.lks-ui .lks14-railcourse-sub{font-size:10.5px;color:rgb(var(--ink-rgb)/0.4)}
.lks-ui .lks14-raildemo{margin-bottom:10px}
/* the full-rail overlays (search / review) */
.lks-ui .lks-railoverlay{position:absolute;inset:0;z-index:50;display:flex;flex-direction:column;gap:8px;padding:12px;overflow-y:auto;
  background:rgb(var(--surface-rail-rgb)/0.92);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
.lks-ui .lks-railoverlay-head{display:flex;gap:8px;align-items:center}
.lks-ui .lks-railoverlay-head .lks14-search{flex:1}
/* chat: thin current-lesson row (ThreadSwitcher empty-state voice) */
.lks-ui .lks14-lessonrow{flex:none;padding:6px 14px;font-size:12px;font-weight:700;color:var(--ink-muted);opacity:.75}
/* composer: the soul pills ride the capsule's first row */
.lks-ui .lks14-soulrow{display:flex;align-items:center;gap:6px;padding:0 2px 6px}
.lks-ui .lks14-soullabel{flex:none;font-size:11px;color:var(--ink-faint)}
/* B6: assistant text is full-width prose (no card); user bubbles right-align */
.lks-ui .lks14-msg-assistant{background:none;border:none;box-shadow:none;border-radius:0;padding:0;max-width:80ch;font-size:.9375rem}
.lks-ui .lks14-msg-assistant.streaming{border:none;opacity:.85}
.lks-ui .lks14-msg-user{align-self:flex-end;max-width:85%}
/* B8: the empty state is a centered card with a 3D CTA */
.lks-ui .lks14-emptycard{margin:auto;display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center;padding:24px;max-width:320px}
.lks-ui .lks14-emptycard-title{font-size:1rem;font-weight:800;color:var(--ink-strong)}
.lks-ui .lks14-emptycard-hint{font-size:.825rem;color:var(--ink-muted);line-height:1.6}
/* B5: notebook tab capsule + 960px reading column */
.lks-ui .lks14-notebody{margin:0 auto;max-width:960px;width:100%;padding:12px 20px 24px;box-sizing:border-box}
.lks-ui .lks14-viewtabs{background:rgb(var(--ink-rgb)/0.08);border-radius:999px;padding:3px;align-self:flex-start}
.lks-ui .lks14-readbar{position:sticky;top:0;z-index:20;background:var(--surface-2);border-radius:10px}

/* ══════════ C-track (P11a): interaction chrome ══════════ */
/* C1: the scroll-to-bottom FAB (red pulse while streaming) */
.lks-ui .lks14-chat{position:relative}
.lks-ui .lks14-scrollfab{position:absolute;right:16px;bottom:118px;z-index:25;width:36px;height:36px;border-radius:999px;
  background:var(--surface-0);color:var(--ink);border:1px solid var(--border);
  box-shadow:0 4px 12px -2px rgb(var(--shadow-rgb)/0.14),0 1px 3px -1px rgb(var(--shadow-rgb)/0.08);
  display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:14px}
.lks-ui .lks14-scrollfab:hover{background:var(--surface-3)}
.lks-ui .lks14-scrollfab.streaming::after{content:'';position:absolute;top:2px;right:2px;width:8px;height:8px;border-radius:999px;background:var(--warning);animation:lks-fab-pulse 1.2s ease-in-out infinite}
@keyframes lks-fab-pulse{0%,100%{opacity:.4}50%{opacity:1}}
/* C2: the stop variant of the 3D send button */
.lks-ui .lks-btn-send.stop{background:var(--warning);box-shadow:0 3px 0 0 var(--warning-dark)}
.lks-ui .lks-btn-send.stop:active{transform:translateY(2px);box-shadow:0 1px 0 0 var(--warning-dark)}
/* C5: the pre-submit pick highlight (never leaks correctness) */
.lks-ui .lks-qcard-opt.picked{border-color:var(--accent);background:rgb(var(--accent-rgb)/0.1)}
/* C8: decided proposal badges */
.lks-ui .lks-propbanner.decided.accepted{background:rgb(var(--brand-rgb)/0.08);border-color:rgb(var(--brand-rgb)/0.35)}
.lks-ui .lks-propbanner.decided.accepted svg{color:var(--brand)}
.lks-ui .lks-propbanner.decided.declined{opacity:.65}
/* C4: the code-block header (lang label + copy) */
.lks-ui .lks-codehead{display:flex;align-items:center;justify-content:space-between;background:rgb(var(--surface-0-rgb)/0.6);
  border:1px solid var(--border);border-bottom:none;border-radius:10px 10px 0 0;padding:4px 10px}
.lks-ui .lks-codehead-lang{font-size:10.5px;font-weight:700;letter-spacing:.06em;color:var(--ink-faint)}
.lks-ui .lks-codehead-copy{background:none;border:none;color:var(--ink-faint);cursor:pointer;font-size:12px;padding:0 2px}
.lks-ui .lks-codehead-copy:hover{color:var(--ink)}
.lks-ui .lks-codehead-copy.done{color:var(--brand)}
.lks-ui .lks-codehead + .lks-shiki pre{border-radius:0 0 10px 10px;margin:0}
/* C9: the review action row */
.lks-ui .lks14-reviewrow{display:flex;gap:8px;align-items:center}

/* ══════════ P11b (C-track closure): chat parts, notes closure, tooltip, confirm ══════════ */
/* C14: the collapsible reasoning block */
.lks-ui .lks14-reasoning{border:1px solid var(--border-faint);border-radius:10px;padding:4px 10px;font-size:12px;color:var(--ink-faint)}
.lks-ui .lks14-reasoning summary{cursor:pointer;font-weight:600;color:var(--ink-muted);user-select:none}
.lks-ui .lks14-reasoning[open] summary{margin-bottom:4px}
/* C14: the tool-call chip states */
.lks-ui .lks14-toolchip{display:inline-flex;align-items:center;gap:6px;align-self:flex-start;font-size:12px;font-weight:600;
  padding:3px 10px;border-radius:999px;background:rgb(var(--ink-rgb)/0.05);color:var(--ink-muted)}
.lks-ui .lks14-toolchip.loading i{width:5px;height:5px;border-radius:999px;background:var(--accent);display:inline-block;animation:lks-typing-dot 1.2s ease-in-out infinite}
.lks-ui .lks14-toolchip.done{color:var(--ink-faint)}
.lks-ui .lks14-toolchip.done::first-letter{color:var(--brand)}
.lks-ui .lks14-toolchip.error{color:var(--warning-light)}
/* C11: per-message audio row + karaoke mark */
.lks-ui .lks14-msgaudio{display:flex;align-items:center;gap:8px;margin-top:-12px;padding:0 4px}
.lks-ui .lks14-msgaudio-n{font-size:11px;color:var(--ink-faint);font-variant-numeric:tabular-nums}
.lks-ui mark.lks-reading{background:rgb(var(--accent-rgb)/0.25);color:inherit;border-radius:3px;padding:0 1px}
/* C6: note-source flash */
.lks-ui mark.lks-flash{background:rgb(var(--gold-rgb)/0.35);color:inherit;border-radius:3px;padding:0 1px;animation:lks-flash-fade 2.4s ease-out forwards}
@keyframes lks-flash-fade{0%,60%{background:rgb(var(--gold-rgb)/0.45)}100%{background:transparent}}
/* C6: zone head becomes the collapse toggle */
.lks-ui .lks14-zoneh{display:flex;align-items:center;gap:8px;background:none;border:none;font:inherit;cursor:pointer;text-align:left;padding:0}
.lks-ui .lks14-zonecount{font-size:10.5px;font-weight:700;color:var(--brand);background:rgb(var(--brand-rgb)/0.15);border-radius:999px;padding:1px 7px}
.lks-ui .lks14-zonecaret{color:var(--ink-faint);font-size:10px}
/* C6: note actions + pinned + edit */
.lks-ui .lks-note-act{background:none;border:none;color:var(--ink-faint);cursor:pointer;padding:2px;display:inline-flex}
.lks-ui .lks-note-act:hover{color:var(--ink)}
.lks-ui .lks-note.pinned{border-color:rgb(var(--gold-rgb)/0.4);background:rgb(var(--gold-rgb)/0.04)}
.lks-ui .lks-note.pinned .lks-note-act:first-of-type{color:var(--gold)}
.lks-ui .lks-note-edit textarea{width:100%;margin:4px 0}
/* C15: GlobalTooltip */
.lks-tip{position:fixed;z-index:2147483000;max-width:260px;background:var(--surface-0);color:var(--ink-strong);
  border:1px solid var(--border);border-radius:8px;padding:5px 9px;font-size:11.5px;line-height:1.5;pointer-events:none;
  box-shadow:0 4px 12px -2px rgb(var(--shadow-rgb)/0.14),0 1px 3px -1px rgb(var(--shadow-rgb)/0.08)}
/* C15: ConfirmCard */
.lks-confirmcard{position:fixed;z-index:2147483000;width:220px;background:var(--surface-0);border:1px solid var(--border);
  border-radius:12px;padding:10px 12px;box-shadow:0 8px 24px -4px rgb(var(--shadow-rgb)/0.18),0 2px 6px -2px rgb(var(--shadow-rgb)/0.12);
  animation:lks-confirm-enter 160ms var(--ease-out-back)}
.lks-confirmcard.danger{border-color:rgb(var(--warning-rgb)/0.4)}
.lks-confirmcard-msg{font-size:12.5px;color:var(--ink);line-height:1.5;margin-bottom:8px}
.lks-confirmcard-row{display:flex;gap:8px;justify-content:flex-end}
/* ══════════ P15 (D5): the physics map — sky canvases + physics mode ══════════ */
.lks-physky{position:absolute;inset:0;pointer-events:none;z-index:0}
.lks-sky-canvas{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;display:block}
.lks-orb-weather-canvas{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;display:block;z-index:20}
/* physics mode: the rail column owns the backdrop — let the nav-level sky show through */
.lks-ui .lks14-rail:has(.lks-physky){background:transparent}
.lks-ui .lks14-rail:has(.lks-physky) .lks14-railbody,.lks-ui .lks14-rail:has(.lks-physky) .lks14-railscroll{background:transparent}
/* physics owns the transform — the CSS bob must not fight it (per-keyframe transform war) */
.lks-ui .lks-mapfield.lks-physics .lks-mapnode{animation:none}
.lks-ui .lks-mapfield.lks-physics .lks-mapnode .lks-bubble{transition:none}
.lks-ui .lks-mapfield.lks-physics{background:transparent}
/* ══════════ P14 (D3): CanvasStage + the board tab + canvas modals ══════════ */
.lks-ui .lks14-stage{position:relative;height:100%;width:100%;overflow:hidden;user-select:none;touch-action:none}
.lks-ui .lks14-stage.grid{background-image:radial-gradient(circle,rgb(var(--ink-rgb)/0.10) 1px,transparent 1px);background-size:22px 22px}
.lks-ui .lks14-stage-content{position:absolute;top:0;left:0}
.lks-ui .lks14-stage-content.glide{transition:transform 150ms var(--ease-out-quart)}
@media (prefers-reduced-motion:reduce){.lks-ui .lks14-stage-content.glide{transition:none}}
.lks-ui .lks14-stage-tools{position:absolute;bottom:12px;left:50%;transform:translateX(-50%);z-index:10;display:flex;align-items:center;gap:2px;padding:4px;border-radius:14px;background:rgb(var(--surface0-rgb,17 17 20)/0.9);backdrop-filter:blur(8px);border:1px solid var(--border);box-shadow:0 8px 24px -4px rgb(var(--shadow-rgb)/0.18),0 2px 6px -2px rgb(var(--shadow-rgb)/0.12)}
.lks-ui .lks14-stage-tools button{width:32px;height:32px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;color:var(--ink-muted);font-size:15px;font-weight:700;cursor:pointer}
.lks-ui .lks14-stage-tools button:hover{background:rgb(var(--ink-rgb)/0.05);color:var(--ink-strong)}
.lks-ui .lks14-stage-tools button:disabled{opacity:.3;pointer-events:none}
.lks-ui .lks14-stage-tools span{min-width:52px;text-align:center;font-size:12px;font-weight:700;color:var(--ink-muted);font-variant-numeric:tabular-nums;user-select:none}
.lks-ui .lks14-stage-probe{display:none}
.lks-ui .lks14-board{display:flex;flex-direction:column;height:100%;min-height:0}
.lks-ui .lks14-board-head{display:flex;align-items:center;gap:8px;padding:12px 16px 8px;font-size:13px;font-weight:700;color:var(--ink);flex:none;min-width:0}
.lks-ui .lks14-board-head svg{color:var(--ink-muted);flex:none}
.lks-ui .lks14-board-stage{flex:1;min-height:0;padding:0 8px 8px}
.lks-ui .lks14-board-stage> .lks14-stage{border-radius:14px;border:1px solid var(--border-faint);background:rgb(var(--surface0-rgb,17 17 20)/0.6);overflow:hidden}
.lks-ui .lks14-board-artifact{padding:20px;width:max-content;max-width:none}
.lks-ui .lks14-board-artifact .lks-acard{min-width:560px;background:var(--surface-0);border:1px solid var(--border-faint);border-radius:14px}
.lks-ui .lks14-cmapwrap{position:relative}
.lks-ui .lks14-cmap-expand{position:absolute;top:10px;right:10px;z-index:5}
.lks14-modal-diagram{padding:16px;width:max-content}
.lks-ui .lks-acard-modal-body:has(.lks14-stage){width:min(86vw,1100px);height:min(78vh,720px);padding:0;overflow:hidden}
.lks-ui .lks-acard-modal-body:has(.lks14-stage) .lks-acard-modal-title{padding:12px 16px;border-bottom:1px solid var(--border-faint)}
/* ══════════ P13 (D2): CelebrationLayer — root particle bursts + reduced static ══════════ */
.lks14-celfx-canvas{position:fixed;inset:0;pointer-events:none;z-index:2147483100}
.lks14-celfx-reduced{position:fixed;inset:0;pointer-events:none;z-index:2147483100;display:flex;align-items:center;justify-content:center}
.lks14-celfx-glyph{font-size:84px;line-height:1;opacity:.45;animation:lks-celfx-fade .2s var(--ease-out-quart)}
@keyframes lks-celfx-fade{from{opacity:0}to{opacity:.45}}
/* ══════════ P12 (D1): ExamView five states + leave guard (upstream ExamView.tsx) ══════════ */
.lks-ui .lks-btn.danger{background:color-mix(in srgb,var(--warning) 82%,#000);color:#fff}
.lks-ui .lks-btn.danger:hover{filter:brightness(1.1)}
/* generating / failed / ready: the centered stage */
.lks-ui .lks14-examstage{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px 24px;text-align:center}
.lks-ui .lks14-exam-glyph{color:var(--accent);opacity:.65;margin-bottom:14px}
.lks-ui .lks14-exam-glyph.warn{color:var(--warning-light)}
.lks-ui .lks14-exam-dots{display:flex;gap:5px;margin:10px 0 6px}
.lks-ui .lks14-exam-dots i{width:6px;height:6px;border-radius:999px;background:var(--brand);animation:lks-typing-dot 1.2s ease-in-out infinite}
.lks-ui .lks14-exam-dots i:nth-child(2){animation-delay:.15s}
.lks-ui .lks14-exam-dots i:nth-child(3){animation-delay:.3s}
.lks-ui .lks14-exam-h1{font-size:19px;font-weight:800;color:var(--ink-strong)}
.lks-ui .lks14-exam-hero{font-size:26px;font-weight:800;color:var(--ink-strong);margin-top:4px}
.lks-ui .lks14-exam-sub{font-size:13.5px;color:var(--ink-muted);line-height:1.6;margin-top:6px}
.lks-ui .lks14-exam-hint{font-size:11.5px;color:var(--ink-faint);max-width:300px;margin-top:18px}
.lks-ui .lks14-exam-badge{width:56px;height:56px;border-radius:999px;background:rgb(var(--brand-rgb)/0.15);display:inline-flex;align-items:center;justify-content:center;color:var(--brand);margin-bottom:10px}
.lks-ui .lks14-exam-meta{font-size:12px;color:var(--ink-muted);margin:8px 0 22px;font-variant-numeric:tabular-nums}
.lks-ui .lks14-exam-ctas{display:flex;flex-direction:column;align-items:center;gap:10px}
.lks-ui .lks-btn.primary.big{padding:10px 26px;font-size:15px}
.lks-ui .lks14-exam-regen{display:inline-flex}
.lks-ui .lks14-exam-arrow{margin-left:4px;font-weight:700}
/* answering: fixed top row + scrollable body (upstream max-w-2xl layout) */
.lks-ui .lks14-examans{flex:1;display:flex;flex-direction:column;min-height:0;max-width:680px;margin:0 auto;width:100%}
.lks-ui .lks14-exam-top{display:flex;align-items:center;justify-content:space-between;padding:22px 4px 10px;flex:none}
.lks-ui .lks14-exam-qno{font-size:12px;color:var(--ink-muted);font-variant-numeric:tabular-nums}
.lks-ui .lks14-exam-timer{font-size:13px;font-weight:800;color:var(--ink);font-variant-numeric:tabular-nums}
.lks-ui .lks14-exam-timer.warn{color:var(--warning-light);animation:lks-exam-timer-pulse 1s ease-in-out infinite}
@keyframes lks-exam-timer-pulse{50%{opacity:.55}}
.lks-ui .lks14-exam-track{height:6px;border-radius:999px;background:rgb(var(--shadow-rgb)/0.16);overflow:hidden;margin-bottom:20px;flex:none}
.lks-ui .lks14-exam-track i{display:block;height:100%;border-radius:999px;background:var(--accent);transition:width 300ms var(--ease-out-quart)}
.lks-ui .lks14-exam-scroll{flex:1;min-height:0;overflow-y:auto;padding:0 4px 24px}
.lks-ui .lks14-exam-kc{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:var(--accent);background:rgb(var(--accent-rgb)/0.1);border-radius:999px;padding:4px 11px;margin-bottom:12px}
.lks-ui .lks14-exam-prompt{font-size:16.5px;color:var(--ink-strong);line-height:1.65;margin-bottom:20px;white-space:pre-wrap;overflow-wrap:anywhere}
.lks-ui .lks14-exam-opts{display:flex;flex-direction:column;gap:10px}
.lks-ui .lks14-exam-opt{text-align:left;padding:13px 17px;border-radius:14px;border:1px solid var(--border);background:var(--surface-2);color:var(--ink);font-size:13.5px;line-height:1.5;cursor:pointer;transition:border-color 150ms,background 150ms}
.lks-ui .lks14-exam-opt:hover{border-color:var(--border)}
.lks-ui .lks14-exam-opt.picked{border-color:var(--accent);background:rgb(var(--accent-rgb)/0.14)}
.lks-ui .lks14-exam-nextrow{display:flex;justify-content:flex-end;margin-top:22px}
/* result: stars + KC breakdown + review */
.lks-ui .lks14-examresult{flex:1;overflow-y:auto;padding:30px 4px 20px;max-width:680px;margin:0 auto;width:100%}
.lks-ui .lks14-exam-scorehead{display:flex;flex-direction:column;align-items:center;margin-bottom:20px}
.lks-ui .lks14-exam-stars{display:flex;gap:5px}
.lks-ui .lks14-exam-stars .lit{color:var(--gold)}
.lks-ui .lks14-exam-stars .dim{color:var(--ink-faint);opacity:.35}
.lks-ui .lks14-exam-term{display:flex;align-items:center;gap:8px;border:1px solid rgb(var(--warning-rgb)/0.4);background:rgb(var(--warning-rgb)/0.1);border-radius:14px;padding:11px 15px;margin-bottom:20px;color:var(--ink);font-size:13px}
.lks-ui .lks14-exam-kcblock{margin-bottom:26px}
.lks-ui .lks14-exam-h2{font-size:15px;font-weight:700;color:var(--ink-strong);margin-bottom:10px}
.lks-ui .lks14-exam-kcrow{display:flex;align-items:center;justify-content:space-between;padding:10px 15px;border-radius:14px;background:var(--surface-2);margin-bottom:7px}
.lks-ui .lks14-exam-kcname{display:inline-flex;align-items:center;gap:7px;color:var(--ink);font-size:13px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lks-ui .lks14-exam-kcstat{display:inline-flex;align-items:center;gap:8px;font-size:12px;color:var(--ink-muted);font-variant-numeric:tabular-nums;flex:none}
.lks-ui .lks14-exam-weak{font-style:normal;color:var(--warning-light);font-size:11.5px}
.lks-ui .lks14-exam-revrow{display:flex;align-items:flex-start;gap:9px;padding:12px 14px;border-radius:14px;background:var(--surface-2);margin-bottom:7px}
.lks-ui .lks14-exam-mark{flex:none;width:18px;height:18px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;margin-top:1px}
.lks-ui .lks14-exam-mark.ok{color:var(--brand);background:rgb(var(--brand-rgb)/0.14)}
.lks-ui .lks14-exam-mark.bad{color:var(--warning-light);background:rgb(var(--warning-rgb)/0.14)}
.lks-ui .lks14-exam-mark.skip{color:var(--ink-faint);background:rgb(var(--shadow-rgb)/0.14)}
.lks-ui .lks14-exam-revbody{min-width:0;flex:1}
.lks-ui .lks14-exam-revprompt{color:var(--ink);font-size:13px;line-height:1.5;margin-bottom:3px;overflow-wrap:anywhere}
.lks-ui .lks14-exam-revmeta{color:var(--ink-faint);font-size:11.5px;line-height:1.5}
.lks-ui .lks14-exam-ok{color:var(--brand)}
.lks-ui .lks14-exam-revexp{color:var(--ink-muted);font-size:11.5px;line-height:1.5;margin-top:4px}
/* leave guard modal (upstream examLeave + focus trap) */
.lks14-examleave{position:fixed;inset:0;z-index:2147483000;background:rgb(var(--shadow-rgb)/0.5);display:flex;align-items:center;justify-content:center;animation:lks-fade-in 140ms var(--ease-out-quart)}
.lks14-examleave-card{width:340px;background:var(--surface-0);border:1px solid var(--border);border-radius:16px;padding:20px;box-shadow:0 16px 48px -8px rgb(var(--shadow-rgb)/0.3);animation:lks-confirm-enter 160ms var(--ease-out-back)}
.lks14-examleave-title{display:flex;align-items:center;gap:8px;font-size:15.5px;font-weight:800;color:var(--ink-strong);margin-bottom:6px}
.lks14-examleave-title svg{color:var(--warning-light)}
.lks14-examleave-msg{font-size:13px;color:var(--ink-muted);line-height:1.6;margin-bottom:16px}
.lks14-examleave-row{display:flex;gap:10px;justify-content:flex-end}
@keyframes lks-fade-in{from{opacity:0}to{opacity:1}}

/* ── D6: map ambiance — seasonal bubble filters (upstream v0.6 env-*), ──
   the world switcher, the streaming spinner badge + rail notice ── */
/* v0.6 节点球季节滤镜(整球色温调,不动状态色本身): status colors are game
   language — the filter warms/cools every bubble but keeps their relative
   differences. env-{weather} rides the same wrapper as a marker only (its
   visuals live on the orb-weather canvas). */
.lks-ui .env-spring .lks-bubble{filter:hue-rotate(-12deg) saturate(1.15) brightness(1.02)}
.lks-ui .env-summer .lks-bubble{filter:saturate(1.4) brightness(1.08) contrast(1.05)}
.lks-ui .env-autumn .lks-bubble{filter:hue-rotate(-22deg) saturate(1.1) brightness(0.97)}
.lks-ui .env-winter .lks-bubble{filter:saturate(0.5) brightness(1.05) hue-rotate(8deg)}
.lks-ui .lks-mapsec-list{position:relative;z-index:1}
/* the two-world switcher (upstream map.world pills: brand study / accent practice) */
.lks-ui .lks-worldswitch{display:flex;gap:4px;margin-top:6px;padding:3px;border-radius:10px;background:rgb(0 0 0/0.3)}
.lks-ui .lks-worldtab{flex:1;display:flex;align-items:center;justify-content:center;gap:5px;padding:4px 0;border:none;border-radius:7px;background:none;color:rgb(255 255 255/0.5);font:inherit;font-size:11px;font-weight:700;cursor:pointer;transition:color .15s}
.lks-ui .lks-worldtab:hover{color:rgb(255 255 255/0.8)}
.lks-ui .lks-worldtab.on{background:color-mix(in srgb,var(--brand) 30%,transparent);color:var(--brand)}
.lks-ui .lks-worldtab[data-testid='world-tab-practice'].on{background:color-mix(in srgb,var(--accent) 30%,transparent);color:var(--accent)}
.lks-ui .lks-worldtab:focus-visible{box-shadow:0 0 0 2px var(--business-primary);outline:none}
.lks-ui .lks-empty-practice{padding:32px 16px;text-align:center;color:var(--ink-muted);font-size:12.5px}
/* the streaming spinner badge on the ball (upstream Loader2 chip) */
.lks-ui .lks-bubble-spin{position:absolute;top:-7px;right:-7px;z-index:10;display:flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:999px;background:var(--surface-0);color:var(--accent);box-shadow:0 2px 8px -2px rgb(var(--shadow-rgb)/0.45);pointer-events:none;animation:lks-spin 1s linear infinite}
/* the rail's streaming notice pill (typing dot + copy) */
.lks-ui .lks-stream-note{display:flex;align-items:center;gap:7px;margin-top:6px;padding:4px 10px;border-radius:999px;background:color-mix(in srgb,var(--accent) 14%,transparent);color:var(--accent);font-size:11px;font-weight:700}
.lks-ui .lks-typing-dot{width:6px;height:6px;border-radius:999px;background:currentColor;animation:lks-blink 1.2s ease-in-out infinite}
@keyframes lks-spin{to{transform:rotate(360deg)}}
@keyframes lks-blink{0%,100%{opacity:.25}50%{opacity:1}}
`

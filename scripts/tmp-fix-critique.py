# one-shot critique fix batch (deleted after use)
import io, re

# ── upstream-theme.ts ──
p = 'src/client/upstream-theme.ts'
src = io.open(p, encoding='utf-8').read()

bad = """   their hue, only L drops for WCAG AA on white; shiki flips via --shiki-light. ── */
   dark stones; shiki flips via --shiki-light. ── */
"""
assert bad in src, 'orphan fragment not found'
src = src.replace(bad, """   their hue, only L drops for WCAG AA on white; shiki flips via --shiki-light. ── */
""")

old = ".lks-ui .lks14-composer-card{flex:1;display:flex;align-items:flex-end;gap:8px;"
assert old in src, 'composer card'
src = src.replace(old, ".lks-ui .lks14-composer-card{flex:1;display:flex;flex-wrap:wrap;align-items:flex-end;gap:8px;")
old = ".lks-ui .lks14-soulrow{display:flex;align-items:center;gap:6px;padding:0 2px 6px}"
assert old in src, 'soulrow'
src = src.replace(old, ".lks-ui .lks14-soulrow{display:flex;align-items:center;gap:6px;padding:0 2px 6px;width:100%}")
old = ".lks-ui .lks14-composertext{background:transparent;border:none;box-shadow:none;color:var(--ink-strong);font-size:.875rem}"
assert old in src, 'composertext'
src = src.replace(old, ".lks-ui .lks14-composertext{background:transparent;border:none;box-shadow:none;color:var(--ink-strong);font-size:.875rem;flex:1 1 120px;min-width:0}")

old = ".lks-ui .lks-lessorow.st-mastered .lks-lessorow-glyph svg{animation:lks-crown-sparkle 1.6s ease-in-out infinite}"
assert old in src, 'crown'
src = src.replace(old, ".lks-ui .lks-lessorow.st-mastered .lks-lessorow-glyph svg{animation:lks-crown-sparkle 1.6s ease-in-out 2}")

old = ".lks-ui .lks-hdr-xpbar i{display:block;height:100%;background:linear-gradient(90deg,var(--gold),var(--gold-light));border-radius:999px;transition:width .5s var(--ease-out-expo)}"
assert old in src, 'xpbar'
src = src.replace(old, ".lks-ui .lks-hdr-xpbar i{display:block;height:100%;background:linear-gradient(90deg,var(--gold),var(--gold-light));border-radius:999px;transform-origin:left;transition:transform .5s var(--ease-out-expo)}")
old = ".lks-ui .lks14-exam-track i{display:block;height:100%;border-radius:999px;background:var(--accent);transition:width 300ms var(--ease-out-quart)}"
assert old in src, 'exam track'
src = src.replace(old, ".lks-ui .lks14-exam-track i{display:block;height:100%;border-radius:999px;background:var(--accent);transform-origin:left;transition:transform 300ms var(--ease-out-quart)}")

old = ".lks-ui .lks-lessorow-bar i{display:block;height:100%;background:var(--brand);transform-origin:left;transition:transform .3s var(--ease-out-expo)}"
assert old in src, 'row bar'
src = src.replace(old, old + "\n.lks-ui .lks-lessorow:focus-visible,.lks-ui .lks-railsec-head:focus-visible{outline:none;box-shadow:0 0 0 2px var(--business-primary)}")

old = "background:rgb(var(--surface-rail-rgb)/0.92);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}"
assert old in src, 'overlay'
src = src.replace(old, "background:rgb(var(--surface-rail-rgb)/0.97);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}")

src += """
/* ── light-mode chrome sweep: the rail-head glass family hardcoded dark for
   the map era; the list rail follows the theme, so the chrome reads
   ink-on-surface here too ── */
.lks-ui[data-lks-theme='light'] .lks14-railhead{background:rgb(255 255 255/0.72);border-color:var(--border-faint);box-shadow:0 1px 4px rgb(0 0 0/0.05)}
.lks-ui[data-lks-theme='light'] .lks14-railtitle{color:var(--ink-strong);text-shadow:none}
.lks-ui[data-lks-theme='light'] .lks14-railpct{color:var(--ink-strong);text-shadow:none}
.lks-ui[data-lks-theme='light'] .lks-railtabs{background:rgb(255 255 255/0.72);box-shadow:0 1px 4px rgb(0 0 0/0.05)}
.lks-ui[data-lks-theme='light'] .lks-railtab{color:var(--ink-muted)}
.lks-ui[data-lks-theme='light'] .lks-railtab.on{color:var(--brand-dark)}
.lks-ui[data-lks-theme='light'] .lks-railpill{background:rgb(0 0 0/0.04);box-shadow:inset 0 0 0 1px var(--border-faint);color:var(--ink-muted)}
.lks-ui[data-lks-theme='light'] .lks-railpill:hover{background:rgb(0 0 0/0.07)}
.lks-ui[data-lks-theme='light'] .lks14-search{background:rgb(0 0 0/0.03);border-color:var(--border-faint)}
.lks-ui[data-lks-theme='light'] .lks14-search::placeholder{color:var(--ink-faint)}
.lks-ui[data-lks-theme='light'] .lks-worldswitch{background:rgb(0 0 0/0.05)}
.lks-ui[data-lks-theme='light'] .lks-worldtab{color:var(--ink-muted)}
.lks-ui[data-lks-theme='light'] .lks-worldtab:hover{color:var(--ink-strong)}
.lks-ui[data-lks-theme='light'] .lks-worldtab.on{color:var(--brand-dark)}
.lks-ui[data-lks-theme='light'] .lks-worldtab[data-testid='world-tab-practice'].on{color:var(--accent-dark)}
.lks-ui[data-lks-theme='light'] .lks-empty-practice{color:var(--ink-muted)}
.lks-ui[data-lks-theme='light'] .lks14-importtabs{background:rgb(0 0 0/0.04)}
.lks-ui[data-lks-theme='light'] .lks14-importtab{color:var(--ink-muted)}
.lks-ui[data-lks-theme='light'] .lks-railoverlay{background:rgb(241 242 244/0.97)}
.lks-ui[data-lks-theme='light'] .lks-lessorow.st-mastered .lks-lessorow-glyph{color:var(--gold-dark)}
.lks-ui[data-lks-theme='light'] .lks-lessorow.st-exam .lks-lessorow-glyph,.lks-ui[data-lks-theme='light'] .lks-lessorow.st-exam-passed .lks-lessorow-glyph{color:var(--exam)}
.lks-ui[data-lks-theme='light'] .lks-lessorow-bar{background:rgb(0 0 0/0.08)}
/* ambient glyph motion sleeps under reduced-motion (A7 never had a guard) */
@media (prefers-reduced-motion: reduce){
  .lks-ui .lks-lessorow.st-mastered .lks-lessorow-glyph svg,.lks-ui .lks-hdr-xp .lks-hdr-glyph,.lks-ui .lks-hdr-streak .lks-hdr-glyph{animation:none}
}
"""
io.open(p, 'w', encoding='utf-8', newline='\n').write(src)
print('upstream-theme: fixes in')

# ── panel.tsx ──
p = 'src/client/panel.tsx'
src = io.open(p, encoding='utf-8').read()
old = "createElement('span', { className: 'lks-hdr-xpbar' }, createElement('i', { style: { width: `${Math.min(100, progress?.levelPct ?? 0)}%` } }))"
assert old in src, 'xpbar js'
src = src.replace(old, "createElement('span', { className: 'lks-hdr-xpbar' }, createElement('i', { style: { transform: `scaleX(${String(Math.min(100, progress?.levelPct ?? 0) / 100)})` } }))")
old = "createElement('i', { style: { width: `${String(contextMeter.pct ?? 0)}%` }, className: contextMeter.pct !== null && contextMeter.pct > 80 ? 'hot' : undefined })),"
assert old in src, 'ctxmeter js'
src = src.replace(old, "createElement('i', { style: { transform: `scaleX(${String((contextMeter.pct ?? 0) / 100)})` }, className: contextMeter.pct !== null && contextMeter.pct > 80 ? 'hot' : undefined })),")
old = "createElement('span', { className: 'lks14-palette-kind' }, '\u2318K'),"
assert old in src, 'palette chip'
src = src.replace(old, "createElement('span', { className: 'lks14-palette-kind' }, tr('palette.kind.action')),")
io.open(p, 'w', encoding='utf-8', newline='\n').write(src)
print('panel: scaleX x2 + palette kind')

# ── examview.tsx ──
p = 'src/client/examview.tsx'
src = io.open(p, encoding='utf-8').read()
m = re.search(r"createElement\('i', \{ style: \{ width: `\$\{String\(Math\.round\(\(currentIdx[^}]+\} \}\)\),", src)
assert m, 'exam track js'
new = m.group(0).replace("style: { width: ", "style: { transform: ").replace(")%` } }", ") / 100)})` } }")
new = new.replace("`scaleX(${String(Math.round((currentIdx / Math.max(1, exercises.length)) * 100)", "`scaleX(${String(Math.round((currentIdx / Math.max(1, exercises.length)) * 100)")
src = src.replace(m.group(0), new)
io.open(p, 'w', encoding='utf-8', newline='\n').write(src)
print('examview: track scaleX')

# ── locale.ts ──
p = 'src/client/locale.ts'
src = io.open(p, encoding='utf-8').read()
src = src.replace("'map.tab.map': '地图',", "'map.tab.map': '课程',", 1)
src = src.replace("'map.tab.map': 'Map',", "'map.tab.map': 'Courses',", 1)
src = src.replace("'tutor.dormant': '学习模式已关闭 — 点右上「▶ 开始学习」开启导师,按钮恢复可用。',",
                  "'tutor.dormant': '学习模式已关闭 — 在下方对话区点「开始学习」即可唤醒导师。',")
src = src.replace("'tutor.dormant': 'Study mode is off — click \"▶ Start learning\" above to wake the tutor and re-enable these controls.',",
                  "'tutor.dormant': 'Study mode is off — click \"Start learning\" in the conversation pane below to wake the tutor.',")
assert src.count("'palette.empty':") == 2, 'palette.empty count'
src = src.replace("  'palette.empty':", "  'palette.kind.action': '操作',\n  'palette.empty':", 1)
src = src.replace("  'palette.empty':", "  'palette.kind.action': 'Action',\n  'palette.empty':", 1)
io.open(p, 'w', encoding='utf-8', newline='\n').write(src)
print('locale: labels + dormant copy + kind key')

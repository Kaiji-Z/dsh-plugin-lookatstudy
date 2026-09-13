// Vendored from LookatStudy src/main/services/pure/subtitle-parse.ts (MIT License, https://github.com/Kaiji-Z/LookatStudy).
// Unmodified except this provenance header. Refreshed 2026-09-14 (the 2026-08-23 CJK-aware join upstream fix).
/**
 * 字幕文件 → 纯文本(vtt/srt)——视频导入的"字幕优先"路径:有 CC/自动字幕的
 * 视频直接出文本,零转写零模型。纯函数,verify 直测。
 *
 * 处理(全部是**机器生成的刚性格式指纹**,高置信度规则;语义判断不在此层):
 * - WEBVTT 头/时间轴行/CUE 编号/NOTE 块/样式行剥除;
 * - 行内标签与打词时间戳剥除(`<c>`、`<00:00:01.359>`);
 * - 滚动字幕去重:YouTube 自动字幕的滚动窗结构是 cue N+1 的首行复述 cue N 的
 *   尾行,相邻去重不够(隔一行就重复),须近窗(最近 2 行)去重——2026-08-23
 *   真实样本驱动修复(经典症状:每句话在成文里出现两遍);
 * - HTML 实体解码(&amp; 等;字幕 XML 转义源);
 * - 整行自动标记剥除(封闭集 [Music]/[Applause]… 只删整行,不碰行内——
 *   行内方括号可能是正文);
 * - 行首 `>>` 换说话人标记剥除(YouTube 自动字幕机器标记);
 * - CJK 感知接行:汉字/中文标点之间不加空格(句与句直接相连),拉丁文之间
 *   加空格——中文字幕逐句 join(" ") 会在全文制造 "汉字 空格 汉字" 噪声。
 */

/** 单条 cue 的时间轴行特征:00:00:01.000 --> 00:00:03.000(毫秒分隔符兼容 , 和 .) */
const CUE_TIMING = /^\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3}\s*-->/;

/** YouTube 自动字幕的整行机器标记(封闭集,只删整行)。 */
const AUTO_MARKERS = /^\[(music|applause|laughter|laughs?|silence|inaudible|cheering|foreign|blank[_\s]?audio|music playing|noise)\]$/i;

/** 字幕常见的 XML/HTML 实体(未列出的实体原样保留,不做激进猜测)。 */
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(s: string): string {
  return s
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/&#(\d+);/g, (m, d: string) => {
      try { return String.fromCodePoint(Number(d)); } catch { return m; }
    });
}

/** CJK 统一表意文字/中文标点/全角符号——接行时两侧任一是则不加空格。 */
const CJKISH = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/;

/** CJK 感知拼接:空段跳过;相邻两侧任一是 CJK 字符则直连,否则加空格。 */
function cjkJoin(parts: string[]): string {
  let s = "";
  for (const p of parts) {
    if (!s) { s = p; continue; }
    const last = s[s.length - 1]!;
    s += CJKISH.test(last) || CJKISH.test(p[0]!) ? p : ` ${p}`;
  }
  return s;
}

export function parseSubtitleToText(raw: string): string {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  /** 近窗去重:最近 2 条已输出的行(滚动字幕 cue 间隔行重复)。 */
  const recent: string[] = [];
  let inNote = false;
  for (const line of lines) {
    const t = line.trim();
    if (!t) { inNote = false; continue; }
    if (/^WEBVTT/i.test(t)) continue;
    if (t.startsWith("NOTE")) { inNote = true; continue; }
    if (inNote) continue;
    if (CUE_TIMING.test(t)) continue;
    if (/^\d+$/.test(t)) continue; // srt 序号行(纯数字正文极罕见,接受)
    if (/^(Kind:|Language:|Style:|Region:|NOTE)/i.test(t)) continue;
    // 行内标签与 HTML(自动字幕的 <c> 打词标签/打词时间戳),实体解码在后
    let text = t.replace(/<[^>]+>/g, "").trim();
    if (!text) continue;
    if (AUTO_MARKERS.test(text)) continue;
    text = decodeEntities(text);
    // 去重基于**原始行**:滚动复述是逐字复制(含 >> 前缀),先剥标记会把
    // 换说话人的首次发言误判成重复
    if (recent.includes(text)) continue;
    recent.push(text);
    if (recent.length > 2) recent.shift();
    // 行首换说话人标记(YouTube 自动字幕机器标记)剥除后再输出
    const spoken = text.replace(/^>{2,}\s*/, "").trim();
    if (spoken) out.push(spoken);
  }
  return cjkJoin(out).replace(/\s+/g, " ").trim();
}

/**
 * yt-dlp 落盘的多语言字幕文件(sub.<lang>.vtt/srt)里挑一个。
 * 不能用 readdir 首个:目录序是字母序,"en" 永远压过 "zh-Hans",
 * 中文优先(与 fetchViaYtDlp 的 --sub-langs 意图一致)必须显式排:
 * zh-Hans/zh-CN > 其他 zh(zh/zh-Hant/zh-TW…) > en > 其他。
 */
export function pickSubtitleFile(names: string[]): string | null {
  const rank = (n: string): number => {
    const m = n.toLowerCase().match(/^sub\.(.+)\.(vtt|srt)$/);
    if (!m) return 99;
    const lang = m[1]!;
    if (lang === "zh-hans" || lang === "zh-cn" || lang.startsWith("zh-hans") || lang.startsWith("zh-cn")) return 0;
    if (lang === "zh" || lang.startsWith("zh")) return 1;
    if (lang === "en" || lang.startsWith("en")) return 2;
    return 3;
  };
  let best: string | null = null;
  let bestRank = 99;
  for (const n of names) {
    const r = rank(n);
    if (r < bestRank) { best = n; bestRank = r; }
  }
  return bestRank <= 3 ? best : null;
}

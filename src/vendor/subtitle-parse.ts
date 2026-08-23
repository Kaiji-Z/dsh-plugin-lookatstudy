// Vendored from LookatStudy src/main/services/pure/subtitle-parse.ts (MIT License, https://github.com/Kaiji-Z/LookatStudy).
// Unmodified except this provenance header.
/**
 * 字幕文件 → 纯文本(vtt/srt)——视频导入的"字幕优先"路径:有 CC/自动字幕的
 * 视频直接出文本,零转写零模型。纯函数,verify 直测。
 *
 * 处理:WEBVTT 头/时间轴行/CUE 编号/NOTE 块/样式行剥除;滚动字幕的重复行
 * 去重(相邻行相同只留一次);行间以空格连接成段(标点已由字幕自带)。
 */

/** 单条 cue 的时间轴行特征:00:00:01.000 --> 00:00:03.000(毫秒分隔符兼容 , 和 .) */
const CUE_TIMING = /^\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3}\s*-->/;

export function parseSubtitleToText(raw: string): string {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let inNote = false;
  let prev = "";
  for (const line of lines) {
    const t = line.trim();
    if (!t) { inNote = false; continue; }
    if (/^WEBVTT/i.test(t)) continue;
    if (t.startsWith("NOTE")) { inNote = true; continue; }
    if (inNote) continue;
    if (CUE_TIMING.test(t)) continue;
    if (/^\d+$/.test(t)) continue; // srt 序号行
    if (/^(Kind:|Language:|Style:|Region:|NOTE)/i.test(t)) continue;
    // 行内标签与 HTML(自动字幕常带 <c> 打词标签)
    const text = t.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
    if (!text) continue;
    if (text === prev) continue; // 滚动字幕重复行
    prev = text;
    out.push(text);
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

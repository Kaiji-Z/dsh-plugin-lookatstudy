/**
 * Vendored from LookatStudy shared/speech-text.ts (MIT License,
 * https://github.com/Kaiji-Z/LookatStudy), upstream v0.28.0 — includes the
 * v11.5 whole-display-group avoidance fix era. Unmodified except this
 * provenance header.
 *
 * speech-text —— TTS 朗读文本处理(纯函数,渲染层/主进程共用)。
 *
 * normalizeSpeechText: markdown → 可朗读纯文本。代码不读(围栏/行内整体移除),
 * 链接留文字,强调/标题/列表/引用/表格标记剥离 —— 导师"念的是话,不是版面"。
 *
 * splitSentences: 流式友好的切句。每次喂"累积文本"返回完整句 + 余量(幂等,StrictMode 安全);
 * flush=true 时尾句强制吐出。终止标点:中英句号/叹/问/分号 + 省略号;ASCII '.' 要求后跟
 * 空白且前字符非数字(3.14 不切)。超过 maxBuffer 仍无终止标点 → 在最后的软标点(、,;: 空白)
 * 处断开,再无则硬断 —— 保证"导师边生成边念"的流式管线永远不会饿死。
 *
 * v11.2 表意分隔:换行与 emoji 也是句界。无标点的段落/列表/短句流文本,
 * 旧逻辑的强制断句块会在显示层并组吞整段(高亮整段到结尾);现在逐行/逐 emoji
 * 成句,显示组另加长度上限兜底 —— karaoke 高亮粒度永远可控。
 */

/** 终止标点(出现即成句,连续终止/右引号并吞进句尾) */
const HARD = new Set(["。", "!", "?", "！", "？", ";", "；", "…"]);
/** 软标点(超长兜底断句位) */
const SOFT = new Set([",", "，", "、", ":", "：", " ", "\t"]);
/** v11.2 emoji 基字符范围(表意/象形/杂项符号/箭头符号区);修饰符(VS16/ZWJ/肤色)不单独成界 */
const EMOJI_CP_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;
function isEmojiCp(cp: number | undefined): boolean {
  return cp != null && EMOJI_CP_RE.test(String.fromCodePoint(cp));
}
/** 句尾 emoji 序列(含 ZWJ 连写/VS16/肤色修饰) —— endsWithSentenceEnd 认它为显示终点 */
const EMOJI_TAIL_RE = /(?:[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}](?:\uFE0F|\u200D[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]|[\u{1F3FB}-\u{1F3FF}])*)$/u;
/** 句尾可并吞的右闭合符 */
const CLOSERS = new Set(["”", '"', "」", "』", "》", ")", "】", "])".slice(0, 1)]);

export function normalizeSpeechText(md: string): string {
  let s = md;
  // Windows CRLF 归一(换行是 v11.2 句界,\r 不许混进来)
  s = s.replace(/\r\n?/g, "\n");
  // 围栏代码块(``` / ~~~):整个移除,不朗读
  s = s.replace(/(?:^|\n)[ \t]*(?:```|~~~)[^\n]*\n[\s\S]*?(?:\n[ \t]*(?:```|~~~)[^\n]*|\n?$)/g, "\n");
  // 行内代码
  s = s.replace(/`[^`\n]*`/g, "");
  // 图片整体移除,链接留文字
  s = s.replace(/!\[[^\]]*\]\([^)\n]*\)/g, "");
  s = s.replace(/\[([^\]]+)\]\([^)\n]*\)/g, "$1");
  // 标题 / 列表 / 引用标记
  s = s.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "");
  s = s.replace(/^[ \t]*(?:[-*+]|\d+\.)[ \t]+/gm, "");
  s = s.replace(/^[ \t]*>[ \t]?/gm, "");
  // 表格:竖线换空格,对齐行(---)整行移除
  s = s.replace(/\|/g, " ");
  s = s.replace(/^[ \t]*[-: ]{3,}[ \t]*$/gm, "");
  // 强调 / 删除线
  s = s.replace(/(\*\*|__)(.*?)\1/g, "$2");
  s = s.replace(/(?<![*\w])(\*|_)(?!\s)(.+?)(?<!\s)\1(?![*\w])/g, "$2");
  s = s.replace(/~~(.+?)~~/g, "$1");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

/**
 * v11.2 朗读句表单一入口(v11.4 起仅合成侧使用):tts-service 用它切段;
 * 渲染层 karaoke **不再调用**(改吃 ttsAudio.sentence 权威原文,见
 * playedSentencePrefix)——句表从合成侧单向流出,显示侧零复算零分叉。
 */
export function speechSentencesOf(text: string): string[] {
  return splitSentences(normalizeSpeechText(text), { flush: true }).sentences;
}

/**
 * v11.4 已播句组前缀:karaoke 高亮文本 = 从当前块向前收拢到最近的"句终点块"
 * (不含),拼接**已播放**各块的原文。块文本由合成侧 ttsAudio.sentence 权威下发
 * (念什么高亮什么,渲染层零复算);强断句块(超长行被 maxBuffer 撕开的)按此
 * 并回同一视觉句,且只亮到当前进度——高亮随音频逐块生长,永不错句。
 */
export function playedSentencePrefix(texts: readonly string[], idx: number): string {
  if (idx < 0 || idx >= texts.length) return "";
  let s = idx;
  while (s > 0 && !endsWithSentenceEnd(texts[s - 1] ?? "")) s--;
  const parts: string[] = [];
  for (let i = s; i <= idx; i++) {
    const t = texts[i];
    if (t && t.trim()) parts.push(t);
  }
  return parts.join(" ");
}

export interface SplitOptions {
  /** 流结束:余量作为尾句吐出 */
  flush?: boolean;
  /** 无终止标点时的强制断句阈值(字符数) */
  maxBuffer?: number;
}

export function splitSentences(
  text: string,
  opts: SplitOptions = {},
): { sentences: string[]; rest: string } {
  const maxBuffer = Math.max(8, opts.maxBuffer ?? 120);
  const flush = opts.flush ?? false;
  const out: string[] = [];
  const n = text.length;
  let start = 0;
  let i = 0;
  let lastSoft = -1;

  const emit = (end: number) => {
    const piece = text.slice(start, end).trim();
    if (piece) out.push(piece);
    start = end;
    lastSoft = -1;
  };

  while (i < n) {
    const ch = text[i]!;
    // v11.2 emoji=句界:吞后续修饰符(VS16/ZWJ/肤色)与连写 emoji,整序列收进句尾
    const cp = text.codePointAt(i)!;
    if (isEmojiCp(cp)) {
      let j = i + (cp > 0xffff ? 2 : 1);
      while (j < n) {
        const cj = text.codePointAt(j)!;
        const ul = cj > 0xffff ? 2 : 1;
        if (cj === 0xfe0f || cj === 0x200d || (cj >= 0x1f3fb && cj <= 0x1f3ff) || isEmojiCp(cj)) {
          j += ul;
          continue;
        }
        break;
      }
      emit(j);
      i = j;
      continue;
    }
    // v11.2 换行=句界:整行成句(无标点的段落/列表不再被并组吞成整段);
    // 句尾保留 \n 作为显示终点标记(endsWithSentenceEnd 认它,不被并组)
    if (ch === "\n") {
      const piece = text.slice(start, i + 1).replace(/[^\S\n]+$/, "");
      if (piece.trim()) out.push(piece);
      start = i + 1;
      lastSoft = -1;
      i++;
      continue;
    }
    if (HARD.has(ch)) {
      let j = i + 1;
      while (j < n && (HARD.has(text[j]!) || CLOSERS.has(text[j]!))) j++;
      emit(j);
      i = j;
      continue;
    }
    if (ch === ".") {
      const prev = i > 0 ? text[i - 1]! : "";
      const next = i + 1 < n ? text[i + 1]! : "";
      // ASCII 句点:后跟空白/结尾,且前一字符不是数字(小数点不切)
      if ((next === "" || /\s/.test(next)) && !/\d/.test(prev)) {
        let j = i + 1;
        while (j < n && (CLOSERS.has(text[j]!) || HARD.has(text[j]!))) j++;
        emit(j);
        i = j;
        continue;
      }
    }
    if (SOFT.has(ch)) lastSoft = i;
    if (i - start + 1 > maxBuffer) {
      if (lastSoft > start) {
        // 在最后的软标点处断(软标点本身不进上一句)。先存切割点 ——
        // emit 内部会重置 lastSoft,重置后再读就回卷到 0 造成重复段(实测踩过)
        const cut = lastSoft;
        emit(cut);
        start = cut + 1;
      } else {
        emit(i + 1);
        i++;
        continue;
      }
    }
    i++;
  }

  const rest = text.slice(start).trim();
  if (flush && rest) out.push(rest);
  return { sentences: out, rest: flush ? "" : rest };
}

/**
 * v9 块是否结束于"真句子终点"(剥尾部闭合符后是终止标点/ASCII 句点)。
 * 超长强制断句(maxBuffer 软标点兜底)产出的块**不以**句终点结尾——
 * TTS 分块 ≠ 显示句:渲染层 karaoke 用 groupSentenceChunks 把这类块
 * 与后续块并成一个显示句组,高亮整组,不在一句中间断开。
 */
export function endsWithSentenceEnd(chunk: string): boolean {
  // v11.2 句尾换行=整行句的显示终点标记 —— 必须在 trimEnd 之前查(它会剥掉 \n)
  if (/\n\s*$/.test(chunk)) return true;
  const t = chunk.trimEnd();
  if (!t) return true;
  let i = t.length - 1;
  while (i >= 0 && CLOSERS.has(t[i]!)) i--;
  if (i < 0) return true;
  const ch = t[i]!;
  if (HARD.has(ch) || ch === ".") return true;
  // v11.2 表意终点:句尾换行(整行句)或 emoji 序列(含修饰符尾巴)
  if (ch === "\n") return true;
  return EMOJI_TAIL_RE.test(t);
}

/** v11.2 显示句组长度上限(字符):并组只为"把被强制断句撕开的真句子缝回来",
 * 不是无限吞 —— 超上限就保持独立组,karaoke 高亮粒度永远可控。 */
export const DISPLAY_GROUP_MAX = 160;

/**
 * v0.28 显示句组跨度(纯):把"TTS 块在容器文本中的匹配段 [start,end)"扩展到
 * **整条显示句**的字符跨度——向前收拢到最近句终点之后,向后扩到最近句终点
 * (含闭合符/emoji 修饰尾)。v11.4 起朗读 mark 只覆盖"已播前缀",而伴学避让
 * ("生物不压正在读的句")需要整句的行盒;本函数与 splitSentences 共用同一套
 * 句界判定(HARD/ASCII 句点/换行/emoji),零第二份标点表。maxSpan 是单侧扫描
 * 上限,防病态无标点长文把跨度扩爆(扫不到界就停在窗口边,保守取小)。
 */
export function displayGroupSpanAround(
  text: string,
  start: number,
  end: number,
  maxSpan = 400,
): { start: number; end: number } {
  const n = text.length;
  // text[i] 开头是否是一处句终点;是则返回该终点的 exclusive 结束下标(闭合符/
  // emoji 修饰已吞进终点),否则 -1。判定分支与 splitSentences 逐条同构。
  const hardEndAt = (i: number): number => {
    if (i < 0 || i >= n) return -1;
    const ch = text[i]!;
    if (ch === "\n") return i + 1;
    if (HARD.has(ch)) {
      let j = i + 1;
      while (j < n && (HARD.has(text[j]!) || CLOSERS.has(text[j]!))) j++;
      return j;
    }
    if (ch === ".") {
      const prev = i > 0 ? text[i - 1]! : "";
      const next = i + 1 < n ? text[i + 1]! : "";
      if ((next === "" || /\s/.test(next)) && !/\d/.test(prev)) {
        let j = i + 1;
        while (j < n && (CLOSERS.has(text[j]!) || HARD.has(text[j]!))) j++;
        return j;
      }
      return -1;
    }
    const cp = text.codePointAt(i)!;
    if (isEmojiCp(cp)) {
      let j = i + (cp > 0xffff ? 2 : 1);
      while (j < n) {
        const cj = text.codePointAt(j)!;
        const ul = cj > 0xffff ? 2 : 1;
        if (cj === 0xfe0f || cj === 0x200d || (cj >= 0x1f3fb && cj <= 0x1f3ff) || isEmojiCp(cj)) {
          j += ul;
          continue;
        }
        break;
      }
      return j;
    }
    return -1;
  };

  // 向前:找 start 之前最近的句终点,span 起点落在它的 exclusive 终点处;
  // 终点被块起点截断(e>start,理论上不该发生)时不动起点。扫到文本头都没有
  // 句界字符(如开头就是无标点短句)时,文本头本身就是界 → 起点=0;仅当因
  // maxSpan 提前截断才保守保持 start(界在窗口外,不外扩)。
  let s = start;
  {
    let found = false;
    for (let i = Math.min(start, n) - 1; i >= 0 && start - i <= maxSpan; i--) {
      const e = hardEndAt(i);
      if (e >= 0) {
        found = true;
        if (e <= start) s = e;
        break;
      }
    }
    if (!found && start <= maxSpan) s = 0;
  }

  // 向后:块段已以句终点结尾(终点块,含闭合符/\n/emoji 尾)则终点只吞紧随的
  // 右闭合符(与 splitSentences"右引号并吞进句尾"一致)即止;否则找 end 起最近的
  // 句终点(含其尾巴),span 终点=其 exclusive 结束位;扫到上限/文本尾都没终点
  // (超长无标点段)则扩到文本尾。
  if (endsWithSentenceEnd(text.slice(0, Math.min(end, n)))) {
    let e = Math.min(end, n);
    while (e < n && CLOSERS.has(text[e]!)) e++;
    return { start: s, end: e };
  }
  for (let i = end; i < n && i - end <= maxSpan; i++) {
    const e = hardEndAt(i);
    if (e >= 0) return { start: s, end: e };
  }
  return { start: s, end: n };
}

/** TTS 分块序列 → 显示句组(每组合成一个真句子):[start,end] 闭区间块下标。 */
export function groupSentenceChunks(sentences: string[]): Array<{ start: number; end: number }> {
  const groups: Array<{ start: number; end: number }> = [];
  let i = 0;
  while (i < sentences.length) {
    let j = i;
    let len = sentences[i]!.length;
    while (
      j + 1 < sentences.length &&
      !endsWithSentenceEnd(sentences[j]!) &&
      len + sentences[j + 1]!.length <= DISPLAY_GROUP_MAX
    ) {
      j++;
      len += sentences[j]!.length;
    }
    groups.push({ start: i, end: j });
    i = j + 1;
  }
  return groups;
}

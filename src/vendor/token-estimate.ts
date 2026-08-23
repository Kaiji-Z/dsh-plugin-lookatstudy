// Vendored from LookatStudy shared/token-estimate.ts (MIT License, https://github.com/Kaiji-Z/LookatStudy).
// Unmodified except this provenance header.
/**
 * token 用量估算 —— main 与 renderer 共用的纯启发式(零依赖,不引 tokenizer)。
 *
 * 为什么是启发式:本地优先 + 无原生模块约束(sql.js/Electron),而上下文表只需要
 * "约 x%"的量级感,不需要精确计费。标尺来自主流 tokenizer 的经验值:
 *   - CJK 字符 ≈ 1.1 token/字(o200k/cl100k 对常用汉字 1-2 token,均值取 1.1)
 *   - 其他(拉丁/代码/符号) ≈ 4 字符/token
 *
 * 纯函数:确定性、可测(verify-token-estimate.mjs)。
 */

/** CJK 及全角区段(含 CJK 标点/全角 ASCII/假名/谚文边缘),命中即按"一字一 token 档"计。 */
const CJK_RE = /[\u2E80-\u9FFF\uF900-\uFAFF\u3000-\u303F\uFF00-\uFFEF]/g;

/** 估算一段文本的 token 数。空串返回 0;只向上取整。
 * CJK 用整数算术(×11/10)避开 0.1 的浮点误差,100 字恰好 110 而非 111。 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjk = (text.match(CJK_RE) ?? []).length;
  const other = text.length - cjk;
  return Math.ceil((cjk * 11) / 10 + other / 4);
}

/** 上下文占用百分比(0-100 整数)。窗口未知(null/非正数)→ null(渲染层只显示用量不显示占比)。 */
export function contextPercent(usedTokens: number, contextWindow: number | null): number | null {
  if (!contextWindow || contextWindow <= 0) return null;
  if (usedTokens <= 0) return 0;
  return Math.min(100, Math.round((usedTokens / contextWindow) * 100));
}

/** 分段宽度:把各段 token 折算成条形图里的百分比宽度(合计 = 总占比 totalPercent)。
 * 某段 0 token → 0 宽度(渲染层直接不画,避免 0% 也留一条 hairline)。 */
export function segmentPercents(segments: number[], totalPercent: number): number[] {
  const total = segments.reduce((a, b) => a + b, 0);
  if (total <= 0 || totalPercent <= 0) return segments.map(() => 0);
  return segments.map((s) => (totalPercent * s) / total);
}

/** token 数显示格式:1234 → "1.2k";12000 → "12k";500 → "500"。 */
export function formatTokenCount(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

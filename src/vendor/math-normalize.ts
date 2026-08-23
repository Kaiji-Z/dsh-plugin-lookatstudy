// Vendored from LookatStudy src/renderer/lib/math-normalize.ts (MIT License, https://github.com/Kaiji-Z/LookatStudy).
// Unmodified except this provenance header (elkjs dynamic import target adapted to CDN).
/**
 * math-normalize —— 数学记法归一(v0.19 数学渲染前置,纯函数)。
 *
 * `\(...\)` / `\[...\]` 是 LaTeX 的原生行内/行间记法,remark-math 只认 `$`/
 * `$$`。导入的内容(AI 讲解/转写稿/粘贴文本)两种记法都可能出现,渲染前统一
 * 归一到 `$` 记法。幂等;**围栏代码块内不动**(代码里的 `\(` 是字面量)。
 */
export function normalizeMathNotation(md: string): string {
  const out: string[] = [];
  let inFence = false;
  for (const line of md.split("\n")) {
    if (/^[ \t]*(?:```|~~~)/.test(line)) {
      out.push(line);
      inFence = !inFence;
      continue;
    }
    out.push(inFence ? line : line.replace(/\\\[|\\\]|\\\(|\\\)/g, (tok) => (tok === "\\[" || tok === "\\]" ? "$$" : "$")));
  }
  return out.join("\n");
}

// Vendored from LookatStudy src/renderer/lib/mindmap-markdown.ts (MIT License, https://github.com/Kaiji-Z/LookatStudy).
// Unmodified except this provenance header (elkjs dynamic import target adapted to CDN).
/**
 * mindmap-markdown —— 讲解 markdown → 思维导图源文本的纯函数预处理(v0.21)。
 *
 * 思维导图是**结构概览**:代码块整段进脑图节点只是噪声(markmap-lib 还会为它
 * 内嵌 hljs 高亮 HTML),图片也无处安放。喂给 markmap 前剥离:
 *   - 围栏代码块(``` 或 ~~~,含缩进围栏)→ 单行「代码块」占位(保住结构位置)
 *   - 图片 ![alt](url) → alt 文字
 *   - HTML 注释整段剥除
 * 其余(标题层级/列表/粗体/链接文字)原样保留 —— 层级就是脑图骨架。
 */
export function mindmapMarkdown(md: string): string {
  const out: string[] = [];
  let fence: string | null = null; // 在围栏内 = 围栏标记(``` 或 ~~~)
  let fenceLen = 0;
  for (const line of md.split("\n")) {
    const open = /^(\s*)(`{3,}|~{3,})/.exec(line);
    if (fence == null) {
      if (open) {
        // 开围栏:长度 ≥3 的 ` 或 ~;占位用列表项语法(markmap 只认标题/列表为节点,
        // 裸段落会被并进上一项的懒延续或整段丢弃)且保留缩进不破嵌套
        fence = (open[2] ?? "")[0] ?? "`";
        fenceLen = (open[2] ?? "").length;
        out.push(`${open[1] ?? ""}- 代码块`);
        continue;
      }
      out.push(line);
    } else {
      const close = new RegExp(`^\\s*\\${fence === "~" ? "~" : "`"}{${fenceLen},}\\s*$`).test(line);
      if (close) {
        fence = null;
      }
      // 围栏内其余行丢弃(含围栏首行后的语言标注已在开行吞掉)
    }
  }
  return out
    .join("\n")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<!--[\s\S]*?-->/g, "");
}

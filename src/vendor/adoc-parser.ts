// Vendored from LookatStudy src/main/services/pure/adoc-parser.ts (MIT License, https://github.com/Kaiji-Z/LookatStudy).
// Unmodified except this provenance header. PDF/PPTX branches resolve unavailable optional libs and are skipped per upstream try/catch.
/**
 * AsciiDoc (.adoc / .asciidoc) → Markdown 转换器。
 *
 * 转换规则:
 *   - = Title → # Title(== Section → ## Section)
 *   - [source,lang] + ---- 代码块围栏 → ```lang
 *   - image::path[alt] → ![alt](path)
 *   - link:url[text] → [text](url)
 *   - *bold* → **bold**,_italic_ → *italic*(AsciiDoc 的 _ 下划线斜体)
 *   - > 引用保留;- 列表保留
 *   - ==== / ---- 作为标题下划线(老式 AsciiDoc)→ 跳过(单行语法优先)
 *
 * 纯函数,便于 verify 脚本测。
 */

export interface ParsedAdoc {
  markdown: string;
}

export function parseAdoc(adocText: string): ParsedAdoc {
  const lines = adocText.split("\n");
  const output: string[] = [];
  let inSourceBlock = false;
  let pendingLang = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    // [source,lang] 行 → 标记下一个 ---- 为代码块开始
    const sourceMatch = line.match(/^\[source,\s*(\w*)\s*\]$/);
    if (sourceMatch && !inSourceBlock) {
      pendingLang = sourceMatch[1] ?? "";
      // 检查下一行是否是 ---- (AsciiDoc 代码围栏)
      if ((lines[i + 1] ?? "").trim() === "----") {
        inSourceBlock = true;
        i++; // 跳过 ---- 行
        output.push(`\`\`\`${pendingLang}`);
        continue;
      }
    }

    // ---- 结束代码块
    if (inSourceBlock && line.trim() === "----") {
      inSourceBlock = false;
      output.push("```");
      continue;
    }
    if (inSourceBlock) {
      output.push(line);
      continue;
    }

    // ``` 原生代码块(某些 AsciiDoc 也用 markdown 围栏)→ 原样保留
    let processed = line;

    // 标题:= Title → # Title(== → ##);注意不与 === 三等(可能是水平线)冲突
    processed = processed.replace(/^(=+)\s+/, (_match, eqs) => {
      if (eqs.length > 6) return "#".repeat(6) + " "; // markdown 最多 6 级
      return "#".repeat(eqs.length) + " ";
    });

    // image::path[alt] → ![alt](path)
    processed = processed.replace(/image::(\S+?)\[([^\]]*)\]/g, (_m, path, alt) => {
      return alt ? `![${alt}](${path})` : `![](${path})`;
    });
    // image:path[alt](块图片,单冒号)→ 同上
    processed = processed.replace(/image:(\S+?)\[([^\]]*)\]/g, (_m, path, alt) => {
      return alt ? `![${alt}](${path})` : `![](${path})`;
    });

    // link:url[text] → [text](url)
    processed = processed.replace(/link:(\S+?)\[([^\]]*)\]/g, "[\$2](\$1)");

    // *bold* → **bold**(单词包围的 * → markdown **)
    processed = processed.replace(/(\s|^)\*([^\s*][^*]*?)\*(?=\s|[.,;:!?)])/gm, "$1**$2**");
    // _italic_ → *italic*
    processed = processed.replace(/(\s|^)_([^\s_][^_]*?)_(?=\s|[.,;:!?)])/gm, "$1*$2*");

    output.push(processed);
  }

  return { markdown: output.join("\n") };
}

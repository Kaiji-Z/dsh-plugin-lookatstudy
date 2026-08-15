// Vendored from LookatStudy src/main/services/pure/org-parser.ts (MIT License, https://github.com/kaiji/LookatStudy).
// Unmodified except this provenance header. PDF/PPTX branches resolve unavailable optional libs and are skipped per upstream try/catch.
/**
 * Org-mode (.org) → Markdown 转换器。
 *
 * Emacs 用户的小众格式,但 Python/GNU 课程偶有使用。
 *
 * 转换规则:
 *   - * Title → # Title(** Subtitle → ## Subtitle,Org 的 * 级别 = markdown # 级别)
 *   - #+BEGIN_SRC lang → ```lang,#+END_SRC → ```
 *   - #+BEGIN_EXAMPLE → ```,#+END_EXAMPLE → ```
 *   - [[url][text]] → [text](url);[[url]] → [url](url)
 *   - *bold* → **bold**, /italic/ → *italic*
 *   - #+KEYWORD: 元数据行 → 注释或剥除
 *   - - 列表项保留(markdown 一致)
 *
 * 纯函数,便于 verify 脚本测。
 */

export interface ParsedOrg {
  markdown: string;
}

export function parseOrg(orgText: string): ParsedOrg {
  const lines = orgText.split("\n");
  const output: string[] = [];
  let inSrcBlock = false;
  let srcLang = "";
  let inExampleBlock = false;

  for (const line of lines) {
    // #+BEGIN_SRC lang
    const beginSrc = line.match(/^\s*#\+BEGIN_SRC\s*(\w*)/i);
    if (beginSrc) {
      inSrcBlock = true;
      srcLang = beginSrc[1] ?? "";
      output.push(`\`\`\`${srcLang}`);
      continue;
    }
    // #+END_SRC
    if (/^\s*#\+END_SRC/i.test(line) && inSrcBlock) {
      inSrcBlock = false;
      output.push("```");
      continue;
    }
    if (inSrcBlock) {
      output.push(line);
      continue;
    }

    // #+BEGIN_EXAMPLE
    if (/^\s*#\+BEGIN_EXAMPLE/i.test(line)) {
      inExampleBlock = true;
      output.push("```");
      continue;
    }
    if (/^\s*#\+END_EXAMPLE/i.test(line) && inExampleBlock) {
      inExampleBlock = false;
      output.push("```");
      continue;
    }
    if (inExampleBlock) {
      output.push(line);
      continue;
    }

    // #+KEYWORD: 元数据行 → 跳过(或注释)
    if (/^\s*#\+/.test(line)) {
      continue;
    }

    let processed = line;

    // 标题:* Title → # Title(** Subtitle → ## Subtitle)
    processed = processed.replace(/^(\*+)\s+/, (_match, stars) => {
      return "#".repeat(stars.length) + " ";
    });

    // [[url][text]] → [text](url) (先匹配双括号格式,再单括号)
    processed = processed.replace(/\[\[([^\]]+)\]\[([^\]]+)\]\]/g, ( _m, url, text) => `[${text}](${url})`);
    // [[url]] → [url](url)
    processed = processed.replace(/\[\[([^\]]+)\]\]/g, (_m, url) => `[${url}](${url})`);

    // *bold* → **bold**(单词包围的 * → markdown **;排除行首列表 * 和 **)
    // 匹配规则:空格/行首 + *word* + 空格/标点/行尾
    processed = processed.replace(/(\s|^)\*([^\s*][^*]*?)\*(?=\s|[.,;:!?)])/gm, "$1**$2**");
    // /italic/ → *italic*
    processed = processed.replace(/(\s|^)\/([^\s/][^/]*?)\/(?=\s|[.,;:!?)])/gm, "$1*$2*");

    output.push(processed);
  }

  return { markdown: output.join("\n") };
}

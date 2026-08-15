// Vendored from LookatStudy src/main/services/pure/rmd-parser.ts (MIT License, https://github.com/kaiji/LookatStudy).
// Unmodified except this provenance header. PDF/PPTX branches resolve unavailable optional libs and are skipped per upstream try/catch.
/**
 * R Markdown (.Rmd) → Markdown 转换器。
 *
 * R 语言/统计课程常用 .Rmd。正文已是 markdown,只需:
 *   - 剥 YAML front matter(---\n...\n---)
 *   - ```{r} → ```r 代码块归一化(剥 chunk 名 + 参数)
 *   - ```{python} → ```python 等,通用 {lang} 归一化
 *   - 保持正文 markdown 原样
 *
 * 纯函数,便于 verify 脚本测。
 */

export interface ParsedRmd {
  markdown: string;
}

/**
 * 解析 .Rmd 文本,转成标准 markdown。
 *
 * @param rmdText .Rmd 文件内容
 * @returns { markdown }
 */
export function parseRmd(rmdText: string): ParsedRmd {
  let result = rmdText;

  // 1. 剥 YAML front matter(文件开头的 ---\n...\n---)
  result = result.replace(/^---\n[\s\S]*?\n---\n*/, "");

  // 2. 代码块归一化: ```{r chunk-name, echo=FALSE} → ```r
  // 匹配 ```{lang ...} 形式(Pandoc / knitr chunk 语法)
  result = result.replace(/```{(\w+)[^}]*}.*$/gm, (_match, lang) => {
    return "```" + (lang ?? "");
  });

  return { markdown: result.trim() };
}

// Vendored from LookatStudy src/main/services/pure/code-parser.ts (MIT License, https://github.com/Kaiji-Z/LookatStudy).
// Unmodified except this provenance header. PDF/PPTX branches resolve unavailable optional libs and are skipped per upstream try/catch.
/**
 * 代码文件解析器 —— 把 .py/.js/.go 等源代码文件转成可学习的 markdown。
 *
 * 设计理念:
 *   代码文件本身就是教学内容（karpathy/nanoGPT、算法题解、"learn X by building"）。
 *   提取模块级 docstring/注释块作为正文讲解，代码体用 ```lang 围栏包裹。
 *   下游 LLM (classifyFileRoles + designCourseStructure) 会基于此 markdown 判断角色和结构。
 *
 * 纯函数，便于 verify 脚本测。
 */

/** 扩展名 → markdown 围栏语言标签 */
const EXT_LANG: Record<string, string> = {
  py: "python",
  js: "javascript",
  jsx: "jsx",
  ts: "typescript",
  tsx: "tsx",
  mjs: "javascript",
  cjs: "javascript",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  scala: "scala",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  rb: "ruby",
  php: "php",
  swift: "swift",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  ps1: "powershell",
  lua: "lua",
  r: "r",
  jl: "julia",
  dart: "dart",
  clj: "clojure",
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  hs: "haskell",
  ml: "ocaml",
  fs: "fsharp",
  sql: "sql",
  vim: "vim",
  pl: "perl",
  elm: "elm",
  graphql: "graphql",
  proto: "protobuf",
  tf: "hcl",
  dockerfile: "dockerfile",
};

/** 获取扩展名对应的围栏语言标签 */
export function codeFenceLang(ext: string): string {
  return EXT_LANG[ext.toLowerCase()] ?? "";
}

/**
 * 提取文件开头的文档注释/docstring 作为正文讲解。
 *
 * 支持的注释风格:
 *   - Python: """...""" 或 '''...'''（模块级 docstring）
 *   - JS/TS/Java/Go/Rust/C: /** ... *\/ 块注释（连续多行）
 *   - Ruby: =begin ... =end
 *   - 通用: 连续的 // 或 # 注释行（开头至少 3 行才算文档）
 *
 * @returns { doc: 提取的文档文字（已去注释符号，空则 ""）, code: 完整原始代码 }
 */
export function extractLeadingDoc(
  raw: string,
  ext: string,
): { doc: string; code: string } {
  const lang = EXT_LANG[ext.toLowerCase()] ?? "";
  const lines = raw.split(/\r?\n/);

  // Python: """...""" 或 '''...'''
  if (lang === "python") {
    const trimmed = raw.trimStart();
    if (trimmed.startsWith('"""') || trimmed.startsWith("'''")) {
      const quote = trimmed.slice(0, 3);
      const endIdx = trimmed.indexOf(quote, 3);
      if (endIdx > 3) {
        const docText = trimmed.slice(3, endIdx).trim();
        return { doc: docText, code: raw };
      }
    }
  }

  // JS/TS/Java/C/Go/Rust/PHP/Swift/Scala/Kotlin: /** ... */
  if (/\*\/\s*$/.test(raw.slice(0, 2000).trimStart().split("\n")[0] ?? "") === false) {
    // 先检查开头是否有块注释
    const blockMatch = raw.match(/^\s*\/\*[\s\S]*?\*\//);
    if (blockMatch && blockMatch.index !== undefined && blockMatch.index < 5) {
      const block = blockMatch[0];
      // 只当块注释看起来像文档（含文字，不是许可证）时提取
      const inner = block
        .replace(/^\/\*+/, "")
        .replace(/\*+\/$/, "")
        .split("\n")
        .map((l) => l.replace(/^\s*\*\s?/, "").trim())
        .join("\n")
        .trim();
      // 过滤掉纯许可证/版权块（这些不是教学内容）
      const isLicense = /copyright|licensed|mit license|apache license|license:/i.test(inner);
      if (inner.length > 30 && !isLicense) {
        return { doc: inner, code: raw };
      }
    }
  }

  // 通用: 开头连续 # 或 // 注释行（至少 3 行才算文档块）
  const commentChar = lang === "python" || lang === "ruby" || lang === "r" || lang === "elixir" || lang === "bash"
    ? "#"
    : lang === "lua"
      ? "--"
      : null;

  if (commentChar) {
    const commentLines: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith(commentChar)) {
        commentLines.push(trimmed.slice(commentChar.length).trim());
      } else if (trimmed === "" && commentLines.length > 0) {
        continue; // 允许注释块中间的空行
      } else {
        break;
      }
    }
    if (commentLines.length >= 3) {
      const docText = commentLines.join("\n").trim();
      const isLicense = /copyright|licensed|mit license|apache license|license:/i.test(docText);
      if (docText.length > 20 && !isLicense) {
        return { doc: docText, code: raw };
      }
    }
  }

  // 无文档注释
  return { doc: "", code: raw };
}

/**
 * 把代码文件转成 markdown。
 * 有 docstring → 正文 + 代码围栏；无 → 纯代码围栏。
 */
export function parseCode(raw: string, ext: string): { markdown: string } {
  const lang = EXT_LANG[ext.toLowerCase()] ?? "";
  const { doc, code } = extractLeadingDoc(raw, ext);
  if (doc) {
    return { markdown: `${doc}\n\n\`\`\`${lang}\n${code}\n\`\`\`` };
  }
  return { markdown: `\`\`\`${lang}\n${raw}\n\`\`\`` };
}

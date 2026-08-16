// Vendored from LookatStudy src/main/services/pure/rst-parser.ts (MIT License, https://github.com/Kaiji-Z/LookatStudy).
// Unmodified except this provenance header. PDF/PPTX branches resolve unavailable optional libs and are skipped per upstream try/catch.
/**
 * reStructuredText (.rst) → Markdown 转换器。
 *
 * Python 官方文档 / Sphinx 课程 / PEP 文档常用 .rst。
 *
 * 转换规则:
 *   - 标题:下划线行(=====/-----/~~~~~/::::/*****)
 *     下一行长度覆盖标题文本 → 该符号 → # 级别(按下划线出现顺序赋级别)
 *   - .. code-block:: lang → ```lang 代码块
 *   - .. image:: path → ![](path)(含 :alt: → alt)
 *   - .. note:: / .. warning:: → > **注** / > **⚠️** 引用块
 *   - :ref:`text` → text,:code:`x` → `x`,:doc:`path` → path
 *   - 行内 ``code`` → `code`(双反引号 → 单反引号)
 *   - .. [1] 脚注 → 跳过
 *
 * 纯函数,便于 verify 脚本测。
 */

/** rst 解析结果 */
export interface ParsedRst {
  markdown: string;
}

/**
 * 解析 rst 文本,转成 markdown。
 *
 * @param rstText .rst 文件内容
 * @returns { markdown }
 */
export function parseRst(rstText: string): ParsedRst {
  const lines = rstText.split("\n");
  const output: string[] = [];

  // 下划线符号 → markdown 标题级别(按首次出现顺序分配)
  const underlineLevels = new Map<string, number>();
  let nextLevel = 1;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const nextLine = lines[i + 1] ?? "";

    // 检测标题:当前行非空 + 下一行是下划线(同长或更长)
    const underlineMatch = nextLine.match(/^([=\-~:*"'^+_-])\1+$/);
    if (line.trim() && underlineMatch && (nextLine.length ?? 0) >= line.trim().length) {
      const symbol = underlineMatch[1];
      if (symbol && !underlineLevels.has(symbol)) {
        underlineLevels.set(symbol, nextLevel++);
        if (nextLevel > 6) nextLevel = 6;
      }
      const level = underlineLevels.get(symbol!) ?? 1;
      const hashes = "#".repeat(Math.min(level, 6));
      output.push(`${hashes} ${line.trim()}`);
      i += 2; // 跳过标题行 + 下划线行
      continue;
    }

    // .. code-block:: lang
    const codeBlockMatch = line.match(/^\.\.\s+code-block::\s*(\S*)/);
    if (codeBlockMatch) {
      const lang = codeBlockMatch[1] ?? "";
      // 收集缩进的代码行(缩进 > .. 的缩进)
      const codeLines: string[] = [];
      i++;
      // 跳过空行
      while (i < lines.length && (lines[i] ?? "").trim() === "") i++;
      // 收缩进行的代码
      while (i < lines.length) {
        const codeLine = lines[i] ?? "";
        if (codeLine.trim() === "" && i + 1 < lines.length && !(lines[i + 1] ?? "").startsWith("   ")) {
          break;
        }
        if (codeLine.startsWith("   ") || codeLine.startsWith("\t") || codeLine.trim() === "") {
          codeLines.push(codeLine.replace(/^   |^\t/, ""));
        } else {
          break;
        }
        i++;
      }
      output.push(`\`\`\`${lang}\n${codeLines.join("\n")}\n\`\`\``);
      continue;
    }

    // .. image:: path
    const imageMatch = line.match(/^\.\.\s+image::\s*(\S+)/);
    if (imageMatch) {
      const imgPath = imageMatch[1] ?? "";
      // 向下找 :alt:
      let alt = "";
      let j = i + 1;
      while (j < lines.length && (lines[j] ?? "").startsWith("   :")) {
        const altMatch = (lines[j] ?? "").match(/:alt:\s*(.+)/);
        if (altMatch) alt = altMatch[1]?.trim() ?? "";
        j++;
      }
      output.push(alt ? `![${alt}](${imgPath})` : `![](${imgPath})`);
      i = j;
      continue;
    }

    // .. note:: / .. warning:: / .. tip::
    const admonitionMatch = line.match(/^\.\.\s+(note|warning|tip|important|caution)::/);
    if (admonitionMatch) {
      const kind = admonitionMatch[1];
      const labels: Record<string, string> = {
        note: "📝 **注**",
        warning: "⚠️ **警告**",
        tip: "💡 **提示**",
        important: "❗ **重要**",
        caution: "⚠️ **注意**",
      };
      const label = labels[kind ?? ""] ?? "📝";
      // 收集缩进内容
      const contentLines: string[] = [];
      i++;
      while (i < lines.length && (lines[i] ?? "").trim() === "") i++;
      while (i < lines.length) {
        const contentLine = lines[i] ?? "";
        if (contentLine.startsWith("   ") || contentLine.startsWith("\t") || contentLine.trim() === "") {
          if (contentLine.trim()) contentLines.push(contentLine.replace(/^   |^\t/, ""));
        } else break;
        i++;
      }
      output.push(`> ${label}`);
      for (const cl of contentLines) output.push(`> ${cl}`);
      continue;
    }

    // 其他 .. directive(跳过,如 .. contents:: / .. toctree::)
    if (/^\.\.\s/.test(line) && !line.includes("code-block") && !line.includes("image")) {
      // 跳过 directive 行 + 缩进行
      i++;
      while (i < lines.length && ((lines[i] ?? "").startsWith("   ") || (lines[i] ?? "").startsWith("\t") || (lines[i] ?? "").trim() === "")) {
        i++;
      }
      continue;
    }

    // 行内转换:双反引号 → 单反引号
    let processed = line.replace(/``([^`]+)``/g, "`$1`");
    // :ref:`text` → text; :code:`x` → `x`; :doc:`path` → path
    processed = processed.replace(/:\w+:`([^`]+)`/g, (_match, content) => {
      // :code: 特殊处理 → `code`
      return content.includes("`") ? content : "`" + content + "`";
    });
    // 简化:大部分 :role:`content` → content(丢掉 role 标记)
    processed = processed.replace(/:\w+:`([^`]+)`/g, "$1");

    output.push(processed);
    i++;
  }

  return { markdown: output.join("\n") };
}

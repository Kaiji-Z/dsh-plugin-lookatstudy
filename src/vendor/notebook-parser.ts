// Vendored from LookatStudy src/main/services/pure/notebook-parser.ts (MIT License, https://github.com/Kaiji-Z/LookatStudy).
// Unmodified except this provenance header. PDF/PPTX branches resolve unavailable optional libs and are skipped per upstream try/catch.
/**
 * Jupyter Notebook (.ipynb) 解析器 —— 把 JSON 格式的 notebook 转成 markdown + 图片。
 *
 * nbformat 4 结构:
 *   {
 *     cells: [
 *       { cell_type: "markdown", source: string | string[] },
 *       { cell_type: "code", source: string | string[], outputs: [
 *         { data: { "image/png": "base64...", "text/plain": "..." } }
 *       ] }
 *     ],
 *     metadata: { kernelspec: { display_name, name, language } }
 *   }
 *
 * 转换策略:
 *   - markdown cell → 原样输出(保持 Markdown 格式)
 *   - code cell → ```{language}\n{code}\n``` 代码块
 *   - code cell 的 image output → 提取为 ScannedImage(buffer 型,source="notebook_output")
 *   - code cell 的 text output → 附在代码块后作为注释(可选)
 *
 * 纯函数设计,便于 verify 脚本测(JSON 解构 + cell 分拣,不依赖 IO)。
 */

/** 解析出的图片(notebook output 或 markdown 引用) */
export interface NotebookImage {
  /** base64 数据(不含 data: 前缀) */
  base64: string;
  mimeType: string;
  /** 来源类型 */
  source: "notebook_output" | "markdown_ref";
  /** cell 索引(用于溯源) */
  cellIndex: number;
  /** alt/描述 */
  altText: string;
}

/** notebook 解析结果 */
export interface ParsedNotebook {
  /** 转换后的 markdown 文本(markdown cell + code block) */
  markdown: string;
  /** 提取的图片(output 内嵌图) */
  images: NotebookImage[];
  /** 语言(Python / R / Julia 等,从 kernelspec 推断) */
  language: string;
  /** cell 统计 */
  stats: {
    markdownCells: number;
    codeCells: number;
    totalCells: number;
  };
}

/** 从 kernelspec 推断代码块语言标识(用于 markdown ``` 语法高亮) */
export function inferLanguage(metadata: {
  kernelspec?: { name?: string; display_name?: string; language?: string };
  language_info?: { name?: string };
}): string {
  // kernelspec.language 优先
  if (metadata.kernelspec?.language) return metadata.kernelspec.language.toLowerCase();
  // language_info.name
  if (metadata.language_info?.name) return metadata.language_info.name.toLowerCase();
  // kernelspec.name 推断
  const name = metadata.kernelspec?.name ?? "";
  if (name.includes("python")) return "python";
  if (name.includes("ir") || name.includes("r-")) return "r";
  if (name.includes("julia")) return "julia";
  return "python"; // 默认 python(Jupyter 最常见)
}

/**
 * 把 source 字段(string 或 string[])统一成 string。
 * nbformat 的 source 可以是数组(每行一个元素)或整体字符串。
 */
export function normalizeSource(source: unknown): string {
  if (typeof source === "string") return source;
  if (Array.isArray(source)) return source.join("");
  return "";
}

/**
 * 从 code cell 的 outputs 里提取图片(base64)。
 * nbformat output 结构:
 *   { output_type: "execute_result"|"display_data", data: { "image/png": "base64..." } }
 *   { output_type: "stream", text: "..." } — 纯文本流,不含图
 *   { output_type: "error", ename, evalue } — 错误,不含图
 */
export function extractOutputImages(
  outputs: unknown[] | undefined,
  cellIndex: number,
): NotebookImage[] {
  if (!Array.isArray(outputs)) return [];
  const images: NotebookImage[] = [];
  for (const output of outputs) {
    if (!output || typeof output !== "object") continue;
    const o = output as Record<string, unknown>;
    const data = o.data as Record<string, unknown> | undefined;
    if (!data) continue;
    // image/png
    const png = data["image/png"];
    if (typeof png === "string" && png.length > 0) {
      images.push({
        base64: png,
        mimeType: "image/png",
        source: "notebook_output",
        cellIndex,
        altText: `Notebook cell ${cellIndex} 输出图`,
      });
    }
    // image/jpeg
    const jpeg = data["image/jpeg"];
    if (typeof jpeg === "string" && jpeg.length > 0) {
      images.push({
        base64: jpeg,
        mimeType: "image/jpeg",
        source: "notebook_output",
        cellIndex,
        altText: `Notebook cell ${cellIndex} 输出图`,
      });
    }
  }
  return images;
}

/**
 * 解析一个 .ipynb JSON 字符串,转成 markdown + 图片。
 *
 * @param jsonText .ipynb 文件的原始 JSON 字符串
 * @returns { markdown, images, language, stats }
 *
 * 纯函数,不依赖 IO,可直接测。
 */
export function parseNotebook(jsonText: string): ParsedNotebook {
  let nb: Record<string, unknown>;
  try {
    nb = JSON.parse(jsonText);
  } catch {
    throw new Error("parseNotebook: 无效的 JSON(不是合法的 .ipynb 文件)");
  }

  const cells = Array.isArray(nb.cells) ? (nb.cells as Record<string, unknown>[]) : [];
  const metadata = (nb.metadata ?? {}) as ParsedNotebook["stats"] extends never ? never : {
    kernelspec?: { name?: string; display_name?: string; language?: string };
    language_info?: { name?: string };
  };
  const language = inferLanguage(metadata as Parameters<typeof inferLanguage>[0]);

  const mdParts: string[] = [];
  const images: NotebookImage[] = [];
  let markdownCells = 0;
  let codeCells = 0;

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (!cell) continue;
    const cellType = cell.cell_type as string | undefined;
    const source = normalizeSource(cell.source);

    if (cellType === "markdown") {
      markdownCells++;
      mdParts.push(source);
    } else if (cellType === "code") {
      codeCells++;
      // 代码块
      mdParts.push(`\`\`\`${language}\n${source}\n\`\`\``);
      // 提取 output 图片
      const cellImages = extractOutputImages(cell.outputs as unknown[] | undefined, i);
      images.push(...cellImages);
    }
    // raw cell / 其他类型跳过
  }

  return {
    markdown: mdParts.join("\n\n"),
    images,
    language,
    stats: {
      markdownCells,
      codeCells,
      totalCells: cells.length,
    },
  };
}

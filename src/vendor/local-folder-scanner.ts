// Vendored from LookatStudy src/main/services/pure/local-folder-scanner.ts (MIT License, https://github.com/kaiji/LookatStudy).
// Local modification (documented): dedupKey() includes the file's directory so
// per-lesson README.md files in different directories are NOT collapsed into one
// (upstream keys on basename alone, dropping every nested README after the first —
// fatal for course repos whose lessons live in per-directory READMEs).
// PDF/PPTX branches resolve unavailable optional libs and are skipped per upstream try/catch.
/**
 * 本地文件夹通用扫描器 —— 把任意课程文件夹(如 Coursera 下载包)递归扫描成文档清单。
 *
 * 设计原则:通用,不硬编码某一种文件夹结构。
 *   - 扫描文档类:.txt/.md/.mdx/.markdown/.html/.htm/.pdf/.ipynb/.rst/.rmd/.org/.adoc/.asciidoc
 *   - 扫描代码类:.py/.js/.ts/.go/.rs/.java/.c/.cpp/.rb/.sh/.lua/.sql/.r/.jl/.dart/... (30+ 语言, code-parser 转 markdown)
 *   - 图片文件:.png/.jpg/.jpeg/.gif/.webp/.svg/.bmp/.avif/.ico/.tiff/.heic(多模态 flag on 时收集)
 *   - 中文优先去重(同内容 .zh-CN 和 .en 只留中文)
 *   - 按文件名 NN_ 前缀排序
 *   - HTML 去标签转纯文本(<co-content> 富文本质量足够)
 *   - PDF 用 pdf-renderer 提取文字 + 图片(纯文字/纯图片/混合自动分类)
 *
 * 纯函数为主(htmlToText/标题推断/去重/图片引用解析),便于 verify 脚本测。
 * scanFolder 本身用 fs(异步),verify 用临时目录造文件测。
 */
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, sep, basename, dirname } from "node:path";

export interface ScannedDoc {
  /** 相对根目录的路径(如 calculus/week1/lesson1/06_motivation.zh-CN.txt),用 / 分隔 */
  path: string;
  /** 从路径/文件名推断的标题(去数字前缀/扩展名/语言后缀) */
  title: string;
  /** 提取的纯文本内容 */
  content: string;
  /** 语言(zh/en/other),用于去重 */
  lang: "zh" | "en" | "other";
  /** 文件类型 */
  kind: "txt" | "md" | "html" | "pdf" | "ipynb" | "rst" | "rmd" | "org" | "adoc" | "code" | "pptx";
}

/** 扫描到的图片资源(独立图片文件 / markdown 引用 / PDF 页面渲染图) */
export interface ScannedImage {
  /** 相对根目录的路径(用 / 分隔) */
  path: string;
  /** 绝对路径(落库时复制到 assets 用);buffer 型(PDF 提取)为空串 */
  absPath: string;
  /** 从文件名推断的标题/描述 */
  title: string;
  /** MIME 类型 */
  mime: string;
  /** 来源:独立文件 / markdown 引用 / PDF 页面渲染图 */
  source: "image_file" | "markdown_ref" | "pdf_page";
  /** markdown ![](x) 的 alt 文本(独立文件时 = title) */
  altText: string;
  /** PDF 提取的图片二进制(有 buffer 时 absPath 可空);独立文件时为 undefined */
  buffer?: Buffer;
  /** PDF 来源页码(1-based);非 PDF 为 undefined */
  pageNumber?: number;
}

/** 支持的扩展名 → kind 映射 */
const EXT_KIND: Record<string, ScannedDoc["kind"]> = {
  txt: "txt",
  md: "md",
  mdx: "md",
  markdown: "md",
  html: "html",
  htm: "html",
  pdf: "pdf",
  pptx: "pptx",
  ipynb: "ipynb",
  rst: "rst",
  rmd: "rmd",
  org: "org",
  adoc: "adoc",
  asciidoc: "adoc",
  // 代码文件 → code kind (代码即教学内容)
  py: "code", js: "code", jsx: "code", ts: "code", tsx: "code", mjs: "code", cjs: "code",
  go: "code", rs: "code", java: "code", kt: "code", kts: "code", scala: "code",
  c: "code", h: "code", cpp: "code", cc: "code", cxx: "code", hpp: "code",
  cs: "code", rb: "code", php: "code", swift: "code",
  sh: "code", bash: "code", zsh: "code", ps1: "code",
  lua: "code", r: "code", jl: "code", dart: "code",
  clj: "code", ex: "code", exs: "code", erl: "code", hs: "code", ml: "code", fs: "code",
  sql: "code", pl: "code", elm: "code",
};

/** 图片扩展名 → MIME 映射 */
const IMAGE_EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  avif: "image/avif",
  ico: "image/x-icon",
  tiff: "image/tiff",
  tif: "image/tiff",
  heic: "image/heic",
};

/** 排除的目录(非教学内容) */
const EXCLUDED_DIRS = new Set([
  "node_modules", ".git", ".svn", "dist", "build", "__pycache__",
  ".DS_Store", "translations",
  ".venv", "venv", "env", "vendor", "target", "out", "coverage",
  ".next", ".nuxt", ".gradle", ".idea", ".vscode", ".cache",
  ".pytest_cache", ".mypy_cache", ".turbo", ".svelte-kit",
  "bin", "obj", "__pypackages__", ".docusaurus",
]);

/** HTML 转纯文本:去 script/style,标签转段落,<li> 加 •,decode 常见实体。纯函数,可测。 */
export function htmlToText(html: string): string {
  let s = html;
  // 去 script/style 整块
  s = s.replace(/<script[\s\S]*?<\/script>/gi, "");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, "");
  s = s.replace(/<head[\s\S]*?<\/head>/gi, "");
  // 块级标签 → 换行
  s = s.replace(/<\/(p|div|section|article|h[1-6]|li|tr|br)>/gi, "\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  // <li> → 项目符号
  s = s.replace(/<li[^>]*>/gi, "• ");
  // 表格单元格分隔
  s = s.replace(/<\/td>/gi, "\t");
  s = s.replace(/<\/th>/gi, "\t");
  // 去所有剩余标签
  s = s.replace(/<[^>]+>/g, "");
  // decode 常见 HTML 实体
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&hellip;/g, "…")
    .replace(/&mdash;/g, "—");
  // 压缩多余空白(保留段落分隔)
  s = s.replace(/[ \t]+/g, " ");
  s = s.replace(/\n[ \t]+/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

/** 从文件名推断语言(用于中文优先去重)。 */
export function detectLang(filename: string): "zh" | "en" | "other" {
  const lower = filename.toLowerCase();
  if (/\.zh[-_]?cn\./.test(lower) || /\.zh[-_]?hans\./.test(lower) || /\.zh[-_]?tw\./.test(lower) || /\.zh[-_]?hant\./.test(lower) || /\.zh\./.test(lower)) return "zh";
  if (/\.en[-_]?us\./.test(lower) || /\.en[-_]?gb\./.test(lower) || /\.en\./.test(lower)) return "en";
  if (/\.ja\./.test(lower) || /\.ko\./.test(lower) || /\.de\./.test(lower) || /\.fr\./.test(lower) || /\.es\./.test(lower) || /\.pt[-_]?br\./.test(lower) || /\.pt\./.test(lower) || /\.it\./.test(lower) || /\.ru\./.test(lower) || /\.ar\./.test(lower)) return "other";
  return "other";
}

/** 从路径推断标题:
 *   07_derivatives-and-tangents.zh-CN.txt → "Derivatives And Tangents"
 *   01_lesson-1-intro/README.md → "Lesson 1 Intro"
 * 去数字前缀 + 扩展名 + 语言后缀,- _ 转空格,首字母大写。纯函数,可测。 */
export function inferTitle(relPath: string): string {
  const filename = basename(relPath);
  // 去扩展名
  let name = filename.replace(/\.(txt|md|mdx|markdown|html?|pdf|ipynb|rst|rmd|org|adoc|asciidoc|py|js|jsx|ts|tsx|mjs|cjs|go|rs|java|kt|kts|scala|c|h|cpp|cc|cxx|hpp|cs|rb|php|swift|sh|bash|zsh|ps1|lua|r|jl|dart|clj|ex|exs|erl|hs|ml|fs|sql|pl|elm)$/i, "");
  // 去语言后缀(.zh-CN / .en / .en-US 等)
  name = name.replace(/\.(zh[-_]?cn|zh[-_]?hans|zh|en[-_]?us|en)$/i, "");
  // README / index → 用父目录名
  if (/^(readme|index)$/i.test(name)) {
    const parts = relPath.split("/").filter(Boolean);
    const parent = parts[parts.length - 2];
    if (parent) name = parent;
  }
  // 去开头数字前缀(01_ / 02-)
  name = name.replace(/^(\d+[_-]\s*)/, "");
  // - 和 _ 转空格
  name = name.replace(/[-_]+/g, " ").trim();
  // 首字母大写(英文),中文不受影响
  if (/^[a-z]/.test(name)) name = name.charAt(0).toUpperCase() + name.slice(1);
  return name || filename;
}

/** 算 basename 的去重 key(去掉语言后缀 + 扩展名)。
 *  06_motivation.en.txt 和 06_motivation.zh-CN.txt → key "06_motivation" */
export function dedupKey(relPath: string): string {
  const dir = dirname(relPath).toLowerCase();
  const filename = basename(relPath);
  let name = filename.replace(/\.(txt|md|mdx|markdown|html?|pdf|ipynb|rst|rmd|org|adoc|asciidoc|py|js|jsx|ts|tsx|mjs|cjs|go|rs|java|kt|kts|scala|c|h|cpp|cc|cxx|hpp|cs|rb|php|swift|sh|bash|zsh|ps1|lua|r|jl|dart|clj|ex|exs|erl|hs|ml|fs|sql|pl|elm)$/i, "");
  name = name.replace(/\.(zh[-_]?cn|zh[-_]?hans|zh|en[-_]?us|en)$/i, "");
  return (dir === "." ? "" : dir + "/") + name.toLowerCase();
}

/**
 * 递归扫描一个目录,返回所有文本类文档(可选:同时收集图片)。
 * 中文优先去重:同 dedupKey 的多语言文件只保留中文(.zh 优先于 .en/other)。
 * 按相对路径排序(保持目录顺序 + 文件名 NN_ 前缀)。
 *
 * @param rootDir 根目录绝对路径
 * @param onProgress 可选进度回调(已扫文件数,当前路径)
 * @param options.collectImages true 时同时收集图片文件 + markdown 图片引用(多模态 flag)
 * @returns 文档数组,或 { docs, images }(collectImages=true 时)
 */
export async function scanFolder(
  rootDir: string,
  onProgress?: (scanned: number, currentPath: string) => void,
  options?: { collectImages?: boolean },
): Promise<ScannedDoc[] | { docs: ScannedDoc[]; images: ScannedImage[] }> {
  const allFiles: { absPath: string; relPath: string; isImage: boolean }[] = [];
  await walkDir(rootDir, rootDir, allFiles);

  // 按相对路径排序(目录顺序 + 文件名数字前缀)
  allFiles.sort((a, b) => naturalPathCompare(a.relPath, b.relPath));

  const docFiles = allFiles.filter((f) => !f.isImage);
  const imageFiles = allFiles.filter((f) => f.isImage);

  // 读所有文档文件,按 kind 提取内容
  const docs: ScannedDoc[] = [];
  let count = 0;
  for (const f of docFiles) {
    onProgress?.(++count, f.relPath);
    const ext = f.relPath.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? "";
    const kind = EXT_KIND[ext];
    if (!kind) continue;
    try {
      const content = await readFileWithKind(f.absPath, kind);
      if (!content || content.trim().length < 5) continue; // 跳过空/太短文件(中文 4-5 字也算有效)
      const lang = detectLang(f.relPath);
      docs.push({
        path: f.relPath,
        title: inferTitle(f.relPath),
        content,
        lang,
        kind,
      });
    } catch {
      // 单文件失败跳过(如损坏 PDF),不阻塞整体扫描
    }
  }

  // 中文优先去重:同 dedupKey 的文件,优先级 zh > en > other
  const dedupedDocs = dedupByLang(docs);

  // 不收图 → 直接返回(向后兼容)
  if (!options?.collectImages) {
    return dedupedDocs;
  }

  // === 收图 ===

  // 1. 独立图片文件
  const fileImages: ScannedImage[] = imageFiles.map((f) => {
    const ext = f.relPath.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? "";
    return {
      path: f.relPath,
      absPath: f.absPath,
      title: inferImageTitle(f.relPath),
      mime: IMAGE_EXT_MIME[ext] ?? "image/png",
      source: "image_file" as const,
      altText: inferImageTitle(f.relPath),
    };
  });

  // 2. markdown 图片引用(从 .md/.html 文档正文解析)
  const refImages: ScannedImage[] = [];
  for (const doc of dedupedDocs) {
    // 所有格式解析后都已转成 markdown,图片引用统一用 ![](path) 或 <img> 语法
    // txt 可能含裸路径但不常见,跳过;html 走 htmlToText 后图片标签已丢
    if (doc.kind === "txt" || doc.kind === "html") continue;
    const refs = extractImageRefs(doc.content);
    for (const ref of refs) {
      const resolvedPath = resolveImageRef(ref.refPath, doc.path);
      // 跳过已被独立文件覆盖的(去重后做)
      const ext = resolvedPath.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? "";
      refImages.push({
        path: resolvedPath,
        absPath: join(rootDir, resolvedPath),
        title: ref.alt || inferImageTitle(resolvedPath),
        mime: IMAGE_EXT_MIME[ext] ?? "image/png",
        source: "markdown_ref" as const,
        altText: ref.alt || inferImageTitle(resolvedPath),
      });
    }
  }

  // 去重:同 path 只留一份(file 优先)
  const dedupedFileAndRefImages = dedupImages(fileImages, refImages);

  // 3. PDF 内嵌图片提取(纯文字 PDF 无图;混合/纯图片 PDF 有图)
  const pdfImages: ScannedImage[] = [];
  for (const doc of dedupedDocs) {
    if (doc.kind !== "pdf") continue;
    try {
      const { processPdf } = await import("../../lib/pdf-renderer.js");
      const pdfBuf = await readFile(join(rootDir, doc.path));
      const result = await processPdf(pdfBuf);
      for (const img of result.images) {
        pdfImages.push({
          path: `${doc.path}#page${img.pageNumber}.png`,
          absPath: "", // buffer 型,无源文件
          title: `${doc.title} - 图(第${img.pageNumber}页)`,
          mime: img.mimeType,
          source: "pdf_page" as const,
          altText: `${doc.title} 第${img.pageNumber}页`,
          buffer: img.buffer,
          pageNumber: img.pageNumber,
        });
      }
    } catch {
      // PDF 图片提取失败跳过(文字已在 doc.content 里)
    }
  }

  // 3b. PPTX 内嵌图片提取(每 slide 的图片对象)
  // 复用 source="pdf_page"(都是 buffer 提取的文档图 + 带 page/slide 号);不新增
  // "pptx_slide" kind —— schema.sql node_assets 有 CHECK 约束, 改了存量 DB 迁移不了。
  // pageNumber 存 slideNumber。语义小瑕疵(slide 复用 pdf_page 标签)用此注释说明。
  const pptxImages: ScannedImage[] = [];
  for (const doc of dedupedDocs) {
    if (doc.kind !== "pptx") continue;
    try {
      const { parsePptx } = await import("../../lib/pptx-parser.js");
      const pptxBuf = await readFile(join(rootDir, doc.path));
      const result = await parsePptx(pptxBuf);
      for (const img of result.images) {
        pptxImages.push({
          path: `${doc.path}#slide${img.slideNumber}.png`,
          absPath: "", // buffer 型, 无源文件
          title: `${doc.title} - 图(第${img.slideNumber}页)`,
          mime: img.mimeType,
          source: "pdf_page" as const, // 复用(见上注释)
          altText: `${doc.title} 第${img.slideNumber}页`,
          buffer: img.buffer,
          pageNumber: img.slideNumber,
        });
      }
    } catch {
      // PPTX 图片提取失败跳过(文字已在 doc.content 里)
    }
  }

  // 4. ipynb output 图片提取(notebook 的 code cell 执行输出图)
  const notebookImages: ScannedImage[] = [];
  for (const doc of dedupedDocs) {
    if (!doc.path.toLowerCase().endsWith(".ipynb")) continue;
    try {
      const { parseNotebook } = await import("./notebook-parser.js");
      const nbRaw = await readFile(join(rootDir, doc.path), "utf8");
      const nbResult = parseNotebook(nbRaw);
      for (const img of nbResult.images) {
        const buf = Buffer.from(img.base64, "base64");
        notebookImages.push({
          path: `${doc.path}#cell${img.cellIndex}.png`,
          absPath: "", // buffer 型
          title: `${doc.title} - 输出图(cell ${img.cellIndex})`,
          mime: img.mimeType,
          source: "image_file" as const, // 复用 image_file 类型(buffer 型)
          altText: img.altText,
          buffer: buf,
        });
      }
    } catch {
      // notebook 图片提取失败跳过(文字已在 doc.content 里)
    }
  }

  // 全部图片合并(PDF/notebook 图用唯一 path,不会和文件图冲突)
  const images = [...dedupedFileAndRefImages, ...pdfImages, ...pptxImages, ...notebookImages];

  return { docs: dedupedDocs, images };
}

/**
 * 同语言类别内部去重（保留双语配对）。
 *
 * 历史：旧版是跨语言的"中文优先"（同 dedupKey 只留 zh）——那是翻译管线诞生前的
 * hack，xxx.en.txt / xxx.zh-CN.txt 成对时英文原稿被直接丢掉，双语信息在扫描层
 * 就没了，翻译管线永远拿不到配对。现在分类层（excludeSuffixTranslations 规则
 * 分流 + LLM translation 角色）负责把成对双语分流为 原文+翻译，所以扫描器必须
 * 把配对双方都保留，只合并同一语言类别内部的真重复（如 08.en.txt vs 08.en.md）。
 */
export function dedupByLang(docs: ScannedDoc[]): ScannedDoc[] {
  const byKey = new Map<string, ScannedDoc>();
  for (const d of docs) {
    const key = `${dedupKey(d.path)}|${d.lang}`;
    if (!byKey.has(key)) byKey.set(key, d); // 同语言同 key 保留首个（docs 已按自然序排好）
  }
  // 保持原顺序
  return docs.filter((d) => byKey.get(`${dedupKey(d.path)}|${d.lang}`) === d);
}

/* ============================================================
 * 图片收集(多模态 flag on 时启用)
 * ============================================================ */

/** markdown 图片引用提取结果 */
export interface MarkdownImageRef {
  /** 原始 alt 文本 */
  alt: string;
  /** 引用路径(markdown 里的原始写法,如 ./img.png 或 ../assets/fig.png) */
  refPath: string;
}

/**
 * 从 markdown 内容里提取图片引用 ![alt](path)。
 * 纯函数,便于测试。
 *
 * 解析规则:
 *   - 匹配 ![可选alt](路径) 格式
 *   - 去掉路径里的锚点和查询参数后缀
 *   - 只保留图片扩展名(.png/.jpg/.jpeg/.gif/.webp/.svg/.bmp)
 *   - 跳过 http(s) 绝对 URL(这些是外部资源,本地没有文件)
 *   - 跳过 data: URL
 */
export function extractImageRefs(md: string): MarkdownImageRef[] {
  const refs: MarkdownImageRef[] = [];
  const seen = new Set<string>();

  // 1. Markdown 语法 ![alt](url)
  const mdPattern = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = mdPattern.exec(md)) !== null) {
    const alt = m[1].trim();
    let url = m[2].trim();
    // 去空格和标题(如 ![alt](path "title"))
    const titleMatch = url.match(/\s+"[^"]*"$/);
    if (titleMatch) url = url.slice(0, titleMatch.index).trim();
    // 去锚点
    url = url.split("#")[0];
    // 跳过外部 URL 和 data URL
    if (!url || url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:")) continue;
    // 只留图片扩展名
    const ext = url.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? "";
    if (!(ext in IMAGE_EXT_MIME)) continue;
    const key = alt + "|" + url;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ alt, refPath: url });
  }

  // 2. HTML <img> 标签(src='...' 或 src="...")
  // 覆盖微软课程仓库常见的 <img src='images/xxx.png' alt='描述'/>
  // 两步法:先提取 <img ...> 整标签,再独立提取 src 和 alt(属性顺序无关)
  const htmlPattern = /<img\s+[^>]*>/gi;
  let hm: RegExpExecArray | null;
  while ((hm = htmlPattern.exec(md)) !== null) {
    const tag = hm[0];
    const url = (tag.match(/src=['"]([^'"]+)['"]/i)?.[1] ?? "").trim().split("#")[0];
    const alt = (tag.match(/alt=['"]([^'"]*)['"]/i)?.[1] ?? "").trim();
    if (!url || url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:")) continue;
    const ext = url.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? "";
    if (!(ext in IMAGE_EXT_MIME)) continue;
    const key = alt + "|" + url;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ alt: alt || (url.split("/").pop() ?? url), refPath: url });
  }

  return refs;
}

/**
 * 把 markdown 图片引用解析成相对于扫描根目录的路径。
 * 处理 ./ ../ 等相对引用。
 *
 * @param refPath markdown 里的原始引用(如 ./img.png)
 * @param docRelPath 引用所在文档的相对路径(如 ch1/lesson1/notes.md)
 * @returns 相对根目录的标准化路径(如 ch1/lesson1/img.png),用 / 分隔
 *
 * 纯函数,便于测试。
 */
export function resolveImageRef(refPath: string, docRelPath: string): string {
  const docDir = dirname(docRelPath).replace(/\\/g, "/");
  // 统一用 / 分隔(Windows \ 路径归一)
  const normalized = refPath.replace(/\\/g, "/").replace(/^\.\//, "");
  // 相对引用(含 ./ ../ 纯文件名 子目录)→ 相对 docDir 解析。
  // 用纯字符串拼接(不依赖 node:path 的盘符行为,跨平台一致)。
  const parts = docDir === "." ? [] : docDir.split("/").filter(Boolean);
  const refParts = normalized.split("/");
  for (const p of refParts) {
    if (p === "..") parts.pop();
    else if (p !== "." && p !== "") parts.push(p);
  }
  return parts.join("/");
}

/** 从图片文件名推断 alt 文本(去扩展名 + 数字前缀) */
export function inferImageTitle(filename: string): string {
  let name = basename(filename);
  name = name.replace(/\.(png|jpe?g|gif|webp|svg|bmp)$/i, "");
  name = name.replace(/^(\d+[_-]\s*)/, "");
  name = name.replace(/[-_]+/g, " ").trim();
  if (/^[a-z]/.test(name)) name = name.charAt(0).toUpperCase() + name.slice(1);
  return name || basename(filename);
}

/**
 * 把独立图片文件 + markdown 引用合并去重。
 * 去重规则:按相对根目录路径归一。同一图既被 .md 引用又是独立文件 → 只留一份(image_file 优先,因为它肯定存在)。
 *
 * 纯函数,便于测试。
 */
export function dedupImages(
  fileImages: ScannedImage[],
  refImages: ScannedImage[],
): ScannedImage[] {
  const seen = new Map<string, ScannedImage>();
  // 先放 file(优先),再放 ref(补充未匹配的)
  for (const img of fileImages) {
    if (!seen.has(img.path)) seen.set(img.path, img);
  }
  for (const img of refImages) {
    if (!seen.has(img.path)) seen.set(img.path, img);
  }
  return Array.from(seen.values());
}

/* ---------- 内部辅助 ---------- */

async function walkDir(root: string, current: string, acc: { absPath: string; relPath: string; isImage: boolean }[]): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    const abs = join(current, entry.name);
    if (entry.isDirectory()) {
      await walkDir(root, abs, acc);
    } else if (entry.isFile()) {
      const ext = entry.name.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? "";
      if (ext in EXT_KIND) {
        const rel = relative(root, abs).split(sep).join("/");
        acc.push({ absPath: abs, relPath: rel, isImage: false });
      } else if (ext in IMAGE_EXT_MIME) {
        const rel = relative(root, abs).split(sep).join("/");
        acc.push({ absPath: abs, relPath: rel, isImage: true });
      }
    }
  }
}

async function readFileWithKind(absPath: string, kind: ScannedDoc["kind"]): Promise<string> {
  if (kind === "pdf") {
    // 优先 pdf-inspector(layout-aware markdown), 失败/平台不支持回退 pdf-parse。
    // 路由 + 兜底集中在 lib/pdf-text.ts(平台缺预编译时 require 会抛, 不能让导入挂)。
    const buf = await readFile(absPath);
    const { parsePdfText } = await import("../../lib/pdf-text.js");
    return parsePdfText(buf);
  }
  if (kind === "pptx") {
    // .pptx → officeparser AST → markdown(每 slide 一个 ##, 讲者备注随 slide 走)。
    // 现有导入管线按 ## 切, 自动每 slide 一节课。图片在下面 pptxImages 循环单独提取。
    const buf = await readFile(absPath);
    const { parsePptx } = await import("../../lib/pptx-parser.js");
    return (await parsePptx(buf)).markdown;
  }
  if (kind === "ipynb") {
    // .ipynb 是 JSON,用 notebook-parser 转成 markdown(markdown cell + code block)
    const raw = await readFile(absPath, "utf8");
    const { parseNotebook } = await import("./notebook-parser.js");
    const result = parseNotebook(raw);
    return result.markdown;
  }
  if (kind === "rst" || kind === "rmd" || kind === "org" || kind === "adoc") {
    // 非 markdown 标记格式 → 用各自解析器转 markdown
    const raw = await readFile(absPath, "utf8");
    const parser = { rst: "rst-parser", rmd: "rmd-parser", org: "org-parser", adoc: "adoc-parser" }[kind];
    if (parser) {
      try {
        const mod = await import(`./${parser}.js`);
        const fn = mod.parseRst ?? mod.parseRmd ?? mod.parseOrg ?? mod.parseAdoc;
        return fn(raw).markdown;
      } catch {
        return raw; // 解析失败 → 当纯文本
      }
    }
    return raw;
  }
  if (kind === "code") {
    // 代码文件 → code-parser 转 markdown（docstring + 代码围栏）
    const raw = await readFile(absPath, "utf8");
    const ext = absPath.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? "";
    try {
      const { parseCode } = await import("./code-parser.js");
      return parseCode(raw, ext).markdown;
    } catch {
      return "```\n" + raw + "\n```"; // 解析失败 → 纯代码围栏
    }
  }
  const raw = await readFile(absPath, "utf8");
  return kind === "html" ? htmlToText(raw) : raw;
}

/** 路径自然排序:按段拆分,数字段按数值比较(02_ 在 10_ 前,不是字典序)。 */
function naturalPathCompare(a: string, b: string): number {
  const pa = a.split("/");
  const pb = b.split("/");
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    const na = pa[i]!.match(/^(\d+)/)?.[1];
    const nb = pb[i]!.match(/^(\d+)/)?.[1];
    if (na && nb && na !== nb) return Number(na) - Number(nb);
    if (pa[i] !== pb[i]) return pa[i]! < pb[i]! ? -1 : 1;
  }
  return pa.length - pb.length;
}

/* ============================================================
 * 本地导入清点 (buildLocalInventory) —— 供新 5 步管线的 Step 1
 *
 * scanFolder 只管扫描文档+图片(不含 translations/)。
 * buildLocalInventory 在此基础上补全:
 *   - translations/{lang}/ 扫描 → 翻译文件 + 检测到的语言
 *   - README 检测(根目录 README.md / index.md / 首个 md)
 *   - fullTree(所有路径,给 LLM 看仓库结构)
 *   - standaloneImages(不被任何 md 引用的独立图片文件)
 * ============================================================ */

/** 本地导入清点结果 */
export interface LocalInventory {
  /** 文档(非翻译,已去重) */
  docs: ScannedDoc[];
  /** 图片(独立文件 + md 引用 + PDF/notebook 提取) */
  images: ScannedImage[];
  /** 翻译文件(path = translations/{lang}/{原路径}) */
  translations: ScannedDoc[];
  /** 检测到的翻译语言代码(如 ["zh-CN", "ja"]) */
  translationLangs: string[];
  /** README 全文(根目录 README.md/index.md,无则首个 md,再无则 "") */
  readmeMd: string;
  /** 完整目录树(所有文件路径,给 LLM 看结构) */
  fullTree: string[];
  /** 不被任何文档引用的独立图片文件(给 LLM Step4 关联到 lesson 用) */
  standaloneImages: ScannedImage[];
}

/**
 * 为新管线构建本地清点:scanFolder + translations + README + fullTree + standaloneImages。
 *
 * 和 GitHub 的 fetchRepoInventory 对齐:产出 readmeMd + fileList(隐含在 docs 里) +
 * fullTree,供 classifyFileRoles + designCourseStructure 使用。
 */
export async function buildLocalInventory(
  rootDir: string,
  onProgress?: (scanned: number, currentPath: string) => void,
): Promise<LocalInventory> {
  // 1. 扫描文档 + 图片(scanFolder 内部排除 translations/,不影响)
  const scanResult = await scanFolder(rootDir, onProgress, { collectImages: true });
  // collectImages:true → 返回 { docs, images }（不是 ScannedDoc[]）
  const { docs, images } = Array.isArray(scanResult) ? { docs: scanResult, images: [] } : scanResult;

  // 2. 扫描 translations/ 目录(单独扫,不进 docs)
  const { translations, translationLangs } = await scanTranslationsDir(rootDir);

  // 3. README 检测
  const readmeMd = findReadmeContent(docs);

  // 4. fullTree(所有文件路径,含翻译 + 图片)
  const fullTree = [
    ...docs.map((d) => d.path),
    ...images.map((i) => i.path),
    ...translations.map((t) => t.path),
  ];

  // 5. 不被引用的独立图片
  const standaloneImages = findStandaloneImages(images, docs);

  return { docs, images, translations, translationLangs, readmeMd, fullTree, standaloneImages };
}

/**
 * 扫描 translations/{lang}/ 目录。
 * 每个 lang 子目录对应一种翻译语言,其下的文件按原目录结构保留。
 * path = translations/{lang}/{相对 lang 目录的路径}。
 */
async function scanTranslationsDir(
  rootDir: string,
): Promise<{ translations: ScannedDoc[]; translationLangs: string[] }> {
  const translationsDir = join(rootDir, "translations");
  if (!existsSync(translationsDir)) {
    return { translations: [], translationLangs: [] };
  }

  let langEntries: import("node:fs").Dirent[];
  try {
    langEntries = await readdir(translationsDir, { withFileTypes: true });
  } catch {
    return { translations: [], translationLangs: [] };
  }

  const langs = langEntries.filter((e) => e.isDirectory()).map((e) => e.name);
  const translations: ScannedDoc[] = [];

  for (const lang of langs) {
    const langDir = join(translationsDir, lang);
    const transFiles: { absPath: string; relPath: string; isImage: boolean }[] = [];
    await walkDir(langDir, langDir, transFiles);

    for (const f of transFiles) {
      if (f.isImage) continue;
      const ext = f.relPath.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? "";
      const kind = EXT_KIND[ext];
      if (!kind) continue;
      try {
        const content = await readFileWithKind(f.absPath, kind);
        if (!content || content.trim().length < 5) continue;
        translations.push({
          path: `translations/${lang}/${f.relPath}`,
          title: inferTitle(f.relPath),
          content,
          lang: detectLang(f.relPath),
          kind,
        });
      } catch {
        // 单文件失败跳过
      }
    }
  }

  return { translations, translationLangs: langs };
}

/**
 * 从已扫描文档里找 README 全文。
 * 优先根目录 README.md/README.markdown,其次 index.md,再首个 md,都没有返回 ""。
 */
function findReadmeContent(docs: ScannedDoc[]): string {
  // 根目录 README.md / README.markdown
  const readme = docs.find((d) => {
    const parts = d.path.split("/");
    return parts.length === 1 && /^readme\.(md|markdown)$/i.test(parts[0]!);
  });
  if (readme) return readme.content;

  // 根目录 index.md
  const index = docs.find((d) => {
    const parts = d.path.split("/");
    return parts.length === 1 && /^index\.(md|markdown)$/i.test(parts[0]!);
  });
  if (index) return index.content;

  // 首个 md 文档
  const firstMd = docs.find((d) => d.kind === "md");
  return firstMd?.content ?? "";
}

/**
 * 找出不被任何文档引用的独立图片文件。
 * 这些是"孤儿"图片,需要 LLM 在 Step 4 关联到最相关的 lesson。
 *
 * 判定:source=image_file(独立文件,非 PDF/notebook 提取) + 有 absPath(磁盘文件) +
 *      不在任何文档的图片引用路径里。
 */
export function findStandaloneImages(images: ScannedImage[], docs: ScannedDoc[]): ScannedImage[] {
  // 收集所有文档引用的图片路径
  const referencedPaths = new Set<string>();
  for (const doc of docs) {
    if (doc.kind === "txt" || doc.kind === "html") continue;
    const refs = extractImageRefs(doc.content);
    for (const ref of refs) {
      const resolved = resolveImageRef(ref.refPath, doc.path);
      referencedPaths.add(resolved);
    }
  }

  return images.filter(
    (img) => img.source === "image_file" && img.absPath && !referencedPaths.has(img.path),
  );
}

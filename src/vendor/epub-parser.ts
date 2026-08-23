// Vendored from LookatStudy src/main/lib/epub-parser.ts (MIT License, https://github.com/Kaiji-Z/LookatStudy).
// Structure (container.xml → OPF → manifest/spine → chapters → markdown) kept
// verbatim; the fflate unzipSync dependency is swapped for the plugin's own
// zip-reader (zero-dependency mandate), Buffer → Uint8Array.
// 为什么不用 officeparser(它声称支持 epub):见上游头注释——spine 章节边界会丢,
// 手解 spine 拿确定性章节边界 + TOC 标题更稳。

import { readZip, readZipText } from "./zip-reader.ts";
import { htmlToMarkdown } from "./html-article.ts";

export interface EpubChapter {
  /** 虚拟路径 chapters/{nn}-{title}.md */
  path: string;
  /** 章节标题(TOC 优先,退回首行 H1,再退回"第 N 章") */
  title: string;
  /** 章节 markdown(以 `# {title}` 开头) */
  markdown: string;
}

export interface EpubBook {
  title: string;
  chapters: EpubChapter[];
}

/** 提取某标签的全部出现(OPF 的属性顺序不定,先抓整标签再逐个提属性)。 */
function tags(xml: string, tagName: string): { raw: string; attrs: Record<string, string> }[] {
  const out: { raw: string; attrs: Record<string, string> }[] = [];
  const re = new RegExp(`<${tagName}\\b[^>]*>`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const raw = m[0];
    const attrs: Record<string, string> = {};
    const attrRe = /([\w:-]+)\s*=\s*"([^"]*)"/g;
    let a: RegExpExecArray | null;
    while ((a = attrRe.exec(raw)) !== null) attrs[a[1]!] = a[2]!;
    out.push({ raw, attrs });
  }
  return out;
}

function firstTagText(xml: string, tagName: string): string {
  const m = xml.match(new RegExp(`<${tagName}[^>]*>([^<]*)</${tagName}>`, "i"));
  return m?.[1]?.trim() ?? "";
}

/** zip 内路径归一:posix 分隔 + href 相对 OPF 目录解析。 */
function resolveZipPath(opfPath: string, href: string): string {
  const cleanHref = decodeURIComponent(href.split("#")[0] ?? href).replace(/\\/g, "/");
  if (!opfPath.includes("/")) return cleanHref.replace(/^\.\//, "");
  const baseDir = opfPath.slice(0, opfPath.lastIndexOf("/"));
  const parts = `${baseDir}/${cleanHref}`.split("/");
  const resolved: string[] = [];
  for (const p of parts) {
    if (p === "..") resolved.pop();
    else if (p !== "." && p !== "") resolved.push(p);
  }
  return resolved.join("/");
}

/** EPUB3 nav.xhtml 或 EPUB2 toc.ncx → href(去 fragment)→ 章节标题。 */
function parseTocLabels(tocXml: string, isNcx: boolean): Map<string, string> {
  const labels = new Map<string, string>();
  if (isNcx) {
    // navPoint 块:<navLabel><text>X</text></navLabel> ... <content src="ch1.xhtml"/>
    const blockRe = /<navPoint\b[\s\S]*?<\/navPoint>/g;
    let m: RegExpExecArray | null;
    while ((m = blockRe.exec(tocXml)) !== null) {
      const label = firstTagText(m[0], "text");
      const src = m[0].match(/<content[^>]+src="([^"]+)"/i)?.[1];
      if (label && src) labels.set(decodeURIComponent(src.split("#")[0]!.replace(/\\/g, "/")), label);
    }
  } else {
    const aRe = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = aRe.exec(tocXml)) !== null) {
      const label = (m[2] ?? "").replace(/<[^>]+>/g, "").trim();
      if (label) labels.set(decodeURIComponent((m[1] ?? "").split("#")[0]!.replace(/\\/g, "/")), label);
    }
  }
  return labels;
}

function sanitizeFileName(title: string): string {
  return (title || "chapter").replace(/[\\/:*?"<>|#\s]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "chapter";
}

export function parseEpub(buf: Uint8Array): EpubBook {
  const entries = readZip(buf);
  const read = (p: string): string => readZipText(entries, p);

  // container.xml → OPF 路径
  const container = read("META-INF/container.xml");
  const opfPath = container.match(/full-path="([^"]+)"/i)?.[1];
  if (!opfPath) throw new Error("epub 结构异常:找不到 container.xml 里的 OPF 路径");
  const opf = read(opfPath);
  if (!opf) throw new Error(`epub 结构异常:OPF 文件缺失(${opfPath})`);

  const bookTitle = firstTagText(opf, "dc:title") || "未命名电子书";

  // manifest + spine
  const manifest = new Map<string, { href: string; mediaType: string; properties: string }>();
  for (const t of tags(opf, "item")) {
    manifest.set(t.attrs["id"] ?? "", {
      href: t.attrs["href"] ?? "",
      mediaType: (t.attrs["media-type"] ?? "").toLowerCase(),
      properties: t.attrs["properties"] ?? "",
    });
  }
  const spineIds = tags(opf, "itemref").map((t) => t.attrs["idref"] ?? "").filter(Boolean);
  const spineTocId = opf.match(/<spine\b[^>]*\btoc="([^"]+)"/i)?.[1];

  // TOC 标签:EPUB3 nav(properties=nav)优先,EPUB2 ncx(spine toc)兜底
  let tocLabels = new Map<string, string>();
  const navItem = [...manifest.values()].find((it) => it.properties.split(/\s+/).includes("nav"));
  if (navItem?.href) {
    tocLabels = parseTocLabels(read(resolveZipPath(opfPath, navItem.href)), false);
  }
  if (tocLabels.size === 0 && spineTocId && manifest.has(spineTocId)) {
    tocLabels = parseTocLabels(read(resolveZipPath(opfPath, manifest.get(spineTocId)!.href)), true);
  }

  // spine 顺序遍历章节
  const opfDirKey = (href: string) => decodeURIComponent(href.split("#")[0] ?? href).replace(/\\/g, "/");
  const chapters: EpubChapter[] = [];
  let n = 0;
  for (const id of spineIds) {
    const item = manifest.get(id);
    if (!item?.href) continue;
    const isDoc = item.mediaType === "application/xhtml+xml" || item.mediaType === "text/html"
      || /\.(xhtml|html|htm)$/i.test(item.href);
    if (!isDoc) continue;
    if (item.properties.split(/\s+/).includes("nav")) continue; // 目录页不成课
    const zipPath = resolveZipPath(opfPath, item.href);
    const xhtml = read(zipPath);
    if (!xhtml) continue;

    const md = htmlToMarkdown(xhtml, { stripImages: true });
    if (!md || md.replace(/[#\s>*-]/g, "").length < 8) continue; // 封面页(纯图/纯标题)跳过

    n++;
    const body = md.startsWith("# ") && md.includes("\n") ? md.slice(md.indexOf("\n") + 1).trim() : md;
    const firstHeading = md.startsWith("# ") ? md.split("\n")[0]!.slice(2).trim() : "";
    const title = tocLabels.get(opfDirKey(item.href)) || firstHeading || `第 ${n} 章`;
    chapters.push({
      path: `chapters/${String(n).padStart(2, "0")}-${sanitizeFileName(title)}.md`,
      title,
      markdown: `# ${title}\n\n${body}`,
    });
  }

  if (chapters.length === 0) throw new Error("epub 里没有可识别的章节文本");
  return { title: bookTitle, chapters };
}

/** 文件夹导入路径用:整本书压平成一个 markdown(全部 H1 降为 H2,给结构设计当 anchor 拆章)。 */
export function parseEpubFlat(buf: Uint8Array): string {
  const book = parseEpub(buf);
  return book.chapters
    .map((c) => c.markdown.replace(/^# /gm, "## "))
    .join("\n\n");
}

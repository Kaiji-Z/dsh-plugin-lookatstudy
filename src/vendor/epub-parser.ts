// Vendored from LookatStudy src/main/lib/epub-parser.ts (MIT License, https://github.com/Kaiji-Z/LookatStudy).
// Structure (container.xml → OPF → manifest/spine → chapters → markdown) kept
// verbatim; the fflate unzipSync dependency is swapped for the plugin's own
// zip-reader (zero-dependency mandate), Buffer → Uint8Array, async → sync
// (our zip-reader is synchronous).
// 2026-09-01 port (upstream v0.23.1 + v0.24.0): chapter alignment全套 —
// sanitizeEpubBody + splitChaptersInBody (spine 文件≠章是采样常态),
// 未命名章节兜底(不编造"第 N 章"),扉页配对,版权页/目录页密度过滤,
// license 文件末章救回。逻辑 verbatim;仅 zip/decode 差异按本插件改写。
// 为什么不用 officeparser(它声称支持 epub):见上游头注释——spine 章节边界会丢,
// 手解 spine 拿确定性章节边界 + TOC 标题更稳。

import { readZip, readZipText } from "./zip-reader.ts";
import { htmlToMarkdown } from "./html-article.ts";

export interface EpubChapter {
  /** 虚拟路径 chapters/{nn}-{title}.md */
  path: string;
  /** 章节标题(TOC 优先,退回首行 H1,再退回"未命名章节"——不编造编号) */
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

/* ============================================================
 * 章内二次拆分与噪声清理(upstream 2026-08-23,8 本 Gutenberg 真书采样驱动):
 * 采样结论:spine 文件 ≠ 章是常态(P&P 15 文件装 61 章 / Moby 27 装 135 /
 * 双城记 46 / Alice 13 / Frankenstein 30),一章一文件反而是少数(Sherlock)。
 * 旧实现"一文件一章"导致标题取末章号、内容从首章开始——标题与内容错位。
 * ============================================================ */

/** 文件内章标记。两类形态:heading 行(# 前缀)与**裸行**(Gutenberg 常见——章号在
 * 原书 html 里是段落不是标题,转 markdown 后成裸文本 "CHAPTER XX.")。
 * 裸行限行长(≤60)防正文中引用句误切;罗马数字/裸序号低置信需序列验证。 */
const CH_HEADING = /^(?:#{1,3}\s*)?(?:CHAPTER|Chapter|chap\.)\s+[IVXLC0-9]{1,7}\b[.:)]?\s*(.*)$/;
const LETTER_HEADING = /^(?:#{1,3}\s*)?(?:Letter|LETTER)\s+\d{1,3}\b[.:)]?\s*(.*)$/;
const ROMAN_HEADING = /^(?:#{1,3}\s*)?(?:[—[]\s*)?([IVXLC]{1,7})\s*[—\]]?\.?\s*$/;
const NUM_HEADING = /^(?:#{1,3}\s*)?[—[]?\s*(\d{1,3})\s*[—\]]?\.?\s*$/;
const romanValue = (s: string): number => {
  const vals: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };
  let v = 0;
  for (let i = 0; i < s.length; i++) {
    const cur = vals[s[i]!] ?? 0;
    const next = vals[s[i + 1]!] ?? 0;
    v += cur < next ? -cur : cur;
  }
  return v;
};

/**
 * 文件内按章标记切分。返回 null = 无高置信切分(保持单章)。
 * 置信规则:CHAPTER/Letter 标记 ≥2 即切;罗马数字/裸序号须形成连续递增
 * 序列(≥3 个)才切——正文中孤立的 "I" / "2" 不当章号。
 * 首标记前的引言/卷头(<800 字符)并入首章;够长则独立成"引言"章。
 */
export function splitChaptersInBody(
  body: string,
  opts?: { minHighConf?: number },
): { title: string; content: string }[] | null {
  const lines = body.split("\n");
  type Mark = { line: number; title: string; kind: "ch" | "letter" | "roman" | "num"; seq: number };
  const marks: Mark[] = [];
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]!.trimEnd();
    if (!ln || ln.length > 60) continue; // 空行/长行(引用句)不当标记
    const strip = (s: string) => s.replace(/^#{1,3}\s*/, "");
    let m = ln.match(CH_HEADING);
    if (m) { marks.push({ line: i, title: strip(ln), kind: "ch", seq: 0 }); continue; }
    m = ln.match(LETTER_HEADING);
    if (m) { marks.push({ line: i, title: strip(ln), kind: "letter", seq: 0 }); continue; }
    m = ln.match(ROMAN_HEADING);
    if (m && (ln.startsWith("#") || /[—[]/.test(ln))) { // 罗马裸行风险高,须 heading 或装饰形态
      marks.push({ line: i, title: strip(ln), kind: "roman", seq: romanValue(m[1]!) });
      continue;
    }
    m = ln.match(NUM_HEADING);
    if (m && (ln.startsWith("#") || /[—[]/.test(ln))) { // 同上:裸数字不切
      marks.push({ line: i, title: strip(ln), kind: "num", seq: parseInt(m[1]!, 10) });
      continue;
    }
  }
  // 分 kind 验证:ch/letter 计数;roman/num 查连续递增子序列
  // minHighConf:文件标题本身是噪声(license/contents)时降为 1——单标记也切,
  // 否则末文件的末章会被 license 标题吞掉(P&P 实测:LXI 章)。
  const minHigh = opts?.minHighConf ?? 2;
  const highConf = marks.filter((mk) => mk.kind === "ch" || mk.kind === "letter");
  let splitMarks: Mark[];
  if (highConf.length >= minHigh) {
    splitMarks = highConf;
  } else {
    splitMarks = [];
    for (const kind of ["roman", "num"] as const) {
      const seq = marks.filter((mk) => mk.kind === kind);
      // 连续递增(允许从 1 或 2 起):取最长链
      const chain: Mark[] = [];
      let expect = 0;
      for (const mk of seq) {
        if (expect === 0) { if (mk.seq === 1 || mk.seq === 2) { chain.push(mk); expect = mk.seq + 1; } }
        else if (mk.seq === expect) { chain.push(mk); expect++; }
      }
      if (chain.length >= 3) splitMarks.push(...chain);
    }
    if (splitMarks.length < 3) return null;
  }
  if (splitMarks.length < 1) return null;

  const out: { title: string; content: string }[] = [];
  const preamble = lines.slice(0, splitMarks[0]!.line).join("\n").trim();
  for (let k = 0; k < splitMarks.length; k++) {
    const start = splitMarks[k]!.line;
    const end = k + 1 < splitMarks.length ? splitMarks[k + 1]!.line : lines.length;
    let content = lines.slice(start + 1, end).join("\n").trim();
    if (k === 0 && preamble && preamble.length < 800) {
      // 引言/卷头并入首章(在章标记前)
      content = `${preamble}\n\n${content}`.trim();
    }
    out.push({ title: splitMarks[k]!.title, content });
  }
  if (preamble && preamble.length >= 800) {
    out.unshift({ title: "引言", content: preamble });
  }
  return out.filter((c) => c.content.replace(/\s/g, "").length > 0);
}

/**
 * 清理电子书正文噪声(Gutenberg 头/尾块、1894 插图版装饰行)。
 * 只删确定性标志,不猜内容:
 * - 头:"The Project Gutenberg eBook of…" 段落(heading 形态)
 * - 尾:"THE FULL PROJECT GUTENBERG™ LICENSE" 起截断到文件尾;"End of the Project Gutenberg" 行起同理
 * - 行内:`[ _Copyright 1894 by …_ ]` 插图版装饰片段
 */
export function sanitizeEpubBody(body: string): string {
  let md = body;
  // 尾块截断(license:heading 或裸行变体——"THE FULL PROJECT GUTENBERG™ LICENSE" /
  // "*** END OF THE PROJECT GUTENBERG EBOOK ***" / "START: FULL LICENSE";限行长防正文误伤)
  const lines0 = md.split("\n");
  for (let i = 0; i < lines0.length; i++) {
    const ln = lines0[i]!.trim();
    if (ln.length <= 100 && (/(?:THE\s+)?FULL PROJECT GUTENBERG/i.test(ln) || /END OF THE PROJECT GUTENBERG/i.test(ln) || ln === "START: FULL LICENSE" || ln === "START: THE FULL LICENSE")) {
      md = lines0.slice(0, i).join("\n");
      break;
    }
  }
  // 头块段落删除(heading 行 + 其后到首个空行的段)
  md = md.replace(/^#{1,3}\s*(?:The Project Gutenberg eBook[^*\n]*|Project Gutenberg[^*\n]*)\n[\s\S]*?\n(?:\n|$)/im, "");
  // 空标题行残留(转 markdown 对无文本 h 标签产出 "##   ")
  md = md.replace(/^#{1,3}[ \t]*$/gm, "");
  // 装饰片段(行内)
  md = md.replace(/\\?\[?\s*_?Copyright 1[6-9]\d\d[^_\n]*_?\s*\\?]?/g, "");
  return md.trim();
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
  /** 无标题标记(不再编造"第 N 章";配对/课程设计层的锚点) */
  const UNTITLED_MARK = "未命名章节";
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
    const body0 = md.startsWith("# ") && md.includes("\n") ? md.slice(md.indexOf("\n") + 1).trim() : md;
    const firstHeading = md.startsWith("# ") ? md.split("\n")[0]!.slice(2).trim() : "";
    // 无标题兜底**不编造编号**:解析层发明"第 N 章"会把假标题喂成大纲权威,
    // 对无编号体系的书双重失真。未命名交课程设计层按内容主题命名;
    // 扉页配对(见下方)会回填真标题。
    const fileTitle = tocLabels.get(opfDirKey(item.href)) || firstHeading || UNTITLED_MARK;

    // Gutenberg 目录页(title=Contents 且正文短)不成课
    if (/^(contents|table of contents)$/i.test(fileTitle) && body0.replace(/\s/g, "").length < 4000) continue;
    // 前言/元数据小文件(短正文 + 版权标志)不成课
    if (body0.replace(/\s/g, "").length < 1500 && /project gutenberg|copyright/i.test(body0)) continue;
    // 出版社前置件不成课(上游 2026-08-23,沉思录真书驱动):①版权页——标题点名版权,
    // 或短正文里 ≥3 个"书名：/作者：/ISBN："式著录字段(出版社版权页机器指纹);
    // ②链接目录页——标题是"目录"且正文六成以上行是 markdown 链接(目录页链接密
    // 度是格式指纹,正文章不会长这样)。出版社宣传小页无高置信信号,按原则不猜——
    // 留给课程设计层(设计简报里的"前置小页"规则)。
    if (/^(版权信息|版权|版权页|著作权|版權)/.test(fileTitle)) continue;
    const colophonFields = (body0.match(/^(书名|作者|译者|编者|丛书|出版社|出版时间|出版年|ISBN|版次|定价|装帧|字数|品牌|出品方)[：:]/gm) ?? []).length;
    if (colophonFields >= 3 && body0.replace(/\s/g, "").length < 2500) continue;
    if (/^目\s*录$/.test(fileTitle)) {
      const lines = body0.split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length >= 3 && lines.filter((l) => l.includes("](")).length / lines.length >= 0.6) continue;
    }

    // 噪声清理(头/尾块、装饰行)后按章标记二次拆分——spine 文件≠章是采样常态
    const body = sanitizeEpubBody(body0);
    if (body.replace(/\s/g, "").length < 8) continue; // 清理后成空(如纯 license 文件)
    // 文件标题本身是 license → 单个章标记也切(救回被 license 标题吞掉的末章)
    const titleIsLicense = /FULL PROJECT GUTENBERG|LICENSE/i.test(fileTitle);
    const split = splitChaptersInBody(body, titleIsLicense ? { minHighConf: 1 } : undefined);
    if (split && split.length >= (titleIsLicense ? 1 : 2)) {
      for (const seg of split) {
        chapters.push({
          path: `chapters/${String(n).padStart(2, "0")}-${sanitizeFileName(seg.title)}.md`,
          title: seg.title,
          markdown: `# ${seg.title}\n\n${seg.content}`,
        });
        n++; // 文件内拆出的章继续编号(防 path 撞)
      }
      n--; // 外层 for 会再 ++
      continue;
    }
    if (titleIsLicense) {
      // license 文件但单标记切不出段:body 大 → 真内容被标志吞(Metamorphosis 的 III 章
      // 在 license 文件里、裸罗马行不可靠),保留为附录;小 → 纯 license 丢
      if (body.replace(/\s/g, "").length > 2000) {
        chapters.push({
          path: `chapters/${String(n).padStart(2, "0")}-appendix.md`,
          title: "附录",
          markdown: `# 附录\n\n${body}`,
        });
      }
      continue;
    }
    chapters.push({
      path: `chapters/${String(n).padStart(2, "0")}-${sanitizeFileName(fileTitle)}.md`,
      title: fileTitle,
      markdown: `# ${fileTitle}\n\n${body}`,
    });
  }

  // 扉页配对(上游 2026-08-23,沉思录真书驱动):出版社 epub 常见"短扉页(带卷/部标题)
  // + 紧随的无标题正文页"两文件结构。规则(高置信):前一章是有真标题的极短扉页
  // (正文 ≤300 字)且后一章是 UNTITLED → 合并,标题取扉页,扉页格言并入正文开头。
  // 后一章自己有标题(正常书)绝不合并;已吞并过正文的章不再是"纯扉页",不许
  // 连锁再吞(否则短正文书会被一路并成一章)。
  const absorbed = new Set<string>();
  for (let i = 0; i + 1 < chapters.length; i++) {
    const stub = chapters[i]!;
    const next = chapters[i + 1]!;
    if (absorbed.has(stub.path)) continue;
    const stubBody = stub.markdown.includes("\n") ? stub.markdown.slice(stub.markdown.indexOf("\n") + 1).trim() : "";
    if (stub.title === UNTITLED_MARK || stub.title === "附录") continue;
    if (stubBody.replace(/\s/g, "").length > 300) continue;
    if (next.title !== UNTITLED_MARK) continue;
    const nextBody = next.markdown.includes("\n") ? next.markdown.slice(next.markdown.indexOf("\n") + 1).trim() : next.markdown;
    chapters[i] = {
      path: stub.path,
      title: stub.title,
      markdown: `# ${stub.title}\n\n${stubBody}\n\n${nextBody}`,
    };
    absorbed.add(stub.path);
    chapters.splice(i + 1, 1);
    i--; // 回看一格:后移的邻居可能仍是可配对的短扉页+未命名对
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

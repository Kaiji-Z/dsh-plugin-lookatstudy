// Vendored/adapted from LookatStudy src/main/services/pure/html-article.ts (MIT, https://github.com/Kaiji-Z/LookatStudy).
// Upstream runs linkedom + @mozilla/readability + turndown (three npm deps); this
// plugin's zero-dependency mandate replaces them with a hand-rolled mini-DOM
// parser + tree-walking converter + heuristic article extraction. Interface is
// kept identical: extractArticle returns null when the page is not article-like
// (honest failure — nav noise as course content is worse than an error), and
// htmlToMarkdown salvages MathJax v2 / KaTeX TeX sources into $..$/$$..$$
// BEFORE stripping scripts, same as upstream.
// 2026-09-01 port (upstream v0.23.1): stripTailNavigation vendored VERBATIM —
// tail site-template fingerprint stripping (sohu/aliyun/CSDN tail junk); the
// principle in its comment is upstream's, learned from a live incident (an
// author's own promo paragraph was once deleted by an over-eager rule).

export interface ExtractedArticle {
  title: string;
  markdown: string;
}

/* ---------------- mini DOM ---------------- */

interface DomNode {
  tag: string; // "" for text nodes
  attrs: Record<string, string>;
  children: DomNode[];
  text: string; // text nodes only
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", hellip: "…", mdash: "—", ndash: "–", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', middot: "·", bull: "•", copy: "©", times: "×", divide: "÷", deg: "°" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_m, ent: string) => {
    if (ent.startsWith("#x") || ent.startsWith("#X")) return String.fromCodePoint(parseInt(ent.slice(2), 16));
    if (ent.startsWith("#")) return String.fromCodePoint(parseInt(ent.slice(1), 10));
    return ENTITIES[ent.toLowerCase()] ?? _m;
  });
}

const VOID_TAGS = new Set(["br", "hr", "img", "input", "meta", "link", "area", "base", "col", "embed", "source", "track", "wbr"]);

/** Stack-parse well-formed-enough HTML/XHTML into a forest of nodes. */
export function parseHtml(html: string): DomNode[] {
  const roots: DomNode[] = [];
  const stack: DomNode[] = [];
  const push = (n: DomNode) => { (stack.length ? stack[stack.length - 1]!.children : roots).push(n); };
  const tokenRe = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\/([a-zA-Z][-\w:]*)\s*>|<([a-zA-Z][-\w:]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(html)) !== null) {
    if (m[2] !== undefined) {
      // closing tag: pop to nearest matching open
      const close = m[2].toLowerCase();
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i]!.tag === close) { stack.length = i; break; }
      }
    } else if (m[3] !== undefined) {
      const tag = m[3].toLowerCase();
      const attrs: Record<string, string> = {};
      const attrRe = /([-\w:]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
      let a: RegExpExecArray | null;
      while ((a = attrRe.exec(m[4] ?? "")) !== null) attrs[a[1]!.toLowerCase()] = decodeEntities(a[3] ?? a[4] ?? "");
      const node: DomNode = { tag, attrs, children: [], text: "" };
      push(node);
      if (!VOID_TAGS.has(tag) && m[5] !== "/") stack.push(node);
    } else if (m[1] !== undefined) {
      push({ tag: "", attrs: {}, children: [], text: m[1] });
    } else if (m[6] !== undefined) {
      const text = decodeEntities(m[6]);
      if (text.trim()) push({ tag: "", attrs: {}, children: [], text });
    }
  }
  return roots;
}

const BLOCK_TAGS = new Set(["p", "div", "section", "article", "header", "footer", "main", "aside", "nav", "figure", "figcaption", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "pre", "table", "tr", "thead", "tbody", "hr", "br", "address", "details", "summary"]);

function nodeText(node: DomNode): string {
  if (node.tag === "") return node.text;
  return node.children.map(nodeText).join("");
}

function findDescendant(node: DomNode, tag: string, cls?: string): DomNode | null {
  for (const c of node.children) {
    if (c.tag === tag && (!cls || (c.attrs["class"] ?? "").split(/\s+/).includes(cls))) return c;
    const hit = findDescendant(c, tag, cls);
    if (hit) return hit;
  }
  return null;
}

/* ---------------- tree → markdown ---------------- */

function inlineRuns(nodes: DomNode[], stripImages: boolean): string {
  let out = "";
  for (const n of nodes) {
    switch (n.tag) {
      case "":
        out += n.text.replace(/\s+/g, " ");
        break;
      case "br":
        out += "\n";
        break;
      case "strong": case "b": {
        const inner = inlineRuns(n.children, stripImages).trim();
        if (inner) out += `**${inner}**`;
        break;
      }
      case "em": case "i": {
        const inner = inlineRuns(n.children, stripImages).trim();
        if (inner) out += `*${inner}*`;
        break;
      }
      case "code":
        out += "`" + nodeText(n).trim() + "`";
        break;
      case "a": {
        const inner = inlineRuns(n.children, stripImages).trim();
        const href = n.attrs["href"] ?? "";
        out += inner && href && !href.startsWith("#") ? `[${inner}](${href})` : inner;
        break;
      }
      case "img": case "picture": case "svg": case "figure": {
        if (!stripImages && n.tag === "img") {
          const alt = n.attrs["alt"] ?? "";
          const src = n.attrs["src"] ?? "";
          if (src) out += `![${alt}](${src})`;
        }
        break;
      }
      case "script":
        if ((n.attrs["type"] ?? "").includes("math/tex")) {
          const tex = nodeText(n).trim();
          if (tex) out += tex.includes("\n") ? `$$${tex}$$` : `$${tex}$`;
        }
        break;
      case "style": case "head":
        break;
      case "span": {
        // KaTeX 渲染节点：回收 annotation 的 TeX 原文，katex-html 渲染垃圾整体丢弃（同上游）
        if ((n.attrs["class"] ?? "").split(/\s+/).includes("katex")) {
          const ann = findDescendant(n, "annotation");
          const tex = ann ? nodeText(ann).trim() : "";
          if (tex) out += tex.includes("\n") ? `$$${tex}$$` : `$${tex}$`;
          break;
        }
        out += inlineRuns(n.children, stripImages);
        break;
      }
      default:
        out += inlineRuns(n.children, stripImages);
    }
  }
  return out.replace(/[ \t]+\n/g, "\n");
}

function emitBlocks(nodes: DomNode[], stripImages: boolean, lines: string[], listDepth = 0, quotePrefix = ""): void {
  const indent = "  ".repeat(listDepth);
  for (const n of nodes) {
    const prefix = quotePrefix;
    switch (n.tag) {
      case "": {
        const t = n.text.trim();
        if (t) lines.push(prefix + t);
        break;
      }
      case "h1": case "h2": case "h3": case "h4": case "h5": case "h6": {
        const level = Number(n.tag[1]);
        const t = inlineRuns(n.children, stripImages).trim();
        if (t) lines.push(prefix + "#".repeat(level) + " " + t);
        break;
      }
      case "p": case "div": case "section": case "article": case "main": case "figcaption": case "summary": case "details": case "address": {
        const hasBlockChild = n.children.some((c) => BLOCK_TAGS.has(c.tag) && c.tag !== "br");
        if (hasBlockChild) { emitBlocks(n.children, stripImages, lines, listDepth, prefix); break; }
        const t = inlineRuns(n.children, stripImages).trim();
        if (t) lines.push(prefix + indent + t);
        break;
      }
      case "ul": case "ol": {
        let idx = 1;
        for (const c of n.children) {
          if (c.tag === "li") {
            const marker = n.tag === "ol" ? `${idx++}. ` : "- ";
            const inlineOnly = !c.children.some((cc) => BLOCK_TAGS.has(cc.tag) && cc.tag !== "br");
            if (inlineOnly) {
              const t = inlineRuns(c.children, stripImages).trim();
              if (t) lines.push(prefix + indent + marker + t);
            } else {
              const nested: string[] = [];
              emitBlocks(c.children, stripImages, nested, listDepth + 1, prefix);
              if (nested.length) lines.push(prefix + indent + marker + nested[0]!.trimStart());
              lines.push(...nested.slice(1));
            }
          } else {
            emitBlocks([c], stripImages, lines, listDepth, prefix);
          }
        }
        lines.push("");
        break;
      }
      case "blockquote": {
        const inner: string[] = [];
        emitBlocks(n.children, stripImages, inner, 0, "");
        for (const l of inner) if (l.trim()) lines.push(prefix + "> " + l);
        lines.push("");
        break;
      }
      case "pre": {
        const code = n.children.map((c) => nodeText(c)).join("").replace(/\n+$/, "");
        if (code.trim()) { lines.push(prefix + "```", code.split("\n").map((l) => prefix + l).join("\n"), prefix + "```"); lines.push(""); }
        break;
      }
      case "table": {
        for (const c of n.children) {
          if (c.tag === "tr") {
            const cells = c.children.filter((cc) => cc.tag === "td" || cc.tag === "th").map((cc) => inlineRuns(cc.children, stripImages).trim().replace(/\|/g, "\\|"));
            if (cells.length) lines.push(prefix + "| " + cells.join(" | ") + " |");
          } else {
            emitBlocks([c], stripImages, lines, listDepth, prefix);
          }
        }
        lines.push("");
        break;
      }
      case "hr":
        lines.push(prefix + "---");
        lines.push("");
        break;
      case "br":
        lines.push("");
        break;
      case "script":
        if ((n.attrs["type"] ?? "").includes("math/tex")) {
          const tex = nodeText(n).trim();
          if (tex) lines.push(prefix + (tex.includes("\n") ? `$$${tex}$$` : `$${tex}$`));
        }
        break;
      case "span": {
        if ((n.attrs["class"] ?? "").split(/\s+/).includes("katex")) {
          const ann = findDescendant(n, "annotation");
          const tex = ann ? nodeText(ann).trim() : "";
          if (tex) lines.push(prefix + (tex.includes("\n") ? `$$${tex}$$` : `$${tex}$`));
          break;
        }
        const t = inlineRuns([n], stripImages).trim();
        if (t) lines.push(prefix + t);
        break;
      }
      case "img": case "picture": case "svg": case "figure":
        if (!stripImages && n.tag === "img") {
          const src = n.attrs["src"] ?? "";
          if (src) lines.push(prefix + `![${n.attrs["alt"] ?? ""}](${src})`);
        }
        break;
      case "style": case "head": case "nav": case "button": case "form": case "noscript":
        break;
      default:
        emitBlocks(n.children, stripImages, lines, listDepth, prefix);
    }
  }
}

/** 任意 HTML/XHTML → markdown（epub 章节用；数学源回收在 script 剥除之前，同上游）。 */
export function htmlToMarkdown(html: string, opts: { stripImages?: boolean } = {}): string {
  const stripImages = opts.stripImages ?? false;
  let roots = parseHtml(html);
  // 裸片段（无 <html>/<body> 包裹）也能解析出森林；空结果时按上游兜底重包一层
  if (roots.length === 0) roots = parseHtml(`<html><body>${html}</body></html>`);
  const lines: string[] = [];
  emitBlocks(roots, stripImages, lines);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/* ---------------- article extraction (readability replacement) ---------------- */

const STRIP_FOR_ARTICLE = new Set(["script", "style", "nav", "header", "footer", "aside", "form", "noscript", "button", "iframe", "svg"]);

function textDensity(nodes: DomNode[]): { chars: number; tags: number } {
  let chars = 0, tags = 0;
  const walk = (ns: DomNode[]) => {
    for (const n of ns) {
      if (n.tag === "") { chars += n.text.trim().length; continue; }
      if (STRIP_FOR_ARTICLE.has(n.tag) || (n.tag === "div" && (n.attrs["id"] ?? n.attrs["class"] ?? "").match(/comment|sidebar|related|share|footer|nav/i))) continue;
      tags++;
      walk(n.children);
    }
  };
  walk(nodes);
  return { chars, tags };
}

/** Pick the densest content root: <article> > <main> > <body> > whole forest. */
function pickContentRoot(roots: DomNode[]): DomNode[] {
  const findFirst = (tag: string): DomNode | null => {
    const walk = (ns: DomNode[]): DomNode | null => {
      for (const n of ns) {
        if (n.tag === tag) return n;
        const hit = walk(n.children);
        if (hit) return hit;
      }
      return null;
    };
    return walk(roots);
  };
  return [findFirst("article") ?? findFirst("main") ?? findFirst("body") ?? { tag: "", attrs: {}, children: roots, text: "" }];
}

/** 从完整 HTML 抽取文章正文并转 markdown。非文章页返回 null（诚实失败，同上游契约）。 */
export function extractArticle(html: string, baseUrl = ""): ExtractedArticle | null {
  let roots = parseHtml(html);
  if (roots.length === 0) return null;
  // title: <title> 或首个 h1
  const titleNode = findDescendant({ tag: "root", attrs: {}, children: roots, text: "" }, "title");
  const h1 = findDescendant({ tag: "root", attrs: {}, children: roots, text: "" }, "h1");
  const title = (titleNode ? nodeText(titleNode) : h1 ? inlineRuns(h1.children, false).trim() : "").trim() || "无标题文章";

  const contentRoots = pickContentRoot(roots);
  // 图片相对地址绝对化（baseUrl 提供时）
  if (baseUrl) {
    const walk = (ns: DomNode[]) => {
      for (const n of ns) {
        if (n.tag === "img") {
          const raw = n.attrs["src"] ?? "";
          if (raw && !raw.startsWith("data:") && !/^https?:/i.test(raw)) {
            try { n.attrs["src"] = new URL(raw, baseUrl).toString(); } catch { /* 非法地址保留原样 */ }
          }
        }
        walk(n.children);
      }
    };
    walk(contentRoots);
  }

  const { chars } = textDensity(contentRoots);
  if (chars < 120) return null; // 判不了正文（登录页/索引页/空壳）

  const body = htmlToMarkdownOf(contentRoots, false);
  if (!body || body.replace(/[#\s>*|-]/g, "").length < 40) return null;
  const alreadyHasTitleH1 = body.split("\n")[0]?.replace(/^#\s+/, "").trim() === title && body.startsWith("# ");
  const markdown = stripTailNavigation(alreadyHasTitleH1 ? body : `# ${title}\n\n${body}`);
  return { title, markdown };
}

/**
 * 尾部**站点模板指纹**清理(upstream v0.23.1, 2026-08-23 真实站点采样驱动; vendored verbatim)。
 * 原则:规则只管高置信度的**机器生成模板**(跨文章稳定、作为正文出现概率≈0);
 * 除此之外的不确定判断(作者自己写的推广段/水印/相关阅读算不算正文)一律不猜——
 * 那是课程设计层(tutor/Step4)的职责,解析层动了就是误删正文
 * (实测:按"欢迎关注公众号"删规则,把 CSDN 作者自己写的推广段删了)。
 */
const NAV_TAIL_PATTERNS = [
  /返回\S{0,6}[，,]?\s*查看更多/,   // 搜狐模板
  /点击进入\S{0,8}首页/,             // 搜狐模板
  /^热门文章$/,                       // 阿里云侧栏
  /^最新文章$/,                       // 阿里云侧栏
  /^目录\s*$/,                        // 阿里云侧栏(尾部窗口内)
  /^END\b.*版权/,                     // 公众号转载页模板
];
/** 行内导航后缀:正文与模板被并成一行时剥掉(精确短语,全文安全) */
const INLINE_NAV_SUFFIXES = ["目录 热门文章 最新文章"];
export function stripTailNavigation(md: string): string {
  if (!md) return md;
  for (const suffix of INLINE_NAV_SUFFIXES) md = md.split(suffix).join("");
  const lines = md.split("\n");
  let end = lines.length;
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 25); i--) {
    const ln = lines[i]!.trim();
    if (!ln) continue;
    // markdown 标记前缀剥掉再判(模板可能被转成 "## " 标题行)
    const bare = ln.replace(/^#{1,6}\s*/, "").replace(/^[>\-*]\s*/, "");
    const isNav = NAV_TAIL_PATTERNS.some((re) => re.test(bare) || re.test(ln));
    // 纯图片行:整行就是一张图或无空格裸图路径(CSDN 尾模板图)
    const isBareImage = /^!\[[^\]]*\]\([^)]*\)$/.test(ln) || /^\S+\.(jpeg|jpg|png|gif|webp)\)?$/i.test(ln);
    if (isNav || isBareImage) continue;
    end = i + 1;
    break;
  }
  return lines.slice(0, end).join("\n").trimEnd();
}

function htmlToMarkdownOf(roots: DomNode[], stripImages: boolean): string {
  const lines: string[] = [];
  emitBlocks(roots, stripImages, lines);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

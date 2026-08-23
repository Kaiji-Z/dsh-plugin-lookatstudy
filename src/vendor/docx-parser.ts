// Vendored/adapted from LookatStudy src/main/lib/docx-parser.ts (MIT License, https://github.com/Kaiji-Z/LookatStudy).
// Output contract kept (heading levels → #, paragraphs, code blocks → fenced):
// the officeparser AST dependency is replaced by direct OOXML parsing of
// word/document.xml (zero-dependency mandate). Word "Heading N" styles map to
// markdown headings so the course pipeline splits lessons on them, same as upstream.

import { readZip, readZipText } from "./zip-reader.ts";

function decodeEntities(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

/** One w:p paragraph: style name (e.g. "heading 1", "Heading2"), joined text. */
interface Para { style: string; text: string }

function parseParagraphs(documentXml: string): Para[] {
  const paras: Para[] = [];
  const pRe = /<w:p\b[^>]*\/>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
  let pm: RegExpExecArray | null;
  while ((pm = pRe.exec(documentXml)) !== null) {
    const p = pm[0];
    const style = p.match(/<w:pStyle w:val="([^"]+)"/i)?.[1] ?? "";
    let text = "";
    const tRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>/g;
    let tm: RegExpExecArray | null;
    while ((tm = tRe.exec(p)) !== null) {
      if (tm[1] !== undefined) text += decodeEntities(tm[1]);
      else if (/w:tab/.test(tm[0])) text += "\t";
      else text += "\n";
    }
    paras.push({ style: style.trim(), text });
  }
  return paras;
}

function headingLevel(style: string): number {
  const s = style.toLowerCase().replace(/\s+/g, "");
  const m = s.match(/heading(\d)/) ?? s.match(/titre(\d)/) ?? s.match(/berschrift(\d)/);
  if (m) return Math.min(6, Math.max(1, Number(m[1])));
  if (/^(title|titre)$/.test(s)) return 1;
  return 0;
}

/** .docx → markdown。Word Heading 样式保真为 # 级标题,代码样式段落围栏。 */
export function parseDocx(buf: Uint8Array): string {
  const entries = readZip(buf);
  const doc = readZipText(entries, "word/document.xml");
  if (!doc) throw new Error("docx 结构异常:缺 word/document.xml");
  const lines: string[] = [];
  for (const para of parseParagraphs(doc)) {
    const t = para.text.trim();
    if (!t) { lines.push(""); continue; }
    const lvl = headingLevel(para.style);
    if (lvl > 0) {
      lines.push("", "#".repeat(lvl) + " " + t, "");
    } else if (/code|sourcecode/i.test(para.style)) {
      lines.push("```", t, "```", "");
    } else {
      lines.push(t, "");
    }
  }
  const md = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!md) throw new Error("docx 里没有可识别的文本");
  return md;
}

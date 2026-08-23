// Vendored/adapted from LookatStudy src/main/lib/pptx-parser.ts (MIT License, https://github.com/Kaiji-Z/LookatStudy).
// Output contract kept verbatim (`## Slide N: <标题>` per slide, body text,
// `**讲者备注:** ...`) so the import pipeline turns each slide into a lesson
// automatically. officeparser dependency replaced by direct OOXML parsing of
// ppt/slides/slideN.xml + ppt/notesSlides/notesSlideN.xml (zero-dependency
// mandate). Embedded images are NOT extracted (v1 text-first, same tradeoff as
// upstream's epub path; image support lands with SPEC Phase 3 image inlining).

import { readZip, readZipText } from "./zip-reader.ts";

export interface PptxImage {
  buffer: Buffer;
  mimeType: string;
  slideNumber: number;
}

export interface PptxProcessResult {
  markdown: string;
  slideCount: number;
  /** v1 文本优先:恒为空数组,Phase 3 图片内联时接入内嵌图提取 */
  images: PptxImage[];
}

function decodeEntities(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

/** Extract this shape tree's text paragraphs (a:t runs joined per a:p). */
function shapeTexts(xml: string): string[] {
  const out: string[] = [];
  const pRe = /<a:p\b[^>]*>[\s\S]*?<\/a:p>/g;
  let pm: RegExpExecArray | null;
  while ((pm = pRe.exec(xml)) !== null) {
    let text = "";
    const tRe = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g;
    let tm: RegExpExecArray | null;
    while ((tm = tRe.exec(pm[0])) !== null) text += decodeEntities(tm[1] ?? "");
    const t = text.trim();
    if (t) out.push(t);
  }
  return out;
}

function slideNumber(name: string): number {
  return Number(name.match(/slide(\d+)\.xml$/i)?.[1] ?? 0);
}

/** .pptx → markdown(每张 slide 一个 ##)。失败抛错,调用方按"无内容"兜底。 */
export function parsePptx(buf: Uint8Array): PptxProcessResult {
  const entries = readZip(buf);
  const slideNames = [...entries.keys()]
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
    .sort((a, b) => slideNumber(a) - slideNumber(b));
  if (slideNames.length === 0) throw new Error("pptx 结构异常:没有幻灯片");

  const presProps = readZipText(entries, "docProps/app.xml");
  const deckTitle = decodeEntities(presProps.match(/<TitlesOfParts>[\s\S]*?<vt:lpstr>([^<]+)<\/vt:lpstr>/i)?.[1] ?? "").trim() || "PPTX";

  const lines: string[] = [`# ${deckTitle}`];
  for (const name of slideNames) {
    const xml = readZipText(entries, name);
    const no = slideNumber(name);
    const texts = shapeTexts(xml);
    const title = texts[0] ?? "";
    const body = texts.slice(1);
    lines.push(`\n## Slide ${no}: ${title || "(无标题)"}\n`);
    if (body.length) lines.push(body.join("\n\n"));
    const notes = shapeTexts(readZipText(entries, `ppt/notesSlides/notesSlide${no}.xml`));
    if (notes.length) lines.push(`\n**讲者备注:** ${notes.join(" ")}`);
  }
  return { markdown: lines.join("\n"), slideCount: slideNames.length, images: [] };
}

// Vendored from LookatStudy src/main/services/pure/text-chunk.ts (MIT License, https://github.com/Kaiji-Z/LookatStudy).
// Unmodified except this provenance header.
/**
 * 无标题长文分段器 —— 粘贴文本 / arXiv 论文 / (M3) 音频转写文本共用的预分段。
 *
 * 这些来源没有 markdown 标题,直接进管线会变成"一整块巨课"。分段器在句子
 * 边界切成 ~targetChars 的段,每段一个虚拟文件(`# 第 n 部分`),Step 4 的
 * 结构设计再把它们组成章节——零新增 LLM 步骤,规则先行。
 *
 * 纯函数,verify 直测。
 */

export interface TextChunkPart {
  /** 虚拟文件路径:{stem}-{nn}.md */
  path: string;
  /** 完整 markdown 内容(以 `# 第 n 部分` 开头) */
  content: string;
}

/** 段落/句子边界切分:优先段落聚合,超长段落内再按句子切。 */
function splitToUnits(text: string): string[] {
  const units: string[] = [];
  for (const para of text.split(/\n{2,}/)) {
    const p = para.replace(/\s+/g, " ").trim();
    if (!p) continue;
    if (p.length <= 600) {
      units.push(p);
      continue;
    }
    // 超长段落按句子切(保留句末标点;CJK 与西文标点都认)
    const sentences = p.match(/[^。！？!?.]+[。！？!?.]+["'”’）)]*|[^。！？!?.]+$/g) ?? [p];
    for (const s of sentences) {
      const t = s.trim();
      if (t) units.push(t);
    }
  }
  return units;
}

/**
 * 把无标题长文切成多个虚拟 markdown 文件。
 * @param stem 虚拟文件名主干(如 "notes" / "arxiv-2401.12345"),产出 {stem}-01.md
 * @param targetChars 每段目标字符数(默认 4000,与 Step4 的 3000-8000 课时段对齐)
 */
export function chunkHeadinglessText(text: string, stem: string, targetChars = 4000): TextChunkPart[] {
  const cleaned = text.replace(/\r\n/g, "\n").trim();
  if (!cleaned) return [];

  const units = splitToUnits(cleaned);
  const chunks: string[] = [];
  let buf: string[] = [];
  let bufLen = 0;
  for (const u of units) {
    // 单句超目标(极端):硬切
    if (u.length > targetChars) {
      if (buf.length > 0) { chunks.push(buf.join("\n\n")); buf = []; bufLen = 0; }
      for (let i = 0; i < u.length; i += targetChars) {
        chunks.push(u.slice(i, i + targetChars));
      }
      continue;
    }
    if (bufLen + u.length > targetChars && buf.length > 0) {
      chunks.push(buf.join("\n\n"));
      buf = [];
      bufLen = 0;
    }
    buf.push(u);
    bufLen += u.length;
  }
  if (buf.length > 0) chunks.push(buf.join("\n\n"));

  return chunks.map((c, i) => {
    const n = String(i + 1).padStart(2, "0");
    return { path: `${stem}-${n}.md`, content: `# 第 ${i + 1} 部分\n\n${c}` };
  });
}

/**
 * 单一长文档的统一预处理器:有 H2/H3 结构 → 整体一个文件(Step4 自己按标题拆);
 * 无结构且超长 → chunkHeadinglessText 预分段。url/arXiv/粘贴三个来源共用。
 */
export function prepareSingleDoc(name: string, markdown: string, stem?: string): TextChunkPart[] {
  const md = markdown.trim();
  if (!md) return [];
  const h2Count = (md.match(/^##\s/m) ?? []).length;
  const structured = h2Count >= 3; // 有明确小节结构,交给 Step4 按 anchor 拆
  if (structured || md.length <= 8000) {
    const safeName = name.replace(/[\\/:*?"<>|#]/g, "-").trim() || "document";
    return [{ path: `${safeName}.md`, content: md }];
  }
  const stemFallback = (stem ?? name.replace(/\s+/g, "-").slice(0, 40)) || "text";
  return chunkHeadinglessText(md, stemFallback);
}

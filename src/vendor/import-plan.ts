// Vendored from LookatStudy src/main/services/pure/import-plan.ts (MIT License, https://github.com/Kaiji-Z/LookatStudy).
// Unmodified except this provenance header.
/**
 * ImportPlan —— 导入管线"确定性"的核心数据格式(纯函数,无 DB/Electron 依赖)。
 *
 * 一个格式服务两个功能:
 *  1. 断点续跑:导入每个步骤边界把产物快照落盘;失败/重启后从最近快照继续,
 *     不再重烧已完成的 LLM 调用(Step 2 文件分类 + Step 4 结构设计是真金白银)。
 *  2. 课程包:GitHub 来源的 plan 文件原样分享给别人——对方导入同一仓库时
 *     零 LLM、秒过 AI 步骤(正文仍从 CDN 现拉;outlines 里的 bodyPreview 会
 *     携带每文件前 ~300 字的正文摘录——结构复用需要,总量 = 文件数×300字,可接受)。
 *
 * 身份与漂移检测:kind + github(owner/repo/branch) 或 folder(absPath) 唯一定位;
 * treeHash = sha1(排序后的 fullTree 路径)。仓库变了 → hash 不匹配 →
 * 结构走 bestEffortStructure 丢弃消失文件的课,分类作废重判。
 */
import { createHash, randomUUID } from "node:crypto";
import type { DiscoveredFile, FileOutline } from "./repo-fetcher.js";

export const IMPORT_PLAN_FORMAT_VERSION = 1;

/** Step 4 产物(与 import-llm-service 的 CourseStructure 结构兼容;独立定义避免服务链反向依赖) */
export interface PlanLesson {
  title: string;
  file: string;
  anchor?: string;
  world: "study" | "practice";
  attachImages?: string[];
}

export interface PlanSection {
  title: string;
  world: "study" | "practice";
  summary?: string;
  lessons: PlanLesson[];
}

export interface PlanStructure {
  courseTitle: string;
  sections: PlanSection[];
}

/** Step 2 产物(结构兼容 FileClassificationResult;Map 序列化为 Record) */
export interface PlanClassification {
  original: string[];
  practice: string[];
  skip: string[];
  translationFiles: Record<string, string[]>;
  translationPairs: Record<string, string>;
  languages: { code: string; name: string }[];
  sourceLang: string;
  translationLayout: "microsoft" | "parallel" | "suffix" | "none";
}

export interface ImportPlan {
  formatVersion: number;
  planId: string;
  /** kind:github | folder | url(网页文章/arXiv) | text(粘贴) | epub | audio(本地音频转写) */
  kind: "github" | "folder" | "url" | "text" | "epub" | "audio" | "video";
  github?: { owner: string; repo: string; branch: string };
  folder?: { absPath: string };
  /** url 源身份:归一化 URL */
  url?: { url: string };
  /** text 源身份:原始文本 sha1 */
  text?: { sha1: string };
  /** epub 源身份:章节内容哈希(重打包不换身份,内容变了才算漂移) */
  epub?: { sha1: string };
  /** audio 源身份:各音频文件字节哈希的聚合(同批文件=同课程;转写模型变化走内容哈希漂移) */
  audio?: { sha1: string };
  /** video 源身份:归一化视频 URL(B站/YouTube/抖音) */
  video?: { url: string };
  /** 漂移检测哈希:github/folder = 路径集合;url/text/epub/audio = 路径+内容(这些源改内容不改路径) */
  treeHash: string;
  createdAt: string;
  updatedAt: string;
  /** 已完成的最后一步(1=清单 2=分类 3=大纲 4=结构);Step5 成功另有 courseId 回填 */
  reachedStep: 1 | 2 | 3 | 4;
  /** Step5 成功后回填(plan 保留,作为课程包源 + 同仓库再导入的复用依据) */
  courseId?: string;
  courseTitle?: string;
  // ── Step 1 产物 ──
  readmeMd: string;
  fileList: DiscoveredFile[];
  fullTree: string[];
  /** github 清点解析出的分支(正文拉取用) */
  branch: string;
  /** url/text/epub 的正文缓存:这类源无法像 github(CDN)/folder(磁盘)那样现拉,
   *  断点续跑({kind:"plan"})靠它拿回 Steps 2-5 需要的内容 */
  docCache?: Record<string, string>;
  // ── Step 2 产物(LLM) ──
  classification?: PlanClassification;
  // ── Step 3 产物(无 LLM,但 CDN/磁盘重扫要时间) ──
  outlines?: Record<string, FileOutline>;
  // ── Step 4 产物(LLM) ──
  structure?: PlanStructure;
}

/** treeHash:对 fullTree 路径排序后拼接取 sha1——与路径枚举顺序无关,只对集合敏感。 */
export function computeTreeHash(fullTree: string[]): string {
  const joined = [...fullTree].sort().join("\n");
  return createHash("sha1").update(joined, "utf8").digest("hex");
}

/** 内容树哈希:url/text/epub 用——这些源改内容不改路径,漂移必须看正文。
 *  epub 重打包(zip 元数据变)内容不变 → 哈希不变 → 不误伤复用。 */
export function computeContentHash(docs: Iterable<[string, string]>): string {
  const joined = [...docs]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([p, c]) => `${p}\n${createHash("sha1").update(c, "utf8").digest("hex")}`)
    .join("\n");
  return createHash("sha1").update(joined, "utf8").digest("hex");
}

export function newPlanId(): string {
  return randomUUID();
}

/** 序列化(JSON 字符串)。parse 的逆;版本号随格式演进 bump。 */
export function serializePlan(plan: ImportPlan): string {
  return JSON.stringify(plan);
}

const PLAN_KINDS = new Set(["github", "folder", "url", "text", "epub", "audio", "video"]);

/** 解析 + 版本守卫:格式不对/坏 JSON 返回 null(调用方按"没有可用快照"处理,不崩)。 */
export function parsePlan(raw: string): ImportPlan | null {
  try {
    const o = JSON.parse(raw) as ImportPlan;
    if (!o || typeof o !== "object") return null;
    if (o.formatVersion !== IMPORT_PLAN_FORMAT_VERSION) return null;
    if (typeof o.planId !== "string" || !PLAN_KINDS.has(o.kind)) return null;
    if (!Array.isArray(o.fullTree) || typeof o.treeHash !== "string") return null;
    return o;
  } catch {
    return null;
  }
}

/** 导入源身份。branch 不参与身份(清点时解析实际分支),treeHash 决定内容一致与否。 */
export interface PlanIdentity {
  kind: "github" | "folder" | "url" | "text" | "epub" | "audio" | "video";
  github?: { owner: string; repo: string };
  folder?: { absPath: string };
  url?: { url: string };
  text?: { sha1: string };
  epub?: { sha1: string };
  audio?: { sha1: string };
  video?: { url: string };
}

/** 身份键:同 kind + github(owner/repo) / folder(absPath) / url(归一化) / text|epub(内容哈希) 视为同一导入源。 */
export function planIdentityKey(plan: PlanIdentity): string {
  if (plan.kind === "github" && plan.github) {
    return `github:${plan.github.owner.toLowerCase()}/${plan.github.repo.toLowerCase()}`;
  }
  if (plan.kind === "folder" && plan.folder) return `folder:${plan.folder.absPath}`;
  if (plan.kind === "url" && plan.url) return `url:${plan.url.url}`;
  if (plan.kind === "text" && plan.text) return `text:${plan.text.sha1}`;
  if (plan.kind === "epub" && plan.epub) return `epub:${plan.epub.sha1}`;
  if (plan.kind === "audio" && plan.audio) return `audio:${plan.audio.sha1}`;
  if (plan.kind === "video" && plan.video) return `video:${plan.video.url}`;
  return "unknown";
}

/** 当前清点与 plan 是否同一内容态:身份一致 + treeHash 一致。
 *  github/folder 传 fullTree(路径集合哈希);url/text/epub 这些"改内容不改路径"
 *  的源必须传 contentHash(调用方已按 computeContentHash 算好)——否则内容漂移
 *  会被漏检,静默复用旧结构。 */
export function planMatchesInventory(
  plan: ImportPlan,
  identity: PlanIdentity,
  fullTree: string[],
  contentHash?: string,
): boolean {
  const a = planIdentityKey(plan);
  const b = planIdentityKey(identity);
  if (a !== b || a === "unknown") return false;
  return plan.treeHash === (contentHash ?? computeTreeHash(fullTree));
}

/**
 * 仓库漂移后的结构尽力而为:丢弃指向已消失文件的 lesson,清空 lesson 的 section 整节丢,
 * 其余原样保留。返回 null 表示没有可抢救的(调用方退回正常 LLM 流程);
 * dropped = 因文件消失被丢弃的 lesson 数(调用方用于警告文案)。
 */
export function bestEffortStructure(
  structure: PlanStructure,
  existingFilePaths: string[],
): { structure: PlanStructure; dropped: number } | null {
  const exist = new Set(existingFilePaths);
  const sections: PlanSection[] = [];
  let dropped = 0;
  for (const sec of structure.sections) {
    const lessons: PlanLesson[] = [];
    for (const les of sec.lessons) {
      if (exist.has(les.file)) lessons.push(les);
      else dropped++;
    }
    if (lessons.length > 0) sections.push({ ...sec, lessons });
  }
  if (sections.length === 0) return null;
  return { structure: { courseTitle: structure.courseTitle, sections }, dropped };
}

/** 从 GitHub URL 提取 owner/repo;无效返回 null(与 IPC 旧正则一致,.git 后缀剥掉)。 */
export function parseGithubUrl(url: string): { owner: string; repo: string } | null {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!m) return null;
  return { owner: m[1]!, repo: m[2]!.replace(/\.git$/, "") };
}

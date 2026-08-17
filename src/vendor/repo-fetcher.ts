// Vendored from LookatStudy src/main/services/pure/repo-fetcher.ts (MIT License, https://github.com/Kaiji-Z/LookatStudy).
// Ported upstream network hardening (upstream 036d449 + 7c597f0 + a66cd3b, 2026-08-16): httpsGet gains deadlineMs +
// AbortSignal with a single-settle guard, the GitHub tree scan gets a 240s deadline, and a jsDelivr data API full-tree
// fallback covers Tree API failures. Plus one plugin-side test seam (setHttpsGetOverride) keeping tree-API calls
// offline in tests. Everything else verbatim from upstream main.
/**
 * 仓库导入器 —— 从学习型 GitHub 仓库构建课程结构。
 *
 * 核心策略:不依赖文件列表 API（api.github.com / api.jsdelivr.net 在很多网络环境下不可达），
 * 而是从 README.md 的 markdown 内部链接发现课程结构。
 *
 * 学习仓库的 README 通常有完整的课程大纲，链接指向每个课时:
 *   - 形态 A（课程型）: 链接指向 lessons/N-Topic/README.md + .ipynb
 *   - 形态 B（单文件型）: README 本身是超长文档，无子文件链接
 *
 * 数据源: cdn.jsdelivr.net/gh/{owner}/{repo}@{branch}/{path}（全球 CDN，无速率限制，
 * 在大多数网络环境下可用，包括 raw.githubusercontent.com 被墙的情况）
 *
 * 纯函数设计: fetchFn 由调用方注入（生产用 global fetch，测试用 mock）。
 */
import { parseMarkdownToCourse, type ParsedCourse, type ParsedSection, type ParsedLesson } from "./markdown-course.js";
import { classifyFile, type FileClassification } from "./file-classifier.js";
import https from "node:https";

/** 仓库文件条目（从 README 链接发现） */
export interface DiscoveredFile {
  path: string;
  /** 链接文本（课时标题） */
  title: string;
  /** 文件类型: md 正文 / ipynb notebook / rst / rmd / org / adoc / code / other */
  kind: "md" | "ipynb" | "rst" | "rmd" | "org" | "adoc" | "code" | "other";
}

/** 仓库检测结果 */
export type RepoPattern = "course" | "well-organized" | "single-file" | "docs-rich" | "unsupported";

export interface DetectionResult {
  pattern: RepoPattern;
  reason: string;
  /** course 模式: 从 README 链接发现的课时文件 */
  lessonFiles?: DiscoveredFile[];
  /** 单文件模式: README 本身的正文长度 */
  readmeLength?: number;
}

/** 拉取结果 */
export interface FetchedFile {
  path: string;
  title: string;
  md: string;
  /** 文件分类（由 classifyFile 填充，buildCourseFromFiles 用于决定是否进 lesson 列表） */
  classification?: FileClassification;
}

export interface FetchResult {
  ok: FetchedFile[];
  failed: { path: string; error: string }[];
}

/** CDN URL 构造 */
export function cdnUrl(owner: string, repo: string, branch: string, path: string): string {
  const cleanPath = path.replace(/^\.\//, "").replace(/^\//, "");
  return `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${branch}/${cleanPath}`;
}

/** 代码文件扩展名（代码即教学内容） */
const CODE_EXTENSIONS = [
  ".py", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
  ".go", ".rs", ".java", ".kt", ".kts", ".scala",
  ".c", ".h", ".cpp", ".cc", ".cxx", ".hpp",
  ".cs", ".rb", ".php", ".swift",
  ".sh", ".bash", ".zsh", ".ps1",
  ".lua", ".r", ".jl", ".dart",
  ".clj", ".ex", ".exs", ".erl", ".hs", ".ml", ".fs",
  ".sql", ".pl", ".elm",
];

/**
 * 从 README 的 markdown 链接提取内部文件引用。
 * 只看相对路径（非 http/锚点），且指向 .md/.ipynb 文件。
 */
export function extractInternalLinks(readmeMd: string): DiscoveredFile[] {
  const linkPattern = /\[([^\]]*)\]\(([^)]+)\)/g;
  const seen = new Set<string>();
  const files: DiscoveredFile[] = [];
  let m;
  while ((m = linkPattern.exec(readmeMd)) !== null) {
    const title = m[1].trim();
    let href = m[2].trim();
    // 去掉锚点部分
    href = href.split("#")[0];
    // 只看相对路径
    if (!href || href.startsWith("http") || href.startsWith("mailto:")) continue;
    // 去掉 ./ 前缀
    href = href.replace(/^\.\//, "");
    // 收文档 + 代码文件
    let kind: DiscoveredFile["kind"] = "other";
    if (href.endsWith(".md") || href.endsWith(".mdx")) kind = "md";
    else if (href.endsWith(".ipynb")) kind = "ipynb";
    else if (href.endsWith(".rst")) kind = "rst";
    else if (href.endsWith(".rmd")) kind = "rmd";
    else if (href.endsWith(".org")) kind = "org";
    else if (href.endsWith(".adoc") || href.endsWith(".asciidoc")) kind = "adoc";
    else if (CODE_EXTENSIONS.some((ext) => href.endsWith(ext))) kind = "code";
    else continue;
    // 去重
    if (seen.has(href)) continue;
    seen.add(href);
    files.push({ path: href, title: title || href, kind });
  }
  return files;
}

/**
 * 过滤:只保留像课时文件的（排除 translations/、lab/、translations、LICENSE 等）
 */
export function filterLessonFiles(files: DiscoveredFile[]): DiscoveredFile[] {
  return files.filter((f) => {
    const p = f.path.toLowerCase();
    // 排除翻译目录
    if (p.includes("translations/")) return false;
    // 排除常见非教学内容
    if (p.endsWith("license.md") || p.endsWith("contributing.md") || p.endsWith("code_of_conduct.md"))
      return false;
    // 排除 lab/ 目录（是配套练习说明，不是课时正文）
    // 注意:保留，但后面处理时区分对待
    return true;
  });
}

/**
 * 规则高置信度检测：仓库是否已用编号目录组织好课程结构。
 *
 * 判定依据：文件路径里有 ≥3 个不同的编号顶层目录（如 lessons/1-Intro/,
 * lessons/2-Symbolic/, lessons/3-NeuralNetworks/）。编号前缀 = 作者刻意组织。
 *
 * 这是确定性判断（规则管），不交给 LLM。
 * 命中 → pattern: "well-organized"，下游只判 world 不重组章节。
 */
export function detectWellOrganized(files: { path: string }[]): boolean {
  const topicDirs = new Set<string>();
  // 已知的课程组织目录名前缀（前缀 + 数字/分隔符，不含纯复数如 lessons/chapters）
  const ORGANIZED_PREFIXES = /^(week|unit|part|topic|lecture|session|day|step)(\d|[-_])/i;
  for (const f of files) {
    const parts = f.path.split("/").filter(Boolean);
    for (const part of parts) {
      if (part.includes(".")) continue; // 是文件名不是目录名
      // 编号目录 (1-Intro, 02_Symbolic, 03-Perceptron)
      const m = part.match(/^(\d+[-_])/i);
      if (m) {
        topicDirs.add(part.toLowerCase());
        break;
      }
      // 已知课程组织目录 (week1, unit-2, topic-a, lecture3, etc.)
      if (ORGANIZED_PREFIXES.test(part)) {
        topicDirs.add(part.toLowerCase());
        break;
      }
    }
  }
  return topicDirs.size >= 3;
}

/**
 * 检测仓库形态。
 *
 * 原则:规则管确定性，不确定的给 LLM 兜底（通过下游 analyzeCourseStructure）。
 *
 * - well-organized: README 链接 ≥1 个且路径有编号/组织目录(数字/week/unit/topic) → 保留原始结构
 * - course: README 链接里有 ≥1 个课程文件(.md/.ipynb/.py 等) → LLM 重组
 * - single-file: 无子文件链接但 README 有实质教学正文（prose >1000 字）
 * - docs-rich: README 无链接但文件树可能有内容 → 不急着拒绝，让 fetchRepoInventory 用文件树补全
 * - unsupported: awesome-list（外链占比>60%且正文极少）
 */
export function detectRepoPattern(readmeMd: string): DetectionResult {
  const allLinks = extractInternalLinks(readmeMd);
  const lessonLinks = filterLessonFiles(allLinks).filter((f) => f.kind !== "other");

  // 课程型: 有 ≥1 个子文件链接 → 尝试课程型（文件树会补全更多文件）
  if (lessonLinks.length >= 1) {
    // 高置信度检测:仓库是否已用编号目录组织好(如 lessons/1-Intro/...)
    if (detectWellOrganized(lessonLinks)) {
      return {
        pattern: "well-organized",
        reason: `README 含 ${lessonLinks.length} 个文件,路径有编号目录组织,判定为已组织好的课程仓库`,
        lessonFiles: lessonLinks,
      };
    }
    return {
      pattern: "course",
      reason: `README 含 ${lessonLinks.length} 个内部课程文件链接，判定为课程型仓库`,
      lessonFiles: lessonLinks,
    };
  }

  // 计算"实质正文"字符数（去徽章/HTML/链接语法后的纯文字）
  const proseChars = readmeMd
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")    // 去图片
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")  // 去链接语法保留文字
    .replace(/<[^>]+>/g, "")                   // 去 HTML 标签
    .replace(/^---[\s\S]*?---/m, "")           // 去 YAML front matter
    .replace(/\s/g, "").length;

  // 单文件型: 无子文件链接，但 README 有实质教学正文
  if (proseChars > 1000) {
    return {
      pattern: "single-file",
      reason: `README 无子文件链接，但实质正文 ${proseChars} 字，判定为单文件型`,
      readmeLength: readmeMd.length,
    };
  }

  // awesome-list 检测：外链占比极高 + 正文极少 → unsupported
  const externalLinks = (readmeMd.match(/\]\(https?:\/\//g) || []).length;
  const totalLinks = (readmeMd.match(/\]\(/g) || []).length;
  if (totalLinks > 10 && externalLinks / totalLinks > 0.6 && proseChars < 500) {
    return {
      pattern: "unsupported",
      reason: `README 外链占比 ${(externalLinks / totalLinks * 100).toFixed(0)}%，实质正文仅 ${proseChars} 字，疑似 awesome-list 资源索引（非课程）`,
    };
  }

  // docs-rich: README 无链接但可能 docs/ 下有大量内容 → 让 fetchRepoInventory 用文件树补全
  // 不在这里抛 unsupported，给文件树一个机会
  return {
    pattern: "docs-rich",
    reason: `README 无课程文件链接，实质正文 ${proseChars} 字 → 将用文件树补全课程文件`,
  };
}

/**
 * 并发拉取多个 markdown 文件（5 并发，防 CDN 过载）。
 *
 * @param files 要拉取的文件列表
 * @param owner repo owner
 * @param repo repo name
 * @param branch 分支名
 * @param fetchFn 注入的 fetch 函数
 * @param onProgress 进度回调 (done, total, currentPath)
 */
export async function fetchMarkdownContents(
  files: DiscoveredFile[],
  owner: string,
  repo: string,
  branch: string,
  fetchFn: typeof fetch,
  onProgress?: (done: number, total: number, currentPath: string) => void,
): Promise<FetchResult> {
  const ok: FetchedFile[] = [];
  const failed: { path: string; error: string }[] = [];
  const CONCURRENCY = 5;
  let done = 0;

  // 分批并发
  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const batch = files.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (f) => {
        const url = cdnUrl(owner, repo, branch, f.path);
        const r = await fetchFn(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const text = await r.text();
        // .ipynb → 用 notebook-parser 转成 markdown(markdown cell + code block)
        if (f.path.toLowerCase().endsWith(".ipynb")) {
          try {
            const { parseNotebook } = await import("./notebook-parser.js");
            const nbResult = parseNotebook(text);
            return { path: f.path, title: f.title, md: nbResult.markdown };
          } catch {
            return { path: f.path, title: f.title, md: text };
          }
        }
        // .rst/.rmd/.org/.adoc → 用各自解析器转 markdown
        const lowerPath = f.path.toLowerCase();
        if (lowerPath.endsWith(".rst") || lowerPath.endsWith(".rmd") || lowerPath.endsWith(".org") || lowerPath.endsWith(".adoc") || lowerPath.endsWith(".asciidoc")) {
          const parserMap: Record<string, string> = {
            ".rst": "rst-parser", ".rmd": "rmd-parser", ".org": "org-parser",
            ".adoc": "adoc-parser", ".asciidoc": "adoc-parser",
          };
          const ext = lowerPath.match(/\.[^.]+$/)?.[0] ?? "";
          const parserName = parserMap[ext];
          if (parserName) {
            try {
              const mod = await import(`./${parserName}.js`);
              const fn = mod.parseRst ?? mod.parseRmd ?? mod.parseOrg ?? mod.parseAdoc;
              return { path: f.path, title: f.title, md: fn(text).markdown };
            } catch {
              return { path: f.path, title: f.title, md: text };
            }
          }
        }
        // 代码文件 → code-parser 转 markdown (docstring + 代码围栏)
        if (CODE_EXTENSIONS.some((ext) => lowerPath.endsWith(ext))) {
          const ext = lowerPath.split(".").pop() ?? "";
          try {
            const { parseCode } = await import("./code-parser.js");
            return { path: f.path, title: f.title, md: parseCode(text, ext).markdown };
          } catch {
            return { path: f.path, title: f.title, md: "```\n" + text + "\n```" };
          }
        }
        return { path: f.path, title: f.title, md: text };
      }),
    );
    for (let j = 0; j < results.length; j++) {
      done++;
      const file = batch[j];
      const result = results[j];
      if (file) onProgress?.(done, files.length, file.path);
      if (result && result.status === "fulfilled") {
        ok.push(result.value);
      } else if (result && result.status === "rejected") {
        failed.push({
          path: file?.path ?? "(unknown)",
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    }
  }

  return { ok, failed };
}

/**
 * 把课程型仓库的多个课时文件合并成 ParsedCourse 结构。
 *
 * v3 改进:集成 file-classifier 规则引擎。
 *   - 先对每个文件调 classifyFile 判定角色（lesson/notebook/lab/section-intro/uncertain 等）
 *   - keepAsLesson=false 的文件（translation/meta/notebook/lab/example/section-intro）不进 lesson 列表
 *   - section-intro 的正文追加到同 section 摘要（作为章节概述）
 *   - uncertain 的文件进 lesson 列表但标 uncertain=true，后续 LLM 结构化时优先判断 keep/skip
 *
 * 分组策略保留 v2 的"第一个非通用目录"启发式（减少碎片）。
 *
 * 每个文件的内部 H2/H3 → 该 section 下的 lessons;无 H2/H3 则整个文件作一个 lesson。
 */
export function buildCourseFromFiles(
  courseTitle: string,
  files: FetchedFile[],
): ParsedCourse {
  // 第 0 步:对每个文件分类（siblingPaths = 全部文件路径）
  const allPaths = files.map((f) => f.path);
  for (const file of files) {
    if (!file.classification) {
      file.classification = classifyFile(file.path, file.md, { siblingPaths: allPaths });
    }
  }

  // 第一步:给每个 keepAsLesson 文件算"分组键"和"lesson 候选"
  // 非课时文件(notebook/lab/example/section-intro)的正文不丢弃——
  // notebook/lab/example 追加到同目录 lesson 的正文末尾（作为"代码/练习补充"）,
  // section-intro 追加到 section 第一个 lesson 的正文开头（作为"章节概述"）。
  interface FileGroup {
    sectionTitle: string;
    orderKey: string; // 用于排序(保持原路径顺序)
    lessons: ParsedLesson[];
    /** 待追加到第一个 lesson 的章节概述正文 */
    pendingIntro?: string;
  }
  const groupMap = new Map<string, FileGroup>();
  const groupOrder: string[] = [];

  const GENERIC_DIRS = new Set(["lessons", "docs", "doc", "src", "content", "modules", "chapters", "tutorials", "guide", "week", "unit", "part", "topic", "lecture", "session", "day", "step"]);

  /**
   * 计算文件的 section 分组键（和 lesson 用同一个逻辑）。
   */
  function sectionKeyOf(path: string): { groupKey: string; sectionTitle: string } {
    const parts = path.split("/").filter(Boolean);
    const dirParts = parts[parts.length - 1]?.match(/^readme/i) || parts[parts.length - 1] === "index.md"
      ? parts.slice(0, -1)
      : parts;
    const specificDir = dirParts.find((p) => !GENERIC_DIRS.has(p.toLowerCase()) && !/\.(md|mdx)$/i.test(p));
    if (dirParts.length >= 2 && specificDir) {
      const gk = specificDir.replace(/\.md$/i, "");
      return { groupKey: gk, sectionTitle: gk };
    } else if (dirParts.length === 1) {
      return { groupKey: path, sectionTitle: dirParts[0]!.replace(/\.md$/i, "") };
    }
    return { groupKey: path, sectionTitle: parts[parts.length - 1] ?? path };
  }

  // 先按路径排序，保证同目录的 notebook 在 lesson 之后（这样 lesson 先建好，notebook 能追加到它）
  const sortedFiles = [...files].sort((a, b) => a.path.localeCompare(b.path));

  for (const file of sortedFiles) {
    const classification = file.classification!;
    const { groupKey, sectionTitle } = sectionKeyOf(file.path);

    // 确保分组存在
    if (!groupMap.has(groupKey)) {
      groupMap.set(groupKey, { sectionTitle, orderKey: file.path, lessons: [] });
      if (!groupOrder.includes(groupKey)) groupOrder.push(groupKey);
    }
    const group = groupMap.get(groupKey)!;

    // ---- 非课时文件：正文合并到同目录 lesson ----
    if (!classification.keepAsLesson) {
      if (classification.role === "section-intro") {
        // section-intro → 追加到 section 第一个 lesson 开头
        group.pendingIntro = file.md;
      } else {
        // translation/meta → 不合并，直接跳过
      }
      continue;
    }

    // ---- uncertain 文件(notebook/lab/example):建独立 practice 节点 ----
    // 两个世界设计:不再把 notebook/lab/example 合并进 study lesson 正文,
    // 而是作为独立 practice lesson 入组(world=null,LLM 判 study/practice)。
    // 这样 LLM 能看到它们并判 world,用户也能在实操世界独立探索。
    const lowerP = file.path.toLowerCase();
    const isNotebook = lowerP.endsWith(".ipynb");
    const isLab = /\/lab\//.test(lowerP) || /\/labs\//.test(lowerP) || /\/exercise/.test(lowerP);
    const isExample = /\/examples?\//.test(lowerP) || /\/demos?\//.test(lowerP);
    if (isNotebook || isLab || isExample) {
      // notebook/lab/example → 独立 practice 节点(world=null 等 LLM 判)
      const h1Match = file.md.match(/^#\s+(.+)$/m);
      const lessonTitle = h1Match ? h1Match[1]!.trim() : file.title;
      group.lessons.push({
        title: lessonTitle,
        anchor: file.path.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        body: file.md,
        uncertain: true,
        sourceFilePath: file.path,
        world: null, // LLM 在 course-structure-service 判 study/practice
      });
      continue;
    }

    // ---- 课时文件：正常进 lesson 列表 ----
    const parsed = parseMarkdownToCourse(file.md);
    const parsedLessonCount = parsed.sections.reduce((sum, s) => sum + s.lessons.length, 0);
    const isUncertain = classification.role === "uncertain";
    const fileWorld = classification.world; // null for uncertain, "study" for section-intro
    const lessonCandidates: ParsedLesson[] =
      parsedLessonCount > 0
        ? parsed.sections
            .filter((s) => s.lessons.length > 0)
            .flatMap((s) => s.lessons.map((l) => ({
              title: l.title,
              anchor: l.title.toLowerCase().replace(/\s+/g, "-"),
              body: l.body,
              uncertain: isUncertain,
              sourceFilePath: file.path,
              world: fileWorld,
            })))
        : (() => {
            const h1Match = file.md.match(/^#\s+(.+)$/m);
            const lessonTitle = h1Match ? h1Match[1]!.trim() : file.title;
            return [{
              title: lessonTitle,
              anchor: lessonTitle.toLowerCase().replace(/\s+/g, "-"),
              body: file.md,
              uncertain: isUncertain,
              sourceFilePath: file.path,
              world: fileWorld,
            }];
          })();

    group.lessons.push(...lessonCandidates);
  }

  // 第二步:把 pendingIntro（section-intro 正文）追加到每个 section 第一个 lesson 开头
  for (const key of groupOrder) {
    const g = groupMap.get(key)!;
    if (g.pendingIntro && g.lessons.length > 0) {
      g.lessons[0]!.body = `> **📖 章节概述**\n>\n> ${g.pendingIntro.replace(/\n/g, "\n> ")}\n\n---\n\n${g.lessons[0]!.body}`;
    }
  }

  // 第三步:每个分组 → 一个 section（去掉空 section）
  // section.world: 全 practice 子节点 → practice, 否则 study(混或全 study)
  const sections: ParsedSection[] = groupOrder
    .filter((key) => groupMap.get(key)!.lessons.length > 0)
    .map((key) => {
      const g = groupMap.get(key)!;
      const practiceCount = g.lessons.filter((l) => l.world === "practice").length;
      const studyCount = g.lessons.filter((l) => l.world === "study").length;
      return {
        title: g.sectionTitle,
        anchor: g.sectionTitle.toLowerCase().replace(/\s+/g, "-"),
        world: practiceCount > 0 && studyCount === 0 ? "practice" as const : "study" as const,
        lessons: g.lessons,
      };
    });

  return { title: courseTitle, sections };
}

/* ============================================================
 * 文件发现:GitHub Tree API(主)→ jsdelivr 文件列表(fallback)→ README 链接(兜底)
 *
 * 用户网络只是偶尔不稳,不屏蔽 API。设计以最优方式为主,降级防抖。
 * ============================================================ */

/** 文件发现的来源标记(供进度提示 + 测试断言)。 */
export type FileDiscoverySource = "github-tree-api" | "jsdelivr-list" | "readme-links" | "none";

export interface DiscoveredTree {
  paths: string[];
  source: FileDiscoverySource;
}

/** 从 .md 路径列表构造 DiscoveredFile[](复用 filterLessonFiles 排除规则 + 标题推断)。 */
export function pathsToDiscoveredFiles(paths: string[]): DiscoveredFile[] {
  const files: DiscoveredFile[] = [];
  const seen = new Set<string>();
  for (const p of paths) {
    const lower = p.toLowerCase();
    if (seen.has(p)) continue;
    let kind: DiscoveredFile["kind"] = "other";
    if (lower.endsWith(".md") || lower.endsWith(".mdx")) kind = "md";
    else if (lower.endsWith(".ipynb")) kind = "ipynb";
    else if (lower.endsWith(".rst")) kind = "rst";
    else if (lower.endsWith(".rmd")) kind = "rmd";
    else if (lower.endsWith(".org")) kind = "org";
    else if (lower.endsWith(".adoc") || lower.endsWith(".asciidoc")) kind = "adoc";
    else if (CODE_EXTENSIONS.some((ext) => lower.endsWith(ext))) kind = "code";
    else continue;
    // 排除非教学内容
    if (lower.includes("node_modules/") || lower.startsWith(".git/") || lower.includes("translations/")) continue;
    if (lower.endsWith("license.md") || lower.endsWith("contributing.md") || lower.endsWith("code_of_conduct.md")) continue;
    seen.add(p);
    // 标题用文件名(去扩展名)或最后一层目录名
    const parts = p.split("/").filter(Boolean);
    const last = parts[parts.length - 1] ?? p;
    const title = last.replace(/\.(md|mdx|ipynb|rst|rmd|org|adoc|asciidoc|py|js|jsx|ts|tsx|go|rs|java|c|cpp|rb|sh|sql|lua|r|jl|dart|scala|kt|cs|php|swift|hs|clj|ex|erl|ml|fs|pl|elm)$/i, "").replace(/^readme$/i, parts[parts.length - 2] ?? last);
    files.push({ path: p, title, kind });
  }
  return files;
}

/**
 * 从本地扫描器（buildLocalInventory）已解析的 docs 直接构造 DiscoveredFile[]。
 *
 * 为什么本地路径不走 pathsToDiscoveredFiles：后者是面向 GitHub 文件树的过滤器，
 * 只保留 .md/.ipynb/.rst/.rmd/.org/.adoc + 代码扩展名，会 `else continue` 静默丢弃
 * .txt/.html/.htm/.pdf/.pptx。而本地扫描器按 EXT_KIND 接受并解析好这些格式了
 * （html→htmlToText / pdf→parsePdfText / pptx→parsePptx / txt→原文），
 * 再过一遍 pathsToDiscoveredFiles 等于把已解析的内容全扔掉 → 分类空 → 空课程
 * （见 scripts/verify-local-filelist.mjs 锁定的回归）。
 *
 * DiscoveredFile.kind 在下游分类 / 结构设计链路（classifyFileRoles、parseRoleResult、
 * parseStructureDesignResult、fallbackStructure）均不读取（只读 path），故统一填 "other"。
 */
export function docsToDiscoveredFiles(docs: { path: string; title?: string }[]): DiscoveredFile[] {
  const seen = new Set<string>();
  const files: DiscoveredFile[] = [];
  for (const d of docs) {
    if (!d.path || seen.has(d.path)) continue;
    seen.add(d.path);
    const parts = d.path.split("/").filter(Boolean);
    const last = parts[parts.length - 1] ?? d.path;
    const title = d.title?.trim() || last.replace(/\.[^.]+$/, "") || d.path;
    files.push({ path: d.path, title, kind: "other" });
  }
  return files;
}

/**
 * 主方式:GitHub Tree API 一次拿全仓文件树。
 * https://api.github.com/repos/{owner}/{repo}/git/trees/{branch}?recursive=1
 * 返回 { tree: [{ path, type }] }。筛 blob + .md/.ipynb。
 * 网络失败/限流 → 抛错(由调用方降级)。
 */
/**
 * 用 Node 的 https 模块拉取（可单独控制 SSL 验证）。
 * GitHub Tree API 的证书链在部分环境（Node 内置 CA）验证失败（中间证书缺失），
 * 对这一个获取公开文件树的请求用 rejectUnauthorized:false 绕过。
 * 风险可控：获取的是公开文件路径列表（无敏感数据），且只用于此请求。
 */
// Plugin-side test seam (documented divergence from upstream): the tree APIs
// ride this internal httpsGet, which a stubbed `fetch` cannot intercept —
// tests swap the transport to keep those calls offline. Production never
// touches the override.
export type HttpsGetFn = (
  url: string,
  opts: { rejectUnauthorized?: boolean; headers?: Record<string, string>; deadlineMs?: number; signal?: AbortSignal },
) => Promise<{ ok: boolean; status?: number; body?: string; error?: string }>;
export let httpsGetOverride: HttpsGetFn | null = null;
export function setHttpsGetOverride(fn: HttpsGetFn | null): void { httpsGetOverride = fn; }

export function httpsGet(
  url: string,
  opts: { rejectUnauthorized?: boolean; headers?: Record<string, string>; deadlineMs?: number; signal?: AbortSignal } = {},
): Promise<{ ok: boolean; status?: number; body?: string; error?: string }> {
  // 预先中止:不建连接直接返回(调用方循环靠 error:"aborted" 识别取消)
  if (opts.signal?.aborted) return Promise.resolve({ ok: false, error: "aborted" });
  if (httpsGetOverride !== null) return httpsGetOverride(url, opts);
  return new Promise((resolve) => {
    let settled = false;
    const done = (r: { ok: boolean; status?: number; body?: string; error?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      opts.signal?.removeEventListener("abort", onAbort);
      resolve(r);
    };
    // 取消信号:与 deadline 同权 —— req.destroy() 撕掉在飞 socket,
    // 240s 的树扫描被取消时立即返回,不等传输自然结束。
    const onAbort = () => { req.destroy(); done({ ok: false, error: "aborted" }); };
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    // 硬性总截止:覆盖 DNS/建连/TLS 握手/响应体全阶段。仅靠 socket 空闲超时
    // 兜不住"TCP 通了但 TLS 卡死"(实测 fastgithub 半死态:progress 卡 700s+,
    // 20s idle timeout 被底层活动不断重置,永不触发)。
    const deadline = setTimeout(() => {
      req.destroy();
      done({ ok: false, error: "deadline" });
    }, opts.deadlineMs ?? 25_000);
    const req = https.get(url, {
      headers: { "User-Agent": "lookatstudy-import", ...opts.headers },
      rejectUnauthorized: opts.rejectUnauthorized ?? true,
      timeout: 20000,
    }, (res) => {
      let body = "";
      res.on("data", (d: Buffer) => { body += d.toString(); });
      res.on("end", () => done({ ok: res.statusCode === 200, status: res.statusCode, body }));
      res.on("error", (e: Error) => done({ ok: false, status: res.statusCode, error: e.message }));
    });
    req.on("error", (e: Error) => done({ ok: false, error: e.message }));
    req.on("timeout", () => { req.destroy(); done({ ok: false, error: "timeout" }); });
  });
}

export async function fetchRepoFileTree(
  owner: string,
  repo: string,
  branch: string,
  _fetchFn?: typeof fetch, // 保留签名兼容，实际用内部 httpsGet（可控制 SSL）
  signal?: AbortSignal,
): Promise<DiscoveredTree> {
  // GitHub Tree API（主源：recursive=1 给全部文件，含 translations/、代码、图片等；
  // 大仓库(>50MB)会被 jsdelivr 403，此处反而是唯一可靠源）
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
  try {
    // 大仓库树 JSON 可达 2-4MB;部分网络直连 GitHub 被限速 ~24KB/s(实测 40s 才 948KB),
    // "活着但爬行"的传输不该被总截止掐掉 —— 树扫描单独放宽到 240s(该速度下覆盖 ~5.7MB),
    // 真挂死仍由 20s 空闲超时兜底。取消由 signal 即时撕断,不受 240s 拖累。
    const r = await httpsGet(apiUrl, { rejectUnauthorized: false, deadlineMs: 240_000, signal });
    console.error(`[import] GitHub Tree API: HTTP ${r.status ?? r.error}`);
    if (r.ok && r.body) {
      const data = JSON.parse(r.body) as { tree?: Array<{ path: string; type: string }> };
      const paths = (data.tree ?? []).filter((n) => n.type === "blob").map((n) => n.path);
      if (paths.length > 0) return { paths, source: "github-tree-api" };
    }
  } catch (e) {
    console.error(`[import] GitHub Tree API 异常: ${e instanceof Error ? e.message : e}`);
  }
  // fallback:jsdelivr data API 全树列表(<50MB 仓库有效;大仓库 403 是它的硬上限,
  // 历史上因此被砍 —— 但 fastgithub 死时这是中小仓库唯一的全树源,加回来当降级)
  try {
    const r2 = await httpsGet(
      `https://data.jsdelivr.com/v1/packages/gh/${owner}/${repo}@${branch}?structure=flat`,
      { rejectUnauthorized: false, signal },
    );
    if (r2.ok && r2.body) {
      const data = JSON.parse(r2.body) as { files?: Array<{ name: string }> };
      const paths = (data.files ?? []).map((f) => f.name);
      if (paths.length > 0) {
        console.error(`[import] jsdelivr data API 全树: ${paths.length} 文件(Tree API 降级)`);
        return { paths, source: "jsdelivr-list" };
      }
    }
  } catch {
    // 降级链尽头,交给 README 兜底
  }
  return { paths: [], source: "none" };
}

/**
 * 兜底:从 README 链接发现 + 一层递归(读到的 .md 文件内部再找链接)。
 * 用于 Tree API + jsdelivr 都失败时,或网络不稳的场景。
 */
export async function discoverFromReadmeRecursively(
  readmeMd: string,
  owner: string,
  repo: string,
  branch: string,
  fetchFn: typeof fetch,
  maxDepth = 1,
  onProgress?: (msg: string) => void,
): Promise<DiscoveredTree> {
  const direct = filterLessonFiles(extractInternalLinks(readmeMd)).filter((f) => f.kind === "md");
  if (direct.length === 0) return { paths: [], source: "readme-links" };

  const allPaths = new Set<string>(direct.map((f) => f.path));

  // 一层递归:拉取直接链接的文件,从其内部再找 .md 链接
  if (maxDepth >= 1) {
    onProgress?.(`README 发现 ${direct.length} 个文件,递归扫描子链接…`);
    const fetched = await fetchMarkdownContents(direct, owner, repo, branch, fetchFn);
    for (const f of fetched.ok) {
      const subLinks = filterLessonFiles(extractInternalLinks(f.md)).filter((s) => s.kind === "md");
      for (const s of subLinks) {
        if (!allPaths.has(s.path)) allPaths.add(s.path);
      }
    }
  }

  return { paths: Array.from(allPaths), source: "readme-links" };
}

/* ============================================================
 * v0.8 多模态:GitHub 导入图片收集
 * 从已拉取的 .md 内容里解析 ![](img.png) 引用,从 CDN 下载图片二进制。
 * ============================================================ */

/** 图片扩展名集合(与 local-folder-scanner 保持一致) */
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "ico", "tiff", "tif", "heic"]);

/** ext → MIME */
const EXT_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
};

/** 从 markdown 文本提取图片引用 ![alt](path) + <img src='...'>,只收相对路径的图片扩展名 */
export function extractImageRefsFromMd(md: string): { alt: string; path: string }[] {
  const refs: { alt: string; path: string }[] = [];
  const seen = new Set<string>();

  // 1. Markdown 语法 ![alt](url)
  const mdPattern = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = mdPattern.exec(md)) !== null) {
    const alt = m[1].trim();
    let url = m[2].trim();
    const titleMatch = url.match(/\s+"[^"]*"$/);
    if (titleMatch) url = url.slice(0, titleMatch.index).trim();
    url = url.split("#")[0];
    if (!url || url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:")) continue;
    url = url.replace(/^\.\//, "");
    const ext = url.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? "";
    if (!IMAGE_EXTS.has(ext)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    refs.push({ alt, path: url });
  }

  // 2. HTML <img> 标签(覆盖微软课程仓库 <img src='images/xxx.png'/>)
  // 两步法:先提取 <img ...> 整标签,再独立提取 src 和 alt(属性顺序无关)
  const htmlPattern = /<img\s+[^>]*>/gi;
  let hm: RegExpExecArray | null;
  while ((hm = htmlPattern.exec(md)) !== null) {
    const tag = hm[0];
    let url = (tag.match(/src=['"]([^'"]+)['"]/i)?.[1] ?? "").trim().split("#")[0];
    const alt = (tag.match(/alt=['"]([^'"]*)['"]/i)?.[1] ?? "").trim();
    if (!url || url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:")) continue;
    url = url.replace(/^\.\//, "");
    const ext = url.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? "";
    if (!IMAGE_EXTS.has(ext)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    refs.push({ alt: alt || (url.split("/").pop() ?? url), path: url });
  }

  return refs;
}

/** 从 .md 文件路径解析图片引用的绝对仓库路径(相对 doc 所在目录) */
function resolveRepoImgPath(imgRef: string, docPath: string): string {
  const docDir = docPath.includes("/") ? docPath.slice(0, docPath.lastIndexOf("/")) : "";
  const parts = docDir ? docDir.split("/") : [];
  for (const p of imgRef.split("/")) {
    if (p === "..") parts.pop();
    else if (p !== "." && p !== "") parts.push(p);
  }
  return parts.join("/");
}

/** 下载的图片结果 */
export interface DownloadedImage {
  /** 仓库内的相对路径(用作 sourcePath) */
  repoPath: string;
  /** 关联的 doc 路径(用于 nodeId 匹配) */
  docPath: string;
  /** 图片二进制 */
  buffer: Buffer;
  /** MIME */
  mimeType: string;
  /** alt 文本 */
  altText: string;
}

/**
 * 从已拉取的 markdown 文件里收集图片引用,从 CDN 下载二进制。
 * 5 并发,防 CDN 过载。单个失败跳过不阻塞。
 *
 * @param files 已拉取的 .md 文件(ok 列表)
 * @param owner repo owner
 * @param repo repo name
 * @param branch 分支
 * @param fetchFn 注入的 fetch
 * @param onProgress 进度回调
 * @returns 下载成功的图片列表
 */
export async function fetchRepoImages(
  files: FetchedFile[],
  owner: string,
  repo: string,
  branch: string,
  fetchFn: typeof fetch,
  onProgress?: (done: number, total: number, path: string) => void,
): Promise<DownloadedImage[]> {
  // 1. 从所有 .md 文件收集图片引用(去重)
  const allRefs = new Map<string, { repoPath: string; docPath: string; alt: string }>();
  for (const file of files) {
    const refs = extractImageRefsFromMd(file.md);
    for (const ref of refs) {
      const repoPath = resolveRepoImgPath(ref.path, file.path);
      if (!allRefs.has(repoPath)) {
        allRefs.set(repoPath, { repoPath, docPath: file.path, alt: ref.alt });
      }
    }
  }

  if (allRefs.size === 0) return [];
  const refList = Array.from(allRefs.values());
  const downloaded: DownloadedImage[] = [];
  const CONCURRENCY = 5;

  // 2. 并发下载(分批)
  for (let i = 0; i < refList.length; i += CONCURRENCY) {
    const batch = refList.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (ref) => {
        const url = cdnUrl(owner, repo, branch, ref.repoPath);
        const r = await fetchFn(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const buf = Buffer.from(await r.arrayBuffer());
        const ext = ref.repoPath.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? "png";
        return {
          repoPath: ref.repoPath,
          docPath: ref.docPath,
          buffer: buf,
          mimeType: EXT_TO_MIME[ext] ?? "image/png",
          altText: ref.alt || ref.repoPath.split("/").pop() || ref.repoPath,
        } satisfies DownloadedImage;
      }),
    );
    for (let j = 0; j < results.length; j++) {
      const done = i + j + 1;
      const ref = batch[j];
      onProgress?.(done, refList.length, ref?.repoPath ?? "");
      const result = results[j];
      if (result && result.status === "fulfilled") {
        downloaded.push(result.value);
      }
    }
  }

  return downloaded;
}

/* ============================================================
 * 顶层编排:从 GitHub repo URL → ParsedCourse（纯函数，不落库）
 *
 * 提取自 ipc/index.ts 的 importFromRepo handler 的纯逻辑部分。
 * IPC handler / 种子脚本 / 未来 CLI 都复用本函数。
 * ============================================================ */

/** importRepoToParsedCourse 的返回结果 */
export interface ImportRepoResult {
  /** 构建好的课程结构（含 classification 标签） */
  course: ParsedCourse;
  /** 仓库检测结果 */
  detection: DetectionResult;
  /** 拉取的文件（含 classification，供图像收集等后续步骤用） */
  fetchedFiles: FetchedFile[];
  /** README 实际用的分支（main 或 master） */
  readmeBranch: string;
  /** README 全文（供 single-file 降级用） */
  readmeMd: string;
}

/** 文件数上限（防爆，和 IPC handler 一致） */
const MAX_FILES = 500;

/**
 * 从 GitHub 仓库构建课程结构 —— 纯编排函数。
 *
 * 流程: fetch README → detectRepoPattern → 发现文件树 → fetchMarkdownContents
 *       → classifyFile（在 buildCourseFromFiles 内）→ buildCourseFromFiles
 *
 * 不落库、不发进度事件（onProgress 回调只传消息字符串，由调用方决定怎么用）。
 *
 * @param owner GitHub owner
 * @param repo GitHub repo
 * @param branch 起始分支（README 先试 main 再试 master）
 * @param fetchFn 注入的 fetch（生产用 global fetch，测试用 mock）
 * @param onProgress 进度回调（可选）
 */
export async function importRepoToParsedCourse(
  owner: string,
  repo: string,
  branch: string,
  fetchFn: typeof fetch,
  onProgress?: (msg: string) => void,
): Promise<ImportRepoResult> {
  const send = (msg: string) => onProgress?.(msg);

  // 1. 拉 README（试 main/master 两个分支）
  send("正在拉取 README…");
  const branches = branch === "master" ? ["master", "main"] : ["main", "master"];
  let readmeMd: string | null = null;
  let readmeBranch = branch;
  for (const br of branches) {
    try {
      const r = await fetchFn(cdnUrl(owner, repo, br, "README.md"));
      if (r.ok) {
        readmeMd = await r.text();
        readmeBranch = br;
        break;
      }
    } catch {
      // 网络错误，试下一个分支
    }
  }
  if (!readmeMd) throw new Error(`无法拉取 README（试过分支: ${branches.join(", ")}）`);
  send(`README 拉取成功（${readmeMd.length} 字符，分支 ${readmeBranch}）`);

  // 2. 检测仓库形态
  const detection = detectRepoPattern(readmeMd);
  if (detection.pattern === "unsupported") {
    throw new Error(`仓库不支持: ${detection.reason}`);
  }

  // single-file: 直接返回（调用方用 generateCourseFromMarkdown 处理）
  if (detection.pattern === "single-file") {
    return {
      course: parseMarkdownToCourse(readmeMd),
      detection,
      fetchedFiles: [],
      readmeBranch,
      readmeMd,
    };
  }

  // 3. course 型: 发现文件
  // 策略:README 链接是人工策展的（作者选了真正重要的文件），优先用它。
  // 文件树是穷举的（含草稿/翻译/内部文档），只在 README 链接太少时才补充。
  let lessonFiles = filterLessonFiles(detection.lessonFiles ?? []);
  const readmeLinkCount = lessonFiles.length;

  // 只在 README 链接很少（<5）时才尝试文件树补充
  if (readmeLinkCount < 5) {
    try {
      send("README 链接较少，扫描文件树补充…");
      const tree = await fetchRepoFileTree(owner, repo, readmeBranch, fetchFn);
      if (tree.paths.length > 0) {
        const treeFiles = pathsToDiscoveredFiles(tree.paths);
        const treeLessonFiles = filterLessonFiles(treeFiles).filter((f) => f.kind !== "other");
        if (treeLessonFiles.length > lessonFiles.length) {
          lessonFiles = treeLessonFiles;
          send(`文件树发现 ${lessonFiles.length} 个课时文件（来源: ${tree.source}）`);
        }
      }
    } catch {
      send("文件树拉取失败，使用 README 链接发现");
    }
  } else {
    send(`README 链接发现 ${readmeLinkCount} 个课时文件（人工策展，优先使用）`);
  }

  if (lessonFiles.length === 0) {
    // 没有子文件，降级为 single-file
    send("未发现课时文件，降级为单文件导入");
    return {
      course: parseMarkdownToCourse(readmeMd),
      detection: { ...detection, pattern: "single-file", reason: "无课时文件，降级" },
      fetchedFiles: [],
      readmeBranch,
      readmeMd,
    };
  }

  // 上限:超过 MAX_FILES 时，优先保留 README 链接的文件（人工策展），
  // 从文件树补充的文件按路径排序截断（保留编号靠前的课时，通常是基础课）
  if (lessonFiles.length > MAX_FILES) {
    send(`文件数 ${lessonFiles.length} 超过上限 ${MAX_FILES}，截断`);
    if (readmeLinkCount > 0 && readmeLinkCount < MAX_FILES) {
      // 保留所有 README 链接文件 + 文件树文件按路径排序填充剩余空间
      const readmePaths = new Set(filterLessonFiles(detection.lessonFiles ?? []).map((f) => f.path));
      const fromReadme = lessonFiles.filter((f) => readmePaths.has(f.path));
      const fromTree = lessonFiles.filter((f) => !readmePaths.has(f.path)).slice(0, MAX_FILES - fromReadme.length);
      lessonFiles = [...fromReadme, ...fromTree];
    } else {
      lessonFiles = lessonFiles.slice(0, MAX_FILES);
    }
  }

  // 4. 拉取正文
  send(`检测到课程型仓库（${lessonFiles.length} 个文件），开始拉取…`);
  const fetchResult = await fetchMarkdownContents(
    lessonFiles, owner, repo, readmeBranch, fetchFn,
    (done, total, path) => send(`拉取 ${done}/${total}: ${path}`),
  );

  if (fetchResult.ok.length === 0) {
    // 所有文件拉取失败 → 抛错让用户知道（而不是静默用 README 伪造课程）
    throw new Error(
      `检测到 ${lessonFiles.length} 个课时文件，但全部拉取失败。` +
      `可能是网络受限。请稍后重试或改用「粘贴 Markdown」方式手动导入。`,
    );
  }

  // 5. 构建课程（buildCourseFromFiles 内部会调 classifyFile 做分类）
  const h1Match = readmeMd.match(/^#\s+(.+)$/m);
  const courseTitle = h1Match ? h1Match[1]!.trim() : repo;
  const course = buildCourseFromFiles(courseTitle, fetchResult.ok);
  send(`解析完成：${course.sections.length} 章节，构建课程…`);

  return {
    course,
    detection,
    fetchedFiles: fetchResult.ok,
    readmeBranch,
    readmeMd,
  };
}

/* ============================================================
 * 多语言:从 README 检测翻译语言 + 拉取翻译版课程内容
 * ============================================================ */

/** 从 markdown 链接中提取翻译语言列表 */
export function extractLanguagesFromReadme(readmeMd: string): { code: string; name: string }[] {
  // 匹配 [语言名](./translations/xx-XX/README.md) 或 [语言名](translations/xx-XX/README.md)
  const pattern = /\[([^\]]+)\]\(\.?\/?translations\/([^/)]+)\/README\.md\)/g;
  const langs: { code: string; name: string }[] = [];
  const seen = new Set<string>();
  let m;
  while ((m = pattern.exec(readmeMd)) !== null) {
    const name = m[1]!.trim();
    const code = m[2]!.trim();
    if (!seen.has(code)) {
      seen.add(code);
      langs.push({ code, name });
    }
  }
  return langs;
}

/**
 * 从 GitHub 仓库检测可用翻译语言。
 * 拉根 README → 提取翻译链接 → 返回语言列表（空 = 无翻译）。
 */
export async function detectRepoLanguages(
  owner: string,
  repo: string,
  branch: string,
  fetchFn: typeof fetch,
): Promise<{ code: string; name: string }[]> {
  // 试 main + master
  const branches = branch === "master" ? ["master", "main"] : ["main", "master"];
  for (const br of branches) {
    try {
      const r = await fetchFn(cdnUrl(owner, repo, br, "README.md"));
      if (r.ok) {
        const readme = await r.text();
        return extractLanguagesFromReadme(readme);
      }
    } catch {
      // 试下一个
    }
  }
  return [];
}

/** 翻译版文件条目 */
export interface TranslatedFile {
  /** 原文路径（用于和 content_nodes 对齐） */
  originalPath: string;
  /** 翻译版路径（translations/<code>/...） */
  translatedPath: string;
  title: string;
  md: string;
}

/**
 * 净化翻译版 markdown —— 翻译内容是 CDN 原样拉取的,未经原文管道的
 * code-fence-aware parser 处理,可能含畸形结构导致 react-markdown 崩溃。
 *
 * 处理:
 *   1. 未闭合代码围栏:统计 ``` 和 ~~~ 数量,奇数则补一个闭合围栏
 *   2. 去除 <script>/<style>/<iframe> 等危险 HTML(防 XSS + 防渲染崩溃)
 *   3. 去 BOM、统一换行
 *
 * 这是确定性规则处理(高置信度),不是 LLM 判断 —— 格式修复是规则擅长的。
 */
export function sanitizeTranslatedMarkdown(md: string): string {
  let s = md.replace(/^\uFEFF/, ""); // BOM
  s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n"); // 统一换行

  // 1. 代码围栏平衡:逐行状态机检测未闭合围栏
  const lines = s.split("\n");
  let fence: string | null = null; // 当前围栏类型("```" 或 "~~~")
  for (const line of lines) {
    const m = line.match(/^\s*(```|~~~)/);
    if (m) {
      fence = fence ? null : m[1]!; // 切换状态
    }
  }
  if (fence) {
    // 围栏没闭合 → 补一个
    s = s + "\n" + fence + "\n";
  }

  // 2. 去除危险 HTML 标签(script/style/iframe/object/embed)
  // react-markdown 默认不渲染 raw HTML(除非 rehype-raw),但保险起见仍剥离
  s = s.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  s = s.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");
  s = s.replace(/<\/?(iframe|object|embed)\b[^>]*>/gi, "");

  return s.trim();
}

/**
 * 拉取翻译版课程内容。
 *
 * 策略:不依赖翻译版 README 的链接（很多翻译只翻译了大纲，README 里没有 lesson 链接，
 * 或链接指向其他语言翻译）。直接用原文课程的文件路径，在前面加 translations/<code>/
 * 前缀去探测翻译版是否存在。5 并发拉取，404 跳过（该课无翻译）。
 *
 * @returns Map<originalPath, { title, content }> — key 是原文路径
 */
export async function fetchTranslatedContent(
  owner: string,
  repo: string,
  branch: string,
  langCode: string,
  originalFiles: FetchedFile[],
  fetchFn: typeof fetch,
  onProgress?: (msg: string) => void,
): Promise<Map<string, { title: string; content: string }>> {
  const send = (msg: string) => onProgress?.(msg);
  const result = new Map<string, { title: string; content: string }>();

  // 先确认翻译版 README 存在（不存在说明该语言完全没翻译）
  const transReadmeUrl = cdnUrl(owner, repo, branch, `translations/${langCode}/README.md`);
  send(`检查翻译版 README (${langCode})…`);
  try {
    const r = await fetchFn(transReadmeUrl);
    if (!r.ok) {
      send(`翻译版不存在 (${r.status})，跳过`);
      return result;
    }
  } catch {
    send("翻译版检查失败，跳过");
    return result;
  }

  // 只对 .md 文件探测翻译版（.ipynb 通常不翻译）
  const mdFiles = originalFiles.filter((f) => !f.path.toLowerCase().endsWith(".ipynb"));
  send(`探测 ${mdFiles.length} 个文件的翻译版（${langCode}）…`);

  const transPrefix = `translations/${langCode}/`;
  const CONCURRENCY = 5;
  let done = 0;

  for (let i = 0; i < mdFiles.length; i += CONCURRENCY) {
    const batch = mdFiles.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (file) => {
        const transPath = transPrefix + file.path;
        const url = cdnUrl(owner, repo, branch, transPath);
        const r = await fetchFn(url);
        if (!r.ok) return null; // 该文件无翻译
        const md = await r.text();
        return { originalPath: file.path, title: file.title, content: sanitizeTranslatedMarkdown(md) };
      }),
    );
    for (const res of results) {
      done++;
      if (res.status === "fulfilled" && res.value) {
        result.set(res.value.originalPath, { title: res.value.title, content: res.value.content });
      }
    }
    if (done % 10 === 0 || done === mdFiles.length) {
      send(`翻译探测 ${done}/${mdFiles.length}（命中 ${result.size}）`);
    }
  }

  send(`翻译版拉取完成: ${result.size}/${mdFiles.length} 文件有翻译`);
  return result;
}

/* ============================================================
 * 新智能导入管线: Step 1 (fetchRepoInventory) + Step 3 (fetchFileOutlines)
 * ============================================================ */

/** 仓库清单 —— Step 1 的输出 */
export interface RepoInventory {
  /** README 全文 */
  readmeMd: string;
  /** 课程文件路径列表(供 Step 3+5 拉正文用，已过滤翻译/元数据) */
  fileList: DiscoveredFile[];
  /** 完整目录树(所有文件路径，含 translations/images/lab 等，供 LLM 看) */
  fullTree: string[];
  /** README 实际使用的分支 */
  branch: string;
  /** 仓库检测结果 */
  detection: DetectionResult;
}

/**
 * Step 1: 拉取仓库清单 —— README 全文 + 完整目录树 + 课程文件列表。
 *
 * 三样东西:
 *   1. README 全文 → 给 LLM 看课程大纲
 *   2. 完整目录树(所有路径) → 给 LLM 看仓库结构(translations/、images/、lab/ 等)
 *   3. 课程文件列表(filterLessonFiles 过滤后) → 供 Step 3+5 拉正文用
 *
 * 不拉正文。
 */
export async function fetchRepoInventory(
  owner: string,
  repo: string,
  branch: string,
  fetchFn: typeof fetch,
  onProgress?: (msg: string) => void,
  signal?: AbortSignal,
): Promise<RepoInventory> {
  const send = (msg: string) => onProgress?.(msg);

  // 1. 拉 README（多候选文件名 + 多分支）
  send("正在拉取 README…");
  const branches = branch === "master" ? ["master", "main", "develop", "gh-pages"]
    : branch === "main" ? ["main", "master", "develop", "gh-pages"]
    : [branch, "main", "master"];
  // README 候选文件名（按优先级）
  const readmeCandidates = ["README.md", "readme.md", "README.MD", "README.rst", "README.adoc", "index.md", "home.md", "SUMMARY.md"];
  let readmeMd: string | null = null;
  let readmeBranch = branch;
  outer: for (const br of branches) {
    for (const candidate of readmeCandidates) {
      // 取消即断:在飞请求由调用方注入的 signal 撕断(reject AbortError 被 catch),
      // 这里在下一个候选开头干净退出,不把"取消"误报成"无法拉取 README"
      if (signal?.aborted) throw new Error("导入已取消");
      try {
        const r = await fetchFn(cdnUrl(owner, repo, br, candidate));
        if (r.ok) {
          readmeMd = await r.text();
          readmeBranch = br;
          break outer;
        }
      } catch {
        // network error, try next
      }
    }
  }
  if (!readmeMd) throw new Error(`无法拉取 README（试过分支: ${branches.join(", ")}，文件名: ${readmeCandidates.join(", ")}）`);
  send(`README 拉取成功（${readmeMd.length} 字符，分支 ${readmeBranch}）`);

  // 2. 检测形态
  const detection = detectRepoPattern(readmeMd);
  if (detection.pattern === "unsupported") {
    throw new Error(`仓库不支持: ${detection.reason}`);
  }

  // 3. 课程文件列表（初始：README 链接发现）
  let fileList = filterLessonFiles(detection.lessonFiles ?? []);
  send(`README 链接发现 ${fileList.length} 个课程文件`);

  // 4. 完整目录树 + 用文件树补全 fileList（README 链接会漏文件）
  // 总是拉取文件树：既供 LLM 看仓库结构，又补全 README 表格没列全的课程文件
  let fullTree: string[] = fileList.map((f) => f.path);
  try {
    send("扫描仓库完整目录结构…");
    const tree = await fetchRepoFileTree(owner, repo, readmeBranch, fetchFn, signal);
    if (tree.paths.length > 0) {
      fullTree = tree.paths;
      // 用文件树的内容文件补全 fileList（README 表格可能没列全所有 .md/.ipynb）
      const treeFiles = pathsToDiscoveredFiles(tree.paths);
      const treeLessonFiles = filterLessonFiles(treeFiles).filter((f) => f.kind !== "other");
      const existing = new Set(fileList.map((f) => f.path));
      const added = treeLessonFiles.filter((f) => !existing.has(f.path));
      if (added.length > 0) {
        fileList = [...fileList, ...added];
        send(`文件树补充 ${added.length} 个，共 ${fileList.length} 个课程文件`);
      }
      send(`目录树: ${fullTree.length} 个文件/目录`);
    }
  } catch {
    send("目录树拉取失败，使用 README 链接列表");
  }
  // 树扫描被取消(240s 窗口内任意时刻) → 干净退出,不带着 README-only 的残缺清单继续
  if (signal?.aborted) throw new Error("导入已取消");

  // docs-rich 模式下文件树也没找到课程文件 → 不支持
  if (fileList.length === 0) {
    throw new Error(`未找到课程文件（README 无链接且文件树无可识别的文档/代码文件）`);
  }

  // 上限
  if (fileList.length > MAX_FILES) {
    send(`文件数 ${fileList.length} 超过上限 ${MAX_FILES}，截断`);
    fileList = fileList.slice(0, MAX_FILES);
  }

  return { readmeMd, fileList, fullTree, branch: readmeBranch, detection };
}

/** 文件标题大纲 —— Step 3 的输出 */
export interface FileOutline {
  /** 文件 H1 标题（第一个 # 开头的行） */
  h1: string;
  /** 文件总字符数（全文，含正文）—— 长文件拆分决策依据 */
  totalChars: number;
  /** H2/H3 标题列表（不含正文）+ 每段字符数（到下一个同级或更高级标题） */
  headings: { level: number; title: string; chars: number }[];
}

/**
 * Step 3: 批量提取文件的标题大纲（H1/H2/H3 + 每段字符数，不含正文）。
 * 拉取完整文件文本（不只前 N 行），因为字符数统计需要全文。
 * 并发度 5，同 fetchMarkdownContents。
 */
export async function fetchFileOutlines(
  filePaths: string[],
  owner: string,
  repo: string,
  branch: string,
  fetchFn: typeof fetch,
  onProgress?: (done: number, total: number, path: string) => void,
  signal?: AbortSignal,
): Promise<Map<string, FileOutline>> {
  const result = new Map<string, FileOutline>();
  const CONCURRENCY = 5;

  for (let i = 0; i < filePaths.length; i += CONCURRENCY) {
    // 取消即断:在飞批次由 signal 撕断(allSettled 吞掉 reject),这里必须抛——
    // 否则带着半截大纲继续跑,半成品快照会被当 Step3 产物存进 plan
    if (signal?.aborted) throw new Error("导入已取消");
    const batch = filePaths.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (filePath) => {
        const url = cdnUrl(owner, repo, branch, filePath);
        const r = await fetchFn(url);
        if (!r.ok) return null;
        const text = await r.text();
        const outline = extractOutlineWithCharCounts(text, filePath);
        return { path: filePath, outline };
      }),
    );
    for (let j = 0; j < results.length; j++) {
      const res = results[j];
      if (res.status === "fulfilled" && res.value) {
        result.set(res.value.path, res.value.outline);
      }
      onProgress?.(i + j + 1, filePaths.length, batch[j] ?? "");
    }
  }

  return result;
}

/**
 * 从 markdown 文本提取 H1/H2/H3 标题 + 每段字符数。
 * 字符数 = 该标题行到下一个同级或更高级标题之间的字符数。
 * H2 边界：下一个 H1/H2；H3 边界：下一个 H1/H2/H3。
 * 代码块内的 # 不算标题。
 */
export function extractOutlineWithCharCounts(text: string, filePath: string): FileOutline {
  const lines = text.split(/\r?\n/);
  const totalChars = text.length;
  let h1 = "";
  // 先收集所有标题行（带行号）
  const rawHeadings: { level: number; title: string; line: number }[] = [];
  let inCodeFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^(\s*)(```|~~~)/.test(line)) { inCodeFence = !inCodeFence; continue; }
    if (inCodeFence) continue;
    const h1Match = line.match(/^#\s+(.+)$/);
    if (h1Match) {
      if (!h1) h1 = h1Match[1]!.trim();
      rawHeadings.push({ level: 1, title: h1Match[1]!.trim(), line: i });
      continue;
    }
    const h2Match = line.match(/^##\s+(.+)$/);
    if (h2Match) { rawHeadings.push({ level: 2, title: h2Match[1]!.trim(), line: i }); continue; }
    const h3Match = line.match(/^###\s+(.+)$/);
    if (h3Match) { rawHeadings.push({ level: 3, title: h3Match[1]!.trim(), line: i }); continue; }
  }
  // 计算每个 H2/H3 的字符数（到下一个同级或更高级标题）
  const headings: { level: number; title: string; chars: number }[] = [];
  for (let idx = 0; idx < rawHeadings.length; idx++) {
    const h = rawHeadings[idx]!;
    if (h.level === 1) continue; // H1 不进 headings
    // 找下一个 level <= h.level 的标题行号
    let endLine = lines.length;
    for (let j = idx + 1; j < rawHeadings.length; j++) {
      if (rawHeadings[j]!.level <= h.level) { endLine = rawHeadings[j]!.line; break; }
    }
    const sectionText = lines.slice(h.line, endLine).join("\n");
    headings.push({ level: h.level, title: h.title, chars: sectionText.length });
  }
  // .ipynb: 没有 markdown 标题，用文件名
  if (!h1 && filePath.endsWith(".ipynb")) {
    h1 = filePath.split("/").pop()?.replace(/\.ipynb$/i, "") ?? filePath;
  }
  return { h1: h1 || (filePath.split("/").pop() ?? filePath), totalChars, headings };
}

/**
 * 拉取单个文件的完整正文（Step 5a 用）。
 * 复用 fetchMarkdownContents 的解析逻辑（.ipynb → parseNotebook, .rst → rst-parser 等），
 * 但只拉一个文件，不做批量。
 */
export async function fetchSingleFileContent(
  filePath: string,
  owner: string,
  repo: string,
  branch: string,
  fetchFn: typeof fetch,
): Promise<string | null> {
  try {
    const url = cdnUrl(owner, repo, branch, filePath);
    const r = await fetchFn(url);
    if (!r.ok) return null;
    const lower = filePath.toLowerCase();
    if (lower.endsWith(".ipynb")) {
      const { parseNotebook } = await import("./notebook-parser.js");
      const jsonText = await r.text();
      const nbResult = parseNotebook(jsonText);
      return nbResult.markdown;
    }
    const text = await r.text();
    if (lower.endsWith(".rst")) {
      const { parseRst } = await import("./rst-parser.js");
      return parseRst(text).markdown;
    }
    if (lower.endsWith(".rmd")) {
      const { parseRmd } = await import("./rmd-parser.js");
      return parseRmd(text).markdown;
    }
    if (lower.endsWith(".org")) {
      const { parseOrg } = await import("./org-parser.js");
      return parseOrg(text).markdown;
    }
    if (lower.endsWith(".adoc")) {
      const { parseAdoc } = await import("./adoc-parser.js");
      return parseAdoc(text).markdown;
    }
    // 代码文件 → code-parser 转 markdown
    if (CODE_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
      const ext = lower.split(".").pop() ?? "";
      const { parseCode } = await import("./code-parser.js");
      return parseCode(text, ext).markdown;
    }
    return text;
  } catch {
    return null;
  }
}

/**
 * 下载图片并转 base64 data-url（Step 5b 用）。
 * 返回 data:url 或 null（下载失败/太大）。
 */
export async function fetchImageAsDataUrl(
  imgPath: string,
  owner: string,
  repo: string,
  branch: string,
  fetchFn: typeof fetch,
  maxBytes = 200_000,
): Promise<string | null> {
  try {
    const url = cdnUrl(owner, repo, branch, imgPath);
    const r = await fetchFn(url);
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > maxBytes) return null; // 太大不内联
    const ext = imgPath.split(".").pop()?.toLowerCase() ?? "png";
    const mime =
      ext === "png" ? "image/png"
      : ext === "jpg" || ext === "jpeg" ? "image/jpeg"
      : ext === "gif" ? "image/gif"
      : ext === "webp" ? "image/webp"
      : ext === "svg" ? "image/svg+xml"
      : ext === "bmp" ? "image/bmp"
      : "image/png";
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}



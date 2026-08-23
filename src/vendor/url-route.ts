// Vendored from LookatStudy src/main/services/pure/url-route.ts (MIT License, https://github.com/Kaiji-Z/LookatStudy).
// Unmodified except this provenance header.
/**
 * 智能 URL 路由 —— 一个输入框自动分流三类导入来源(纯函数)。
 *
 *   github.com/{owner}/{repo} → 走既有仓库导入(完整 5 步管线)
 *   arxiv.org / export.arxiv.org 的 /abs/ID 或 /pdf/ID → 论文 PDF 导入
 *   其余任意 http(s) → 网页文章正文抽取(readability)
 *
 * 用户不需要理解三种来源的区别。纯函数,verify 直测。
 */
import { parseGithubUrl } from "./import-plan.ts";

export type UrlRoute =
  | { kind: "github"; url: string }
  | { kind: "url"; flavor: "arxiv"; url: string; arxivId: string; pdfUrl: string }
  | { kind: "url"; flavor: "article"; url: string }
  /** 视频链接:B站纯 JS 直连;YouTube/抖音/其他站走 yt-dlp(字幕优先) */
  | { kind: "video"; source: "bilibili" | "ytdlp"; url: string };

/** arXiv 论文 ID:新式 2401.12345[v2] / 旧式 cs.CL/24010000 / hep-th/9901001 */
const ARXIV_ID = /^[a-z.-]+\/\d{7}$|^\d{4}\.\d{4,5}(v\d+)?$/i;

export function routeImportUrl(raw: string): UrlRoute | null {
  const url = raw.trim();
  if (!url || /\s/.test(url)) return null;

  // GitHub 仓库(复用 import-plan 的解析:owner/repo 提取)
  if (parseGithubUrl(url)) return { kind: "github", url };

  // 带了协议但不是 http(s) → 拒绝(不能补前缀后把 ftp:// 变成合法 https URL)
  if (url.includes("://") && !/^https?:\/\//i.test(url)) return null;
  // 统一解析 http(s)
  let parsed: URL;
  try {
    parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");

  // arXiv:arxiv.org/abs/2401.12345 | arxiv.org/pdf/2401.12345v2 | export.arxiv.org/...
  // ID 允许含 /(旧式 cs.CL/24010001),只排除 ? 和 #
  if (host === "arxiv.org" || host === "export.arxiv.org") {
    const m = parsed.pathname.match(/^\/(?:abs|pdf)\/([^?#]+?)(?:\.pdf)?$/i);
    const id = m?.[1] ?? "";
    if (id && ARXIV_ID.test(id)) {
      return {
        kind: "url",
        flavor: "arxiv",
        url: `https://arxiv.org/abs/${id}`,
        arxivId: id,
        pdfUrl: `https://export.arxiv.org/pdf/${id}`,
      };
    }
    // arxiv 域名但路径不像论文页 → 当普通文章抓(如列表页)
  }

  // 视频链接:B站(bilibili.com/b23.tv,路径带 BV/av 号或 /video/)、
  // YouTube(youtube.com/watch|shorts, youtu.be)与抖音(douyin.com/v.douyin.com
  // 短链/iesdouyin.com 分享链)——后两者走 yt-dlp(需用户自装)
  const path = parsed.pathname;
  if (host === "bilibili.com" || host === "b23.tv") {
    if (/(BV[a-zA-Z0-9]+|av\d+)/i.test(path) || host === "b23.tv" || path.startsWith("/video/")) {
      return { kind: "video", source: "bilibili", url: parsed.toString() };
    }
  }
  if (host === "douyin.com" || host === "v.douyin.com" || host === "iesdouyin.com") {
    return { kind: "video", source: "ytdlp", url: parsed.toString() };
  }
  if (host === "youtube.com" || host === "youtu.be" || host === "m.youtube.com") {
    if (host === "youtu.be" || path === "/watch" || path.startsWith("/shorts/") || path.startsWith("/live/")) {
      return { kind: "video", source: "ytdlp", url: parsed.toString() };
    }
  }
  return { kind: "url", flavor: "article", url: parsed.toString() };
}

/** 身份键用:归一化 URL(去 hash,去尾斜杠;query 保留——不少站点 query 载内容)。 */
export function normalizeUrlIdentity(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
}

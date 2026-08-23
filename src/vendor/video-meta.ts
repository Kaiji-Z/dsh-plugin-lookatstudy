// Vendored/adapted from LookatStudy src/main/services/video-import-service.ts (MIT License, https://github.com/Kaiji-Z/LookatStudy).
// Only the classification/metadata surface (SPEC 1.2: 音视频"分类与元数据"部分):
// parseBilibiliId is verbatim; fetchBilibiliMeta is the plugin-side adaptation of
// upstream's view-API call (title/desc/owner metadata only — the audio download
// and ASR transcription paths need a model client / spawn and stay out per the
// no-model-client iron rule).

export const BILI_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  Referer: "https://www.bilibili.com/",
};

/** 从 B站 URL 提取 BV/av 号与分P(b23.tv 短链由 fetchFn 跟随重定向展开)。
 *  page=undefined 表示 URL 未带 ?p= —— 多分P 视频导入整季;带 ?p=N 只导该集。 */
export function parseBilibiliId(url: string): { bvid?: string; aid?: number; page?: number } | null {
  const u = url.match(/bilibili\.com\/(?:video\/)?(?:BV[a-zA-Z0-9]+|av\d+)/i) ? url : null;
  const m = u?.match(/(BV[a-zA-Z0-9]+|av(\d+))/i);
  if (!m) return null;
  const pm = url.match(/[?&]p=(\d+)/);
  return {
    bvid: m[1]!.toLowerCase().startsWith("bv") ? m[1] : undefined,
    aid: m[2] ? Number(m[2]) : undefined,
    page: pm ? Math.max(1, Number(pm[1])) : undefined,
  };
}

export interface BilibiliMeta {
  title: string;
  /** UP 主昵称 */
  owner: string;
  /** 简介(可能为空) */
  desc: string;
  /** 分P 标题列表(单P为空数组) */
  parts: string[];
  /** 总时长(秒) */
  duration: number;
}

/** view API 元数据(免登录,无 wbi)。b23.tv 短链由 fetchFn 重定向展开后重试一次。 */
export async function fetchBilibiliMeta(url: string, fetchFn: typeof fetch, signal?: AbortSignal): Promise<BilibiliMeta> {
  let id = parseBilibiliId(url);
  if (!id && /b23\.tv/i.test(url)) {
    const r = await fetchFn(url, { signal, headers: BILI_HEADERS });
    id = parseBilibiliId(r.url);
  }
  if (!id) throw new Error("不是可识别的 B站视频链接(BV/av 号缺失)");
  const idParam = id.bvid ? `bvid=${id.bvid}` : `aid=${id.aid}`;
  const resp = (await (await fetchFn(`https://api.bilibili.com/x/web-interface/view?${idParam}`, { signal, headers: BILI_HEADERS })).json()) as {
    code: number; message?: string; data?: { title?: string; desc?: string; duration?: number; owner?: { name?: string }; pages?: { part?: string }[] };
  };
  if (resp.code !== 0 || !resp.data) throw new Error(`B站接口返回错误(${resp.code} ${resp.message ?? ""})`);
  const d = resp.data;
  return {
    title: (d.title ?? "").trim() || "未命名视频",
    owner: (d.owner?.name ?? "").trim(),
    desc: (d.desc ?? "").trim(),
    parts: (d.pages ?? []).map((p) => (p.part ?? "").trim()).filter(Boolean),
    duration: d.duration ?? 0,
  };
}

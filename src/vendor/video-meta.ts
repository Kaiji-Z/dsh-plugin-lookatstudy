// Vendored/adapted from LookatStudy src/main/services/video-import-service.ts (MIT License, https://github.com/Kaiji-Z/LookatStudy).
import { encWbi, extractKeysFromNavUrl, getMixinKey } from './bilibili-wbi.ts'
import { parseSubtitleToText } from './subtitle-parse.ts'
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
  /** 各分P 的 cid(CC 字幕拉取需要;与 parts 同序,单P时为视频自身 cid) */
  cids: number[];
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
  const pages = (d.pages ?? []) as { cid?: number; part?: string; page?: number }[];
  return {
    title: (d.title ?? "").trim() || "未命名视频",
    owner: (d.owner?.name ?? "").trim(),
    desc: (d.desc ?? "").trim(),
    parts: pages.map((p) => (p.part ?? "").trim()).filter(Boolean),
    duration: d.duration ?? 0,
    cids: pages.map((p) => Number(p.cid ?? 0)),
  };
}


// —— B站 CC 字幕直连(player/wbi/v2,免登录)——
// Plugin-side addition: upstream's own bilibili route downloads the audio track
// for ASR (a model-client path this plugin bans outright); the CC subtitle list
// through the wbi-signed player API is the zero-LLM equivalent — same vendored
// signing (bilibili-wbi.ts) upstream uses for playurl, per bilibili-API-collect.
// Videos without CC fail honestly (the paste-the-transcript guidance stands).

export interface BilibiliCcPart {
  /** 分P显示名:多P "P{n} {分P标题}",单P 即主标题 */
  name: string;
  /** 字幕纯文本(时间轴已去) */
  text: string;
  /** 选中字幕的语言代码(如 zh-CN / ai-zh / en) */
  lan: string;
}

/** 字幕语言优先级:中文(含 AI)→ 英文(含 AI)→ 其他,同档取第一个。 */
export function pickCcLane(subs: { lan?: string; lan_doc?: string; subtitle_url?: string }[]): { lan: string; url: string } | null {
  const usable = subs.filter((s) => typeof s.subtitle_url === "string" && s.subtitle_url !== "");
  if (usable.length === 0) return null;
  const rank = (lan: string): number => {
    if (/^zh-Hans$|^zh-CN$|^zh$/.test(lan)) return 0;
    if (/^ai-zh/.test(lan)) return 1;
    if (/^en/.test(lan)) return 2;
    if (/^ai-en/.test(lan)) return 3;
    return 4;
  };
  const best = usable
    .map((s) => ({ lan: String(s.lan ?? ""), url: String(s.subtitle_url), r: rank(String(s.lan ?? "")), i: usable.indexOf(s) }))
    .sort((a, b) => (a.r !== b.r ? a.r - b.r : a.i - b.i))[0]!;
  return { lan: best.lan, url: best.url };
}

/**
 * 拉取一个 B站视频的 CC 字幕(逐分P)。分P 语义对齐上游:`?p=N` 只导该集,
 * 未带 p 的多分P导整季(≤maxPages,超出截断并在 missing 里披露)。
 * 返回 parts(有字幕的分P)与 missing(无字幕的分P名)——parts 为空时调用方
 * 抛诚实错误。签名材料(nav 取 img/sub_key)整季共用一次。
 */
export async function fetchBilibiliSubtitles(
  url: string,
  fetchFn: typeof fetch,
  signal?: AbortSignal,
  opts?: { maxPages?: number },
): Promise<{ title: string; owner: string; parts: BilibiliCcPart[]; missing: string[] }> {
  const meta = await fetchBilibiliMeta(url, fetchFn, signal);
  const id = parseBilibiliId(url) ?? (await (async () => {
    // b23 短链:fetchBilibiliMeta 已展开过一次;这里直接用其返回前的解析路径
    const r = await fetchFn(url, { signal, headers: BILI_HEADERS });
    return parseBilibiliId(r.url);
  })());
  if (!id) throw new Error("不是可识别的 B站视频链接(BV/av 号缺失)");

  // 单P视频:view API 的 pages 恒有 1 项(自身 cid);cids 与 pages 对齐
  const view = await (await fetchFn(`https://api.bilibili.com/x/web-interface/view?${id.bvid ? `bvid=${id.bvid}` : `aid=${id.aid}`}`, { signal, headers: BILI_HEADERS })).json() as {
    code: number; message?: string; data?: { title?: string; cid?: number; pages?: { cid?: number; page?: number; part?: string }[] };
  };
  if (view.code !== 0 || !view.data) throw new Error(`B站视频信息获取失败: ${view.message ?? ""}`);
  const pages = view.data.pages ?? [];
  const maxPages = Math.max(1, opts?.maxPages ?? 200);
  const partName = (i: number) => `P${pages[i]?.page ?? i + 1} ${(pages[i]?.part ?? meta.title).trim()}`.trim();

  type Target = { cid: number; name: string };
  let targets: Target[];
  if (id.page !== undefined) {
    const idx = pages.length > 0 ? Math.min(id.page, pages.length) - 1 : -1;
    targets = [{ cid: Number(idx >= 0 ? pages[idx]!.cid : view.data.cid ?? meta.cids[0] ?? 0), name: pages.length > 1 ? partName(idx) : meta.title }];
  } else if (pages.length > 1) {
    targets = pages.slice(0, maxPages).map((pg, i) => ({ cid: Number(pg.cid ?? 0), name: partName(i) }));
  } else {
    targets = [{ cid: Number(view.data.cid ?? meta.cids[0] ?? 0), name: meta.title }];
  }

  const nav = (await (await fetchFn("https://api.bilibili.com/x/web-interface/nav", { signal, headers: BILI_HEADERS })).json()) as { code: number; data?: { wbi_img?: { img_url?: string; sub_url?: string } } };
  const wbiImg = nav.data?.wbi_img ?? {};
  const { imgKey, subKey } = extractKeysFromNavUrl(wbiImg.img_url ?? "", wbiImg.sub_url ?? "");
  const mixinKey = getMixinKey(imgKey, subKey);
  const idKey = id.bvid ? "bvid" : "aid";
  const idVal = id.bvid ?? String(id.aid ?? "");

  const parts: BilibiliCcPart[] = [];
  const missing: string[] = [];
  for (const t of targets) {
    if (signal?.aborted) break;
    const query = encWbi({ [idKey]: idVal, cid: t.cid }, mixinKey);
    const player = (await (await fetchFn(`https://api.bilibili.com/x/player/wbi/v2?${query}`, { signal, headers: BILI_HEADERS })).json()) as {
      code: number; message?: string; data?: { subtitle?: { subtitles?: { lan?: string; lan_doc?: string; subtitle_url?: string }[] } };
    };
    if (player.code !== 0) throw new Error(`B站播放器接口返回错误(${t.name}): ${player.message ?? ""}(可能需要登录或为付费内容)`);
    const lane = pickCcLane(player.data?.subtitle?.subtitles ?? []);
    if (lane === null) {
      missing.push(t.name);
      continue;
    }
    const subUrl = lane.url.startsWith("//") ? `https:${lane.url}` : lane.url;
    const raw = await (await fetchFn(subUrl, { signal, headers: BILI_HEADERS })).text();
    let text = "";
    try {
      const cc = JSON.parse(raw) as { body?: { content?: string }[] };
      text = (cc.body ?? []).map((b) => (b.content ?? "").trim()).filter(Boolean).join("");
    } catch {
      // 少数入口给 srt/vtt 而非 JSON —— 复用字幕解析器兜底
      text = parseSubtitleToText(raw);
    }
    if (text.replace(/\s+/g, "").length < 50) {
      missing.push(t.name);
      continue;
    }
    parts.push({ name: t.name, text, lan: lane.lan });
  }
  return { title: meta.title, owner: meta.owner, parts, missing };
}

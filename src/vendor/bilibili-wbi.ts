// Vendored from LookatStudy src/main/services/pure/bilibili-wbi.ts (MIT License, https://github.com/Kaiji-Z/LookatStudy).
// Unmodified except this provenance header.
/**
 * B站 Wbi 签名(纯函数)——playurl 等 web 接口免登录访问的前提。
 * 算法来自社区文档 bilibili-API-collect(docs/misc/sign/wbi.md):
 * nav 接口取 img_key/sub_key → 重排表拼 mixin_key → 参数排序+过滤+chrFilter
 * → query + wts → MD5 = w_rid。纯函数,verify 用固定 key 断言 w_rid。
 */
import { createHash } from "node:crypto";

/** 重排映射表(社区文档公开常量,2023 引入后保持稳定;漂移时接口回 -352,live-test 可发现) */
export const MIXIN_KEY_ENC_TAB: number[] = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

export function getMixinKey(imgKey: string, subKey: string): string {
  const raw = imgKey + subKey;
  return MIXIN_KEY_ENC_TAB.map((n) => raw[n]).join("").slice(0, 32);
}

/** 从 nav 接口的 img_url/sub_url 里剥文件名(去扩展名)得 img_key/sub_key。 */
export function extractKeysFromNavUrl(imgUrl: string, subUrl: string): { imgKey: string; subKey: string } {
  const stem = (u: string) => {
    const noQuery = u.split("?")[0] ?? u;
    const base = noQuery.split("/").pop() ?? "";
    return base.replace(/\.[^.]+$/, "");
  };
  return { imgKey: stem(imgUrl), subKey: stem(subUrl) };
}

const CHR_FILTER = /[!'()*]/g;

/** 对查询参数做 Wbi 签名,返回完整 query(含 w_rid/wts)。 */
export function encWbi(
  params: Record<string, string | number>,
  mixinKey: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): string {
  const filtered: [string, string][] = Object.entries(params)
    .filter(([k]) => k !== "w_rid" && k !== "wts")
    .map(([k, v]) => [k, String(v)]);
  filtered.push(["wts", String(nowSec)]);
  filtered.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query = filtered
    .map(([k, v]) => {
      const safeVal = v.replace(CHR_FILTER, "");
      return `${encodeURIComponent(k)}=${encodeURIComponent(safeVal)}`;
    })
    .join("&");
  const wRid = createHash("md5").update(query + mixinKey, "utf8").digest("hex");
  return `${query}&w_rid=${wRid}`;
}

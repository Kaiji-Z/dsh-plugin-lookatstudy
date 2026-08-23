// Plugin-original module (zero-dependency mandate: reads zip containers for
// epub/docx/pptx parsing; upstream ships fflate, which this plugin cannot add).
// Central-directory-based reading — the same layout every zip tool writes:
// [local headers+data ...] [central directory] [EOCD].
// Supports method 0 (stored) and 8 (deflate, via vendor/inflate.ts). Zip64 is
// out of scope (course documents stay far below 4GB).

import { inflateRaw } from "./inflate.ts";

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

export interface ZipEntry {
  name: string;
  data: Uint8Array;
  method: number; // 0 stored | 8 deflate
  uncompressedSize: number;
}

function u16(b: Uint8Array, off: number): number { return b[off]! | (b[off + 1]! << 8); }
function u32(b: Uint8Array, off: number): number { return (b[off]! | (b[off + 1]! << 8) | (b[off + 2]! << 16) | (b[off + 3]! << 24)) >>> 0; }

/** Locate the End-of-Central-Directory record, scanning back over an optional comment. */
function findEocd(buf: Uint8Array): number {
  const minOff = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= minOff; i--) {
    if (u32(buf, i) === EOCD_SIG) return i;
  }
  throw new Error("zip: 找不到 EOCD(不是 zip 文件?)");
}

/**
 * Read every regular file entry in a zip archive into a name→bytes map.
 * Directory entries (trailing "/") are skipped. Data descriptors (bit 3 of
 * general purpose flag) are fine — sizes come from the central directory.
 */
export function readZip(buf: Uint8Array): Map<string, ZipEntry> {
  const eocd = findEocd(buf);
  const entryCount = u16(buf, eocd + 10);
  let cenOff = u32(buf, eocd + 16);

  const out = new Map<string, ZipEntry>();
  const decoder = new TextDecoder("utf-8");
  for (let i = 0; i < entryCount; i++) {
    if (u32(buf, cenOff) !== CEN_SIG) throw new Error(`zip: 中央目录第 ${i} 项签名错误`);
    const method = u16(buf, cenOff + 10);
    const compSize = u32(buf, cenOff + 20);
    const uncompSize = u32(buf, cenOff + 24);
    const nameLen = u16(buf, cenOff + 28);
    const extraLen = u16(buf, cenOff + 30);
    const commentLen = u16(buf, cenOff + 32);
    const localOff = u32(buf, cenOff + 42);
    const name = decoder.decode(buf.subarray(cenOff + 46, cenOff + 46 + nameLen));

    if (!name.endsWith("/")) {
      if (u32(buf, localOff) !== LOC_SIG) throw new Error(`zip: ${name} 本地头签名错误`);
      const lNameLen = u16(buf, localOff + 26);
      const lExtraLen = u16(buf, localOff + 28);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const raw = buf.subarray(dataStart, dataStart + compSize);
      let data: Uint8Array;
      if (method === 0) {
        data = raw;
      } else if (method === 8) {
        data = inflateRaw(raw);
      } else {
        throw new Error(`zip: ${name} 使用不支持的压缩方法 ${method}`);
      }
      if (uncompSize > 0 && data.length !== uncompSize) {
        throw new Error(`zip: ${name} 解压后大小不符(期望 ${uncompSize},实得 ${data.length})`);
      }
      out.set(name, { name, data, method, uncompressedSize: uncompSize });
    }
    cenOff += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Convenience: decode one entry as UTF-8 text ("" when missing). */
export function readZipText(entries: Map<string, ZipEntry>, name: string): string {
  const e = entries.get(name);
  return e ? new TextDecoder("utf-8").decode(e.data) : "";
}

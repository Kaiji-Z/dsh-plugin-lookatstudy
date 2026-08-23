// Vendored/adapted from LookatStudy src/main/lib/pdf-text.ts (MIT License, https://github.com/Kaiji-Z/LookatStudy).
// Upstream routes @firecrawl/pdf-inspector (layout-aware) → pdf-parse (flat);
// both are npm deps this plugin cannot carry. Zero-dependency path: scan the
// raw PDF for stream objects, Flate-decode them (vendor/inflate), and pull
// text-showing operators (Tj/TJ/'/") from content streams — the pdf-parse
// subset that covers text-layer PDFs. Anything else (scanned images, encrypted
// pdfs, exotic encodings) returns "" honestly; the scanner treats it as
// "no text", never a crash — same contract as upstream.

import { inflateZlib } from "./inflate.ts";

function decodePdfString(s: string): string {
  // \( \\ \) escapes and octal \ddd inside literal strings
  return s.replace(/\\([0-7]{1,3}|.)/g, (_m, esc: string) => {
    if (/^[0-7]+$/.test(esc)) return String.fromCharCode(parseInt(esc, 8));
    if (esc === "n") return "\n";
    if (esc === "r") return "\r";
    if (esc === "t") return "\t";
    if (esc === "b" || esc === "f") return " ";
    return esc;
  });
}

function decodeHexString(s: string): string {
  const clean = s.replace(/[^0-9a-fA-F]/g, "");
  let out = "";
  // UTF-16BE when it starts with a BOM
  const bytes: number[] = [];
  for (let i = 0; i + 1 < clean.length; i += 2) bytes.push(parseInt(clean.slice(i, i + 2), 16));
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    for (let i = 2; i + 1 < bytes.length; i += 2) out += String.fromCharCode((bytes[i]! << 8) | bytes[i + 1]!);
    return out;
  }
  // plain (likely WinAnsi/custom-encoded) bytes — take printable range
  for (const b of bytes) if (b! >= 32 && b! < 127) out += String.fromCharCode(b!);
  return out;
}

/** Pull text out of one decoded content stream. */
function textFromContentStream(content: string): string {
  if (!/BT[\s\S]*?ET/.test(content)) return "";
  let out = "";
  // (..) Tj | ' | "   <hex> Tj | ' | "   [(..) <hex> nums] TJ
  const re = /\(((?:\\.|[^\\()])*)\)\s*(Tj|'|")|<([0-9a-fA-F\s]+)>\s*(Tj|'|")|\[((?:\(.*?\)|<[0-9a-fA-F\s]+>|[^\]])*?)\]\s*TJ/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m[1] !== undefined) {
      out += decodePdfString(m[1]);
      if (m[2] === "'" || m[2] === '"') out += "\n";
    } else if (m[3] !== undefined) {
      out += decodeHexString(m[3]);
      if (m[4] === "'" || m[4] === '"') out += "\n";
    } else if (m[5] !== undefined) {
      const partRe = /\(((?:\\.|[^\\()])*)\)|<([0-9a-fA-F\s]+)>/g;
      let pm: RegExpExecArray | null;
      while ((pm = partRe.exec(m[5])) !== null) {
        out += pm[1] !== undefined ? decodePdfString(pm[1]!) : decodeHexString(pm[2] ?? "");
      }
    }
  }
  return out;
}

/**
 * PDF 文本层抽取(零依赖)。逐个 stream 对象:Flate 解压 → BT/ET 块内 Tj/TJ 文本。
 * 顺序按对象在文件中的出现位置(绝大多数生成器按页序写)。
 * 限制(诚实):加密 PDF、纯扫描图、Type0 复合字体编码的 PDF 返回部分或空文本;
 * 调用方按"无文本"处理,不让单个 PDF 崩掉导入(同上游契约)。
 */
export function parsePdfText(buf: Uint8Array): string {
  const latin = new TextDecoder("latin1");
  const raw = latin.decode(buf);
  if (/\/Encrypt\b/.test(raw)) return ""; // 加密 PDF 无法零依赖解
  const parts: string[] = [];
  const streamRe = /stream\r?\n?/g;
  let sm: RegExpExecArray | null;
  while ((sm = streamRe.exec(raw)) !== null) {
    const start = sm.index + sm[0].length;
    const end = raw.indexOf("endstream", start);
    if (end === -1) break;
    const head = raw.slice(Math.max(0, sm.index - 300), sm.index);
    // 只认紧跟对象字典的流;"stream"/"endstream"字样出现在压缩数据内时跳过(正则自动前移)
    if (!/obj\b[\s\S]*<<[\s\S]*>>\s*$/.test(head) && !/<<[^<>]*>>\s*$/.test(head)) continue;
    const chunk = buf.subarray(start, end);
    let content = "";
    if (/FlateDecode/.test(head)) {
      try { content = latin.decode(inflateZlib(chunk)); } catch { streamRe.lastIndex = end + 9; continue; }
    } else if (!/\/Filter/.test(head)) {
      content = latin.decode(chunk);
    } else {
      streamRe.lastIndex = end + 9; continue; // DCTDecode etc — 图片流
    }
    const text = textFromContentStream(content);
    if (text.trim()) parts.push(text);
    streamRe.lastIndex = end + 9; // 跳过 endstream 关键词本身,防止其中的 "stream" 二次匹配
  }
  const joined = parts.join("\n");
  return joined.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

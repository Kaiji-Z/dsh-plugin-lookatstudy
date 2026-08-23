// Plugin-original module (zero-dependency mandate: replaces upstream's fflate/zlib
// npm deps for reading zip archives and PDF Flate streams).
//
// Raw DEFLATE (RFC 1951) decompressor + zlib (RFC 1950) wrapper — puff-style
// canonical Huffman decoding. Decompression only; all of epub/docx/pptx (zip
// containers) and pdf content streams read through here.

/** Growable output buffer; back-references read bytes this pass already wrote. */
class Out {
  private buf = new Uint8Array(1024);
  len = 0;
  pushByte(b: number): void {
    if (this.len === this.buf.length) {
      const next = new Uint8Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[this.len++] = b;
  }
  pushBytes(src: Uint8Array): void {
    for (const b of src) this.pushByte(b);
  }
  result(): Uint8Array {
    return this.buf.subarray(0, this.len);
  }
  peek(idx: number): number {
    if (idx < 0 || idx >= this.len) throw new Error("inflate: 回引越界");
    return this.buf[idx]!;
  }
}

/** LSB-first bit reader over a byte source. */
class BitReader {
  private pos = 0; // byte position
  private bit = 0; // bit position within current byte (0 = LSB)
  constructor(private readonly src: Uint8Array) {}
  readBit(): number {
    if (this.pos >= this.src.length) throw new Error("inflate: 意外的输入结束");
    const b = (this.src[this.pos]! >> this.bit) & 1;
    if (++this.bit === 8) { this.bit = 0; this.pos++; }
    return b;
  }
  readBits(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) v |= this.readBit() << i;
    return v;
  }
  readBytes(n: number): Uint8Array {
    if (this.bit !== 0) { this.bit = 0; this.pos++; }
    if (this.pos + n > this.src.length) throw new Error("inflate: 意外的输入结束");
    const out = this.src.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
}

/** Canonical Huffman decoder built from code lengths (per RFC 1951 §3.2.2). */
class Huffman {
  private readonly count = new Array<number>(16).fill(0);
  private readonly symbols: number[] = [];
  constructor(lengths: readonly number[]) {
    for (const l of lengths) this.count[l]!++;
    this.count[0] = 0;
    const offs = new Array<number>(16).fill(0);
    for (let len = 1; len < 16; len++) offs[len] = offs[len - 1]! + this.count[len - 1]!;
    for (let sym = 0; sym < lengths.length; sym++) {
      const l = lengths[sym]!;
      if (l !== 0) this.symbols[offs[l]!++] = sym;
    }
  }
  decode(br: BitReader): number {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len < 16; len++) {
      code |= br.readBit();
      const cnt = this.count[len]!;
      if (code - first < cnt) return this.symbols[index + code - first]!;
      index += cnt;
      first = (first + cnt) << 1;
      code <<= 1;
    }
    throw new Error("inflate: 无效的 Huffman 编码");
  }
}

// RFC 1951 §3.2.5 fixed-table code lengths
const FIXED_LIT = new Uint8Array(288);
for (let i = 0; i < 144; i++) FIXED_LIT[i] = 8;
for (let i = 144; i < 256; i++) FIXED_LIT[i] = 9;
for (let i = 256; i < 280; i++) FIXED_LIT[i] = 7;
for (let i = 280; i < 288; i++) FIXED_LIT[i] = 8;
const FIXED_DIST = new Uint8Array(30).fill(5);

// §3.2.5 length/distance tables
const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CLEN_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/** Inflate one compressed block body (fixed or dynamic tables already built). */
function inflateBlock(br: BitReader, out: Out, lit: Huffman, dist: Huffman): void {
  for (;;) {
    const sym = lit.decode(br);
    if (sym < 256) {
      out.pushByte(sym);
    } else if (sym === 256) {
      return;
    } else {
      const li = sym - 257;
      if (li >= LEN_BASE.length) throw new Error("inflate: 无效长度码");
      const length = LEN_BASE[li]! + (LEN_EXTRA[li] ? br.readBits(LEN_EXTRA[li]!) : 0);
      const dsym = dist.decode(br);
      if (dsym >= DIST_BASE.length) throw new Error("inflate: 无效距离码");
      const distance = DIST_BASE[dsym]! + (DIST_EXTRA[dsym] ? br.readBits(DIST_EXTRA[dsym]!) : 0);
      if (distance > out.len) throw new Error("inflate: 距离越过已输出起点");
      // byte-by-byte: overlapping copies (distance < length) must see fresh bytes
      const from = out.len - distance;
      for (let i = 0; i < length; i++) out.pushByte(out.peek(from + i));
    }
  }
}

/** Decompress a raw DEFLATE stream (zip method 8, no zlib header). Throws on truncation/corruption. */
export function inflateRaw(src: Uint8Array): Uint8Array {
  const br = new BitReader(src);
  const out = new Out();
  for (;;) {
    const bfinal = br.readBit();
    const btype = br.readBits(2);
    if (btype === 0) {
      // stored: byte-align, LEN/NLEN complement check, raw copy
      const head = br.readBytes(4);
      const len = head[0]! | (head[1]! << 8);
      const nlen = head[2]! | (head[3]! << 8);
      if ((len ^ 0xffff) !== nlen) throw new Error("inflate: stored 块 LEN/Nlen 校验失败");
      out.pushBytes(br.readBytes(len));
    } else if (btype === 1) {
      inflateBlock(br, out, new Huffman(FIXED_LIT), new Huffman(FIXED_DIST));
    } else if (btype === 2) {
      const hlit = br.readBits(5) + 257;
      const hdist = br.readBits(5) + 1;
      const hclen = br.readBits(4) + 4;
      const clen = new Array<number>(19).fill(0);
      for (let i = 0; i < hclen; i++) clen[CLEN_ORDER[i]!] = br.readBits(3);
      const clenHuff = new Huffman(clen);
      const lengths: number[] = [];
      while (lengths.length < hlit + hdist) {
        const sym = clenHuff.decode(br);
        if (sym < 16) {
          lengths.push(sym);
        } else if (sym === 16) {
          const prev = lengths[lengths.length - 1];
          if (prev === undefined) throw new Error("inflate: 重复码出现在开头");
          const n = 3 + br.readBits(2);
          for (let i = 0; i < n; i++) lengths.push(prev);
        } else if (sym === 17) {
          const n = 3 + br.readBits(3);
          for (let i = 0; i < n; i++) lengths.push(0);
        } else {
          const n = 11 + br.readBits(7);
          for (let i = 0; i < n; i++) lengths.push(0);
        }
      }
      if (lengths.length > hlit + hdist) throw new Error("inflate: 码长超表");
      inflateBlock(br, out, new Huffman(lengths.slice(0, hlit)), new Huffman(lengths.slice(hlit, hlit + hdist)));
    } else {
      throw new Error("inflate: 保留块类型 11");
    }
    if (bfinal) return out.result();
  }
}

/** Decompress a zlib (RFC 1950) stream: 2-byte header + raw deflate (+ ignored adler32). */
export function inflateZlib(src: Uint8Array): Uint8Array {
  if (src.length < 6) throw new Error("inflate: zlib 流过短");
  const cmf = src[0]!, flg = src[1]!;
  if ((cmf & 0x0f) !== 8) throw new Error("inflate: 非 deflate 的 zlib CM");
  if (((cmf << 8) | flg) % 31 !== 0) throw new Error("inflate: zlib 头校验失败");
  if (flg & 0x20) throw new Error("inflate: 预置字典不支持");
  return inflateRaw(src.subarray(2));
}

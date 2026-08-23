/** Test-only zip assembler: local headers + central directory + EOCD, deflate
 * entries compressed by Node zlib. Shared by zip-reader and container-format
 * (epub/docx/pptx) fixture builders. */

import { deflateRawSync } from 'node:zlib'

export function buildZip(files: { name: string; data: Uint8Array; store?: boolean }[], dirs: string[] = []): Uint8Array {
  const enc = new TextEncoder()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  const offsets: number[] = []
  let offset = 0
  const payloads: Uint8Array[] = []
  for (const f of files) {
    offsets.push(offset)
    const nameB = enc.encode(f.name)
    const stored = f.store ?? false
    const payload = stored ? f.data : new Uint8Array(deflateRawSync(f.data, { level: 6 }))
    payloads.push(payload)
    const lhdr = new Uint8Array(30 + nameB.length)
    const dv = new DataView(lhdr.buffer)
    dv.setUint32(0, 0x04034b50, true)
    dv.setUint16(8, stored ? 0 : 8, true)
    dv.setUint32(18, payload.length, true)
    dv.setUint32(22, f.data.length, true)
    dv.setUint16(26, nameB.length, true)
    lhdr.set(nameB, 30)
    locals.push(lhdr, payload)
    offset += lhdr.length + payload.length
  }
  const cenStart = offset
  const all = [
    ...files.map((f, i) => ({ name: f.name, store: f.store ?? false, uncomp: f.data.length, comp: payloads[i]!.length, off: offsets[i]! })),
    ...dirs.map((name) => ({ name, store: true, uncomp: 0, comp: 0, off: 0 })),
  ]
  for (const e of all) {
    const nameB = enc.encode(e.name)
    const cen = new Uint8Array(46 + nameB.length)
    const dv = new DataView(cen.buffer)
    dv.setUint32(0, 0x02014b50, true)
    dv.setUint16(10, e.store ? 0 : 8, true)
    dv.setUint32(20, e.comp, true)
    dv.setUint32(24, e.uncomp, true)
    dv.setUint16(28, nameB.length, true)
    dv.setUint32(42, e.off, true)
    cen.set(nameB, 46)
    centrals.push(cen)
  }
  const cenBytes = concat(centrals)
  const eocd = new Uint8Array(22)
  const edv = new DataView(eocd.buffer)
  edv.setUint32(0, 0x06054b50, true)
  edv.setUint16(8, all.length, true)
  edv.setUint16(10, all.length, true)
  edv.setUint32(12, cenBytes.length, true)
  edv.setUint32(16, cenStart, true)
  return concat([...locals, cenBytes, eocd])
}

function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0
  for (const p of parts) total += p.length
  const res = new Uint8Array(total)
  let off = 0
  for (const p of parts) { res.set(p, off); off += p.length }
  return res
}

/** EPUB3-flavored minimal book: mimetype(stored, spec 要求) + container + OPF + nav + chapters. */
export function buildEpub(opts: { navStyle?: 'nav' | 'ncx'; chapters?: { href: string; html: string; title: string }[]; title?: string }): Uint8Array {
  const enc = new TextEncoder()
  const chapters = opts.chapters ?? [
    { href: 'ch1.xhtml', title: '第一章 起点', html: '<html><body><h1>第一章 起点</h1><p>' + '开篇正文内容。'.repeat(20) + '</p></body></html>' },
    { href: 'text/ch2.xhtml', title: '第二章 进阶', html: '<html><body><h1>第二章 进阶</h1><p>' + '进阶正文内容。'.repeat(20) + '</p><p>公式<script type="math/tex">a^2+b^2=c^2</script>回收。</p></body></html>' },
  ]
  const manifest = chapters.map((c, i) => `<item id="c${i + 1}" href="${c.href}" media-type="application/xhtml+xml"/>`).join('')
  const spine = chapters.map((_c, i) => `<itemref idref="c${i + 1}"/>`).join('')
  const ncx = `<?xml version="1.0"?><ncx><navMap>${chapters.map((c, i) => `<navPoint><navLabel><text>${c.title}</text></navLabel><content src="${c.href}"/></navPoint>`).join('')}</navMap></ncx>`
  const navXhtml = `<html><body><nav>${chapters.map((c) => `<a href="${c.href}">${c.title}</a>`).join('')}</nav></body></html>`
  const files: { name: string; data: Uint8Array; store?: boolean }[] = [
    { name: 'mimetype', data: enc.encode('application/epub+zip'), store: true },
    { name: 'META-INF/container.xml', data: enc.encode(`<container><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></container>`) },
  ]
  if (opts.navStyle === 'ncx') {
    files.push({ name: 'OEBPS/toc.ncx', data: enc.encode(ncx) })
    files.push({ name: 'OEBPS/content.opf', data: enc.encode(`<package><metadata><dc:title>${opts.title ?? '测试书'}</dc:title></metadata><manifest>${manifest}<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest><spine toc="ncx">${spine}</spine></package>`) })
  } else {
    files.push({ name: 'OEBPS/nav.xhtml', data: enc.encode(navXhtml) })
    files.push({ name: 'OEBPS/content.opf', data: enc.encode(`<package><metadata><dc:title>${opts.title ?? '测试书'}</dc:title></metadata><manifest>${manifest}<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine>${spine}</spine></package>`) })
  }
  for (const c of chapters) files.push({ name: 'OEBPS/' + c.href, data: enc.encode(c.html) })
  return buildZip(files)
}

/**
 * The B站 CC-subtitle supply chain (P4): the vendored wbi signing's regression
 * vectors (ported verbatim from upstream's verify-video-import.mjs — a table
 * drift on bilibili's side turns these red), the lane picker's language
 * priority, and fetchBilibiliSubtitles' multi-P semantics against a mocked
 * transport (no network).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { encWbi, extractKeysFromNavUrl, getMixinKey } from '../src/vendor/bilibili-wbi.ts'
import { fetchBilibiliSubtitles, parseBilibiliId, pickCcLane } from '../src/vendor/video-meta.ts'

test('wbi signing regression vectors (POC-anchored; a bilibili table drift turns this red)', () => {
  const mixin = getMixinKey('abcd1234efgh5678', 'ijkl9012mnop3456')
  assert.equal(mixin, 'kce28g6dp2fl437564imojab511n03h9')
  const q = encWbi({ foo: '_bar', baz: 12, zz: 'hello世界' }, mixin, 1700000000)
  assert.equal(q, 'baz=12&foo=_bar&wts=1700000000&zz=hello%E4%B8%96%E7%95%8C&w_rid=8240ea72c4ef615717fb788b1eeab49e')
  const { imgKey, subKey } = extractKeysFromNavUrl('https://i0.hdslb.com/bfs/wbi/abcd1234.png', 'https://i0.hdslb.com/bfs/wbi/efgh5678.png')
  assert.equal(imgKey, 'abcd1234')
  assert.equal(subKey, 'efgh5678')
})

test('parseBilibiliId: BV/av/?p= extraction vectors (ported from upstream verify T2)', () => {
  assert.deepEqual(parseBilibiliId('https://www.bilibili.com/video/BV1GJ411x7h7?p=3'), { bvid: 'BV1GJ411x7h7', aid: undefined, page: 3 })
  assert.deepEqual(parseBilibiliId('https://www.bilibili.com/video/BV1GJ411x7h7'), { bvid: 'BV1GJ411x7h7', aid: undefined, page: undefined }, 'no ?p= means the whole season')
  assert.deepEqual(parseBilibiliId('https://www.bilibili.com/video/av170001'), { bvid: undefined, aid: 170001, page: undefined })
  assert.equal(parseBilibiliId('https://example.com/x'), null)
})

test('pickCcLane: zh (incl. AI) over en (incl. AI) over the rest; empty lanes are null', () => {
  assert.equal(pickCcLane([]), null)
  assert.equal(pickCcLane([{ lan: 'zh-CN', subtitle_url: '' }]), null, 'empty URLs never count')
  const zh = pickCcLane([
    { lan: 'en', subtitle_url: 'https://x/en.json' },
    { lan: 'ai-zh', subtitle_url: 'https://x/aizh.json' },
    { lan: 'zh-Hans', subtitle_url: 'https://x/hans.json' },
  ])
  assert.equal(zh?.url, 'https://x/hans.json', 'manual zh outranks AI zh')
  const ai = pickCcLane([{ lan: 'ai-en', subtitle_url: 'https://x/aien.json' }, { lan: 'ai-zh', subtitle_url: 'https://x/aizh.json' }])
  assert.equal(ai?.url, 'https://x/aizh.json', 'AI zh beats AI en')
  const any = pickCcLane([{ lan: 'ja', subtitle_url: 'https://x/ja.json' }])
  assert.equal(any?.lan, 'ja', 'no zh/en at all: the first lane stands')
})

const NAV = JSON.stringify({ code: 0, data: { wbi_img: { img_url: 'https://i0.hdslb.com/bfs/wbi/abcd1234.png', sub_url: 'https://i0.hdslb.com/bfs/wbi/efgh5678.png' } } })

function ccJson(n: number): string {
  return JSON.stringify({ body: Array.from({ length: n }, (_v, i) => ({ from: i, to: i + 1, content: `第${i}句梯度下降的直觉讲解。` })) })
}

function biliTransport(pages: { cid: number; page?: number; part?: string }[], ccByCid: Record<number, { lan: string; url: string }[]>, seen: string[] = []): typeof fetch {
  return async (input) => {
    const url = String(input)
    seen.push(url)
    if (url.includes('/x/web-interface/view')) {
      return new Response(JSON.stringify({ code: 0, data: { title: '机器学习入门', owner: { name: '某UP' }, desc: '', duration: 600, cid: pages[0]?.cid ?? 1, pages } }), { status: 200 })
    }
    if (url.includes('/x/web-interface/nav')) return new Response(NAV, { status: 200 })
    if (url.includes('/x/player/wbi/v2')) {
      const cid = Number(new URL(url).searchParams.get('cid'))
      return new Response(JSON.stringify({ code: 0, data: { subtitle: { subtitles: ccByCid[cid] ?? [] } } }), { status: 200 })
    }
    if (url.includes('aisubtitle.hdslb.com/cc1.json')) return new Response(ccJson(60), { status: 200 })
    if (url.includes('aisubtitle.hdslb.com/cc2.json')) return new Response(ccJson(80), { status: 200 })
    return new Response('x', { status: 404 })
  }
}

test('fetchBilibiliSubtitles: multi-P whole-season — CC parts import, CC-less parts land in missing', async () => {
  const cc: Record<number, { lan: string; url: string }[]> = {
    11: [{ lan: 'zh-CN', subtitle_url: '//aisubtitle.hdslb.com/cc1.json' }],
  }
  const res = await fetchBilibiliSubtitles('https://www.bilibili.com/video/BV1ab411c2dE', biliTransport([{ cid: 11, page: 1, part: '第一讲' }, { cid: 22, page: 2, part: '第二讲' }], cc))
  assert.equal(res.title, '机器学习入门')
  assert.equal(res.parts.length, 1)
  assert.equal(res.parts[0]!.name, 'P1 第一讲')
  assert.equal(res.parts[0]!.lan, 'zh-CN')
  assert.ok(res.parts[0]!.text.includes('梯度下降'), 'the CC body joined into plain text')
  assert.deepEqual(res.missing, ['P2 第二讲'], 'the CC-less episode is disclosed, not silently dropped')
})

test('fetchBilibiliSubtitles: ?p=N targets exactly that episode (single-P naming falls back to the course title)', async () => {
  const cc: Record<number, { lan: string; url: string }[]> = {
    11: [{ lan: 'zh-CN', subtitle_url: '//aisubtitle.hdslb.com/cc1.json' }],
    22: [{ lan: 'ai-zh', subtitle_url: '//aisubtitle.hdslb.com/cc2.json' }],
  }
  const pages = [{ cid: 11, page: 1, part: '第一讲' }, { cid: 22, page: 2, part: '第二讲' }]
  const single = await fetchBilibiliSubtitles('https://www.bilibili.com/video/BV1ab411c2dE?p=2', biliTransport(pages, cc))
  assert.equal(single.parts.length, 1)
  assert.equal(single.parts[0]!.name, 'P2 第二讲')
  assert.equal(single.parts[0]!.lan, 'ai-zh')
  assert.deepEqual(single.missing, [])
  // single-P video (pages carries itself): the part name IS the course title
  const solo = await fetchBilibiliSubtitles('https://www.bilibili.com/video/BV1ab411c2dE', biliTransport([{ cid: 11, page: 1, part: '全一集' }], cc))
  assert.equal(solo.parts[0]!.name, '机器学习入门', 'upstream naming: a lone episode bears the video title')
})

test('fetchBilibiliSubtitles: every episode CC-less → empty parts with full disclosure', async () => {
  const res = await fetchBilibiliSubtitles('https://www.bilibili.com/video/BV1ab411c2dE', biliTransport([{ cid: 11, page: 1, part: '第一讲' }], {}))
  assert.equal(res.parts.length, 0)
  assert.deepEqual(res.missing, ['机器学习入门'])
})

test('fetchBilibiliSubtitles: a non-JSON subtitle body falls back to the vtt/srt parser', async () => {
  const srt = Array.from({ length: 10 }, (_v, i) => `${String(i + 1)}\n00:00:0${String(i + 1)},000 --> 00:00:0${String(i + 2)},000\n第${String(i + 1)}句讲梯度下降与学习率的不同取舍。`).join('\n\n') + '\n'
  const transport: typeof fetch = async (input) => {
    const url = String(input)
    if (url.includes('/x/web-interface/view')) return new Response(JSON.stringify({ code: 0, data: { title: 'T', owner: {}, desc: '', duration: 1, cid: 1, pages: [{ cid: 1, page: 1, part: 'P1' }] } }), { status: 200 })
    if (url.includes('/x/web-interface/nav')) return new Response(NAV, { status: 200 })
    if (url.includes('/x/player/wbi/v2')) return new Response(JSON.stringify({ code: 0, data: { subtitle: { subtitles: [{ lan: 'zh-CN', subtitle_url: '//aisubtitle.hdslb.com/srt1' }] } } }), { status: 200 })
    if (url.includes('aisubtitle.hdslb.com/srt1')) return new Response(srt, { status: 200 })
    return new Response('x', { status: 404 })
  }
  const res = await fetchBilibiliSubtitles('https://www.bilibili.com/video/BV1ab411c2dE', transport)
  assert.equal(res.parts.length, 1)
  assert.ok(res.parts[0]!.text.includes('梯度下降') && res.parts[0]!.text.includes('学习率'))
})

/**
 * Edge read-aloud synthesis: Microsoft's read-aloud endpoint (the one behind
 * Edge's own 朗读 feature), spoken to over a hand-rolled WebSocket on
 * node:https/node:crypto — zero dependencies. Synthesis runs HOST-side (the
 * browser cannot open that socket), so the dashboard streams the cached MP3
 * down and the client falls back to speechSynthesis when this path fails.
 *
 * Three live-verified protocol details this module pins (2026-09-06 probes):
 * 1. Sec-MS-GEC ticks are ~1.36e17 — past Number's 2^53. BigInt or the hash
 *    silently mismatches (403).
 * 2. `Sec-MS-GEC-Version` must carry a CURRENT Edge full version; stale
 *    strings are rejected with 403 before any upgrade.
 * 3. The service sends WebSocket PINGs; unanswered PONGs get the socket reset
 *    mid-turn (read the turn.end path name with the dot — `\w+` eats it).
 * @module dsh-plugin-lookatstudy/tts
 */

import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import https from 'node:https'

/** Public read-aloud client token (same constant every edge-tts client ships). */
export const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'
/** Must track a shipped Edge release; a stale string is rejected outright. */
export const CHROMIUM_FULL_VERSION = '143.0.3650.75'
/** The plugin's default tutor voice (晓晓, zh-CN female neural). */
export const DEFAULT_TTS_VOICE = 'zh-CN-XiaoxiaoNeural'

/** Voices the dashboard route accepts (others fall back to the default). */
const VOICES = new Set([
  DEFAULT_TTS_VOICE,
  'zh-CN-YunxiNeural',
  'zh-CN-YunyangNeural',
  'zh-CN-XiaoyiNeural',
  'en-US-AriaNeural',
  'en-US-GuyNeural',
])

export function normalizeVoice(voice: string | undefined): string {
  return voice !== undefined && VOICES.has(voice) ? voice : DEFAULT_TTS_VOICE
}

/**
 * The DRM token (Sec-MS-GEC): SHA-256 over the Windows-filetime ticks of the
 * current 5-minute window plus the trusted token. BigInt is mandatory — the
 * ticks exceed Number.MAX_SAFE_INTEGER and the hash consumes exact digits.
 * @param nowMs - caller clock in unix milliseconds.
 */
export function secMsGec(nowMs: number = Date.now()): string {
  let ticks = (BigInt(Math.floor(nowMs / 1000)) + 11644473600n) * 10000000n
  ticks -= ticks % 3000000000n
  return createHash('sha256').update(`${ticks}${TRUSTED_CLIENT_TOKEN}`).digest('hex').toUpperCase()
}

function xmlEscape(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

/** Build one speak utterance. */
export function buildSsml(text: string, voice: string): string {
  const lang = voice.split('-').slice(0, 2).join('-')
  return `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'><voice name='${voice}'><prosody rate='+0%' pitch='+0Hz'>${xmlEscape(text)}</prosody></voice></speak>`
}

/** Client→server frames are masked; server→client frames are not. */
function maskFrame(opcode: number, payload: Buffer): Buffer {
  const mask = randomBytes(4)
  const head = payload.length < 126
    ? Buffer.from([0x80 | opcode, 0x80 | payload.length])
    : Buffer.from([0x80 | opcode, 0x80 | 126, payload.length >> 8, payload.length & 0xff])
  const masked = Buffer.from(payload.map((b, i) => b ^ mask[i % 4]))
  return Buffer.concat([head, mask, masked])
}

const timestamp = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

/**
 * Synthesize one utterance to MP3 (audio-24khz-48kbit-mono-mp3).
 * @param text - plain speakable text (short: one sentence or a small group).
 * @param voice - neural voice name.
 * @param timeoutMs - hard ceiling on the whole turn.
 * @returns the MP3 bytes.
 */
export function synthesizeSpeech(text: string, voice: string = DEFAULT_TTS_VOICE, timeoutMs = 20_000): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const gec = secMsGec()
    const host = 'speech.platform.bing.com'
    const path = `/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${gec}&Sec-MS-GEC-Version=1-${CHROMIUM_FULL_VERSION}`
    const key = randomBytes(16).toString('base64')
    const req = https.request(`https://${host}${path}`, {
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Version': '13',
        Pragma: 'no-cache',
        'Cache-Control': 'no-cache',
        Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_FULL_VERSION.split('.')[0]}.0.0.0 Safari/537.36 Edg/${CHROMIUM_FULL_VERSION}`,
      },
    })
    const timer = setTimeout(() => {
      socket?.destroy()
      reject(new Error('edge tts: turn timed out'))
    }, timeoutMs)
    const debug = process.env.LKS_TTS_DEBUG === '1'
    const log = (line: string): void => { if (debug) console.error(`[lks-tts] ${line}`) }
    let socket: import('node:stream').Duplex | undefined
    const finish = (err: Error | null, mp3?: Buffer): void => {
      clearTimeout(timer)
      socket?.destroy()
      if (err !== null) reject(err)
      else resolve(mp3!)
    }
    req.on('upgrade', (res, sock) => {
      log(`upgrade ok (${String(res.statusCode)})`)
      socket = sock
      const accept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64')
      if (res.headers['sec-websocket-accept'] !== accept) return finish(new Error('edge tts: bad upgrade accept'))
      if (res.statusCode !== 101) return finish(new Error(`edge tts: upgrade refused (${String(res.statusCode)})`))
      sock.setNoDelay(true)
      sock.write(maskFrame(0x1, Buffer.from(
        `X-Timestamp:${timestamp()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
        JSON.stringify({ context: { synthesis: { audio: { metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'false' }, outputFormat: 'audio-24khz-48kbitrate-mono-mp3' } } } }),
      )))
      sock.write(maskFrame(0x1, Buffer.from(
        `X-RequestId:${randomBytes(16).toString('hex')}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${timestamp()}\r\nPath:ssml\r\n\r\n${buildSsml(text, voice)}`,
      )))
      let acc = Buffer.alloc(0)
      const audio: Buffer[] = []
      sock.on('data', (chunk: Buffer) => {
        if (debug) log(`recv ${chunk.length}B head=${chunk.subarray(0, 8).toString('hex')}`)
        acc = Buffer.concat([acc, chunk])
        for (;;) {
          if (acc.length < 2) return
          const opcode = acc[0]! & 0x0f
          let len = acc[1]! & 0x7f
          let off = 2
          if (len === 126) { if (acc.length < 4) return; len = acc.readUInt16BE(2); off = 4 } else if (len === 127) { if (acc.length < 10) return; len = Number(acc.readBigUInt64BE(2)); off = 10 }
          if (acc.length < off + len) return
          const payload = acc.subarray(off, off + len)
          acc = acc.subarray(off + len)
          if (opcode === 0x9) { log('ping→pong'); sock.write(maskFrame(0xa, payload)); continue } // PING → PONG
          if (opcode === 0x8) { log('close frame'); return finish(audio.length > 0 ? null : new Error('edge tts: closed before audio')) }
          if (opcode !== 0x1 && opcode !== 0x2) continue
          const headerLen = payload.readUInt16BE(0)
          const head = payload.subarray(2, 2 + headerLen).toString('utf8')
          if (debug) log(`frame op=${opcode} len=${len} path=${/Path:([\w.]+)/.exec(head)?.[1] ?? '?'}`)
          if ((opcode === 0x1 && /Path:turn\.end/.test(head))) {
            log(`turn.end with ${audio.length} audio chunk(s)`)
            return finish(audio.length > 0 ? null : new Error('edge tts: turn ended without audio'), Buffer.concat(audio))
          }
          if (opcode === 0x2 && /Path:audio/.test(head)) {
            const chunk = payload.subarray(2 + headerLen)
            audio.push(chunk)
            if (debug) log(`audio chunk ${chunk.length}B (total ${audio.reduce((n, c) => n + c.length, 0)}B)`)
          }
        }
      })
      sock.on('error', (err: Error) => finish(err))
      sock.on('close', () => { if (timer.hasRef()) finish(new Error('edge tts: socket closed mid-turn')) })
    })
    req.on('response', (res) => {
      res.resume()
      finish(new Error(`edge tts: endpoint refused the upgrade (HTTP ${String(res.statusCode)})`))
    })
    req.on('error', (err) => finish(err))
    req.end()
  })
}

/** Cache key: voice-scoped (different voices never share files). */
export function ttsCachePath(cacheDir: string, text: string, voice: string): string {
  const hash = createHash('sha256').update(`${voice}\n${text}`).digest('hex')
  return join(cacheDir, `${hash}.mp3`)
}

/**
 * Cache-first synthesis: study-area/tts-cache/{sha256(voice+text)}.mp3.
 * Misses synthesize once and persist; later listens (and other learners on
 * the same install) replay from disk without touching the endpoint.
 * @param synth - the synthesizer (injectable for tests; real Edge TTS by default).
 */
export async function cachedTtsMp3(
  cacheDir: string,
  text: string,
  voice: string = DEFAULT_TTS_VOICE,
  synth: (text: string, voice: string) => Promise<Buffer> = synthesizeSpeech,
): Promise<Buffer> {
  const file = ttsCachePath(cacheDir, text, voice)
  if (existsSync(file)) return readFileSync(file)
  mkdirSync(cacheDir, { recursive: true })
  const mp3 = await synth(text, voice)
  if (mp3.length === 0) throw new Error('edge tts: synthesis returned empty audio (not cached)')
  writeFileSync(file, mp3)
  return mp3
}

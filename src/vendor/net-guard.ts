/**
 * Audit B6 (2026-09-14): the article/subtitle fetch paths take tutor- and
 * user-supplied URLs, and the host process runs with the user's full network
 * reach — an unguarded GET is an SSRF primitive against the local (formerly
 * unauthenticated) dashboard, cloud metadata, and LAN devices. Three guards:
 *   1. literal private/loopback addresses are refused (DNS names are NOT
 *      resolved — documented boundary: a public DNS name pointing inward
 *      still passes);
 *   2. redirects are followed MANUALLY with a per-hop re-check (a public URL
 *      302-ing to 169.254.169.254 must not be followed blindly);
 *   3. response bodies are stream-read under a hard byte cap before they
 *      enter memory as text.
 * @module dsh-plugin-lookatstudy/net-guard
 */

/** Private/loopback IPv4 literal? */
function isPrivateIPv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (m === null) return false
  const octets = m.slice(1).map(Number)
  if (octets.some(o => o > 255)) return false
  const [a, b] = octets as [number, number, number, number]
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true // carrier-grade NAT
  return false
}

/** Private/loopback hostname? Literal IPs and localhost only (no DNS resolution). */
export function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === '' || host === 'localhost' || host.endsWith('.localhost')) return true
  if (host.includes(':')) {
    if (host === '::1' || host === '::') return true
    const first = host.split(':')[0] ?? ''
    if (/^fe[89ab]/.test(first)) return true // IPv6 link-local fe80::/10
    if (/^f[cd]/.test(first)) return true // IPv6 unique-local fc00::/7
    const v4mapped = host.match(/(\d{1,3}(?:\.\d{1,3}){3})$/)
    if (v4mapped !== null) return isPrivateIPv4(v4mapped[1]!)
    return false
  }
  return isPrivateIPv4(host)
}

/** Parse and refuse non-public fetch targets; returns the parsed URL. */
export function assertPublicHttpUrl(url: string): URL {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`lookatstudy-plugin: not a valid URL: ${JSON.stringify(url)}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`lookatstudy-plugin: refusing non-http(s) fetch target ${JSON.stringify(url)}`)
  }
  if (isPrivateHostname(parsed.hostname)) {
    throw new Error(`lookatstudy-plugin: refusing to fetch a private/loopback address (SSRF guard): ${parsed.hostname}`)
  }
  return parsed
}

export interface GuardedFetchDeps {
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  headers?: Record<string, string>
  /** Hard body ceiling; defaults to 2 MiB. */
  maxBytes?: number
  /** Manual-redirect hop ceiling; defaults to 5. */
  maxRedirects?: number
}

/**
 * Fetch one URL as text under the guards: manual redirects re-checked per
 * hop, declared content-length pre-check, stream-read truncated at the cap.
 * Non-2xx (after the redirect hops) throws, matching the article path's
 * honest-failure contract.
 */
export async function guardedFetchText(url: string, deps: GuardedFetchDeps = {}): Promise<string> {
  const doFetch = deps.fetchImpl ?? fetch
  const maxBytes = deps.maxBytes ?? 2 * 1024 * 1024
  const maxRedirects = deps.maxRedirects ?? 5
  let current = assertPublicHttpUrl(url).toString()
  for (let hop = 0; ; hop++) {
    const resp = await doFetch(current, { headers: deps.headers, redirect: 'manual', signal: deps.signal })
    if (resp.status === 301 || resp.status === 302 || resp.status === 303 || resp.status === 307 || resp.status === 308) {
      const location = resp.headers.get('location')
      if (location === null) throw new Error(`lookatstudy-plugin: redirect without a Location header (HTTP ${resp.status})`)
      if (hop >= maxRedirects) throw new Error('lookatstudy-plugin: too many redirects')
      current = assertPublicHttpUrl(new URL(location, current).toString()).toString()
      continue
    }
    if (!resp.ok) throw new Error(`lookatstudy-plugin: page fetch failed (HTTP ${resp.status}): ${current}`)
    const declaredRaw = resp.headers.get('content-length')
    if (declaredRaw !== null && /^\d+$/.test(declaredRaw) && Number(declaredRaw) > maxBytes) {
      throw new Error(`lookatstudy-plugin: response declares ${declaredRaw} bytes, over the ${maxBytes} byte cap: ${current}`)
    }
    const reader = resp.body?.getReader()
    if (reader === undefined) return await resp.text()
    const chunks: Uint8Array[] = []
    let total = 0
    let capped = false
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      total += value.length
      if (total > maxBytes) { capped = true; break }
    }
    if (capped) await reader.cancel().catch(() => { /* the cap decision is made */ })
    const bytes = new Uint8Array(Math.min(total, maxBytes))
    let off = 0
    for (const chunk of chunks) {
      if (off >= bytes.length) break
      const take = Math.min(chunk.length, bytes.length - off)
      bytes.set(chunk.subarray(0, take), off)
      off += take
    }
    return new TextDecoder('utf-8').decode(bytes)
  }
}

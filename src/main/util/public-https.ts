/** Descargas del host: DNS validado y fijado en el socket TLS, sin red para la composición. */
import { lookup } from 'node:dns/promises'
import { request } from 'node:https'
import { isIP } from 'node:net'
import { isLocalHostname } from '../embedded-browser/ip-class'
import { INTERNAL_NAME } from '@shared/brand'

export interface PublicResponse {
  status: number
  location?: string
  length?: string
  encoding?: string
  body: AsyncIterable<Uint8Array>
  cancel: () => void
}
export interface PublicHttpsDeps {
  resolve?: (host: string) => Promise<{ address: string; family: number }[]>
  request?: (url: URL, address: string, signal: AbortSignal) => Promise<PublicResponse>
  allowUrl?: (url: URL) => boolean
  timeoutMs?: number
}

export function publicHttpsUrl(raw: string): URL {
  if (raw.length > 4000 || /[\x00-\x20\x7f]/.test(raw)) throw Error('URL de recurso no válida.')
  const url = new URL(raw)
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || isLocalHostname(url.hostname))
    throw Error('Usa HTTPS público sin credenciales, fragmentos ni puertos especiales.')
  return url
}

export function publicAddress(address: string): boolean {
  if (!isIP(address) || isLocalHostname(address)) return false
  if (isIP(address) === 6) {
    // Solo unicast global; excluye traducciones/túneles que pueden alcanzar IPv4 local.
    const u = new URL(`https://[${address}]/`).hostname.slice(1, -1)
    return (
      /^[23]/.test(u) && !/^(?:2001:db8:|2002:|3fff:)/.test(u) && !(u.startsWith('2001:') && parseInt(u.split(':')[1] || '0', 16) < 0x200)
    )
  }
  const [a, b, c] = address.split('.').map(Number)
  return !(
    (a === 192 && (b === 0 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  )
}

/** El hostname original se conserva para Host, SNI y certificado; lookup NO vuelve a consultar DNS. */
export function pinnedHttpsRequest(url: URL, address: string, signal: AbortSignal): Promise<PublicResponse> {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'GET',
        agent: false,
        signal,
        lookup: (_host, options, callback) => {
          const family = isIP(address)
          if (options.all) callback(null, [{ address, family }])
          else callback(null, address, family)
        },
        headers: { 'User-Agent': `${INTERNAL_NAME}/video`, Accept: '*/*', 'Accept-Encoding': 'identity' }
      },
      (res) => {
        resolve({
          status: res.statusCode ?? 0,
          location: res.headers.location,
          length: res.headers['content-length'],
          encoding: res.headers['content-encoding'],
          body: res,
          cancel: () => res.destroy()
        })
      }
    )
    req.on('error', reject)
    req.end()
  })
}

export async function publicHttpsBytes(
  raw: string,
  limit: number,
  parent: AbortSignal,
  deps: PublicHttpsDeps = {}
): Promise<{ bytes: Buffer; url: string }> {
  const signal = AbortSignal.any([parent, AbortSignal.timeout(deps.timeoutMs ?? 30000)])
  const run = async () => {
    let url = publicHttpsUrl(raw)
    for (let hop = 0; hop <= 3; hop++) {
      signal.throwIfAborted()
      if (deps.allowUrl && !deps.allowUrl(url)) throw Error('Ese sitio no permite descargar audio para video.')
      const host = url.hostname.replace(/^\[|\]$/g, '')
      const addresses = isIP(host)
        ? [{ address: host, family: isIP(host) }]
        : await (deps.resolve ?? ((h) => lookup(h, { all: true, verbatim: true })))(host)
      signal.throwIfAborted()
      if (!addresses.length || addresses.some((a) => !publicAddress(a.address))) throw Error('El destino no tiene solo IP públicas.')
      const address = addresses.find((a) => a.family === 4) ?? addresses[0]!
      const res = await (deps.request ?? pinnedHttpsRequest)(url, address.address, signal)
      const cancel = () => res.cancel()
      signal.addEventListener('abort', cancel, { once: true })
      try {
        signal.throwIfAborted()
        if ([301, 302, 303, 307, 308].includes(res.status)) {
          if (hop === 3 || !res.location) throw Error('Demasiadas redirecciones o destino ausente.')
          url = publicHttpsUrl(new URL(res.location, url).href)
          continue
        }
        if (res.status !== 200) throw Error(`El recurso web no está disponible (HTTP ${res.status}).`)
        if (res.encoding && res.encoding !== 'identity') throw Error('Codificación de descarga no admitida.')
        if (res.length && (!/^\d+$/.test(res.length) || Number(res.length) > limit)) throw Error('Descarga demasiado grande.')
        const parts: Buffer[] = []
        let size = 0
        for await (const chunk of res.body) {
          signal.throwIfAborted()
          size += chunk.byteLength
          if (size > limit) throw Error('Descarga demasiado grande.')
          parts.push(Buffer.from(chunk))
        }
        if (!size) throw Error('El recurso web está vacío.')
        return { bytes: Buffer.concat(parts), url: url.href }
      } finally {
        signal.removeEventListener('abort', cancel)
        res.cancel()
      }
    }
    throw Error('Demasiadas redirecciones.')
  }
  // DNS también tiene plazo, aunque el resolver del sistema no sea cancelable.
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    void run()
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort))
  })
}

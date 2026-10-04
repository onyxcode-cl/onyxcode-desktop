/**
 * Clasificación de destinos «locales» del navegador integrado (SSRF, F8-B68): la regla de red y la puerta de
 * aprobación deciden por la IP REAL, no por el texto del host. `new URL()` ya normaliza las notaciones de IPv4
 * (`2130706433`, `0x7f.1`, `127.1`) a decimal con puntos; aquí se desmapea IPv6 (`::ffff:7f00:1`, NAT64) y se
 * cubren loopback, privadas, link-local, ULA, `0.0.0.0/8`, CGNAT, multicast y reservadas (incluye 169.254.169.254).
 */
import { isIP } from 'node:net'

function v4Local(a: number, b: number, c: number): boolean {
  if (a === 0) return true // 0.0.0.0/8 («este host»: en Linux/macOS alcanza el loopback)
  if (a === 10) return true
  if (a === 127) return true
  if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10 (CGNAT)
  if (a === 169 && b === 254) return true // link-local y metadatos de nube (169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 192 && b === 0 && c === 0) return true // 192.0.0.0/24
  if (a >= 224) return true // multicast 224/4 y reservadas 240/4 (incluye 255.255.255.255)
  return false
}

/** Expande una IPv6 textual a 8 grupos de 16 bits, o `null` si no es válida. */
function parseV6(text: string): number[] | null {
  let s = text
  const zone = s.indexOf('%')
  if (zone >= 0) s = s.slice(0, zone)
  // Cola IPv4 embebida (`::ffff:1.2.3.4`) → dos grupos hex.
  const tail = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s)
  if (tail) {
    const o = tail.slice(1, 5).map(Number)
    if (o.some((n) => n > 255)) return null
    s = s.slice(0, tail.index) + ((o[0] << 8) | o[1]).toString(16) + ':' + ((o[2] << 8) | o[3]).toString(16)
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  if (halves.length === 1 && head.length !== 8) return null
  const fill = 8 - head.length - rest.length
  if (halves.length === 2 && fill < 1) return null
  const groups = [...head, ...(halves.length === 2 ? Array<string>(fill).fill('0') : []), ...rest]
  if (groups.length !== 8) return null
  const out = groups.map((g) => (/^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : NaN))
  return out.some(Number.isNaN) ? null : out
}

function v6Local(g: number[]): boolean {
  const high5 = g.slice(0, 5).every((x) => x === 0)
  const embedded = (hi: number, lo: number): boolean => v4Local(hi >> 8, hi & 255, lo >> 8)
  if (g.slice(0, 7).every((x) => x === 0) && g[7] <= 1) return true // :: y ::1
  if (high5 && g[5] === 0xffff) return embedded(g[6], g[7]) // IPv4 mapeada ::ffff:a.b.c.d
  if (g.slice(0, 6).every((x) => x === 0)) return embedded(g[6], g[7]) // IPv4 «compatible» ::a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return embedded(g[6], g[7]) // NAT64
  if (g[0] === 0x2002) return embedded(g[1], g[2]) // 6to4: la IPv4 va en los grupos 1-2
  if ((g[0] & 0xfe00) === 0xfc00) return true // fc00::/7 (ULA)
  if ((g[0] & 0xffc0) === 0xfe80) return true // fe80::/10 (link-local)
  if ((g[0] & 0xffc0) === 0xfec0) return true // fec0::/10 (site-local, obsoleta)
  if ((g[0] & 0xff00) === 0xff00) return true // multicast
  return false
}

/** ¿`hostname` (de `URL.hostname`, con o sin corchetes) es un destino local/privado/reservado? Los nombres no se resuelven aquí. */
export function isLocalHostname(hostname: string): boolean {
  let h = hostname.toLowerCase().trim()
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1)
  while (h.endsWith('.')) h = h.slice(0, -1)
  if (!h) return false
  const kind = isIP(h.split('%')[0])
  if (kind === 6) {
    const g = parseV6(h)
    return g ? v6Local(g) : true // IPv6 que no sabemos leer: por prudencia, local
  }
  if (kind === 4) {
    const [a, b, c] = h.split('.').map(Number)
    return v4Local(a, b, c)
  }
  // Notaciones de IPv4 que `net.isIP` no acepta (`2130706433`, `0x7f.1`, `0177.0.0.1`): se normalizan con URL.
  if (/^[0-9.]+$/.test(h) || /^0x[0-9a-f.x]+$/i.test(h)) {
    try {
      const norm = new URL(`http://${h}/`).hostname
      if (norm !== h && isIP(norm) === 4) return isLocalHostname(norm)
    } catch {
      return true // numérico y no interpretable: no se deja pasar como «público»
    }
  }
  return h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan')
}

/**
 * Resolución del nombre del túnel para la autocomprobación del Mac.
 *
 * PROBLEMA (medido con el `cloudflared` real, 2026.9.3): `cloudflared` imprime la URL y registra la conexión ANTES de que el nombre
 * exista en el DNS. La primera consulta del Mac recibe NXDOMAIN y los resolvedores (el del router, el del sistema, 1.1.1.1) lo guardan
 * en caché con el TTL negativo de la zona (SOA de `trycloudflare.com`: 60 s). Los reintentos de 1 s → 30 s dentro de una ventana de 45 s
 * chocaban siempre con esa caché: `getaddrinfo ENOTFOUND` hasta agotar el plazo y el QR nunca aparecía, aunque el túnel funcionaba.
 *
 * SOLUCIÓN: preguntar el nombre DIRECTAMENTE a los servidores autoritativos de la zona (los NS de `trycloudflare.com`: no tienen caché
 * negativa que envenenar, y a ningún resolvedor intermedio se le pregunta un nombre que aún no existe) y conectar a la IP que
 * devuelven; el certificado se sigue validando contra el nombre (SNI). Mientras no exista, el error es `ENOTFOUND` y NO se consulta al
 * sistema (no se envenena su caché: el celular, si usa el mismo resolvedor, tampoco heredaría un NXDOMAIN). Solo si no se puede hablar
 * con los autoritativos (UDP 53 bloqueado, sin NS) se recurre al resolvedor del sistema. Solo vale para `*.trycloudflare.com`.
 */
import dns from 'node:dns'
import type { LookupFunction } from 'node:net'

const ZONE = 'trycloudflare.com'
const NS_TTL_MS = 10 * 60_000

export interface DnsDeps {
  /** IPs de los servidores autoritativos de la zona. Rechaza si no se pueden obtener. */
  authoritative(): Promise<string[]>
  /** Registros A del nombre preguntando SOLO a esos servidores. Rechaza con `code` (`ENOTFOUND`/`ENODATA` = no existe todavía). */
  resolve4(servers: string[], host: string): Promise<string[]>
  /** Resolvedor del sistema (respaldo). */
  system: LookupFunction
}

let nsCache: { at: number; ips: Promise<string[]> } | null = null

export const realDnsDeps: DnsDeps = {
  authoritative() {
    if (nsCache && Date.now() - nsCache.at < NS_TTL_MS) return nsCache.ips
    const ips = (async (): Promise<string[]> => {
      const r = new dns.promises.Resolver({ timeout: 3000, tries: 2 })
      const names = await r.resolveNs(ZONE)
      const out: string[] = []
      for (const n of names.slice(0, 4)) {
        try {
          out.push(...(await r.resolve4(n)).slice(0, 2))
        } catch {
          /* ese NS no resuelve: se prueba con los demás */
        }
      }
      if (out.length === 0) throw Object.assign(new Error('no-ns'), { code: 'ENOTFOUND-NS' })
      return out
    })()
    nsCache = { at: Date.now(), ips }
    ips.catch(() => {
      if (nsCache?.ips === ips) nsCache = null
    })
    return ips
  },
  async resolve4(servers, host) {
    const r = new dns.promises.Resolver({ timeout: 3000, tries: 2 })
    r.setServers(servers)
    return r.resolve4(host)
  },
  system: dns.lookup as unknown as LookupFunction
}

const isMissing = (err: unknown): boolean => {
  const c = (err as { code?: string } | null)?.code
  return c === 'ENOTFOUND' || c === 'ENODATA'
}

/** `lookup` para `https.request`: autoritativo primero, sistema solo como respaldo si no hay forma de preguntar al autoritativo. */
export function makeTunnelLookup(deps: DnsDeps = realDnsDeps): LookupFunction {
  return ((hostname: string, options: dns.LookupOptions, cb: (...a: unknown[]) => void) => {
    const opts = typeof options === 'object' && options ? options : {}
    if (!hostname.endsWith(`.${ZONE}`)) return (deps.system as unknown as (...a: unknown[]) => void)(hostname, options, cb)
    void (async () => {
      try {
        const servers = await deps.authoritative()
        const ips = await deps.resolve4(servers, hostname)
        if (ips.length === 0) throw Object.assign(new Error('empty'), { code: 'ENODATA' })
        if (opts.all)
          cb(
            null,
            ips.map((address) => ({ address, family: 4 }))
          )
        else cb(null, ips[0], 4)
      } catch (err) {
        if (isMissing(err)) {
          // Todavía no existe: error de «no encontrado» SIN preguntar al sistema (no se envenena su caché negativa).
          cb(Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND', hostname }))
          return
        }
        ;(deps.system as unknown as (...a: unknown[]) => void)(hostname, options, cb)
      }
    })()
  }) as LookupFunction
}

/**
 * IPv4 privada de la interfaz activa (la única dirección a la que se liga el servidor del control remoto).
 * Puro: recibe lo que devuelve `os.networkInterfaces()`.
 */
export interface IfaceInfo {
  address: string
  family: string | number
  internal: boolean
}

/** 10/8, 172.16/12 y 192.168/16 (no link-local 169.254, no CGNAT 100.64/10 de las VPN, no loopback). */
export function isPrivateIPv4(address: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  if (m.slice(1).some((x) => Number(x) > 255)) return false
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

/** Interfaces virtuales o de túnel: nunca se eligen. */
const VIRTUAL = /^(utun|awdl|llw|lo|bridge|vmnet|vboxnet|docker|veth|gif|stf|ap|anpi|tailscale|zt|tun|tap)/i

/** Preferencia: `en0` (Wi-Fi o cable principal del Mac), luego cualquier `en*`, luego el resto. */
function rank(name: string): number {
  if (name === 'en0') return 0
  if (/^en\d+$/.test(name)) return 1
  return 2
}

export function pickLanIp(ifaces: Record<string, IfaceInfo[] | undefined>): string | null {
  const candidates: Array<{ name: string; address: string }> = []
  for (const [name, list] of Object.entries(ifaces)) {
    if (VIRTUAL.test(name)) continue
    for (const i of list ?? []) {
      const v4 = i.family === 'IPv4' || i.family === 4
      if (v4 && !i.internal && isPrivateIPv4(i.address)) candidates.push({ name, address: i.address })
    }
  }
  candidates.sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name))
  return candidates[0]?.address ?? null
}

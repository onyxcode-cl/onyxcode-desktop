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

/**
 * Windows: nombres de adaptador de Hyper-V/WSL (`vEthernet (WSL)`, `vEthernet (Default Switch)`), VMware, VirtualBox, VPN y túneles
 * (Tailscale, ZeroTier, OpenVPN, WireGuard, TAP/Wintun), Bluetooth, loopback de Npcap y los `Local Area Connection* N` del punto de
 * acceso móvil / Wi-Fi Direct (192.168.137.x: el celular no puede llegar al equipo por ahí). Nunca se eligen. La lista es cerrada y
 * solo se aplica en Windows: en macOS `lo`/`ap`/`tap` casan por prefijo y aquí dejarían fuera a «Local Area Connection».
 */
const WIN_VIRTUAL =
  /^(vethernet|vmware|virtualbox|vbox|hyper-v|wsl|bluetooth|loopback|npcap|tailscale|zerotier|openvpn|wireguard|wintun|tap-|nordlynx|radmin|hamachi|docker|vpn|ppp|local area connection\*|conexi[oó]n de [aá]rea local\*)/i

/** Windows: el adaptador principal se llama `Wi-Fi` o `Ethernet` (también `Ethernet 2`, `WLAN`). */
const WIN_PRIMARY = /^(wi-?fi|wlan|ethernet)( \d+)?$/i

/** Preferencia: `en0` (Wi-Fi o cable principal del Mac), luego cualquier `en*`, luego el resto. */
function rank(name: string, platform: string): number {
  if (platform === 'win32') return WIN_PRIMARY.test(name) ? 0 : 2
  if (name === 'en0') return 0
  if (/^en\d+$/.test(name)) return 1
  return 2
}

export function pickLanIp(ifaces: Record<string, IfaceInfo[] | undefined>, platform: string = process.platform): string | null {
  const virtual = platform === 'win32' ? WIN_VIRTUAL : VIRTUAL
  const candidates: Array<{ name: string; address: string }> = []
  for (const [name, list] of Object.entries(ifaces)) {
    if (virtual.test(name)) continue
    for (const i of list ?? []) {
      const v4 = i.family === 'IPv4' || i.family === 4
      if (v4 && !i.internal && isPrivateIPv4(i.address)) candidates.push({ name, address: i.address })
    }
  }
  candidates.sort((a, b) => rank(a.name, platform) - rank(b.name, platform) || a.name.localeCompare(b.name))
  return candidates[0]?.address ?? null
}

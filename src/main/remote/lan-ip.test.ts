import { describe, expect, it } from 'vitest'
import { pickLanIp, type IfaceInfo } from './lan-ip'

const v4 = (address: string): IfaceInfo[] => [
  { address: 'fe80::1', family: 'IPv6', internal: false },
  { address, family: 'IPv4', internal: false }
]

describe('pickLanIp en Windows (plataforma inyectada)', () => {
  it('prefiere Wi-Fi o Ethernet frente a los adaptadores virtuales de Hyper-V/WSL y VMware', () => {
    const ifaces = {
      'vEthernet (WSL)': v4('172.20.16.1'),
      'vEthernet (Default Switch)': v4('172.28.64.1'),
      'VMware Network Adapter VMnet8': v4('192.168.100.1'),
      'Wi-Fi': v4('192.168.1.34'),
      'Loopback Pseudo-Interface 1': [{ address: '127.0.0.1', family: 'IPv4', internal: true }]
    }
    expect(pickLanIp(ifaces, 'win32')).toBe('192.168.1.34')
  })
  it('descarta VPN, túneles, Bluetooth y el punto de acceso móvil (192.168.137.x)', () => {
    const ifaces = {
      'Local Area Connection* 10': v4('192.168.137.1'),
      'Bluetooth Network Connection': v4('192.168.44.2'),
      Tailscale: v4('10.64.0.5'),
      'OpenVPN TAP-Windows6': v4('10.8.0.6'),
      'VirtualBox Host-Only Network': v4('192.168.56.1')
    }
    expect(pickLanIp(ifaces, 'win32')).toBeNull()
  })
  it('Ethernet numerado cuenta como principal y gana a un adaptador desconocido', () => {
    const ifaces = { 'Realtek USB NIC': v4('192.168.0.9'), 'Ethernet 2': v4('10.0.0.15') }
    expect(pickLanIp(ifaces, 'win32')).toBe('10.0.0.15')
  })
  it('un adaptador con nombre local desconocido sirve si es el único privado', () => {
    expect(pickLanIp({ 'Realtek USB NIC': v4('192.168.0.9') }, 'win32')).toBe('192.168.0.9')
  })
  it('«Local Area Connection» (sin asterisco, Windows antiguo) no se descarta', () => {
    expect(pickLanIp({ 'Local Area Connection': v4('192.168.2.7') }, 'win32')).toBe('192.168.2.7')
  })
  it('nunca elige IP pública, CGNAT ni link-local, igual que en macOS', () => {
    const ifaces = {
      'Wi-Fi': [{ address: '100.64.1.2', family: 'IPv4', internal: false }],
      Ethernet: [{ address: '169.254.9.9', family: 'IPv4', internal: false }]
    }
    expect(pickLanIp(ifaces, 'win32')).toBeNull()
  })
})

describe('pickLanIp en macOS no cambia', () => {
  it('sigue prefiriendo en0 y descartando utun/lo/bridge', () => {
    const ifaces = { bridge100: v4('192.168.64.1'), en5: v4('192.168.50.4'), en0: v4('192.168.1.20'), utun3: v4('10.8.0.2') }
    expect(pickLanIp(ifaces, 'darwin')).toBe('192.168.1.20')
  })
  it('los nombres de Windows no se interpretan en macOS (lista de macOS intacta)', () => {
    expect(pickLanIp({ 'Local Area Connection': v4('192.168.2.7') }, 'darwin')).toBeNull() // `lo` casa por prefijo, como siempre
  })
})

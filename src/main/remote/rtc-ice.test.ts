import { describe, expect, it } from 'vitest'
import { DISCONNECTED_GRACE_MS, toNdcIceServers } from './rtc'

describe('toNdcIceServers', () => {
  it('STUN y TURN en la forma objeto, con usuario y clave tal cual (sin escapar)', () => {
    expect(
      toNdcIceServers([
        { urls: ['stun:stun.cloudflare.com:3478'] },
        {
          urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:80?transport=tcp'],
          username: 'u:ser@x',
          credential: 'p/a+ss='
        },
        { urls: ['turns:turn.cloudflare.com:443?transport=tcp'], username: 'u', credential: 'c' }
      ])
    ).toEqual([
      { hostname: 'stun.cloudflare.com', port: 3478 },
      { hostname: 'turn.cloudflare.com', port: 3478, relayType: 'TurnUdp', username: 'u:ser@x', password: 'p/a+ss=' },
      { hostname: 'turn.cloudflare.com', port: 80, relayType: 'TurnTcp', username: 'u:ser@x', password: 'p/a+ss=' },
      { hostname: 'turn.cloudflare.com', port: 443, relayType: 'TurnTls', username: 'u', password: 'c' }
    ])
  })

  it('puertos por defecto y STUN sin credenciales aunque las traiga', () => {
    expect(
      toNdcIceServers([
        { urls: ['stun:stun.cloudflare.com'], username: 'u', credential: 'c' },
        { urls: ['turn:t.cloudflare.com'] },
        { urls: ['turns:t.cloudflare.com'] }
      ])
    ).toEqual([
      { hostname: 'stun.cloudflare.com', port: 3478 },
      { hostname: 't.cloudflare.com', port: 3478, relayType: 'TurnUdp' },
      { hostname: 't.cloudflare.com', port: 5349, relayType: 'TurnTls' }
    ])
  })

  it('lo que no se entiende se omite y la lista vacía da vacía', () => {
    expect(toNdcIceServers([{ urls: ['https://x.cloudflare.com', 'stun:'] }])).toEqual([])
    expect(toNdcIceServers([])).toEqual([])
  })

  it('la gracia de `disconnected` es de 6 s', () => {
    expect(DISCONNECTED_GRACE_MS).toBe(6000)
  })
})

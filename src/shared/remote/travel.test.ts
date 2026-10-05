import { describe, expect, it } from 'vitest'
import { parseHostFrame } from './protocol'
import {
  TRAVEL_KEEPALIVE,
  TRAVEL_PROCESS,
  TRAVEL_STUN_URLS,
  TUNNEL_HOST_RE,
  TUNNEL_ORIGIN_RE,
  TUNNEL_URL_SCAN_RE,
  isTravelError,
  isTravelKeep,
  parseSetTravelKeepRequest,
  parseTravelInstallRequest,
  travelBlockedReason,
  travelLifetimeHours,
  travelPairUrl
} from './travel'

describe('nombre público del túnel', () => {
  it('solo `https://<palabras>.trycloudflare.com`', () => {
    expect(TUNNEL_ORIGIN_RE.test('https://horizontal-aircraft-tamil-weekend.trycloudflare.com')).toBe(true)
    expect(TUNNEL_HOST_RE.test('ian-hope-consumption-retired.trycloudflare.com')).toBe(true)
    for (const bad of [
      'https://x.trycloudflare.com',
      'http://aa-bb.trycloudflare.com',
      'https://aa-bb.trycloudflare.com:443',
      'https://aa-bb.trycloudflare.com/',
      'https://aa-bb.trycloudflare.com.evil.com',
      'https://aa-bb.evil.com',
      'https://AA-bb.trycloudflare.com',
      'https://aa--bb.trycloudflare.com',
      'https://-aa-bb.trycloudflare.com',
      'https://a-b-c-d-e-f-g-h-i.trycloudflare.com'
    ])
      expect(TUNNEL_ORIGIN_RE.test(bad), bad).toBe(false)
  })
  it('el aviso legal de cloudflared no casa', () => {
    const notice =
      'INF Thank you for trying Cloudflare Tunnel (https://www.cloudflare.com/website-terms/) ... trycloudflare.com ... https://developers.cloudflare.com/cloudflare-one/connections/connect-apps'
    expect(TUNNEL_URL_SCAN_RE.test(notice)).toBe(false)
    expect(TUNNEL_URL_SCAN_RE.exec('INF |  https://merry-plasma-least-recruitment.trycloudflare.com   |')?.[1]).toBe(
      'merry-plasma-least-recruitment'
    )
  })
})

describe('enlace del QR', () => {
  it('lleva T en la ruta y q en el fragmento', () => {
    expect(travelPairUrl('https://a-b.trycloudflare.com', 'T'.repeat(22), 'Q'.repeat(43))).toBe(
      `https://a-b.trycloudflare.com/k/${'T'.repeat(22)}#s=${'Q'.repeat(43)}`
    )
  })
})

describe('keepalive, STUN y vida', () => {
  it('pings ≤ 25 s y cierre antes de 100 s', () => {
    expect(TRAVEL_KEEPALIVE.pingMs).toBeLessThanOrEqual(25_000)
    expect(TRAVEL_KEEPALIVE.deadMs).toBeLessThan(100_000)
  })
  it('el plazo de arranque de cloudflared deja margen sobre lo medido con el binario real (una ejecución pasó de 30 s)', () => {
    expect(TRAVEL_PROCESS.startTimeoutMs).toBeGreaterThanOrEqual(45_000)
  })
  it('dos STUN sin cuenta y ningún TURN', () => {
    expect(TRAVEL_STUN_URLS).toEqual(['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'])
  })
  it('vida = lo elegido recortado por la política (1–24 h)', () => {
    expect(travelLifetimeHours('h12', 24)).toBe(12)
    expect(travelLifetimeHours('h12', 4)).toBe(4)
    expect(travelLifetimeHours('h24', 1)).toBe(1)
    expect(travelLifetimeHours('idle30', 6)).toBe(6)
    expect(travelLifetimeHours('h4', 0)).toBe(1)
    expect(travelLifetimeHours('h4', 99)).toBe(4)
    expect(travelLifetimeHours('h4', NaN)).toBe(1)
  })
  it('claves y errores válidos', () => {
    expect(isTravelKeep('h4')).toBe(true)
    expect(isTravelKeep('h5')).toBe(false)
    expect(isTravelError('exited:1')).toBe(true)
    expect(isTravelError('exited:x')).toBe(false)
    expect(isTravelError('rate')).toBe(true)
    expect(isTravelError('otro')).toBe(false)
  })
})

describe('bloqueo', () => {
  const ok = { allowTravelMode: true, requireConnectionConfirm: false, requirePasskey: false, confirmEach: false }
  it('política, passkey y confirmar cada conexión bloquean (en ese orden)', () => {
    expect(travelBlockedReason(ok)).toBeNull()
    expect(travelBlockedReason({ ...ok, allowTravelMode: false })).toBe('policy')
    expect(travelBlockedReason({ ...ok, requirePasskey: true })).toBe('passkey-required')
    expect(travelBlockedReason({ ...ok, requireConnectionConfirm: true })).toBe('confirm-required')
    expect(travelBlockedReason({ ...ok, confirmEach: true })).toBe('confirm-required')
    expect(travelBlockedReason({ ...ok, allowTravelMode: false, requirePasskey: true })).toBe('policy')
  })
})

describe('esquemas IPC estrictos', () => {
  it('remote:travelInstall exige { consent: true } exacto', () => {
    expect(parseTravelInstallRequest({ consent: true })).toEqual({ consent: true })
    for (const bad of [{}, { consent: false }, { consent: 'true' }, { consent: true, x: 1 }, null, [], 'x', undefined, { Consent: true }])
      expect(parseTravelInstallRequest(bad), JSON.stringify(bad)).toBeNull()
  })
  it('remote:setTravelKeep solo acepta la lista', () => {
    expect(parseSetTravelKeepRequest({ keep: 'h24' })).toEqual({ keep: 'h24' })
    for (const bad of [{}, { keep: 'forever' }, { keep: 'h4', x: 1 }, { keep: 4 }, null, []])
      expect(parseSetTravelKeepRequest(bad)).toBeNull()
  })
})

describe('protocolo: cierre del modo viaje', () => {
  it('`bye` con `travel-ended` es válido y un motivo desconocido no', () => {
    expect(parseHostFrame(JSON.stringify({ t: 'bye', reason: 'travel-ended' })).ok).toBe(true)
    expect(parseHostFrame(JSON.stringify({ t: 'bye', reason: 'stopped' })).ok).toBe(true)
    expect(parseHostFrame(JSON.stringify({ t: 'bye', reason: 'travel-ended-x' })).ok).toBe(false)
  })
})

// Regla de red del navegador integrado (installNetworkGuard) con peticiones simuladas: el CSS de una página local carga,
// otro puerto local NO aprobado sigue bloqueado.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Listener = (details: unknown, cb: (r: { cancel: boolean }) => void) => void
const state = vi.hoisted(() => ({
  reqH: null as null | ((...a: any[]) => void),
  chkH: null as null | ((...a: any[]) => boolean),
  listener: null as Listener | null,
  always: new Set<string>(),
  dns: {} as Record<string, string[]>
}))

vi.mock('electron', () => {
  const ses = {
    webRequest: { onBeforeRequest: (l: Listener) => (state.listener = l) },
    setUserAgent: () => undefined,
    getUserAgent: () => 'UA',
    setPermissionRequestHandler: (h: (...a: unknown[]) => void) => (state.reqH = h),
    setPermissionCheckHandler: (h: (...a: unknown[]) => boolean) => (state.chkH = h),
    setDevicePermissionHandler: () => undefined,
    setDisplayMediaRequestHandler: () => undefined,
    on: () => undefined
  }
  return { app: { on: () => undefined }, session: { fromPartition: () => ses } }
})
vi.mock('./store', () => ({ isLocalOriginApproved: (o: string) => state.always.has(o) }))
vi.mock('node:dns/promises', () => ({
  lookup: async (h: string) => (state.dns[h] ?? ['93.184.216.34']).map((address) => ({ address, family: address.includes(':') ? 6 : 4 }))
}))
vi.mock('./downloads', () => ({ handleWillDownload: () => undefined }))

import { isLoopbackOrPrivateHost, sessionFor } from './session'

function wcAt(url: string, destroyed = false): unknown {
  return { isDestroyed: () => destroyed, getURL: () => url }
}
function runAsync(url: string, resourceType: string, wc: unknown): Promise<boolean> {
  return new Promise((resolve) => state.listener!({ url, resourceType, webContents: wc }, (r) => resolve(r.cancel)))
}
function run(url: string, resourceType: string, wc: unknown): boolean {
  let cancelled: boolean | null = null
  state.listener!({ url, resourceType, webContents: wc }, (r) => (cancelled = r.cancel))
  expect(cancelled).not.toBeNull()
  return cancelled === true
}

describe('installNetworkGuard (destinos locales)', () => {
  beforeEach(() => {
    state.always.clear()
    sessionFor('code')
  })

  it('el stylesheet/script/imagen del MISMO origen carga aunque nada esté aprobado «siempre»', () => {
    const top = wcAt('http://127.0.0.1:4173/')
    for (const t of ['stylesheet', 'script', 'image', 'font', 'xhr']) expect(run('http://127.0.0.1:4173/a.css', t, top), t).toBe(false)
    expect(run('http://localhost:5173/x.css', 'stylesheet', wcAt('http://localhost:5173/index.html'))).toBe(false)
  })

  it('otro puerto local no aprobado: bloqueado (la regla de seguridad no se afloja)', () => {
    const top = wcAt('http://127.0.0.1:4173/')
    expect(run('http://127.0.0.1:3000/secreto', 'xhr', top)).toBe(true)
    expect(run('http://127.0.0.1:3000/i.png', 'image', top)).toBe(true)
    expect(run('http://localhost:4173/x.css', 'stylesheet', top)).toBe(true) // otro nombre de host
  })

  it('«Permitir siempre» en el origen de la página sí abre otros puertos locales', () => {
    state.always.add('localhost:5173')
    expect(run('http://127.0.0.1:3000/api', 'xhr', wcAt('http://localhost:5173/'))).toBe(false)
  })

  it('sin webContents (service worker) o destruido: bloqueado; el frame principal pasa por su propia puerta', () => {
    expect(run('http://127.0.0.1:4173/a.css', 'stylesheet', null)).toBe(true)
    expect(run('http://127.0.0.1:4173/a.css', 'stylesheet', wcAt('http://127.0.0.1:4173/', true))).toBe(true)
    expect(run('http://127.0.0.1:4173/', 'mainFrame', null)).toBe(false)
  })

  it('una página remota nunca alcanza un destino local; esquemas raros se cancelan; lo remoto pasa', () => {
    expect(run('http://127.0.0.1:4173/a.css', 'stylesheet', wcAt('https://ejemplo.com/'))).toBe(true)
    expect(run('file:///etc/hosts', 'image', wcAt('https://ejemplo.com/'))).toBe(true)
  })

  it('lo remoto pasa (tras resolver DNS a una IP pública)', async () => {
    expect(await runAsync('https://cdn.ejemplo.com/a.css', 'stylesheet', wcAt('https://ejemplo.com/'))).toBe(false)
  })

  it('SSRF: IPv6 mapeada, ULA, link-local, 0.0.0.0 y notaciones raras de IPv4 se bloquean como subrecurso', () => {
    const top = wcAt('https://ejemplo.com/')
    for (const u of [
      'http://[::ffff:127.0.0.1]:4173/',
      'http://[::ffff:7f00:1]:4173/',
      'http://[fc00::1]/',
      'http://[fd12:3456::1]/',
      'http://[fe80::1]/',
      'http://0.0.0.0:4173/',
      'http://[::]:4173/',
      'http://2130706433:4173/',
      'http://0x7f.1:4173/',
      'http://0177.0.0.1:4173/',
      'http://127.1:4173/',
      'http://169.254.169.254/latest/meta-data/',
      'http://100.64.0.1/',
      'http://foo.localhost:4173/'
    ])
      expect(run(u, 'xhr', top), u).toBe(true)
  })

  it('anti-rebinding: un nombre público cuyo DNS apunta a una IP local se bloquea (salvo origen aprobado «siempre»)', async () => {
    state.dns['rebind.ejemplo.com'] = ['127.0.0.1']
    state.dns['rebind6.ejemplo.com'] = ['::ffff:127.0.0.1']
    const top = wcAt('https://rebind.ejemplo.com/')
    expect(await runAsync('https://rebind.ejemplo.com/api', 'xhr', top)).toBe(true) // mismo «origen» ya no basta
    expect(await runAsync('https://rebind6.ejemplo.com/api', 'xhr', top)).toBe(true)
    expect(await runAsync('https://rebind.ejemplo.com/', 'mainFrame', null)).toBe(false)
    state.always.add('rebind.ejemplo.com:443')
    expect(await runAsync('https://rebind.ejemplo.com/api', 'xhr', top)).toBe(false)
  })
})

describe('isLoopbackOrPrivateHost', () => {
  it('clasifica por la IP real', () => {
    for (const h of [
      '[::ffff:127.0.0.1]',
      '::ffff:10.0.0.1',
      '[fc00::1]',
      'fe80::1',
      '0.0.0.0',
      '224.0.0.1',
      '[ff02::1]',
      'localhost.',
      '[::1]',
      '172.31.0.1'
    ])
      expect(isLoopbackOrPrivateHost(h), h).toBe(true)
    for (const h of ['8.8.8.8', 'ejemplo.com', '[2606:4700::1111]', '172.32.0.1', '[::ffff:8.8.8.8]', '100.63.0.1'])
      expect(isLoopbackOrPrivateHost(h), h).toBe(false)
  })
})

describe('permisos (clipboard-sanitized-write) por origen', () => {
  const ask = (permission: string, requestingUrl: string, top: string, isMainFrame = true): boolean => {
    let granted: boolean | null = null
    sessionFor('code')
    state.reqH!(wcAt(top), permission, (g: boolean) => (granted = g), { requestingUrl, isMainFrame })
    return granted === true
  }
  it('se concede al origen https de la página y se niega a file:/data:/opaco, a otro origen, a subframes y a otros permisos', () => {
    expect(ask('clipboard-sanitized-write', 'https://ejemplo.com/p', 'https://ejemplo.com/q')).toBe(true)
    expect(ask('clipboard-sanitized-write', 'http://localhost:5173/', 'http://localhost:5173/')).toBe(true)
    expect(ask('clipboard-sanitized-write', 'http://ejemplo.com/', 'http://ejemplo.com/')).toBe(false) // http público
    expect(ask('clipboard-sanitized-write', 'file:///tmp/x.html', 'file:///tmp/x.html')).toBe(false)
    expect(ask('clipboard-sanitized-write', 'about:blank', 'about:blank')).toBe(false)
    expect(ask('clipboard-sanitized-write', 'https://otro.com/', 'https://ejemplo.com/')).toBe(false)
    expect(ask('clipboard-sanitized-write', 'https://ejemplo.com/', 'https://ejemplo.com/', false)).toBe(false)
    expect(ask('geolocation', 'https://ejemplo.com/', 'https://ejemplo.com/')).toBe(false)
    expect(state.chkH!(wcAt('https://ejemplo.com/'), 'clipboard-sanitized-write', 'null')).toBe(false)
    expect(state.chkH!(wcAt('https://ejemplo.com/'), 'clipboard-sanitized-write', 'https://ejemplo.com')).toBe(true)
  })
})

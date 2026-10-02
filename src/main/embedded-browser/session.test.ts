// Regla de red del navegador integrado (installNetworkGuard) con peticiones simuladas: el CSS de una página local carga,
// otro puerto local NO aprobado sigue bloqueado.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Listener = (details: unknown, cb: (r: { cancel: boolean }) => void) => void
const state = vi.hoisted(() => ({ listener: null as Listener | null, always: new Set<string>() }))

vi.mock('electron', () => {
  const ses = {
    webRequest: { onBeforeRequest: (l: Listener) => (state.listener = l) },
    setUserAgent: () => undefined,
    getUserAgent: () => 'UA',
    setPermissionRequestHandler: () => undefined,
    setPermissionCheckHandler: () => undefined,
    setDevicePermissionHandler: () => undefined,
    setDisplayMediaRequestHandler: () => undefined,
    on: () => undefined
  }
  return { app: { on: () => undefined }, session: { fromPartition: () => ses } }
})
vi.mock('./store', () => ({ isLocalOriginApproved: (o: string) => state.always.has(o) }))
vi.mock('./downloads', () => ({ handleWillDownload: () => undefined }))

import { sessionFor } from './session'

function wcAt(url: string, destroyed = false): unknown {
  return { isDestroyed: () => destroyed, getURL: () => url }
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
    expect(run('https://cdn.ejemplo.com/a.css', 'stylesheet', wcAt('https://ejemplo.com/'))).toBe(false)
  })
})

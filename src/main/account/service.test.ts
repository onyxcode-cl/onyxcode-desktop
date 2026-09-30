import { describe, expect, it, vi } from 'vitest'
import { GRACE_MS, REVALIDATE_MS, type AccountState, type ServerResult } from '@shared/account'
import { AccountApiError, type AccountClient, type MeResult, type SessionGrant } from './client'
import type { AccountConfig } from './config'
import type { LoopbackHandle, LoopbackResult } from './loopback'
import { AccountService, AccountUserError, type AccountServiceDeps } from './service'
import type { AccountStore, StoredAccount } from './store'

const DAY = 24 * 60 * 60 * 1000
const T0 = 1_800_000_000_000
const ON: AccountConfig = { enabled: true, baseUrl: 'https://api.test', allowLocalHttp: false }
const OFF: AccountConfig = { enabled: false, baseUrl: null, allowLocalHttp: false }
const GRANT: SessionGrant = { token: 'TOK', email: 'ana@ejemplo.cl', provider: 'email' }

type MemStore = AccountStore & { data: StoredAccount | null; saves: number }

function memStore(initial: StoredAccount | null = null, memoryOnly = false): MemStore {
  const s = {
    data: initial,
    saves: 0,
    get memoryOnly() {
      return memoryOnly
    },
    load: () => s.data,
    save: (d: StoredAccount) => {
      s.saves++
      s.data = d
    },
    clear: () => {
      s.data = null
    }
  }
  return s
}

type FakeClient = AccountClient & { meResults: MeResult[] }

function fakeClient(over: Partial<AccountClient> = {}): FakeClient {
  const meResults: MeResult[] = []
  const c: AccountClient = {
    emailStart: vi.fn(async () => undefined),
    emailVerify: vi.fn(async (): Promise<SessionGrant> => GRANT),
    googleStart: vi.fn(async () => ({ authUrl: 'https://accounts.example/auth' })),
    exchange: vi.fn(async (): Promise<SessionGrant> => ({ ...GRANT, provider: 'google' })),
    me: vi.fn(async (): Promise<MeResult> => meResults.shift() ?? { result: { kind: 'ok' } }),
    exportMe: vi.fn(async () => ({ email: 'ana@ejemplo.cl' })),
    logout: vi.fn(async () => undefined),
    deleteMe: vi.fn(async () => undefined),
    ...over
  }
  return Object.assign(c, { meResults })
}

function fakeLoopback(
  result: LoopbackResult | 'pending' = { ok: true, code: 'CODE' }
): LoopbackHandle & { cancelled: number; resolve: (r: LoopbackResult) => void } {
  let resolve!: (r: LoopbackResult) => void
  const p = new Promise<LoopbackResult>((r) => (resolve = r))
  if (result !== 'pending') resolve(result)
  const h = {
    port: 5555,
    redirectUri: 'http://127.0.0.1:5555/callback',
    result: p,
    cancelled: 0,
    resolve,
    cancel: () => {
      h.cancelled++
      resolve({ ok: false, reason: 'cancelled' })
    }
  }
  return h
}

function make(o: { config?: AccountConfig; store?: MemStore; client?: AccountClient; lb?: LoopbackHandle; now?: { t: number } } = {}) {
  const now = o.now ?? { t: T0 }
  const states: AccountState[] = []
  const repeaters: Array<() => void> = []
  const opened: string[] = []
  const exported: string[] = []
  const client = o.client ?? fakeClient()
  const store: MemStore = o.store ?? memStore()
  const lb = o.lb ?? fakeLoopback()
  const deps: AccountServiceDeps = {
    config: o.config ?? ON,
    client,
    store,
    now: () => now.t,
    setRepeating: (fn) => {
      repeaters.push(fn)
      return () => undefined
    },
    openExternal: async (u) => void opened.push(u),
    startLoopback: vi.fn(async () => lb),
    saveExport: async (j) => {
      exported.push(j)
      return true
    },
    onState: (s) => states.push(s),
    createPkce: () => ({ verifier: 'VER', challenge: 'CHAL', method: 'S256' }),
    createState: () => 'STATE',
    logoutWaitMs: 50
  }
  const svc = new AccountService(deps)
  return { svc, states, repeaters, opened, exported, client, store, lb, now, deps }
}

const stored = (lastValidation: number | null = T0 - DAY): StoredAccount => ({
  session: { token: 'TOK', email: 'ana@ejemplo.cl', provider: 'email' },
  lastValidation
})

describe('cuenta apagada', () => {
  it('no exige nada, isAllowed=true, no toca la red ni el disco', async () => {
    const { svc, client, store } = make({ config: OFF })
    await svc.start()
    expect(svc.getState().required).toBe(false)
    expect(svc.isAllowed()).toBe(true)
    expect(client.me).not.toHaveBeenCalled()
    expect(store.data).toBeNull()
    await expect(svc.emailStart('a@b.cl')).rejects.toBeInstanceOf(AccountUserError)
    await expect(svc.signInGoogle()).rejects.toBeInstanceOf(AccountUserError)
  })
})

describe('arranque', () => {
  it('sin sesión guardada: signed-out, no permitido', async () => {
    const { svc } = make()
    await svc.start()
    expect(svc.getState()).toMatchObject({ required: true, status: 'signed-out', checking: false })
    expect(svc.isAllowed()).toBe(false)
  })

  it('con sesión guardada: valida con /me, abre y anota la validación', async () => {
    const store = memStore(stored())
    const { svc, client } = make({ store })
    const p = svc.start()
    expect(svc.getState().checking).toBe(true)
    expect(svc.isAllowed()).toBe(false) // aún no se sabe
    await p
    expect(client.me).toHaveBeenCalledWith('TOK')
    expect(svc.getState()).toMatchObject({ status: 'signed-in', email: 'ana@ejemplo.cl', provider: 'email', checking: false })
    expect(svc.isAllowed()).toBe(true)
    expect(store.data?.lastValidation).toBe(T0)
  })

  it('el estado público nunca contiene el token', async () => {
    const { svc, states } = make({ store: memStore(stored()) })
    await svc.start()
    expect(JSON.stringify([svc.getState(), ...states])).not.toContain('TOK')
  })

  it('servidor caído con validación reciente: gracia, y avisa cuándo termina', async () => {
    const store = memStore(stored(T0 - 5 * DAY))
    const client = fakeClient()
    client.meResults.push({ result: { kind: 'unreachable' } })
    const { svc } = make({ store, client })
    await svc.start()
    expect(svc.getState()).toMatchObject({ status: 'grace', graceEndsAt: T0 - 5 * DAY + GRACE_MS })
    expect(svc.isAllowed()).toBe(true)
    expect(store.data?.lastValidation).toBe(T0 - 5 * DAY) // no se renueva sin confirmación
  })

  it('servidor caído con validación de hace >30 días: bloquea y conserva la sesión para reintentar', async () => {
    const store = memStore(stored(T0 - 31 * DAY))
    const client = fakeClient()
    client.meResults.push({ result: { kind: 'unreachable' } })
    const { svc } = make({ store, client })
    await svc.start()
    expect(svc.getState()).toMatchObject({ status: 'offline-blocked', email: 'ana@ejemplo.cl' })
    expect(svc.isAllowed()).toBe(false)
    expect(store.data).not.toBeNull()
  })

  it('401: bloquea al instante y borra la sesión', async () => {
    const store = memStore(stored())
    const client = fakeClient()
    client.meResults.push({ result: { kind: 'http', status: 401 } })
    const { svc } = make({ store, client })
    await svc.start()
    expect(svc.getState()).toMatchObject({ status: 'expired', email: null })
    expect(store.data).toBeNull()
    expect(svc.isAllowed()).toBe(false)
  })

  it.each([404, 410])('%i: cuenta borrada, borra la sesión', async (status) => {
    const store = memStore(stored())
    const client = fakeClient()
    client.meResults.push({ result: { kind: 'http', status } })
    const { svc } = make({ store, client })
    await svc.start()
    expect(svc.getState().status).toBe('deleted')
    expect(store.data).toBeNull()
  })

  it('token rotado por el servidor: se guarda el nuevo', async () => {
    const store = memStore(stored())
    const client = fakeClient()
    client.meResults.push({ result: { kind: 'ok' }, rotatedToken: 'NUEVO' })
    const { svc } = make({ store, client })
    await svc.start()
    expect(store.data?.session.token).toBe('NUEVO')
    await svc.validate()
    expect(client.me).toHaveBeenLastCalledWith('NUEVO')
  })

  it('revalida cada 24 h', async () => {
    const { svc, repeaters, client } = make({ store: memStore(stored()) })
    await svc.start()
    expect(repeaters).toHaveLength(1)
    repeaters[0]()
    await svc.validate()
    expect(client.me).toHaveBeenCalledTimes(2)
    expect(REVALIDATE_MS).toBe(DAY)
  })

  it('bloqueado por falta de red y vuelve el servidor: «Reintentar» abre', async () => {
    const client = fakeClient()
    client.meResults.push({ result: { kind: 'unreachable' } })
    const { svc } = make({ store: memStore(stored(T0 - 40 * DAY)), client })
    await svc.start()
    expect(svc.isAllowed()).toBe(false)
    await svc.validate()
    expect(svc.getState().status).toBe('signed-in')
    expect(svc.isAllowed()).toBe(true)
  })

  it('validaciones simultáneas se deduplican', async () => {
    const { svc, client } = make({ store: memStore(stored()) })
    await svc.start()
    await Promise.all([svc.validate(), svc.validate()])
    expect(client.me).toHaveBeenCalledTimes(2)
  })

  it('una validación que termina tras cerrar sesión se descarta', async () => {
    let release!: (m: MeResult) => void
    const client = fakeClient({ me: () => new Promise<MeResult>((r) => (release = r)) })
    const { svc } = make({ store: memStore(stored()), client })
    const p = svc.start()
    await svc.signOut()
    release({ result: { kind: 'ok' } })
    await p
    expect(svc.getState().status).toBe('signed-out')
    expect(svc.isAllowed()).toBe(false)
  })

  it('sin cifrado del Llavero: avisa memoryOnly', async () => {
    const { svc } = make({ store: memStore(null, true) })
    await svc.start()
    expect(svc.getState().memoryOnly).toBe(true)
  })
})

describe('correo + código', () => {
  it('emailStart valida el correo antes de llamar al servidor y normaliza', async () => {
    const { svc, client } = make()
    await expect(svc.emailStart('no-es-correo')).rejects.toThrow('correo válido')
    expect(client.emailStart).not.toHaveBeenCalled()
    await svc.emailStart('  Ana@Ejemplo.CL ')
    expect(client.emailStart).toHaveBeenCalledWith('ana@ejemplo.cl')
  })

  it('emailStart: límite del servidor (429) → mensaje claro', async () => {
    const client = fakeClient({ emailStart: async () => Promise.reject(new AccountApiError('http', 'x', 429, 'rate_limited', 600)) })
    const { svc } = make({ client })
    await expect(svc.emailStart('a@b.cl')).rejects.toThrow(/Demasiados intentos\. Espera 10 min/)
  })

  it('emailStart: sin red → mensaje de conexión', async () => {
    const client = fakeClient({ emailStart: async () => Promise.reject(new AccountApiError('unreachable', 'x')) })
    const { svc } = make({ client })
    await expect(svc.emailStart('a@b.cl')).rejects.toThrow(/conectar con el servidor/)
  })

  it('emailVerify: valida el código (6 dígitos) antes de la red', async () => {
    const { svc, client } = make()
    await expect(svc.emailVerify('a@b.cl', '12345')).rejects.toThrow('6 dígitos')
    await expect(svc.emailVerify('a@b.cl', '12345a')).rejects.toThrow('6 dígitos')
    expect(client.emailVerify).not.toHaveBeenCalled()
  })

  it('emailVerify correcto: guarda la sesión y entra', async () => {
    const { svc, store, states } = make()
    const s = await svc.emailVerify('ana@ejemplo.cl', '123456')
    expect(s).toMatchObject({ status: 'signed-in', email: 'ana@ejemplo.cl', provider: 'email' })
    expect(store.data).toEqual({ session: { token: 'TOK', email: 'ana@ejemplo.cl', provider: 'email' }, lastValidation: T0 })
    expect(svc.isAllowed()).toBe(true)
    expect(JSON.stringify(states)).not.toContain('TOK')
  })

  it('emailVerify con código malo (401): mensaje claro y no entra', async () => {
    const client = fakeClient({ emailVerify: async () => Promise.reject(new AccountApiError('http', 'x', 401, 'invalid_code')) })
    const { svc, store } = make({ client })
    await expect(svc.emailVerify('a@b.cl', '000000')).rejects.toThrow('incorrecto o ya venció')
    expect(svc.isAllowed()).toBe(false)
    expect(store.data).toBeNull()
  })

  it('servidor caído (5xx) en verify: mensaje de servidor no disponible', async () => {
    const client = fakeClient({ emailVerify: async () => Promise.reject(new AccountApiError('http', 'x', 503)) })
    const { svc } = make({ client })
    await expect(svc.emailVerify('a@b.cl', '123456')).rejects.toThrow('no está disponible')
  })
})

describe('Google (loopback + PKCE)', () => {
  it('flujo completo: loopback → start con challenge → navegador → exchange con verifier', async () => {
    const { svc, client, opened, store, states } = make()
    const s = await svc.signInGoogle()
    expect(client.googleStart).toHaveBeenCalledWith({ redirectUri: 'http://127.0.0.1:5555/callback', state: 'STATE', challenge: 'CHAL' })
    expect(opened).toEqual(['https://accounts.example/auth'])
    expect(client.exchange).toHaveBeenCalledWith({ code: 'CODE', verifier: 'VER', redirectUri: 'http://127.0.0.1:5555/callback' })
    expect(s).toMatchObject({ status: 'signed-in', provider: 'google' })
    expect(store.data?.session.provider).toBe('google')
    expect(states.map((x) => x.status)).toEqual(['signing-in', 'signed-in'])
  })

  it('el verifier nunca se envía en /google/start (solo el challenge)', async () => {
    const { svc, client } = make()
    await svc.signInGoogle()
    expect(JSON.stringify((client.googleStart as ReturnType<typeof vi.fn>).mock.calls)).not.toContain('VER')
  })

  it('no abre URLs que no sean https', async () => {
    const client = fakeClient({ googleStart: async () => ({ authUrl: 'javascript:alert(1)' }) })
    const { svc, opened } = make({ client })
    await expect(svc.signInGoogle()).rejects.toThrow('dirección no válida')
    expect(opened).toEqual([])
    expect(svc.getState().status).toBe('signed-out')
  })

  it('cancelar mientras espera al navegador: vuelve a signed-out sin error y libera el receptor', async () => {
    const lb = fakeLoopback('pending')
    const { svc } = make({ lb })
    const p = svc.signInGoogle()
    await vi.waitFor(() => expect(svc.getState().status).toBe('signing-in'))
    svc.cancel()
    const s = await p
    expect(s.status).toBe('signed-out')
    expect(lb.cancelled).toBeGreaterThan(0)
  })

  it('cancelar durante la petición /google/start: no se abre el navegador', async () => {
    let release!: (v: { authUrl: string }) => void
    const gs = vi.fn(() => new Promise<{ authUrl: string }>((r) => (release = r)))
    const client = fakeClient({ googleStart: gs })
    const lb = fakeLoopback('pending')
    const { svc, opened } = make({ client, lb })
    const p = svc.signInGoogle()
    await vi.waitFor(() => expect(gs).toHaveBeenCalled())
    svc.cancel()
    release({ authUrl: 'https://accounts.example/auth' })
    expect((await p).status).toBe('signed-out')
    expect(opened).toEqual([])
  })

  it('tiempo agotado, usuario que rechaza o respuesta inválida: mensajes claros y vuelve a signed-out', async () => {
    for (const [reason, text] of [
      ['timeout', 'Se agotó el tiempo'],
      ['denied', 'No se completó'],
      ['invalid', 'No se pudo completar']
    ] as const) {
      const { svc } = make({ lb: fakeLoopback({ ok: false, reason }) })
      await expect(svc.signInGoogle()).rejects.toThrow(text)
      expect(svc.getState().status).toBe('signed-out')
    }
  })

  it('exchange rechazado: error claro y sin sesión', async () => {
    const client = fakeClient({ exchange: async () => Promise.reject(new AccountApiError('http', 'x', 401)) })
    const { svc, store } = make({ client })
    await expect(svc.signInGoogle()).rejects.toThrow('No se pudo iniciar sesión con Google')
    expect(store.data).toBeNull()
  })

  it('un segundo intento cancela el receptor del primero', async () => {
    const lb1 = fakeLoopback('pending')
    const lb2 = fakeLoopback({ ok: true, code: 'C2' })
    const lbs = [lb1, lb2]
    const { deps } = make()
    deps.startLoopback = vi.fn(async () => lbs.shift() as LoopbackHandle)
    const svc2 = new AccountService(deps)
    const p1 = svc2.signInGoogle()
    await vi.waitFor(() => expect(deps.startLoopback).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(lb1.port).toBe(5555))
    const p2 = svc2.signInGoogle()
    await p2
    expect(lb1.cancelled).toBeGreaterThan(0)
    await p1
    expect(svc2.getState().status).toBe('signed-in')
  })

  it('el estado público durante la espera es «signing-in»', async () => {
    const lb = fakeLoopback('pending')
    const { svc } = make({ lb })
    const p = svc.signInGoogle()
    await vi.waitFor(() => expect(svc.getState().status).toBe('signing-in'))
    lb.resolve({ ok: true, code: 'X' })
    await p
  })
})

describe('cerrar sesión, borrar y exportar', () => {
  async function loggedIn(over: Partial<AccountClient> = {}) {
    const ctx = make({ store: memStore(stored()), client: fakeClient(over) })
    await ctx.svc.start()
    return ctx
  }

  it('signOut: borra la sesión local, avisa al servidor y bloquea', async () => {
    const { svc, store, client } = await loggedIn()
    const s = await svc.signOut()
    expect(s.status).toBe('signed-out')
    expect(store.data).toBeNull()
    expect(client.logout).toHaveBeenCalledWith('TOK')
    expect(svc.isAllowed()).toBe(false)
  })

  it('signOut sin red: igualmente cierra y no se queda esperando', async () => {
    const { svc, store } = await loggedIn({ logout: () => new Promise(() => undefined) })
    const t = Date.now()
    await svc.signOut()
    expect(Date.now() - t).toBeLessThan(1000)
    expect(store.data).toBeNull()
  })

  it('deleteAccount: DELETE con el token y borra solo la sesión de cuenta', async () => {
    const { svc, store, client } = await loggedIn()
    const s = await svc.deleteAccount()
    expect(client.deleteMe).toHaveBeenCalledWith('TOK')
    expect(s.status).toBe('signed-out')
    expect(store.data).toBeNull()
  })

  it('deleteAccount sin red: no borra nada y avisa', async () => {
    const { svc, store } = await loggedIn({ deleteMe: async () => Promise.reject(new AccountApiError('unreachable', 'x')) })
    await expect(svc.deleteAccount()).rejects.toThrow(/conectar con el servidor/)
    expect(store.data).not.toBeNull()
    expect(svc.isAllowed()).toBe(true)
  })

  it('deleteAccount cuando el servidor dice que ya no existe/vale (401/404/410): limpia igualmente', async () => {
    for (const status of [401, 404, 410]) {
      const { svc, store } = await loggedIn({ deleteMe: async () => Promise.reject(new AccountApiError('http', 'x', status)) })
      await svc.deleteAccount()
      expect(store.data).toBeNull()
    }
  })

  it('sin sesión: borrar y exportar avisan', async () => {
    const { svc } = make()
    await svc.start()
    await expect(svc.deleteAccount()).rejects.toThrow('No hay una sesión')
    await expect(svc.exportData()).rejects.toThrow('No hay una sesión')
  })

  it('exportData: pasa el JSON de /me al diálogo de guardado', async () => {
    const { svc, exported } = await loggedIn()
    expect(await svc.exportData()).toEqual({ saved: true })
    expect(JSON.parse(exported[0])).toEqual({ email: 'ana@ejemplo.cl' })
  })

  it('exportData con error de red: mensaje claro y no se guarda nada', async () => {
    const { svc, exported } = await loggedIn({ exportMe: async () => Promise.reject(new AccountApiError('unreachable', 'x')) })
    await expect(svc.exportData()).rejects.toThrow(/conectar con el servidor/)
    expect(exported).toHaveLength(0)
  })
})

describe('eventos', () => {
  it('solo emite cuando el estado cambia', async () => {
    const { svc, states } = make({ store: memStore(stored()) })
    await svc.start()
    const n = states.length
    await svc.validate()
    expect(states.length).toBe(n)
  })

  it('ServerResult de ejemplo compila con el tipo compartido', () => {
    const r: ServerResult = { kind: 'ok' }
    expect(r.kind).toBe('ok')
  })
})

/**
 * Modo unificado (puente de apps), lado servidor de control: ComputerService REAL + MCP REAL (helper falso). Origen aislado = cabecera con el
 * secreto que main fijó con `setBridgeSecret` (bandera `LAZUNOX_UNIFIED_APPS=1`). Sin eso, todo es como hoy.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { FAKE_HELPER, bundleMcp, startMcp, textOf, tmpWork, type McpProc, type SideChannel } from '../../test/cu-mcp-kit'
import { BRIDGE_ORIGIN_HEADER, BRIDGE_SERVER_HEADER, UNIFIED_APPS_ENV } from '../../shared/unified-bridge'

const h = vi.hoisted(() => ({ dir: '', power: null as unknown as import('node:events').EventEmitter }))

vi.mock('electron', async () => {
  const { EventEmitter: EE } = await import('node:events')
  h.power = new EE()
  return {
    app: { getPath: (n: string) => (n === 'temp' ? join(h.dir, 'tmp') : h.dir), getAppPath: () => join(h.dir, 'app'), isPackaged: false },
    globalShortcut: { register: () => true, unregister: () => undefined },
    powerMonitor: h.power,
    shell: { openExternal: async () => undefined },
    systemPreferences: { isTrustedAccessibilityClient: () => true, getMediaAccessStatus: () => 'granted' }
  }
})

import { ComputerService } from './service'

vi.setConfig({ testTimeout: 30_000 })

const work = tmpWork('lzx-svc-bridge')
let bundle = ''
beforeAll(() => {
  bundle = bundleMcp(work.dir)
})
afterAll(() => work.cleanup())

const SECRET = 'S3cr3to-aleatorio-de-esta-ejecucion-0123456789'
const SERVER_A = '/Users/ana/proyecto-a'
const SERVER_B = '/Users/ana/proyecto-b'
const SES = 'ses_aaaaaaaaaaaaaaaa'
const SES2 = 'ses_bbbbbbbbbbbbbbbb'
const NOTES = 'com.apple.Notes'
const hdr = (secret = SECRET, server = SERVER_A): Record<string, string> => ({
  [BRIDGE_ORIGIN_HEADER]: secret,
  [BRIDGE_SERVER_HEADER]: server
})
const NO_PLAN = /Todavía no hay un plan aprobado/

let svc: ComputerService
let mcp: McpProc
let n = 0
const savedFlag = process.env[UNIFIED_APPS_ENV]

beforeEach(async () => {
  h.dir = mkdtempSync(join(tmpdir(), 'svc-bridge-'))
  process.env[UNIFIED_APPS_ENV] = '1'
  svc = new ComputerService({ platform: 'darwin' })
  svc.init()
  svc.setBridgeSecret(SECRET)
  svc.bridgeSessionProbe = async () => 'live'
  const url = await svc.planGateUrl()
  if (!url) throw new Error('sin canal lateral')
  mcp = await startMcp({
    bundle,
    helper: FAKE_HELPER,
    dir: join(work.dir, `w${++n}`),
    events: { url } as SideChannel,
    env: { COMPUTER_AUTO_SCREENSHOT: '0', COMPUTER_INSTANT: '1' }
  })
})
afterEach(async () => {
  await mcp.stop()
  svc.dispose()
  if (savedFlag === undefined) delete process.env[UNIFIED_APPS_ENV]
  else process.env[UNIFIED_APPS_ENV] = savedFlag
  rmSync(h.dir, { recursive: true, force: true })
})

/** Concede `tier` a Notes solo para esa sesión, por la tarjeta de siempre. */
async function grant(session: string, decision: 'view' | 'click' | 'full' | 'deny', bundleId = NOTES): Promise<void> {
  const cards: Array<{ id: string }> = []
  svc.on('requestAccess', (r) => cards.push(r))
  const p = svc.requestAccess([{ bundleId, name: 'Notes' }], undefined, undefined, session)
  await vi.waitFor(() => expect(cards.length).toBeGreaterThan(0))
  svc.resolveAccessRequest(cards[cards.length - 1].id, [{ bundleId, name: 'Notes', decision }])
  await p
  svc.removeAllListeners('requestAccess')
}

const open = (args: Record<string, unknown>, headers?: Record<string, string>) =>
  mcp.call('open_application', { name: 'Notes', ...args }, headers)
const opened = (): number => mcp.calls().filter((c) => c.cmd === 'open-app' || c.cmd === 'open-app-bg').length

describe('reconocimiento del origen', () => {
  it('sin cabeceras: exige plan, igual que hoy', async () => {
    await grant(SES, 'full')
    const r = await open({ lazunox_session: SES })
    expect(textOf(r)).toMatch(NO_PLAN)
    expect(opened()).toBe(0)
  })

  it('secreto incorrecto, vacío, más largo o con el mismo prefijo: respuesta idéntica a «sin cabeceras» (no se filtra nada)', async () => {
    await grant(SES, 'full')
    const base = textOf(await open({ lazunox_session: SES }))
    for (const bad of ['otro', SECRET.slice(0, -1), SECRET + 'x', SECRET.toUpperCase(), 'x'.repeat(600)]) {
      const r = await open({ lazunox_session: SES }, hdr(bad))
      expect(r.isError).toBe(true)
      expect(textOf(r)).toBe(base)
    }
    expect(opened()).toBe(0)
  })

  it('bandera apagada (aunque el secreto sea el bueno): como hoy', async () => {
    await grant(SES, 'full')
    process.env[UNIFIED_APPS_ENV] = '0'
    const r = await open({ lazunox_session: SES }, hdr())
    expect(textOf(r)).toMatch(NO_PLAN)
    process.env[UNIFIED_APPS_ENV] = '0'
    expect(textOf(await open({ lazunox_session: SES }, hdr()))).toMatch(NO_PLAN)
    expect(opened()).toBe(0)
  })

  it('sin secreto fijado en main (o quitado): nadie es origen aislado', async () => {
    await grant(SES, 'full')
    svc.setBridgeSecret(null)
    expect(textOf(await open({ lazunox_session: SES }, hdr()))).toMatch(NO_PLAN)
    expect(textOf(await open({ lazunox_session: SES }, hdr('')))).toMatch(NO_PLAN)
    expect(opened()).toBe(0)
  })

  it('checkBridgeCall: sin bandera o con secreto ajeno ⇒ isolated false', () => {
    expect(svc.checkBridgeCall({ origin: SECRET, server: SERVER_A, session: SES })).toEqual({ isolated: true, ok: true })
    expect(svc.checkBridgeCall({ origin: 'x', server: SERVER_A, session: SES })).toEqual({ isolated: false })
    expect(svc.checkBridgeCall({ origin: undefined, server: SERVER_A, session: SES })).toEqual({ isolated: false })
    expect(svc.checkBridgeCall({ origin: 42, server: SERVER_A, session: SES })).toEqual({ isolated: false })
    process.env[UNIFIED_APPS_ENV] = '0'
    expect(svc.checkBridgeCall({ origin: SECRET, server: SERVER_A, session: SES })).toEqual({ isolated: false })
  })
})

describe('origen aislado: sesión', () => {
  it('con sesión y concesión suficiente pasa SIN plan', async () => {
    await grant(SES, 'view')
    const r = await open({ lazunox_session: SES }, hdr())
    expect(r.isError).not.toBe(true)
    expect(textOf(r)).toContain('Abierta Notes')
    expect(opened()).toBe(1)
  })

  it.each([
    ['ausente', undefined],
    ['vacía', ''],
    ['mal formada', 'ses con espacios/..'],
    ['demasiado larga', 'a'.repeat(201)],
    ['no es texto', 42]
  ])('sesión %s ⇒ rechazo (aunque otra sesión tenga plan aprobado y concesiones)', async (_n, session) => {
    await grant(SES, 'full')
    svc.approvePlanFor(SES2) // el respaldo global de hoy dejaría pasar una llamada sin sesión
    const r = await open(session === undefined ? {} : { lazunox_session: session }, hdr())
    expect(r.isError).toBe(true)
    expect(textOf(r)).toContain('no trae una sesión válida')
    expect(textOf(r)).not.toContain(SECRET)
    expect(opened()).toBe(0)
  })

  it('sesión de OTRO servidor ⇒ rechazo; la primera reclamación gana y sigue funcionando', async () => {
    await grant(SES, 'full')
    expect((await open({ lazunox_session: SES }, hdr(SECRET, SERVER_A))).isError).not.toBe(true)
    const r = await open({ lazunox_session: SES }, hdr(SECRET, SERVER_B))
    expect(r.isError).toBe(true)
    expect(textOf(r)).toContain('no corresponde a este servidor')
    expect(textOf(r)).not.toContain(SERVER_A)
    expect((await open({ lazunox_session: SES }, hdr(SECRET, SERVER_A))).isError).not.toBe(true)
    expect(opened()).toBe(2)
  })

  it('servidor ausente o absurdo ⇒ rechazo', async () => {
    await grant(SES, 'full')
    const r = await open({ lazunox_session: SES }, { [BRIDGE_ORIGIN_HEADER]: SECRET })
    expect(textOf(r)).toContain('No se pudo identificar el servidor')
    expect(opened()).toBe(0)
  })

  it('una sesión que ya actuó con plan aprobado (servidor sin aislar) no se puede reclamar', async () => {
    await grant(SES, 'full')
    svc.approvePlanFor(SES)
    const r = await open({ lazunox_session: SES }, hdr())
    expect(textOf(r)).toContain('no corresponde a este servidor')
    expect(opened()).toBe(0)
  })

  it('archivar la tarea (revokePlan) libera la sesión para otro servidor', async () => {
    await grant(SES, 'full')
    await open({ lazunox_session: SES }, hdr(SECRET, SERVER_A))
    svc.revokePlan(SES)
    await grant(SES, 'full')
    expect((await open({ lazunox_session: SES }, hdr(SECRET, SERVER_B))).isError).not.toBe(true)
  })
})

describe('origen aislado: concesión por app', () => {
  it('sin concesión ⇒ rechazo y NO abre la app', async () => {
    const r = await open({ lazunox_session: SES }, hdr())
    expect(r.isError).toBe(true)
    expect(textOf(r)).toContain('no tiene acceso concedido')
    expect(opened()).toBe(0)
  })

  it('app bloqueada para esta sesión («Denegar») ⇒ rechazo aunque antes tuviera concesión', async () => {
    await grant(SES, 'full')
    await grant(SES, 'deny')
    const r = await open({ lazunox_session: SES }, hdr())
    expect(r.isError).toBe(true)
    expect(opened()).toBe(0)
  })

  it('app bloqueada de seguridad ⇒ rechazo', async () => {
    const dir = join(work.dir, 'blk')
    const m = await startMcp({
      bundle,
      helper: FAKE_HELPER,
      dir,
      events: { url: (await svc.planGateUrl()) as string } as SideChannel,
      script: { responses: { 'resolve-app': { out: { name: '1Password', bundleId: 'com.1password.1password', found: true } } } },
      env: { COMPUTER_AUTO_SCREENSHOT: '0', COMPUTER_INSTANT: '1' }
    })
    try {
      const r = await m.call('open_application', { name: '1Password', lazunox_session: SES }, hdr())
      expect(r.isError).toBe(true)
      expect(m.calls().some((c) => c.cmd === 'open-app')).toBe(false)
    } finally {
      await m.stop()
    }
  })

  it('nivel insuficiente: solo ver intenta pulsar ⇒ rechazo, el helper no pulsa', async () => {
    await grant(SES, 'view')
    const r = await mcp.call('app_press', { app: 'Notes', ref: 'w0.1', lazunox_session: SES }, hdr())
    expect(r.isError).toBe(true)
    expect(textOf(r)).toContain('solo tiene el nivel')
    expect(mcp.calls().some((c) => c.cmd === 'ax-press')).toBe(false)
  })

  it('la concesión de una sesión no vale para otra sesión del mismo servidor', async () => {
    await grant(SES, 'full')
    const r = await open({ lazunox_session: SES2 }, hdr())
    expect(r.isError).toBe(true)
    expect(textOf(r)).toContain('no tiene acceso concedido')
  })

  it('request_access sigue abriendo la tarjeta por app, sin plan', async () => {
    const cards: Array<{ id: string; plan?: unknown; sessionId?: string; apps: Array<{ bundleId: string }> }> = []
    svc.on('requestAccess', (r) => cards.push(r))
    const p = mcp.call('request_access', { apps: ['Notes'], levels: ['click'], plan: ['no vale'], lazunox_session: SES }, hdr())
    await vi.waitFor(() => expect(cards).toHaveLength(1))
    expect(cards[0].plan).toBeUndefined()
    expect(cards[0].sessionId).toBe(SES)
    svc.resolveAccessRequest(cards[0].id, [{ bundleId: cards[0].apps[0].bundleId, name: 'Notes', decision: 'click' }])
    expect(textOf(await p)).toContain('Notes: Ver y clic')
    // El plan no se aprobó: sin cabecera sigue sin poder actuar.
    expect(svc.isPlanApproved(SES)).toBe(false)
  })
})

describe('Detener revoca todo', () => {
  it('parado: nada pasa; al reanudar la concesión y la sesión reclamada ya no existen', async () => {
    await grant(SES, 'full')
    expect((await open({ lazunox_session: SES }, hdr(SECRET, SERVER_A))).isError).not.toBe(true)
    await svc.stop('prueba')
    await new Promise((r) => setTimeout(r, 300)) // caché del kill-switch (200 ms)
    const stopped = await open({ lazunox_session: SES }, hdr())
    expect(textOf(stopped)).toContain('Control detenido')
    svc.resume()
    await new Promise((r) => setTimeout(r, 300)) // caché del kill-switch (200 ms)
    // La sesión se liberó con Detener: otro servidor puede reclamarla (aquí el B, y sin concesión sigue sin pasar).
    const after = await open({ lazunox_session: SES }, hdr(SECRET, SERVER_B))
    expect(after.isError).toBe(true)
    expect(textOf(after)).toContain('no tiene acceso concedido')
    await grant(SES, 'full')
    expect((await open({ lazunox_session: SES }, hdr(SECRET, SERVER_B))).isError).not.toBe(true)
  })
})

describe('telemetría', () => {
  it('cada rechazo deja una línea de registro sin secretos ni la clave del servidor', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      await open({}, hdr()) // sin sesión
      await open({ lazunox_session: SES }, hdr()) // sin concesión
      await vi.waitFor(() =>
        expect(warn.mock.calls.filter((c) => String(c[0]).includes('puente de apps')).length).toBeGreaterThanOrEqual(2)
      )
      const lines = warn.mock.calls.map((c) => c.map(String).join(' ')).join('\n')
      expect(lines).toContain('bad-session')
      expect(lines).toContain('no-grant')
      expect(lines).not.toContain(SECRET)
      expect(lines).not.toContain(SERVER_A)
    } finally {
      warn.mockRestore()
    }
  })
})

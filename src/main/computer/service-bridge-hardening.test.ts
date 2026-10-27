/**
 * Modo unificado (puente de apps), endurecimiento tras la revisión de seguridad: ComputerService REAL + MCP REAL (helper falso).
 * H1 apps exentas del sistema, H2 concesiones solo de sesión, H4 «primera reclamación gana», H5 app no identificada, H6 máscara en capturas,
 * y el modo «Control de la pantalla» que no le da el ratón al agente aislado. Todo lo de aquí abajo es SOLO para el origen aislado: los casos
 * «control» comprueban que sin origen aislado nada cambia.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { FAKE_HELPER, bundleMcp, startMcp, textOf, tmpWork, type McpProc, type SideChannel } from '../../test/cu-mcp-kit'
import { BRIDGE_ORIGIN_HEADER, BRIDGE_SERVER_HEADER, UNIFIED_APPS_ENV } from '../../shared/unified-bridge'
import { APP_ID } from '../../shared/brand'

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

const work = tmpWork('lzx-svc-bridge-hard')
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
const SAFARI = 'com.apple.Safari'
const hdr = (server = SERVER_A): Record<string, string> => ({ [BRIDGE_ORIGIN_HEADER]: SECRET, [BRIDGE_SERVER_HEADER]: server })

let svc: ComputerService
let url = ''
const mcps: McpProc[] = []
let n = 0
const savedFlag = process.env[UNIFIED_APPS_ENV]

/** MCP real contra `svc`; `app` fija lo que devuelve `resolve-app` (cualquier nombre ⇒ esa app) y `front` la app en primer plano. */
async function mcpFor(
  app?: { name: string; bundleId: string },
  front?: { name: string; bundleId: string },
  running?: Array<{ name: string; bundleId: string }>
): Promise<McpProc> {
  const responses: Record<string, unknown> = {}
  if (running) responses['running-apps'] = { out: running }
  if (app) responses['resolve-app'] = { out: { ...app, found: true } }
  if (front) {
    responses.frontmost = { out: { ...front, pid: 100 } }
    responses['app-at'] = { out: { ...front, pid: 100 } }
  }
  const m = await startMcp({
    bundle,
    helper: FAKE_HELPER,
    dir: join(work.dir, `w${++n}`),
    events: { url } as SideChannel,
    script: { responses },
    env: { COMPUTER_AUTO_SCREENSHOT: '0', COMPUTER_INSTANT: '1' }
  })
  mcps.push(m)
  return m
}

beforeEach(async () => {
  h.dir = mkdtempSync(join(tmpdir(), 'svc-bridge-hard-'))
  process.env[UNIFIED_APPS_ENV] = '1'
  svc = new ComputerService({ platform: 'darwin' })
  svc.init()
  svc.setBridgeSecret(SECRET)
  url = (await svc.planGateUrl()) as string
})
afterEach(async () => {
  for (const m of mcps.splice(0)) await m.stop()
  svc.dispose()
  if (savedFlag === undefined) delete process.env[UNIFIED_APPS_ENV]
  else process.env[UNIFIED_APPS_ENV] = savedFlag
  rmSync(h.dir, { recursive: true, force: true })
})

/** Concede `decision` a la app solo para esa sesión, por la tarjeta de siempre. */
async function grant(session: string, decision: 'view' | 'click' | 'full' | 'deny', bundleId: string, name = 'App'): Promise<void> {
  const cards: Array<{ id: string }> = []
  svc.on('requestAccess', (r) => cards.push(r))
  const p = svc.requestAccess([{ bundleId, name }], undefined, undefined, session)
  await vi.waitFor(() => expect(cards.length).toBeGreaterThan(0))
  svc.resolveAccessRequest(cards[cards.length - 1].id, [{ bundleId, name, decision }])
  await p
  svc.removeAllListeners('requestAccess')
}

const tierUrl = (bundleId: string, session: string, isolated: boolean): string =>
  `${url}/tier?bundleId=${encodeURIComponent(bundleId)}&name=${encodeURIComponent(bundleId)}&session=${session}${isolated ? '&isolated=1' : ''}`
const tierOf = async (bundleId: string, session: string, isolated: boolean): Promise<unknown> =>
  ((await (await fetch(tierUrl(bundleId, session, isolated))).json()) as { tier: unknown }).tier
const axCalls = (m: McpProc): string[] =>
  m
    .calls()
    .map((c) => c.cmd)
    .filter((c) => c !== 'resolve-app' && c !== 'frontmost')

describe('H1: las apps exentas del sistema nunca se actúan desde el origen aislado', () => {
  const EXEMPT: Array<[string, string]> = [
    [APP_ID, 'Lazunox'],
    ['com.github.Electron', 'Electron'],
    ['com.apple.Spotlight', 'Spotlight'],
    ['com.apple.dock', 'Dock']
  ]
  const TOOLS: Array<[string, Record<string, unknown>]> = [
    ['app_tree', {}],
    ['app_find', {}],
    ['app_press', { ref: 'w0.1' }],
    ['app_set_value', { ref: 'w0.1', value: 'x' }],
    ['app_screenshot', {}]
  ]

  it.each(EXEMPT)(
    '%s: app_tree/app_find/app_press/app_set_value/app_screenshot ⇒ rechazo, el helper no toca nada',
    async (bundleId, name) => {
      // Aunque la sesión tenga una concesión de sesión (tarjeta) sobre ella, y sin importar el tier pedido.
      await grant(SES, 'full', bundleId, name)
      const m = await mcpFor({ name, bundleId })
      for (const [tool, extra] of TOOLS) {
        const r = await m.call(tool, { app: name, lazunox_session: SES, ...extra }, hdr())
        expect(r.isError, `${tool} sobre ${bundleId}`).toBe(true)
        expect(textOf(r)).toContain('no se puede controlar')
      }
      expect(axCalls(m)).toEqual([])
    }
  )

  it('open_application y request_access sobre ellas tampoco las concede (la tarjeta ni se abre)', async () => {
    const cards: unknown[] = []
    svc.on('requestAccess', (r) => cards.push(r))
    const m = await mcpFor({ name: 'Lazunox', bundleId: APP_ID })
    const open = await m.call('open_application', { name: 'Lazunox', lazunox_session: SES }, hdr())
    expect(open.isError).toBe(true)
    const ask = await m.call('request_access', { apps: ['Lazunox'], levels: ['full'], lazunox_session: SES }, hdr())
    expect(cards).toHaveLength(0)
    expect(textOf(ask)).not.toMatch(/Control total/)
    expect(m.calls().some((c) => c.cmd === 'open-app')).toBe(false)
  })

  it('el servidor lo decide también: /tier?isolated=1 da null para cada exenta, con o sin concesión de sesión', async () => {
    await grant(SES, 'full', APP_ID, 'Lazunox')
    svc.checkBridgeCall({ origin: SECRET, server: SERVER_A, session: SES })
    for (const [bundleId] of EXEMPT) {
      expect(await tierOf(bundleId, SES, true), bundleId).toBeNull()
      // Una sesión ya reclamada por un servidor aislado cuenta como aislada aunque la petición no lo diga.
      expect(await tierOf(bundleId, SES, false), bundleId).toBeNull()
    }
  })

  it('CONTROL: sin origen aislado (Control total) las exentas siguen siendo «full» sin tarjeta', async () => {
    for (const [bundleId] of EXEMPT) expect(await tierOf(bundleId, SES2, false), bundleId).toBe('full')
    const m = await mcpFor({ name: 'Lazunox', bundleId: APP_ID })
    svc.approvePlanFor(SES2)
    const r = await m.call('app_tree', { app: 'Lazunox', lazunox_session: SES2 })
    expect(r.isError).not.toBe(true)
  })
})

describe('H2: el origen aislado solo cuenta concesiones de SESIÓN', () => {
  const tree = (m: McpProc, session = SES): ReturnType<McpProc['call']> =>
    m.call('app_tree', { app: 'Safari', lazunox_session: session }, hdr())

  it('Safari sin tarjeta ⇒ rechazo (no hay «Solo ver» automático por categoría)', async () => {
    const m = await mcpFor({ name: 'Safari', bundleId: SAFARI })
    const r = await tree(m)
    expect(r.isError).toBe(true)
    expect(textOf(r)).toContain('no tiene acceso concedido')
    expect(axCalls(m)).toEqual([])
    expect(await tierOf(SAFARI, SES, true)).toBeNull()
  })

  it('Terminal (categoría «Ver y clic») tampoco se autoasigna', async () => {
    expect(await tierOf('com.apple.Terminal', SES, true)).toBeNull()
    expect(await tierOf('com.apple.Terminal', SES2, false)).toBe('click') // CONTROL: Control total sí
  })

  it('con una concesión «siempre» preexistente de Control total ⇒ rechazo (no se hereda)', async () => {
    svc.grants.grant(SAFARI, 'Safari', 'full')
    const m = await mcpFor({ name: 'Safari', bundleId: SAFARI })
    const r = await tree(m)
    expect(r.isError).toBe(true)
    expect(textOf(r)).toContain('no tiene acceso concedido')
    expect(axCalls(m)).toEqual([])
    // CONTROL: sin origen aislado esa misma concesión sí vale.
    svc.approvePlanFor(SES2)
    expect((await m.call('app_tree', { app: 'Safari', lazunox_session: SES2 })).isError).not.toBe(true)
  })

  it('Safari sin concesión: Control total sigue teniendo «Solo ver» automático (control)', async () => {
    expect(await tierOf(SAFARI, SES2, false)).toBe('view')
  })

  it('con concesión de SESIÓN (tarjeta) ⇒ pasa; esa concesión no vale para otra sesión', async () => {
    await grant(SES, 'view', SAFARI, 'Safari')
    const m = await mcpFor({ name: 'Safari', bundleId: SAFARI })
    expect((await tree(m)).isError).not.toBe(true)
    expect((await tree(m, SES2)).isError).toBe(true)
  })

  it('una tarjeta con «siempre» desde el origen aislado no sube más de lo pedido por una concesión guardada previa', async () => {
    svc.grants.grant(SAFARI, 'Safari', 'full')
    const m = await mcpFor({ name: 'Safari', bundleId: SAFARI })
    await m.call('app_tree', { app: 'Safari', lazunox_session: SES }, hdr()) // reclama la sesión
    await grant(SES, 'view', SAFARI, 'Safari')
    expect(await tierOf(SAFARI, SES, true)).toBe('view') // no «full» heredado
  })

  it('«siempre» desde una tarjeta aislada además la deja como concesión de sesión (si no, el agente se quedaría sin acceso)', async () => {
    svc.checkBridgeCall({ origin: SECRET, server: SERVER_A, session: SES })
    const cards: Array<{ id: string }> = []
    svc.on('requestAccess', (r) => cards.push(r))
    const p = svc.requestAccess([{ bundleId: SAFARI, name: 'Safari' }], undefined, undefined, SES)
    await vi.waitFor(() => expect(cards).toHaveLength(1))
    svc.resolveAccessRequest(cards[0].id, [{ bundleId: SAFARI, name: 'Safari', decision: 'click' }], { scope: 'always' })
    await p
    expect(await tierOf(SAFARI, SES, true)).toBe('click')
  })

  it('el bloqueo fijo, «Denegar» guardado y «No» de la sesión siguen mandando', async () => {
    await grant(SES, 'full', SAFARI, 'Safari')
    svc.checkBridgeCall({ origin: SECRET, server: SERVER_A, session: SES })
    svc.grants.deny(SAFARI, 'Safari')
    expect(await tierOf(SAFARI, SES, true)).toBeNull()
    svc.grants.undeny(SAFARI)
    expect(await tierOf(SAFARI, SES, true)).toBe('full')
    await grant(SES, 'deny', SAFARI, 'Safari')
    expect(await tierOf(SAFARI, SES, true)).toBeNull()
    expect(await tierOf('com.1password.1password', SES, true)).toBeNull()
  })

  describe('Modo Automático («Solo ver» sin tarjeta, solo lista permitida)', () => {
    it('solo cuenta si pasa por request_access: queda como concesión de SESIÓN del propio servidor', async () => {
      svc.autoAccess = async () => ({ approve: true, recordId: 'r1' })
      const m = await mcpFor({ name: 'Safari', bundleId: SAFARI })
      const r = await m.call('request_access', { apps: ['Safari'], levels: ['view'], lazunox_session: SES }, hdr())
      expect(textOf(r)).toContain('modo auto')
      expect(await tierOf(SAFARI, SES, true)).toBe('view')
      expect((await tree(m)).isError).not.toBe(true)
      expect((await tree(m, SES2)).isError).toBe(true)
    })

    it('un «Solo ver» efímero concedido fuera de request_access (otra vía) no cuenta para el origen aislado', async () => {
      const NOTES = 'com.apple.Notes'
      svc.checkBridgeCall({ origin: SECRET, server: SERVER_A, session: SES })
      svc.grantAutoView(SES, [NOTES])
      expect(await tierOf(NOTES, SES, true)).toBeNull()
      // CONTROL: en una sesión sin origen aislado ese mismo «Solo ver» efímero sí vale, como siempre.
      svc.grantAutoView(SES2, [NOTES])
      expect(await tierOf(NOTES, SES2, false)).toBe('view')
    })
  })
})

describe('H4: una sesión pertenece al primer servidor que la reclama (riesgo residual documentado)', () => {
  it('fija el comportamiento actual: quien reclama primero se la queda, aunque no sea quien la creó', () => {
    expect(svc.checkBridgeCall({ origin: SECRET, server: SERVER_B, session: SES })).toEqual({ isolated: true, ok: true })
    expect(svc.checkBridgeCall({ origin: SECRET, server: SERVER_A, session: SES })).toMatchObject({ ok: false, reason: 'foreign-session' })
    expect(svc.checkBridgeCall({ origin: SECRET, server: SERVER_B, session: SES })).toEqual({ isolated: true, ok: true })
  })
})

describe('validación de origen y sesión en checkBridgeCall', () => {
  it.each([['../x'], ['a/b'], ['x'.repeat(201)], [''], ['ses con espacio'], ['ses\n']])('sesión %j ⇒ rechazo bad-session', (session) => {
    expect(svc.checkBridgeCall({ origin: SECRET, server: SERVER_A, session })).toMatchObject({
      isolated: true,
      ok: false,
      reason: 'bad-session'
    })
  })
  it('una sesión de exactamente 200 caracteres válidos sí vale', () => {
    expect(svc.checkBridgeCall({ origin: SECRET, server: SERVER_A, session: 'a'.repeat(200) })).toEqual({ isolated: true, ok: true })
  })
  it('origen de más de 512 caracteres ⇒ nunca es origen aislado (aunque fuera el secreto)', () => {
    const big = 'k'.repeat(513)
    svc.setBridgeSecret(big)
    expect(svc.checkBridgeCall({ origin: big, server: SERVER_A, session: SES })).toEqual({ isolated: false })
    const ok = 'k'.repeat(512)
    svc.setBridgeSecret(ok)
    expect(svc.checkBridgeCall({ origin: ok, server: SERVER_A, session: SES })).toEqual({ isolated: true, ok: true })
  })
})

describe('«Control de la pantalla» (modo full) no le da el ratón al agente aislado', () => {
  it('con la preferencia en «full», left_click sin request_full_control ⇒ rechazo y el helper no pulsa', async () => {
    svc.prefs.set({ mode: 'full' })
    await grant(SES, 'click', 'com.apple.Notes', 'Notes')
    const m = await mcpFor()
    const r = await m.call('left_click', { x: 10, y: 10, lazunox_session: SES }, hdr())
    expect(r.isError).toBe(true)
    expect(textOf(r)).toContain('request_full_control')
    expect(m.calls().some((c) => c.cmd === 'click')).toBe(false)
  })

  it('tras un request_full_control aprobado de ESA sesión sí pasa (la puerta es esa, no otra)', async () => {
    svc.prefs.set({ mode: 'full' })
    await grant(SES, 'click', 'com.apple.Notes', 'Notes')
    const m = await mcpFor()
    ;(svc as unknown as { foregroundSessions: Set<string> }).foregroundSessions.add(SES)
    const r = await m.call('left_click', { x: 10, y: 10, lazunox_session: SES }, hdr())
    expect(r.isError).not.toBe(true)
    expect(m.calls().some((c) => c.cmd === 'click')).toBe(true)
    // Otra sesión del mismo servidor no hereda ese control.
    expect((await m.call('left_click', { x: 10, y: 10, lazunox_session: SES2 }, hdr())).isError).toBe(true)
  })

  it('CONTROL: sin origen aislado, con la preferencia en «full» y plan aprobado, el clic pasa como siempre', async () => {
    svc.prefs.set({ mode: 'full' })
    svc.grants.grant('com.apple.Notes', 'Notes', 'click')
    svc.approvePlanFor(SES2)
    const m = await mcpFor()
    const r = await m.call('left_click', { x: 10, y: 10, lazunox_session: SES2 })
    expect(r.isError).not.toBe(true)
    expect(m.calls().some((c) => c.cmd === 'click')).toBe(true)
  })
})

describe('H5: app de destino no identificada ⇒ falla cerrado solo en origen aislado', () => {
  const unknown = { name: '', bundleId: '' }
  it('origen aislado: sin ninguna app identificada no se pulsa', async () => {
    await grant(SES, 'click', 'com.apple.Notes', 'Notes')
    ;(svc as unknown as { foregroundSessions: Set<string> }).foregroundSessions.add(SES)
    const m = await mcpFor(undefined, unknown)
    const r = await m.call('left_click', { x: 10, y: 10, lazunox_session: SES }, hdr())
    expect(r.isError).toBe(true)
    expect(textOf(r)).toContain('No se pudo identificar')
    expect(m.calls().some((c) => c.cmd === 'click')).toBe(false)
  })

  it('CONTROL: sin origen aislado (macOS) una app sin identificar sigue sin bloquear', async () => {
    svc.prefs.set({ mode: 'full' })
    svc.approvePlanFor(SES2)
    const m = await mcpFor(undefined, unknown)
    const r = await m.call('left_click', { x: 10, y: 10, lazunox_session: SES2 })
    expect(r.isError).not.toBe(true)
    expect(m.calls().some((c) => c.cmd === 'click')).toBe(true)
  })
})

describe('H6: la captura completa se rechaza en origen aislado y sigue igual sin él', () => {
  const RUNNING = [
    { name: 'Lazunox', bundleId: APP_ID },
    { name: 'Spotlight', bundleId: 'com.apple.Spotlight' },
    { name: 'Dock', bundleId: 'com.apple.dock' },
    { name: 'Notes', bundleId: 'com.apple.Notes' }
  ]
  const excluded = (m: McpProc): string[] =>
    m
      .calls()
      .filter((c) => c.cmd === 'screenshot-sck')
      .flatMap((c) => (c.args[1] ?? '').split(','))

  it('origen aislado: la captura de pantalla completa se RECHAZA (no se hace ninguna captura; la máscara queda como defensa en profundidad)', async () => {
    await grant(SES, 'view', 'com.apple.Notes', 'Notes')
    const m = await mcpFor(undefined, undefined, RUNNING)
    svc.checkBridgeCall({ origin: SECRET, server: SERVER_A, session: SES })
    const r = await m.call('screenshot', { lazunox_session: SES }, hdr())
    expect(r.isError).toBe(true)
    expect(r.content.some((c) => c.type === 'image')).toBe(false)
    expect(m.calls().filter((c) => c.cmd === 'screenshot-sck')).toEqual([])
  })

  it('CONTROL: sin origen aislado esas apps siguen visibles (como hoy)', async () => {
    svc.approvePlanFor(SES2)
    const m = await mcpFor(undefined, undefined, RUNNING)
    const r = await m.call('screenshot', { lazunox_session: SES2 })
    expect(r.isError).not.toBe(true)
    const ex = excluded(m)
    expect(ex).not.toContain(APP_ID)
    expect(ex).not.toContain('com.apple.Spotlight')
  })
})

/**
 * Modo unificado (puente de apps), 2ª ronda de la revisión de seguridad: ComputerService REAL + MCP REAL (helper falso).
 * F1 teclas (una combinación, lista cerrada, `paste_key` fijo, app en primer plano re-comprobada justo antes de pulsar),
 * F2 `request_full_control` con la preferencia en «full» (tarjeta real), F3 capturas que fallan cerradas y Finder tapado,
 * F4 «siempre» no deja concesión guardada, F5 ayudantes de Lazunox exentos, y las pruebas de mutación de `|| isolatedCall`.
 * Todo es SOLO para el origen aislado: los casos «CONTROL» comprueban que sin él nada cambia.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
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
// El ayudante falso de estas pruebas es un script sh (POSIX); en Windows no se puede ejecutar (spawn EFTYPE). Windows se cubrió en el PC real.
import { posixOnly } from '../../test/platform'

vi.setConfig({ testTimeout: 30_000 })

const work = tmpWork('lzx-svc-bridge-r2')
let bundle = ''
beforeAll(() => {
  bundle = bundleMcp(work.dir)
})
afterAll(() => work.cleanup())

const SECRET = 'S3cr3to-aleatorio-de-esta-ejecucion-0123456789'
const SERVER_A = '/Users/ana/proyecto-a'
const SES = 'ses_aaaaaaaaaaaaaaaa'
const SES2 = 'ses_bbbbbbbbbbbbbbbb'
const NOTES = { name: 'Notes', bundleId: 'com.apple.Notes' }
const hdr = (server = SERVER_A): Record<string, string> => ({ [BRIDGE_ORIGIN_HEADER]: SECRET, [BRIDGE_SERVER_HEADER]: server })

let svc: ComputerService
let url = ''
const mcps: McpProc[] = []
let n = 0
const savedFlag = process.env[UNIFIED_APPS_ENV]

type AppLike = { name: string; bundleId: string }

/** MCP real contra `svc`. `front` puede ser una LISTA: cada llamada a `frontmost` consume una (la última se repite). */
async function mcpFor(
  opts: { app?: AppLike; front?: AppLike | AppLike[]; at?: AppLike; running?: AppLike[]; script?: Record<string, unknown> } = {}
): Promise<McpProc> {
  // Ventana de 400x300 pt en la pantalla principal (la captura por defecto del helper falso mide 800x600 = 2 x marco: así se puede ubicar).
  const responses: Record<string, unknown> = {
    'windows-of': { out: [{ title: 'Ventana', x: 100, y: 100, width: 400, height: 300 }] },
    ...(opts.script ?? {})
  }
  if (opts.running) responses['running-apps'] = { out: opts.running }
  if (opts.app) responses['resolve-app'] = { out: { ...opts.app, found: true } }
  if (opts.front) {
    responses.frontmost = Array.isArray(opts.front)
      ? opts.front.map((f) => ({ out: { ...f, pid: 100 } }))
      : { out: { ...opts.front, pid: 100 } }
    if (!opts.at) responses['app-at'] = { out: { ...(Array.isArray(opts.front) ? opts.front[0] : opts.front), pid: 100 } }
  }
  if (opts.at) responses['app-at'] = { out: { ...opts.at, pid: 100 } }
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
  h.dir = mkdtempSync(join(tmpdir(), 'svc-bridge-r2-'))
  process.env[UNIFIED_APPS_ENV] = '1'
  svc = new ComputerService({ platform: 'darwin' })
  svc.init()
  svc.setBridgeSecret(SECRET)
  svc.bridgeSessionProbe = async () => 'live'
  url = (await svc.planGateUrl()) as string
})
afterEach(async () => {
  for (const m of mcps.splice(0)) await m.stop()
  svc.dispose()
  if (savedFlag === undefined) delete process.env[UNIFIED_APPS_ENV]
  else process.env[UNIFIED_APPS_ENV] = savedFlag
  rmSync(h.dir, { recursive: true, force: true })
})

/** Concede `decision` a la app solo para esa sesión, por la tarjeta de siempre (`scope` «always» si se pide). */
async function grant(
  session: string,
  decision: 'view' | 'click' | 'full',
  bundleId: string,
  name = 'App',
  scope?: 'always'
): Promise<void> {
  const cards: Array<{ id: string }> = []
  svc.on('requestAccess', (r) => cards.push(r))
  const p = svc.requestAccess([{ bundleId, name }], undefined, undefined, session)
  await vi.waitFor(() => expect(cards.length).toBeGreaterThan(0))
  svc.resolveAccessRequest(cards[cards.length - 1].id, [{ bundleId, name, decision }], scope ? { scope } : {})
  await p
  svc.removeAllListeners('requestAccess')
}

/** Reclama la sesión y la deja con el ratón y el teclado (como tras una tarjeta de takeover aprobada). */
function giveControl(session: string): void {
  svc.checkBridgeCall({ origin: SECRET, server: SERVER_A, session })
  ;(svc as unknown as { foregroundSessions: Set<string> }).foregroundSessions.add(session)
}

/** Origen aislado: captura la ventana de la app (sin ella el clic con x/y no tiene dónde caer: falla cerrado). */
async function snap(m: McpProc, session: string, app = 'Notes'): Promise<void> {
  const r = await m.call('app_screenshot', { app, lazunox_session: session }, hdr())
  expect(r.isError, textOf(r)).not.toBe(true)
}

const clickCalls = (m: McpProc): string[][] =>
  m
    .calls()
    .filter((c) => c.cmd === 'click')
    .map((c) => c.args)

const keyCalls = (m: McpProc): string[][] =>
  m
    .calls()
    .filter((c) => c.cmd === 'key')
    .map((c) => c.args)

describe.skipIf(!posixOnly)('F1: key en origen aislado', () => {
  async function ready(front: AppLike | AppLike[] = NOTES): Promise<McpProc> {
    await grant(SES, 'full', NOTES.bundleId, 'Notes')
    giveControl(SES)
    return mcpFor({ front })
  }

  it('cmd+tab (hacia Lazunox) ⇒ rechazo y NO se pulsa nada', async () => {
    const m = await ready()
    const r = await m.call('key', { keys: 'cmd+tab', lazunox_session: SES }, hdr())
    expect(r.isError).toBe(true)
    expect(textOf(r)).toContain('cambia de app')
    expect(keyCalls(m)).toEqual([])
  })

  it('la secuencia que pegaba en Lazunox («cmd+tab cmd+v return») ⇒ rechazo; tres combinaciones ⇒ rechazo', async () => {
    const m = await ready()
    for (const keys of ['cmd+tab cmd+v return', 'cmd+a cmd+c cmd+v', 'cmd+space t e r m return', 'return  tab', 'a\nb']) {
      const r = await m.call('key', { keys, lazunox_session: SES }, hdr())
      expect(r.isError, keys).toBe(true)
    }
    expect(keyCalls(m)).toEqual([])
  })

  it.each([
    'cmd+tab',
    'cmd+shift+tab',
    'COMMAND+Tab',
    'meta+tab',
    'cmd+`',
    'cmd+space',
    'cmd+alt+space',
    'ctrl+left',
    'ctrl+right',
    'ctrl+up',
    'ctrl+down',
    'ctrl+shift+left',
    'ctrl+space',
    'cmd+alt+esc',
    'cmd+alt+escape',
    'cmd+h',
    'cmd+m',
    'cmd+q',
    'ctrl+cmd+q',
    'f3',
    'f4',
    'f9',
    'f10',
    'f11',
    'f12',
    'cmd+f11',
    'fn+e',
    'cmd+shift+3',
    'cmd+shift+4'
  ])('combinación bloqueada «%s» ⇒ no se pulsa', async (keys) => {
    const m = await ready()
    const r = await m.call('key', { keys, lazunox_session: SES }, hdr())
    expect(r.isError).toBe(true)
    expect(keyCalls(m)).toEqual([])
  })

  it('teclas desconocidas (alias raros, símbolos Unicode) ⇒ rechazo, vocabulario cerrado', async () => {
    const m = await ready()
    for (const keys of ['⌘+tab', 'cmd+inventada', 'cmd+~', 'hyper+a']) {
      const r = await m.call('key', { keys, lazunox_session: SES }, hdr())
      expect(r.isError, keys).toBe(true)
    }
    expect(keyCalls(m)).toEqual([])
  })

  it.each(['return', 'cmd+a', 'cmd+v', 'shift+left', 'f5', 'escape', 'cmd+shift+t', 'ctrl+a', 'cmd++'])(
    'combinación normal «%s» ⇒ se pulsa tal cual (una sola)',
    async (keys) => {
      const m = await ready()
      const r = await m.call('key', { keys, lazunox_session: SES }, hdr())
      expect(r.isError, textOf(r)).not.toBe(true)
      expect(keyCalls(m)).toEqual([[keys]])
    }
  )

  it('la app en primer plano CAMBIA entre la comprobación y la pulsación ⇒ rechazo y no se pulsa', async () => {
    const m = await ready([NOTES, { name: 'Lazunox', bundleId: APP_ID }])
    const r = await m.call('key', { keys: 'return', lazunox_session: SES }, hdr())
    expect(r.isError).toBe(true)
    expect(textOf(r)).toContain('cambió')
    expect(keyCalls(m)).toEqual([])
  })

  it('cambia a OTRA app (también concedida) ⇒ igualmente rechazo: debe ser la comprobada', async () => {
    await grant(SES, 'full', 'com.apple.TextEdit', 'TextEdit')
    const m = await ready([NOTES, { name: 'TextEdit', bundleId: 'com.apple.TextEdit' }])
    const r = await m.call('key', { keys: 'return', lazunox_session: SES }, hdr())
    expect(r.isError).toBe(true)
    expect(keyCalls(m)).toEqual([])
  })

  it('type_text: si el foco cambió justo antes de escribir ⇒ rechazo y no se escribe', async () => {
    const m = await ready([NOTES, { name: 'Lazunox', bundleId: APP_ID }])
    const r = await m.call('type_text', { text: 'hola', lazunox_session: SES }, hdr())
    expect(r.isError).toBe(true)
    expect(m.calls().some((c) => c.cmd === 'type')).toBe(false)
  })

  it('type_text normal sigue escribiendo', async () => {
    const m = await ready()
    const r = await m.call('type_text', { text: 'hola', lazunox_session: SES }, hdr())
    expect(r.isError, textOf(r)).not.toBe(true)
    expect(m.calls().some((c) => c.cmd === 'type')).toBe(true)
  })

  it('CONTROL: sin origen aislado (plan aprobado) la secuencia y cmd+tab se pulsan EXACTAMENTE como siempre', async () => {
    svc.grants.grant(NOTES.bundleId, 'Notes', 'full')
    svc.approvePlanFor(SES2)
    svc.prefs.set({ mode: 'full' })
    const m = await mcpFor({ front: NOTES })
    const seq = await m.call('key', { keys: 'cmd+tab cmd+v return', lazunox_session: SES2 })
    expect(seq.isError, textOf(seq)).not.toBe(true)
    expect(keyCalls(m)).toEqual([['cmd+tab cmd+v return']])
  })

  it('CONTROL: sin origen aislado el cambio de foco entre comprobación y pulsación NO se vigila (hoy igual)', async () => {
    svc.grants.grant(NOTES.bundleId, 'Notes', 'full')
    svc.approvePlanFor(SES2)
    svc.prefs.set({ mode: 'full' })
    const m = await mcpFor({ front: [NOTES, { name: 'Otra', bundleId: 'com.otra.App' }] })
    const r = await m.call('key', { keys: 'return', lazunox_session: SES2 })
    expect(r.isError, textOf(r)).not.toBe(true)
    expect(keyCalls(m)).toEqual([['return']])
  })

  it('paste_key de origen aislado: el MCP lo fija por plataforma (guardia de código; el pegado real toca el portapapeles y no se prueba aquí)', () => {
    const src = readFileSync(join(__dirname, 'mcp-server.ts'), 'utf8')
    expect(src).toMatch(/const pasteKey = isolatedCall\s*\?\s*isolatedPasteKey\(backend\.id\)/)
    expect(src).toMatch(/backend\.pasteText!\(text, pasteKey, isolatedCall \? \(\) => recheckFront\(checkedFront, session\) : undefined\)/)
  })
})

describe.skipIf(!posixOnly)('F2: request_full_control con la preferencia en «full» abre la tarjeta REAL en origen aislado', () => {
  it('abre la tarjeta de takeover, al aprobarla la sesión controla y el clic pasa (sin meter foregroundSessions a mano)', async () => {
    svc.prefs.set({ mode: 'full' })
    await grant(SES, 'click', NOTES.bundleId, 'Notes')
    const m = await mcpFor({ app: NOTES, front: NOTES })
    // Antes de la tarjeta: el clic se rechaza pidiendo request_full_control.
    const before = await m.call('left_click', { x: 5, y: 5, lazunox_session: SES }, hdr())
    expect(before.isError).toBe(true)
    expect(textOf(before)).toContain('request_full_control')

    const cards: Array<{ id: string; kind?: string }> = []
    svc.on('requestAccess', (r) => cards.push(r))
    const pending = m.call('request_full_control', { app: 'Notes', reason: 'arrastrar', lazunox_session: SES }, hdr())
    await vi.waitFor(() => expect(cards.length).toBeGreaterThan(0))
    expect(cards[0].kind).toBe('takeover')
    svc.resolveAccessRequest(cards[0].id, [], { approvePlan: true })
    const reply = await pending
    expect(textOf(reply)).not.toContain('Ya tienes control de la pantalla')
    expect(textOf(reply)).toContain('permitió')

    await snap(m, SES)
    const after = await m.call('left_click', { x: 5, y: 5, lazunox_session: SES }, hdr())
    expect(after.isError, textOf(after)).not.toBe(true)
    expect(m.calls().some((c) => c.cmd === 'click')).toBe(true)
    // Y no se lo da a otra sesión del mismo servidor.
    expect((await m.call('left_click', { x: 5, y: 5, lazunox_session: SES2 }, hdr())).isError).toBe(true)
  })

  it('CONTROL: sin origen aislado y con «full», request_full_control sigue respondiendo «Ya tienes control» sin tarjeta', async () => {
    svc.prefs.set({ mode: 'full' })
    svc.approvePlanFor(SES2)
    const cards: unknown[] = []
    svc.on('requestAccess', (r) => cards.push(r))
    const m = await mcpFor({ app: NOTES, front: NOTES })
    const r = await m.call('request_full_control', { app: 'Notes', reason: 'x', lazunox_session: SES2 })
    expect(textOf(r)).toContain('Ya tienes control de la pantalla')
    expect(cards).toEqual([])
  })
})

describe.skipIf(!posixOnly)('F3: capturas en origen aislado', () => {
  const RUNNING: AppLike[] = [{ name: 'Lazunox', bundleId: APP_ID }, { name: 'Finder', bundleId: 'com.apple.finder' }, NOTES]
  const excluded = (m: McpProc): string[] =>
    m
      .calls()
      .filter((c) => c.cmd === 'screenshot-sck')
      .flatMap((c) => (c.args[1] ?? '').split(','))

  it('screenshot de pantalla completa en origen aislado: rechazo, sin ninguna captura (Finder y Lazunox no llegan a verse), tenga o no Finder concedido', async () => {
    for (const withFinder of [false, true]) {
      await grant(SES, 'view', NOTES.bundleId, 'Notes')
      if (withFinder) await grant(SES, 'view', 'com.apple.finder', 'Finder')
      giveControl(SES)
      const m = await mcpFor({ running: RUNNING })
      const r = await m.call('screenshot', { elements: false, lazunox_session: SES }, hdr())
      expect(r.isError, textOf(r)).toBe(true)
      expect(textOf(r)).toContain('app_screenshot')
      expect(r.content.some((c) => c.type === 'image')).toBe(false)
      expect(excluded(m)).toEqual([])
    }
  })

  it('CONTROL: sin origen aislado Finder y Lazunox siguen visibles (no cambia nada)', async () => {
    svc.approvePlanFor(SES2)
    const m = await mcpFor({ running: RUNNING })
    const r = await m.call('screenshot', { elements: false, lazunox_session: SES2 })
    expect(r.isError, textOf(r)).not.toBe(true)
    expect(excluded(m)).not.toContain('com.apple.finder')
    expect(excluded(m)).not.toContain(APP_ID)
  })

  it('si running-apps falla en origen aislado ⇒ error, SIN captura (nunca la pantalla completa)', async () => {
    await grant(SES, 'view', NOTES.bundleId, 'Notes')
    giveControl(SES)
    const m = await mcpFor({ script: { 'running-apps': { exit: 1, stderr: 'boom' } } })
    const r = await m.call('screenshot', { elements: false, lazunox_session: SES }, hdr())
    expect(r.isError).toBe(true)
    expect(r.content.some((c) => c.type === 'image')).toBe(false)
  })

  it('CONTROL: sin origen aislado, si running-apps falla la captura sale igual que hoy (mejor esfuerzo)', async () => {
    svc.approvePlanFor(SES2)
    const m = await mcpFor({ script: { 'running-apps': { exit: 1, stderr: 'boom' } } })
    const r = await m.call('screenshot', { elements: false, lazunox_session: SES2 })
    expect(r.isError, textOf(r)).not.toBe(true)
    expect(r.content.some((c) => c.type === 'image')).toBe(true)
  })
})

describe.skipIf(!posixOnly)('F4: «siempre» desde una tarjeta de origen aislado no deja concesión guardada', () => {
  it('scope «always» en una sesión aislada vale solo para la sesión; Control total no la hereda', async () => {
    svc.checkBridgeCall({ origin: SECRET, server: SERVER_A, session: SES })
    await grant(SES, 'click', NOTES.bundleId, 'Notes', 'always')
    expect(svc.grants.tierFor(NOTES.bundleId)).toBeNull()
    const tier = async (session: string, isolated: boolean): Promise<unknown> =>
      (
        (await (
          await fetch(`${url}/tier?bundleId=${NOTES.bundleId}&name=Notes&session=${session}${isolated ? '&isolated=1' : ''}`)
        ).json()) as { tier: unknown }
      ).tier
    expect(await tier(SES, true)).toBe('click')
    // Una sesión de Control total (sin plan, sin reclamar) no ve ninguna concesión guardada de esa app.
    expect(await tier(SES2, false)).not.toBe('click')
  })

  it('CONTROL: «siempre» en una sesión de Control total sigue guardando la concesión', async () => {
    await grant(SES2, 'click', NOTES.bundleId, 'Notes', 'always')
    expect(svc.grants.tierFor(NOTES.bundleId)).toBe('click')
  })
})

describe.skipIf(!posixOnly)('F5: los ayudantes de Lazunox son exentos en origen aislado', () => {
  const HELPERS = [`${APP_ID}.motor`, `${APP_ID}.disclaim`, `${APP_ID}.helper`, `${APP_ID}.helper.GPU`]

  it.each(HELPERS)('%s: main no concede ni abre tarjeta y el MCP se niega a actuarla', async (bundleId) => {
    svc.checkBridgeCall({ origin: SECRET, server: SERVER_A, session: SES })
    const cards: unknown[] = []
    svc.on('requestAccess', (r) => cards.push(r))
    const r = await svc.requestAccess([{ bundleId, name: 'Ayudante' }], undefined, undefined, SES)
    expect(r.blocked?.[0]?.bundleId).toBe(bundleId)
    expect(r.decisions[bundleId]).toBe('deny')
    expect(cards).toEqual([])
    const tier = ((await (await fetch(`${url}/tier?bundleId=${bundleId}&name=x&session=${SES}&isolated=1`)).json()) as { tier: unknown })
      .tier
    expect(tier).toBeNull()
    giveControl(SES)
    const m = await mcpFor({ front: { name: 'Ayudante', bundleId } })
    const k = await m.call('key', { keys: 'return', lazunox_session: SES }, hdr())
    expect(k.isError).toBe(true)
    expect(textOf(k)).toContain('propia Lazunox')
    expect(keyCalls(m)).toEqual([])
  })

  it('CONTROL: una app ajena cuyo id solo se parece (sin el punto) NO queda exenta', async () => {
    svc.checkBridgeCall({ origin: SECRET, server: SERVER_A, session: SES })
    await grant(SES, 'view', `${APP_ID}x`, 'Parecida')
    const tier = ((await (await fetch(`${url}/tier?bundleId=${APP_ID}x&name=x&session=${SES}&isolated=1`)).json()) as { tier: unknown })
      .tier
    expect(tier).toBe('view')
  })
})

describe.skipIf(!posixOnly)('mutación: las puertas `|| isolatedCall` se notan (con la preferencia en «full»)', () => {
  it('frontmost conocida y punto SIN identificar bajo el clic ⇒ rechazo (quitar `|| isolatedCall` de requireTier lo deja pasar)', async () => {
    await grant(SES, 'click', NOTES.bundleId, 'Notes')
    giveControl(SES)
    const m = await mcpFor({ front: NOTES, at: { name: '', bundleId: '' } })
    await snap(m, SES)
    const r = await m.call('left_click', { x: 5, y: 5, lazunox_session: SES }, hdr())
    expect(r.isError).toBe(true)
    expect(textOf(r)).toContain('No se pudo identificar')
    expect(m.calls().some((c) => c.cmd === 'click')).toBe(false)
  })

  it('CONTROL: sin origen aislado ese mismo punto sin identificar no bloquea (macOS)', async () => {
    svc.grants.grant(NOTES.bundleId, 'Notes', 'click')
    svc.approvePlanFor(SES2)
    svc.prefs.set({ mode: 'full' })
    const m = await mcpFor({ front: NOTES, at: { name: '', bundleId: '' } })
    const r = await m.call('left_click', { x: 5, y: 5, lazunox_session: SES2 })
    expect(r.isError, textOf(r)).not.toBe(true)
    expect(m.calls().some((c) => c.cmd === 'click')).toBe(true)
  })

  it('open_application con la preferencia en «full» y SIN request_full_control aprobado ⇒ se abre en segundo plano (open-app-bg), no se activa', async () => {
    svc.prefs.set({ mode: 'full' })
    await grant(SES, 'view', NOTES.bundleId, 'Notes')
    svc.checkBridgeCall({ origin: SECRET, server: SERVER_A, session: SES })
    const m = await mcpFor({ app: NOTES, front: NOTES })
    const r = await m.call('open_application', { name: 'Notes', lazunox_session: SES }, hdr())
    expect(r.isError, textOf(r)).not.toBe(true)
    const cmds = m.calls().map((c) => c.cmd)
    expect(cmds).toContain('open-app-bg')
    expect(cmds).not.toContain('open-app')
    expect(cmds).not.toContain('activate')
  })

  it('open_application con control de ESA sesión aprobado ⇒ sí la activa (flujo normal)', async () => {
    svc.prefs.set({ mode: 'full' })
    await grant(SES, 'view', NOTES.bundleId, 'Notes')
    giveControl(SES)
    const m = await mcpFor({ app: NOTES, front: NOTES })
    const r = await m.call('open_application', { name: 'Notes', lazunox_session: SES }, hdr())
    expect(r.isError, textOf(r)).not.toBe(true)
    expect(m.calls().map((c) => c.cmd)).toContain('open-app')
  })

  it('CONTROL: sin origen aislado y con «full», open_application activa como siempre', async () => {
    svc.prefs.set({ mode: 'full' })
    svc.approvePlanFor(SES2)
    const m = await mcpFor({ app: NOTES, front: NOTES })
    const r = await m.call('open_application', { name: 'Notes', lazunox_session: SES2 })
    expect(r.isError, textOf(r)).not.toBe(true)
    const cmds = m.calls().map((c) => c.cmd)
    expect(cmds).toContain('open-app')
    expect(cmds).not.toContain('open-app-bg')
  })
})

describe.skipIf(!posixOnly)(
  'G1: la tarjeta de una app con «Ver y clic» o «Control total» ya da el ratón y el teclado sobre ESA app (origen aislado)',
  () => {
    const OTHER = { name: 'Slack', bundleId: 'com.tinyspeck.slackmacgap' }

    /** Pide la app por la herramienta REAL (así la sesión queda reclamada por el origen aislado) y responde la tarjeta con `decision`. */
    async function askByCard(m: McpProc, session: string, decision: 'view' | 'click' | 'full'): Promise<void> {
      const cards: Array<{ id: string }> = []
      svc.on('requestAccess', (r) => cards.push(r))
      const pending = m.call('request_access', { apps: ['Notes'], levels: [decision], reason: 'probar', lazunox_session: session }, hdr())
      await vi.waitFor(() => expect(cards.length).toBeGreaterThan(0))
      svc.resolveAccessRequest(cards[0].id, [{ bundleId: NOTES.bundleId, name: 'Notes', decision }])
      await pending
      svc.removeAllListeners('requestAccess')
    }

    it('«Control total» de Notes: clic y teclas sobre Notes pasan sin request_full_control, y ninguna otra sesión lo hereda', async () => {
      const m = await mcpFor({ app: NOTES, front: NOTES })
      await askByCard(m, SES, 'full')
      // Sin captura de la ventana el clic con x/y falla cerrado (aunque la sesión tenga el control): hay que mirar antes.
      const blind = await m.call('left_click', { x: 5, y: 5, lazunox_session: SES }, hdr())
      expect(blind.isError).toBe(true)
      expect(textOf(blind)).toContain('app_screenshot')
      expect(m.calls().some((c) => c.cmd === 'click')).toBe(false)
      await snap(m, SES)
      const click = await m.call('left_click', { x: 5, y: 5, lazunox_session: SES }, hdr())
      expect(click.isError, textOf(click)).not.toBe(true)
      expect(clickCalls(m).length).toBe(1)
      const key = await m.call('key', { keys: 'space', lazunox_session: SES }, hdr())
      expect(key.isError, textOf(key)).not.toBe(true)
      expect((await m.call('left_click', { x: 5, y: 5, lazunox_session: SES2 }, hdr())).isError).toBe(true)
    })

    it('el alcance sigue siendo la app: con otra app al frente (sin concesión) el clic y las teclas se rechazan', async () => {
      const m = await mcpFor({ app: NOTES, front: OTHER })
      await askByCard(m, SES, 'full')
      await snap(m, SES)
      const clicksBefore = m.calls().filter((c) => c.cmd === 'click').length
      const click = await m.call('left_click', { x: 5, y: 5, lazunox_session: SES }, hdr())
      expect(click.isError).toBe(true)
      const key = await m.call('key', { keys: 'space', lazunox_session: SES }, hdr())
      expect(key.isError).toBe(true)
      expect(m.calls().filter((c) => c.cmd === 'click').length).toBe(clicksBefore)
      expect(keyCalls(m)).toEqual([])
    })

    it('«Solo ver» NO da el ratón ni el teclado (sigue pidiendo request_full_control)', async () => {
      const m = await mcpFor({ app: NOTES, front: NOTES })
      await askByCard(m, SES, 'view')
      const click = await m.call('left_click', { x: 5, y: 5, lazunox_session: SES }, hdr())
      expect(click.isError).toBe(true)
      expect(textOf(click)).toContain('request_full_control')
      expect(m.calls().some((c) => c.cmd === 'click')).toBe(false)
    })

    it('«Ver y clic» deja hacer clic en esa app pero NO teclear (teclear exige «Control total»)', async () => {
      const m = await mcpFor({ app: NOTES, front: NOTES })
      await askByCard(m, SES, 'click')
      await snap(m, SES)
      expect((await m.call('left_click', { x: 5, y: 5, lazunox_session: SES }, hdr())).isError).not.toBe(true)
      const typed = await m.call('type_text', { text: 'hola', lazunox_session: SES }, hdr())
      expect(typed.isError).toBe(true)
      expect(m.calls().some((c) => c.cmd === 'type' || c.cmd === 'paste')).toBe(false)
    })

    it('Detener revoca ese control: después del Detener el clic vuelve a rechazarse', async () => {
      const m = await mcpFor({ app: NOTES, front: NOTES })
      await askByCard(m, SES, 'full')
      await snap(m, SES)
      expect((await m.call('left_click', { x: 5, y: 5, lazunox_session: SES }, hdr())).isError).not.toBe(true)
      await svc.stop()
      svc.resume()
      expect((await m.call('left_click', { x: 5, y: 5, lazunox_session: SES }, hdr())).isError).toBe(true)
    })
  }
)

describe.skipIf(!posixOnly)(
  'G2: el control por tarjeta de una app no alcanza al Finder, no activa apps de menos nivel y no abre atajos del sistema',
  () => {
    const FINDER = { name: 'Finder', bundleId: 'com.apple.finder' }
    const SPOT = { name: 'Spotify', bundleId: 'com.spotify.client' }

    /** Concede por la herramienta REAL (la sesión queda reclamada) varias apps con su nivel, en una sola tarjeta. */
    async function askMany(
      m: McpProc,
      session: string,
      items: Array<{ app: { name: string; bundleId: string }; tier: 'view' | 'click' | 'full' }>
    ) {
      const cards: Array<{ id: string }> = []
      svc.on('requestAccess', (r) => cards.push(r))
      const pending = m.call(
        'request_access',
        { apps: items.map((i) => i.app.name), levels: items.map((i) => i.tier), reason: 'probar', lazunox_session: session },
        hdr()
      )
      await vi.waitFor(() => expect(cards.length).toBeGreaterThan(0))
      svc.resolveAccessRequest(
        cards[0].id,
        items.map((i) => ({ bundleId: i.app.bundleId, name: i.app.name, decision: i.tier }))
      )
      await pending
      svc.removeAllListeners('requestAccess')
    }

    it('Finder con «Ver y clic»/«Control total» por tarjeta: el doble clic y las teclas reales se rechazan (hay que pedir request_full_control)', async () => {
      const m = await mcpFor({ app: FINDER, front: FINDER })
      await askMany(m, SES, [{ app: FINDER, tier: 'full' }])
      await snap(m, SES, 'Finder')
      const dbl = await m.call('double_click', { x: 5, y: 5, lazunox_session: SES }, hdr())
      expect(dbl.isError).toBe(true)
      expect(textOf(dbl)).toContain('request_full_control')
      const key = await m.call('key', { keys: 'return', lazunox_session: SES }, hdr())
      expect(key.isError).toBe(true)
      expect(m.calls().some((c) => c.cmd === 'click' || c.cmd === 'key')).toBe(false)
    })

    it('aunque otra app de la MISMA tarjeta dé el control (Spotify «full»), el Finder concedido sigue sin ratón ni teclado reales', async () => {
      // Cada nombre de la tarjeta se resuelve a SU app (resolve-app en orden: Spotify, Finder).
      const m = await mcpFor({
        front: FINDER,
        script: { 'resolve-app': [{ out: { ...SPOT, found: true } }, { out: { ...FINDER, found: true } }] }
      })
      // Spotify por la tarjeta REAL (resolve-app #1); el Finder concedido aparte (los nombres de una tarjeta se resuelven a la vez en el helper falso).
      await askMany(m, SES, [{ app: SPOT, tier: 'full' }])
      await grant(SES, 'click', FINDER.bundleId, 'Finder')
      // La prueba solo vale si la sesión de verdad tiene el control acotado por la tarjeta de Spotify.
      expect(svc.isForeground(SES, true)).toBe(true)
      expect(svc.isScopedOnly(SES)).toBe(true)
      await snap(m, SES, 'Finder')
      const click = await m.call('left_click', { x: 5, y: 5, lazunox_session: SES }, hdr())
      expect(click.isError).toBe(true)
      // El rechazo es el del Finder (pide la toma de control explícita), no «sin concesión».
      expect(textOf(click)).toContain('request_full_control')
      expect(m.calls().some((c) => c.cmd === 'click')).toBe(false)
    })

    it('con una toma de control EXPLÍCITA (request_full_control aprobado) el Finder concedido sí se maneja, como antes', async () => {
      const m = await mcpFor({ app: FINDER, front: FINDER })
      await askMany(m, SES, [{ app: FINDER, tier: 'click' }])
      giveControl(SES)
      await snap(m, SES, 'Finder')
      expect((await m.call('left_click', { x: 5, y: 5, lazunox_session: SES }, hdr())).isError).not.toBe(true)
    })

    it('open_application de una app con solo «Solo ver» NO la activa aunque la sesión tenga el control por otra app', async () => {
      const m = await mcpFor({
        front: NOTES,
        script: { 'resolve-app': [{ out: { ...SPOT, found: true } }, { out: { ...NOTES, found: true } }] }
      })
      await askMany(m, SES, [{ app: SPOT, tier: 'full' }])
      await grant(SES, 'view', NOTES.bundleId, 'Notes')
      // La prueba solo vale si la sesión tiene el ratón y el teclado por Spotify (control acotado), no por casualidad.
      expect(svc.isForeground(SES, true)).toBe(true)
      expect(svc.isScopedOnly(SES)).toBe(true)
      const r = await m.call('open_application', { name: 'Notes', lazunox_session: SES }, hdr())
      expect(r.isError, textOf(r)).not.toBe(true)
      const cmds = m.calls().map((c) => c.cmd)
      expect(cmds).toContain('open-app-bg')
      expect(cmds).not.toContain('open-app')
      // El modelo recibe cómo seguir: volver a pedir «Control total» de ESA app (no devolverle el problema a la persona).
      expect(textOf(r)).toContain('levels: ["full"]')
      expect(textOf(r)).toContain('NO se trajo al frente')
    })

    it('open_application de la app con «Control total» sí la activa', async () => {
      const m = await mcpFor({ app: NOTES, front: NOTES })
      await askMany(m, SES, [{ app: NOTES, tier: 'full' }])
      const r = await m.call('open_application', { name: 'Notes', lazunox_session: SES }, hdr())
      expect(r.isError, textOf(r)).not.toBe(true)
      expect(m.calls().map((c) => c.cmd)).toContain('open-app')
    })

    it.each(['ctrl+f2', 'ctrl+f8', 'cmd+f5', 'cmd+alt+f5'])(
      'la combinación %s (menús de estado, VoiceOver) se bloquea en origen aislado',
      async (keys) => {
        const m = await mcpFor({ app: NOTES, front: NOTES })
        await askMany(m, SES, [{ app: NOTES, tier: 'full' }])
        const r = await m.call('key', { keys, lazunox_session: SES }, hdr())
        expect(r.isError).toBe(true)
        expect(keyCalls(m)).toEqual([])
      }
    )
  }
)

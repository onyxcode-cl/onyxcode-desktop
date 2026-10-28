/**
 * H4: el puente solo acepta sesiones que el servidor aislado de origen conoce y tiene vivas. ComputerService REAL + MCP REAL (helper falso). Origen aislado = cabecera con el
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
const hdr = (secret = SECRET, server = SERVER_A): Record<string, string> => ({
  [BRIDGE_ORIGIN_HEADER]: secret,
  [BRIDGE_SERVER_HEADER]: server
})

let svc: ComputerService
type St = 'live' | 'dead' | 'unknown'
/** Sesiones vivas por servidor (lo que cada servidor aislado conoce de verdad). */
let known: Record<string, string[]> = {}
let probeCalls = 0
let down = false
const probe = async (server: string, session: string): Promise<St> => {
  probeCalls++
  if (down) return 'unknown'
  return (known[server] ?? []).includes(session) ? 'live' : 'dead'
}
let mcp: McpProc
let n = 0
const savedFlag = process.env[UNIFIED_APPS_ENV]

beforeEach(async () => {
  known = { [SERVER_A]: [SES], [SERVER_B]: [SES2] }
  probeCalls = 0
  down = false
  h.dir = mkdtempSync(join(tmpdir(), 'svc-bridge-'))
  process.env[UNIFIED_APPS_ENV] = '1'
  svc = new ComputerService({ platform: 'darwin' })
  svc.init()
  svc.setBridgeSecret(SECRET)
  svc.bridgeSessionProbe = probe
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

const open = (args: Record<string, unknown>, headers?: Record<string, string>) =>
  mcp.call('open_application', { name: 'Notes', ...args }, headers)
const opened = (): number => mcp.calls().filter((c) => c.cmd === 'open-app' || c.cmd === 'open-app-bg').length
const BAD = /no trae una sesión válida/
const cardsOf = (): Array<{ id: string }> => {
  const c: Array<{ id: string }> = []
  svc.on('requestAccess', (r) => c.push(r))
  return c
}
const verdict = (server: string, session: string) => svc.verifyBridgeCall({ origin: SECRET, server, session })

describe('H4: sesión viva en el servidor de origen', () => {
  it('sesión inventada (bien formada) ⇒ rechazo inmediato, sin tarjeta y sin reclamarla', async () => {
    const cards = cardsOf()
    const r = await open({ lazunox_session: 'ses_inventadaXXXXXXXX' }, hdr())
    expect(r.isError).toBe(true)
    expect(textOf(r)).toMatch(BAD)
    expect(cards).toHaveLength(0)
    expect(opened()).toBe(0)
    expect(svc.isBridgeSessionClaimed('ses_inventadaXXXXXXXX')).toBe(false)
  })

  it('sesión de OTRO servidor ⇒ rechazo (no vale aunque exista en B)', async () => {
    const cards = cardsOf()
    expect(await verdict(SERVER_A, SES2)).toEqual({ isolated: true, ok: false, reason: 'bad-session' })
    const r = await open({ lazunox_session: SES2 }, hdr(SECRET, SERVER_A))
    expect(textOf(r)).toMatch(BAD)
    expect(cards).toHaveLength(0)
    expect(await verdict(SERVER_B, SES2)).toEqual({ isolated: true, ok: true })
  })

  it('sesión viva ⇒ pasa al flujo normal (no es el rechazo de sesión ni el de «falta el plan»)', async () => {
    expect(await verdict(SERVER_A, SES)).toEqual({ isolated: true, ok: true })
    expect(svc.isBridgeSessionClaimed(SES)).toBe(true)
    const r = await open({ lazunox_session: SES }, hdr())
    expect(textOf(r)).not.toMatch(BAD)
    expect(textOf(r)).not.toMatch(/Todavía no hay un plan aprobado/)
  })

  it('servidor caído o sin comprobador ⇒ falla cerrado y no se cachea', async () => {
    down = true
    expect(await verdict(SERVER_A, SES)).toMatchObject({ ok: false })
    down = false
    expect(await verdict(SERVER_A, SES)).toEqual({ isolated: true, ok: true })
    svc.setBridgeSecret(SECRET)
    svc.bridgeSessionProbe = null
    expect(await verdict(SERVER_A, SES)).toMatchObject({ ok: false })
  })

  it('origen no aislado: no consulta nada', async () => {
    expect(await svc.verifyBridgeCall({ origin: 'otro', server: SERVER_A, session: SES })).toEqual({ isolated: false })
    expect(probeCalls).toBe(0)
  })

  it('caché corta y una sola consulta en vuelo por sesión', async () => {
    await Promise.all([verdict(SERVER_A, SES), verdict(SERVER_A, SES), verdict(SERVER_A, SES)])
    expect(probeCalls).toBe(1)
    await verdict(SERVER_A, SES)
    expect(probeCalls).toBe(1)
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(Date.now() + 9_000)
      await verdict(SERVER_A, SES)
      expect(probeCalls).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('una inventada repetida también se cachea (no se martilla al servidor)', async () => {
    await verdict(SERVER_A, 'ses_fantasmaXXXXXXXX')
    await verdict(SERVER_A, 'ses_fantasmaXXXXXXXX')
    expect(probeCalls).toBe(1)
  })
})

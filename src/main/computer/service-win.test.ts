/**
 * ComputerService con la plataforma Windows INYECTADA (C4), sobre macOS y con dobles: electron y el helper son falsos, el servidor
 * lateral es el real (127.0.0.1). Nada de esto se ha probado en un Windows real.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ dir: '', power: null as unknown as import('node:events').EventEmitter, helper: vi.fn() }))

vi.mock('electron', async () => {
  const { EventEmitter: EE } = await import('node:events')
  h.power = new EE()
  return {
    app: {
      getPath: (n: string) => (n === 'temp' ? join(h.dir, 'tmp') : h.dir),
      getAppPath: () => join(h.dir, 'app'),
      isPackaged: false
    },
    globalShortcut: { register: () => true, unregister: () => undefined },
    powerMonitor: h.power,
    shell: { openExternal: async () => undefined },
    systemPreferences: {
      isTrustedAccessibilityClient: () => true,
      getMediaAccessStatus: () => 'granted'
    }
  }
})
vi.mock('../util/exec', () => ({ runHelper: (...a: unknown[]) => h.helper(...a) }))

import { ComputerService } from './service'
import { CONSENT_ARM_MS } from './policy/consent-win'

const winKey = 'exe:c:\\windows\\notepad.exe|pub:microsoft windows'
let now = 1_700_000_000_000
let svc: ComputerService | null = null

beforeEach(() => {
  h.dir = mkdtempSync(join(tmpdir(), 'svc-win-'))
  now = 1_700_000_000_000
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  h.helper.mockReset()
})
afterEach(() => {
  svc?.dispose()
  svc = null
  vi.restoreAllMocks()
  rmSync(h.dir, { recursive: true, force: true })
})

function make(platform: string): ComputerService {
  svc = new ComputerService({ platform })
  svc.init()
  return svc
}

async function url(s: ComputerService): Promise<string> {
  const u = await s.planGateUrl()
  if (!u) throw new Error('sin canal lateral')
  return u
}

function grantConsent(s: ComputerService): void {
  s.winConsent('show')
  s.winConsent('check')
  now += CONSENT_ARM_MS
  expect(s.winConsent('confirm').granted).toBe(true)
}

describe('Windows: GET /consent del canal lateral', () => {
  it('sin consentimiento → {consent:false, version}; tras concederlo → true; revocar → false', async () => {
    const s = make('win32')
    const base = await url(s)
    const get = async (): Promise<unknown> => (await fetch(`${base}/consent`)).json()
    expect(await get()).toEqual({ consent: false, version: 1 })
    grantConsent(s)
    expect(await get()).toEqual({ consent: true, version: 1 })
    s.winConsent('revoke')
    expect(await get()).toEqual({ consent: false, version: 1 })
  })

  it('un archivo de consentimiento corrupto o de otra versión no vale (falla cerrado)', async () => {
    const s = make('win32')
    const base = await url(s)
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(h.dir, 'computer-win-consent.json'), '{"version":99,"at":5}')
    expect(await (await fetch(`${base}/consent`)).json()).toEqual({ consent: false, version: 1 })
    writeFileSync(join(h.dir, 'computer-win-consent.json'), 'basura')
    expect(await (await fetch(`${base}/consent`)).json()).toEqual({ consent: false, version: 1 })
  })

  it('el token sigue siendo necesario: otra ruta responde 404', async () => {
    const s = make('win32')
    const base = await url(s)
    const origin = new URL(base).origin
    expect((await fetch(`${origin}/consent`)).status).toBe(404)
    expect((await fetch(`${origin}/computer-events/otro/consent`)).status).toBe(404)
  })

  it('macOS: el endpoint no existe (404 como siempre)', async () => {
    const s = make('darwin')
    expect((await fetch(`${await url(s)}/consent`)).status).toBe(404)
  })
})

describe('Windows: tarjeta de consentimiento (armado en main)', () => {
  it('sin mostrar, sin casilla o antes de 600 ms no concede; solo al armarse', () => {
    const s = make('win32')
    expect(s.winConsent('confirm')).toMatchObject({ consent: false, granted: false })
    s.winConsent('show')
    expect(s.winConsent('confirm').granted).toBe(false)
    expect(s.winConsent('check').armed).toBe(false)
    now += CONSENT_ARM_MS - 1
    expect(s.winConsent('confirm').granted).toBe(false)
    now += 1
    expect(s.winConsent('check').armed).toBe(true)
    const r = s.winConsent('confirm')
    expect(r).toMatchObject({ consent: true, granted: true, armed: false })
  })

  it('desmarcar la casilla desarma; mostrarla de nuevo reinicia', () => {
    const s = make('win32')
    s.winConsent('show')
    s.winConsent('check')
    now += 700
    expect(s.winConsent('uncheck').armed).toBe(false)
    s.winConsent('check')
    expect(s.winConsent('check').armed).toBe(true)
    s.winConsent('show')
    s.winConsent('check')
    expect(s.winConsent('check').armed).toBe(false)
  })

  it('revocar detiene el control (reanudar exige «Reanudar control») y queda en el registro', async () => {
    const s = make('win32')
    grantConsent(s)
    expect(s.isStopped()).toBe(false)
    s.winConsent('revoke')
    await vi.waitFor(() => expect(s.isStopped()).toBe(true))
    const log = readFileSync(join(h.dir, 'computer-audit.jsonl'), 'utf8')
    expect(log).toContain('"reason":"granted"')
    expect(log).toContain('"reason":"revoked"')
  })

  it('requestPermissions en Windows no abre nada del sistema: rearma la tarjeta', async () => {
    const s = make('win32')
    s.winConsent('show')
    s.winConsent('check')
    now += 700
    expect(s.winConsent('check').armed).toBe(true)
    await s.requestPermissions()
    expect(s.winConsent('check').armed).toBe(false)
  })
})

describe('Windows: estado sin TCC', () => {
  it('status: consentimiento de la app + sesión, elevación, escalado y monitores del helper', async () => {
    const s = make('win32')
    const fs = await import('node:fs')
    const bin = join(h.dir, 'app', 'resources', 'computer-use', 'win', 'bin')
    fs.mkdirSync(bin, { recursive: true })
    fs.writeFileSync(join(bin, 'cu-helper.exe'), '')
    vi.spyOn(process, 'cwd').mockReturnValue(h.dir)
    h.helper.mockImplementation(async (_b: string, args: string[]) =>
      args[0] === 'permissions'
        ? JSON.stringify({ consent: false, interactive: true, elevated: false, helper: true, dpi: 144, monitors: 2 })
        : JSON.stringify([{ width: 2880, height: 1620, scale: 1.5 }])
    )
    const st = await s.status()
    expect(st).toMatchObject({
      helperOk: true,
      accessibility: false,
      screenRecording: false,
      win: { consent: false, consentVersion: 1, consentStale: false, interactive: true, elevated: false, dpiPercent: 150, monitors: 2 }
    })
    grantConsent(s)
    const st2 = await s.status()
    expect(st2.win?.consent).toBe(true)
    expect([st2.accessibility, st2.screenRecording]).toEqual([true, true])
  })

  it('sin helper: no disponible, con el motivo, y sin tocar nada del sistema', async () => {
    const s = make('win32')
    // Independiente del disco: un `cu-helper.exe` compilado en esta carpeta (ignorado por git) no debe cambiar el resultado.
    vi.spyOn(s, 'helperPath').mockReturnValue(null)
    const info = await s.info()
    expect(info.available).toBe(false)
    expect(info.reason).toMatch(/componente de la app/i)
    expect(h.helper).not.toHaveBeenCalled()
  })

  it('macOS: el estado no lleva `win`', async () => {
    // El helper del Mac devuelve JSON válido (el mock sin implementación daba `undefined` y lo registraba como error).
    h.helper.mockImplementation(async (_b: string, args: string[]) =>
      args[0] === 'permissions'
        ? JSON.stringify({ accessibility: true, screenRecording: true })
        : JSON.stringify([{ width: 1440, height: 900, scale: 2 }])
    )
    const s = make('darwin')
    expect((await s.status()).win).toBeUndefined()
  })
})

describe('bloqueo de sesión y suspensión', () => {
  it('Windows: lock-screen y suspend paran el control; dispose quita las escuchas', async () => {
    const s = make('win32')
    expect(s.isStopped()).toBe(false)
    h.power.emit('lock-screen')
    await vi.waitFor(() => expect(s.isStopped()).toBe(true))
    s.resume()
    expect(s.isStopped()).toBe(false)
    h.power.emit('suspend')
    await vi.waitFor(() => expect(s.isStopped()).toBe(true))
    s.dispose()
    expect(h.power.listenerCount('lock-screen') + h.power.listenerCount('suspend')).toBe(0)
  })

  it('macOS: ninguna escucha (parar al bloquear en el Mac es decisión del dueño)', () => {
    make('darwin')
    expect(h.power.listenerCount('lock-screen') + h.power.listenerCount('suspend')).toBe(0)
  })
})

describe('registro auditable', () => {
  const post = (base: string, body: unknown): Promise<Response> =>
    fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

  it('Windows: el final de cada acción se registra sin el texto tecleado', async () => {
    const s = make('win32')
    const base = await url(s)
    await post(base, { tool: 'type_text', text: 'secreto123', phase: 'start' })
    await post(base, { tool: 'type_text', text: 'secreto123', phase: 'end', ok: true })
    await post(base, { tool: 'left_click', x: 10, y: 20, phase: 'end', ok: false })
    const raw = readFileSync(join(h.dir, 'computer-audit.jsonl'), 'utf8')
    expect(raw).not.toContain('secreto123')
    const rows = s.auditEntries()
    expect(rows.map((r) => [r.tool, r.outcome])).toEqual([
      ['left_click', 'error'],
      ['type_text', 'ok']
    ])
    expect(rows[1].textLen).toBe(10)
  })

  it('macOS: no se escribe ningún registro', async () => {
    const s = make('darwin')
    await post(await url(s), { tool: 'left_click', x: 1, y: 2, phase: 'end', ok: true })
    expect(existsSync(join(h.dir, 'computer-audit.jsonl'))).toBe(false)
  })
})

describe('concesiones con claves de Windows', () => {
  it('una app bloqueada no abre tarjeta (sale denegada) y no se concede aunque el renderer lo pida', async () => {
    const s = make('win32')
    const consent = 'exe:c:\\windows\\system32\\consent.exe|pub:microsoft windows'
    const got: Array<{ id: string; apps: Array<{ bundleId: string; denied?: boolean }> }> = []
    s.on('requestAccess', (r) => got.push(r))
    const p = s.requestAccess([
      { bundleId: consent, name: 'Consent' },
      { bundleId: winKey, name: 'Bloc de notas' }
    ])
    await vi.waitFor(() => expect(got).toHaveLength(1))
    // La bloqueada ya no llega a la tarjeta: solo la otra app.
    expect(got[0].apps.map((a) => [a.bundleId === consent, a.denied])).toEqual([[false, false]])
    s.resolveAccessRequest(
      got[0].id,
      [
        { bundleId: consent, name: 'Consent', decision: 'full' },
        { bundleId: winKey, name: 'Bloc de notas', decision: 'click' }
      ],
      { scope: 'always' }
    )
    const r = await p
    expect(r.decisions).toEqual({ [consent]: 'deny', [winKey]: 'click' })
    expect(s.grants.tierFor(consent)).toBeNull()
    expect(s.grants.tierFor(winKey)).toBe('click')
  })
})

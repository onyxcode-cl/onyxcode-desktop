/** `tasks:winBeta`: esquema estricto, armado en main, revocación, reinicio y registro solo en win32 con la puerta de compilación. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({ app: { getVersion: () => '1.2.3' }, BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('./guard', () => ({ guardInvoke: (_e: unknown, _c: string, a: unknown[]) => a[0], IpcGuardError: class extends Error {} }))

import { TASKS_INVOKE_CHANNELS } from '@shared/ipc-tasks'
import { capsFor } from '@shared/platform-caps'
import { CHANNEL_ROLES, IPC_SCHEMAS } from './schemas'
import { CELULAR_POLICY, decide } from '../remote/policy'
import { TASKS_WIN_BETA_CONSENT_FILE } from '../tasks/tasks-win-beta-consent'
import { registerTasksBetaHandlers, tasksWinBetaHandled } from './tasks-beta-handlers'
import { registerUnsupportedHandlers } from './unsupported-handlers'

type Fn = (e: unknown, ...a: unknown[]) => Promise<{ ok: boolean; data?: Record<string, unknown>; code?: string }>
function fakeIpc(): { ipc: never; handlers: Map<string, Fn> } {
  const handlers = new Map<string, Fn>()
  const ipc = { removeHandler: () => undefined, handle: (ch: string, fn: Fn) => handlers.set(ch, fn) }
  return { ipc: ipc as never, handlers }
}

let dir: string
let clock: number
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lazunox-betah-'))
  clock = 50_000
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function setup(over: { platform?: string; build?: boolean; active?: boolean } = {}): {
  call: (action: string) => Promise<NonNullable<Awaited<ReturnType<Fn>>['data']>>
  relaunch: ReturnType<typeof vi.fn>
  handlers: Map<string, Fn>
  registered: boolean
} {
  const { ipc, handlers } = fakeIpc()
  const relaunch = vi.fn()
  const registered = registerTasksBetaHandlers(ipc, {
    userDataDir: dir,
    platform: over.platform ?? 'win32',
    build: over.build ?? true,
    active: over.active ?? false,
    relaunch,
    now: () => clock
  })
  const call = async (action: string): Promise<NonNullable<Awaited<ReturnType<Fn>>['data']>> => {
    const r = await handlers.get('tasks:winBeta')!({}, { action })
    expect(r.ok).toBe(true)
    return r.data!
  }
  return { call, relaunch, handlers, registered }
}

describe('esquema estricto', () => {
  const v = IPC_SCHEMAS['tasks:winBeta']
  it('acepta solo las acciones conocidas', () => {
    for (const action of ['view', 'show', 'check', 'uncheck', 'accept', 'revoke', 'restart']) expect(v({ action })).toEqual({ action })
    for (const bad of [{ action: 'grant' }, { action: 1 }, {}, undefined, null, 'accept', []]) expect(() => v(bad)).toThrow()
  })
  it('claves inesperadas → INVALID (no se puede colar un consentimiento ni una versión)', () => {
    for (const extra of [{ consent: true }, { version: 99 }, { at: 1 }, { granted: true }, { settings: { tasksWinBeta: true } }]) {
      expect(() => v({ action: 'accept', ...extra })).toThrow()
    }
  })
  it('es solo de la ventana principal y X para el celular', () => {
    for (const set of Object.values(CHANNEL_ROLES)) expect(set.has('tasks:winBeta')).toBe(false)
    expect(TASKS_INVOKE_CHANNELS).toContain('tasks:winBeta')
    expect(CELULAR_POLICY['tasks:winBeta']).toBe('X')
    const d = decide({ kind: 'ipc', channel: 'tasks:winBeta', payload: { action: 'accept' } } as never, { allowedDirs: [] })
    expect(d).toMatchObject({ allow: false })
  })
})

describe('registro', () => {
  it('solo win32 con la puerta de compilación', () => {
    expect(tasksWinBetaHandled('win32', true)).toBe(true)
    expect(tasksWinBetaHandled('win32', false)).toBe(false)
    expect(tasksWinBetaHandled('darwin', true)).toBe(false)
    expect(tasksWinBetaHandled('linux', true)).toBe(false)
    expect(tasksWinBetaHandled('win32')).toBe(false) // el literal real sigue apagado
  })
  it('darwin o sin build: no registra el handler real y el stub responde available:false', async () => {
    for (const over of [{ platform: 'darwin' }, { build: false }]) {
      const s = setup(over)
      expect(s.registered).toBe(false)
      expect(s.handlers.size).toBe(0)
      const { ipc, handlers } = fakeIpc()
      registerUnsupportedHandlers(ipc, capsFor(over.platform ?? 'win32'), { winBetaHandled: s.registered })
      expect(handlers.has('tasks:winBeta')).toBe(true)
      expect((await handlers.get('tasks:winBeta')!({}, { action: 'accept' })).data).toMatchObject({ available: false, consent: false })
      expect(existsSync(join(dir, TASKS_WIN_BETA_CONSENT_FILE))).toBe(false)
    }
  })
  it('win32 con build: se registra aunque tasksWin esté apagada (active:false) y el stub no lo pisa', () => {
    const s = setup({ active: false })
    expect(s.registered).toBe(true)
    const { ipc, handlers } = fakeIpc()
    expect(registerUnsupportedHandlers(ipc, capsFor('win32'), { winBetaHandled: s.registered })).not.toContain('tasks:winBeta')
    expect(handlers.has('tasks:winBeta')).toBe(false)
  })
})

describe('flujo de consentimiento en main', () => {
  it('sin consentimiento: view lo dice y no hay reinicio pendiente', async () => {
    const { call } = setup()
    expect(await call('view')).toMatchObject({
      available: true,
      consent: false,
      stale: false,
      armed: false,
      active: false,
      restartRequired: false
    })
  })
  it('aceptar antes de 600 ms (o sin casilla) no concede y no escribe nada', async () => {
    const { call } = setup()
    await call('show')
    expect(await call('accept')).toMatchObject({ granted: false, consent: false })
    await call('check')
    clock += 599
    expect(await call('accept')).toMatchObject({ granted: false, consent: false, armed: false })
    expect(existsSync(join(dir, TASKS_WIN_BETA_CONSENT_FILE))).toBe(false)
  })
  it('casilla + 600 ms: concede, escribe el archivo y pide reiniciar; «Reiniciar» solo entonces reinicia', async () => {
    const { call, relaunch } = setup()
    expect(await call('restart')).toMatchObject({ restartRequired: false })
    expect(relaunch).not.toHaveBeenCalled()
    await call('show')
    await call('check')
    clock += 600
    expect(await call('view')).toMatchObject({ armed: true })
    expect(await call('accept')).toMatchObject({ granted: true, consent: true, restartRequired: true, active: false })
    expect(existsSync(join(dir, TASKS_WIN_BETA_CONSENT_FILE))).toBe(true)
    await call('restart')
    expect(relaunch).toHaveBeenCalledTimes(1)
  })
  it('revocar es inmediato; con la beta activa en este arranque pide reiniciar', async () => {
    const { call, relaunch } = setup({ active: true })
    writeFileSync(join(dir, TASKS_WIN_BETA_CONSENT_FILE), JSON.stringify({ version: 1, at: 1 }))
    expect(await call('view')).toMatchObject({ consent: true, active: true, restartRequired: false })
    expect(await call('revoke')).toMatchObject({ consent: false, restartRequired: true })
    expect(existsSync(join(dir, TASKS_WIN_BETA_CONSENT_FILE))).toBe(false)
    await call('restart')
    expect(relaunch).toHaveBeenCalledTimes(1)
  })
  it('un archivo de otra versión se ve «stale» y no cuenta', async () => {
    const { call } = setup()
    writeFileSync(join(dir, TASKS_WIN_BETA_CONSENT_FILE), JSON.stringify({ version: 7, at: 1 }))
    expect(await call('view')).toMatchObject({ consent: false, stale: true })
  })
  it('settings.tasksWinBeta=true (legado, escrito por el renderer) no cuenta como consentimiento', async () => {
    const { call } = setup()
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ tasksWinBeta: true }))
    expect(await call('view')).toMatchObject({ consent: false, restartRequired: false })
  })
})

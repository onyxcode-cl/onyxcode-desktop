import { describe, expect, it, vi } from 'vitest'
import type { PreflightId, Runtime } from '@shared/preflight'
import { runInstall, type InstallApi } from './preflight-run'
import { failureKey, hintKey, sizeParts } from './preflight-view'
import { en } from '@shared/i18n/en'
import { es } from '@shared/i18n/es'

function harness(over: Partial<InstallApi> = {}) {
  const log: string[] = []
  const runtime: Array<[PreflightId, Runtime | null]> = []
  const details: Record<string, string> = {}
  const api: InstallApi = {
    craftInstall: vi.fn(async () => (log.push('craft'), { ok: true })),
    craftProgress: vi.fn(async () => 42),
    sandboxSetup: vi.fn(async () => log.push('sandbox')),
    sandboxStatus: vi.fn(async () => ({ state: 'ready', setup: null })),
    fail: vi.fn(async (id, code) => ({ detail: `detalle ${id} ${code}` })),
    sleep: async () => undefined,
    alive: () => true,
    ...over
  }
  const ev = {
    onRuntime: (id: PreflightId, rt: Runtime | null) => void runtime.push([id, rt]),
    onDetail: (id: PreflightId, d: string) => void (details[id] = d)
  }
  return { api, ev, log, runtime, details }
}

describe('instalación en orden con progreso', () => {
  it('instala ArtCraft y luego el entorno aislado, y limpia el estado de cada uno al terminar', async () => {
    const h = harness()
    const out = await runInstall(['craft', 'sandbox'], h.api, h.ev)
    expect(h.log).toEqual(['craft', 'sandbox'])
    expect(out).toEqual([
      { id: 'craft', ok: true },
      { id: 'sandbox', ok: true }
    ])
    expect(h.runtime.at(-1)).toEqual(['sandbox', null])
    expect(h.runtime).toContainEqual(['craft', null])
    expect(h.api.fail).not.toHaveBeenCalled()
  })
  it('informa el porcentaje real de la descarga de ArtCraft', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    let ticks = 0
    const h = harness({
      craftInstall: async () => (await gate, { ok: true }),
      craftProgress: async () => (ticks++ === 1 ? (release(), 80) : 30),
      sleep: () => new Promise((r) => setTimeout(r, 0))
    })
    await runInstall(['craft'], h.api, h.ev)
    const pcts = h.runtime.filter(([, rt]) => rt?.state === 'downloading' && rt.pct !== undefined).map(([, rt]) => rt?.pct)
    expect(pcts).toContain(30)
    expect(pcts).toContain(80)
  })
  it('un fallo de ArtCraft deja el motivo real, lo anota y sigue con el siguiente', async () => {
    const h = harness({ craftInstall: async () => ({ ok: false, error: 'disk', message: 'Espacio insuficiente' }) })
    const out = await runInstall(['craft', 'sandbox'], h.api, h.ev)
    expect(out[0]).toEqual({ id: 'craft', ok: false, code: 'disk', message: 'Espacio insuficiente' })
    expect(h.runtime).toContainEqual(['craft', { state: 'failed', error: 'disk' }])
    expect(h.api.fail).toHaveBeenCalledWith('craft', 'disk', 'Espacio insuficiente')
    expect(h.details.craft).toBe('detalle craft disk')
    expect(out[1]).toEqual({ id: 'sandbox', ok: true })
  })
  it('si el IPC ni responde se informa «download», nunca un fallo sin motivo', async () => {
    const h = harness({ craftInstall: async () => undefined })
    const [r] = await runInstall(['craft'], h.api, h.ev)
    expect(r).toMatchObject({ ok: false, code: 'download' })
  })
  it('entorno aislado: espera a que termine la instalación en main y toma el código de su fallo', async () => {
    const states = [
      { state: 'needsSetup', setup: { running: true, pct: 10 } },
      { state: 'needsSetup', setup: { running: true, pct: 60 } },
      { state: 'needsSetup', setup: { running: false, pct: 0, error: 'no-space' } }
    ]
    const h = harness({ sandboxStatus: async () => states.shift() ?? { state: 'needsSetup', setup: null } })
    const [r] = await runInstall(['sandbox'], h.api, h.ev)
    expect(r).toEqual({ id: 'sandbox', ok: false, code: 'no-space', message: undefined })
    expect(h.runtime).toContainEqual(['sandbox', { state: 'downloading', pct: 60 }])
    expect(h.api.fail).toHaveBeenCalledWith('sandbox', 'no-space', undefined)
  })
  it('entorno aislado que termina listo', async () => {
    const states = [
      { state: 'needsSetup', setup: { running: true, pct: 90 } },
      { state: 'ready', setup: null }
    ]
    const h = harness({ sandboxStatus: async () => states.shift() ?? { state: 'ready', setup: null } })
    expect((await runInstall(['sandbox'], h.api, h.ev))[0]).toEqual({ id: 'sandbox', ok: true })
  })
  it('si la pantalla se cierra no sigue instalando', async () => {
    let alive = true
    const h = harness({ craftInstall: async () => ((alive = false), { ok: true }), alive: () => alive })
    const out = await runInstall(['craft', 'sandbox'], h.api, h.ev)
    expect(out).toHaveLength(1)
  })
})

describe('textos de la pantalla', () => {
  it('cada fallo tiene un motivo legible, para ArtCraft y para el entorno aislado', () => {
    expect(failureKey('craft', 'disk')).toBe('settings.craft.error.disk')
    expect(failureKey('craft', 'hash')).toBe('settings.craft.error.hash')
    expect(failureKey('craft', undefined)).toBe('settings.craft.error.generic')
    expect(failureKey('sandbox', 'offline')).toBe('tasks.sandbox.error.offline')
    expect(failureKey('sandbox', 'no-space')).toBe('tasks.sandbox.error.no-space')
    expect(failureKey('sandbox', 'rarisimo')).toBe('tasks.sandbox.error.generic')
    expect(failureKey('engine', 'x')).toBe('preflight.error.engine')
  })
  it('hint por componente y motivo, y genérico para lo desconocido; nada si está listo', () => {
    const c = (o: object) => ({ id: 'craft' as const, essential: true, ok: false, installable: true, ...o })
    expect(hintKey(c({ reason: 'incomplete' }))).toBe('preflight.hint.craft.incomplete')
    expect(hintKey(c({ id: 'perms', essential: false, reason: 'restart' }))).toBe('preflight.hint.perms.restart')
    expect(hintKey(c({ id: 'sandbox', reason: 'needsWsl' }))).toBe('preflight.hint.sandbox.other')
    expect(hintKey(c({ id: 'helper', essential: false, reason: 'x' }))).toBe('preflight.hint.generic.optional')
    expect(hintKey(c({ ok: true }))).toBeNull()
  })
  it('tamaños: MB por debajo de 1 GB y GB con un decimal por encima', () => {
    expect(sizeParts(300e6)).toEqual({ key: 'preflight.size.mb', n: '300' })
    expect(sizeParts(2.3e9, 'en-US')).toEqual({ key: 'preflight.size.gb', n: '2.3' })
    expect(sizeParts(2.3e9, 'es')).toEqual({ key: 'preflight.size.gb', n: '2,3' })
    expect(sizeParts(10)).toEqual({ key: 'preflight.size.mb', n: '1' })
  })
  it('todas las claves de la pantalla existen en español e inglés', () => {
    const keys = Object.keys(es).filter((k) => k.startsWith('preflight.') || k.startsWith('settings.diag.components.'))
    expect(keys.length).toBeGreaterThan(40)
    for (const k of keys) expect(en, k).toHaveProperty([k])
  })
})

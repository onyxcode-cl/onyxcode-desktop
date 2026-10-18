import { describe, expect, it, vi } from 'vitest'
import { blocking, installPlan, optionalPending, type PreflightComponent } from '@shared/preflight'
import type { CraftPart } from '../office/craft/craft-install'
import { failureDetail, placementOf, runPreflightChecks, skippedReport, type CraftCheck, type PreflightDeps } from './service'

const part = (name: string, problem: CraftPart['problem'] = null): CraftPart => ({ name, kind: 'cli', problem, sizeBytes: 100e6 })
const ALL = ['deckcraft', 'wordcraft', 'gridcraft', 'web-deckcraft', 'web-wordcraft', 'web-gridcraft', 'web-extra']
const installed: CraftCheck = { state: 'installed', version: '0.5.0', parts: ALL.map((n) => part(n)) }

const deps = (o: Partial<PreflightDeps> = {}): PreflightDeps => ({
  platform: 'darwin',
  appVersion: '0.5.12',
  now: () => 1000,
  engine: async () => ({ found: true, version: '1.2.3' }),
  craft: () => installed,
  freeBytes: () => 50e9,
  userDataWritable: () => true,
  ...o
})
const get = async (o: Partial<PreflightDeps> = {}, id: PreflightComponent['id']): Promise<PreflightComponent | undefined> =>
  (await runPreflightChecks(deps(o))).components.find((c) => c.id === id)

describe('revisión de arranque: todo listo', () => {
  it('motor y ArtCraft completos, disco y carpeta de datos bien: nada que mostrar', async () => {
    const r = await runPreflightChecks(deps())
    expect(blocking(r)).toEqual([])
    expect(optionalPending(r)).toEqual([])
    expect(r.components.find((c) => c.id === 'engine')).toMatchObject({ ok: true, version: '1.2.3' })
    expect(r.components.find((c) => c.id === 'craft')).toMatchObject({ ok: true, version: '0.5.0' })
    expect(r.at).toBe(1000)
  })
})

describe('Node.js y uv (conectores locales, F8-B195)', () => {
  const rt =
    (o: Partial<ReturnType<NonNullable<PreflightDeps['runtimes']>>> = {}): NonNullable<PreflightDeps['runtimes']> =>
    () => ({
      offered: true,
      ready: false,
      broken: false,
      sizeBytes: 67_329_746,
      version: '24.22.0',
      ...o
    })
  it('faltan: componente opcional e instalable, con su tamaño; no bloquea', async () => {
    const r = await runPreflightChecks(deps({ runtimes: rt() }))
    expect(r.components.find((c) => c.id === 'runtimes')).toMatchObject({
      essential: false,
      ok: false,
      installable: true,
      reason: 'missing',
      sizeBytes: 67_329_746
    })
    expect(blocking(r)).toEqual([])
    expect(installPlan(r).map((c) => c.id)).toEqual(['runtimes'])
  })
  it('dañados: el motivo es «broken» (se vuelven a bajar)', async () => {
    expect(await get({ runtimes: rt({ broken: true }) }, 'runtimes')).toMatchObject({ ok: false, reason: 'broken' })
  })
  it('listos: ok y sin nada pendiente', async () => {
    const r = await runPreflightChecks(deps({ runtimes: rt({ ready: true, sizeBytes: 0 }) }))
    expect(r.components.find((c) => c.id === 'runtimes')).toMatchObject({ ok: true })
    expect(optionalPending(r)).toEqual([])
  })
  it('en una plataforma sin conectores locales no aparece (Windows hoy)', async () => {
    expect(await get({ platform: 'win32', runtimes: rt({ offered: false }) }, 'runtimes')).toBeUndefined()
  })
  it('si la comprobación se rompe no bloquea y no aparece', async () => {
    const onCheckError = vi.fn()
    const c = await get(
      {
        runtimes: () => {
          throw new Error('x')
        },
        onCheckError
      },
      'runtimes'
    )
    expect(c).toBeUndefined()
    expect(onCheckError).toHaveBeenCalledWith('runtimes', expect.any(Error))
  })
  it('el disco avisa si no alcanza para ArtCraft + Node.js y uv', async () => {
    const r = await runPreflightChecks(deps({ runtimes: rt(), freeBytes: () => 300e6 }))
    expect(r.components.find((c) => c.id === 'disk')).toMatchObject({ ok: false, reason: 'low-space' })
  })
})

describe('motor', () => {
  it('ausente: esencial y no instalable', async () => {
    expect(await get({ engine: async () => ({ found: false, version: null }) }, 'engine')).toMatchObject({
      ok: false,
      essential: true,
      installable: false,
      reason: 'not-found'
    })
  })
  it('presente pero no responde a --version', async () => {
    expect(await get({ engine: async () => ({ found: true, version: null }) }, 'engine')).toMatchObject({
      ok: false,
      reason: 'not-responding'
    })
  })
  it('si la comprobación se rompe no bloquea la app y se anota', async () => {
    const onCheckError = vi.fn()
    const c = await get({ engine: async () => Promise.reject(new Error('boom')), onCheckError }, 'engine')
    expect(c?.ok).toBe(true)
    expect(onCheckError).toHaveBeenCalledWith('engine', expect.any(Error))
  })
  it('si tarda más del plazo tampoco bloquea', async () => {
    const onCheckError = vi.fn()
    const c = await get({ engine: () => new Promise(() => undefined), timeoutMs: 20, onCheckError }, 'engine')
    expect(c?.ok).toBe(true)
    expect(onCheckError).toHaveBeenCalled()
  })
})

describe('primer uso: solo el motor bloquea', () => {
  it('sin ArtCraft, sin espacio para instalarlo, con el entorno aislado por preparar: no bloquea nada', async () => {
    const r = await runPreflightChecks(
      deps({
        platform: 'win32',
        craft: () => ({ state: 'missing', version: '0.5.0', sizeBytes: 700e6, parts: ALL.map((n) => part(n, 'no-mark')) }),
        freeBytes: () => 1e9,
        sandbox: async () => ({ state: 'needsSetup' })
      })
    )
    expect(blocking(r)).toEqual([])
    expect(optionalPending(r).map((c) => c.id)).toEqual(['disk', 'craft', 'sandbox'])
  })
  it('sin motor sí bloquea', async () => {
    const r = await runPreflightChecks(deps({ engine: async () => ({ found: false, version: null }) }))
    expect(blocking(r).map((c) => c.id)).toEqual(['engine'])
  })
})

describe('ArtCraft', () => {
  it('nada instalado: falta entero con el tamaño a descargar', async () => {
    const craft: CraftCheck = {
      state: 'missing',
      version: '0.5.0',
      sizeBytes: 700e6,
      parts: ALL.map((n) => part(n, 'no-mark'))
    }
    expect(await get({ craft: () => craft }, 'craft')).toMatchObject({
      ok: false,
      essential: false,
      installable: true,
      reason: 'missing',
      sizeBytes: 700e6
    })
  })
  it('incompleto: una pieza con archivo truncado se marca como incompleto y se detalla', async () => {
    const parts = ALL.map((n) => part(n))
    parts[1] = part('wordcraft', 'truncated')
    const c = await get({ craft: () => ({ state: 'missing', version: '0.5.0', sizeBytes: 100e6, parts }) }, 'craft')
    expect(c).toMatchObject({ ok: false, reason: 'incomplete', sizeBytes: 100e6 })
    expect(c?.detail).toBe('piezas: wordcraft:truncated')
  })
  it('plataforma sin descarga fijada: el componente no aparece', async () => {
    expect(await get({ craft: () => ({ state: 'unsupported', parts: [] }) }, 'craft')).toBeUndefined()
  })
})

describe('disco y carpeta de datos', () => {
  const faltaCraft: CraftCheck = { state: 'missing', version: '0.5.0', sizeBytes: 300e6, parts: ALL.map((n) => part(n, 'no-mark')) }
  it('sin espacio para lo que falta (300 MB ×4): falla el disco con el detalle', async () => {
    const d = await get({ craft: () => faltaCraft, freeBytes: () => 1.1e9 }, 'disk')
    expect(d).toMatchObject({ ok: false, essential: false, reason: 'low-space' })
    expect(d?.detail).toContain('hacen falta 1200 MB')
  })
  it('con espacio justo alcanza', async () => {
    expect(await get({ craft: () => faltaCraft, freeBytes: () => 1.2e9 }, 'disk')).toMatchObject({ ok: true })
  })
  it('sin nada que instalar el espacio libre no importa', async () => {
    expect(await get({ freeBytes: () => 10 }, 'disk')).toMatchObject({ ok: true })
  })
  it('si no se puede medir el disco se intenta igual', async () => {
    expect(await get({ craft: () => faltaCraft, freeBytes: () => null }, 'disk')).toMatchObject({ ok: true })
  })
  it('carpeta de datos sin escritura: esencial y no instalable', async () => {
    expect(await get({ userDataWritable: () => false }, 'storage')).toMatchObject({
      ok: false,
      essential: true,
      installable: false,
      reason: 'not-writable'
    })
  })
})

describe('macOS: permisos, ubicación y ayudante (no esenciales)', () => {
  const mac = (status: { accessibility: boolean; screenRecording: boolean } | null, placement = null as never): Partial<PreflightDeps> => ({
    helperPresent: () => true,
    mac: { status: async () => status, placement: () => placement }
  })
  it('todo concedido y app en su sitio', async () => {
    const r = await runPreflightChecks(deps(mac({ accessibility: true, screenRecording: true })))
    expect(optionalPending(r)).toEqual([])
    expect(r.components.map((c) => c.id)).toEqual(expect.arrayContaining(['helper', 'perms', 'location']))
  })
  it.each([
    [{ accessibility: false, screenRecording: false }, 'both'],
    [{ accessibility: true, screenRecording: false }, 'restart'],
    [{ accessibility: false, screenRecording: true }, 'accessibility']
  ])('permisos %j -> %s, solo pendiente', async (st, reason) => {
    const r = await runPreflightChecks(deps(mac(st)))
    expect(r.components.find((c) => c.id === 'perms')).toMatchObject({ ok: false, essential: false, reason })
    expect(blocking(r)).toEqual([])
  })
  it('sin respuesta del ayudante de permisos: pendiente "unknown"', async () => {
    expect(await get(mac(null), 'perms')).toMatchObject({ ok: false, reason: 'unknown', essential: false })
  })
  it.each(['translocated', 'volume', 'elsewhere'] as const)('app en %s: pendiente', async (place) => {
    expect(await get(mac({ accessibility: true, screenRecording: true }, place as never), 'location')).toMatchObject({
      ok: false,
      essential: false,
      reason: place
    })
  })
  it('ayudante ausente', async () => {
    expect(await get({ ...mac({ accessibility: true, screenRecording: true }), helperPresent: () => false }, 'helper')).toMatchObject({
      ok: false,
      essential: false,
      reason: 'not-found'
    })
  })
})

describe('Windows: entorno aislado', () => {
  const win = (state: string, detail?: string): Partial<PreflightDeps> => ({ platform: 'win32', sandbox: async () => ({ state, detail }) })
  it('listo', async () => {
    expect(await get(win('ready'), 'sandbox')).toMatchObject({ ok: true })
  })
  it('por preparar: opcional e instalable con ~2 GB', async () => {
    const r = await runPreflightChecks(deps(win('needsSetup')))
    expect(r.components.find((c) => c.id === 'sandbox')).toMatchObject({
      ok: false,
      essential: false,
      installable: true,
      sizeBytes: 2_000_000_000
    })
    expect(installPlan(r).map((c) => c.id)).toEqual(['sandbox'])
  })
  it('imagen rota por el paquete se repara; rota por otra causa no', async () => {
    expect(await get(win('broken', 'payload'), 'sandbox')).toMatchObject({ installable: true, essential: false })
    expect(await get(win('broken', 'status'), 'sandbox')).toMatchObject({ installable: false, essential: false })
  })
  it('falta WSL o virtualización: avisa pero deja entrar', async () => {
    for (const s of ['needsWsl', 'needsWsl2', 'needsVirtualization']) {
      expect(await get(win(s), 'sandbox')).toMatchObject({ ok: false, essential: false, installable: false, reason: s })
    }
  })
  it('no soportado o bloqueado por la organización: sin componente', async () => {
    expect(await get(win('unsupported'), 'sandbox')).toBeUndefined()
    expect(await get(win('policyDisabled'), 'sandbox')).toBeUndefined()
  })
  it('espacio para ArtCraft + entorno aislado', async () => {
    const faltaCraft: CraftCheck = { state: 'missing', version: '0.5.0', sizeBytes: 300e6, parts: ALL.map((n) => part(n, 'no-mark')) }
    const need = 300e6 * 4 + 2e9
    expect(await get({ ...win('needsSetup'), craft: () => faltaCraft, freeBytes: () => need - 1 }, 'disk')).toMatchObject({ ok: false })
    expect(await get({ ...win('needsSetup'), craft: () => faltaCraft, freeBytes: () => need }, 'disk')).toMatchObject({ ok: true })
  })
})

describe('utilidades', () => {
  it('skippedReport no trae componentes', () => {
    expect(skippedReport(deps())).toMatchObject({ skipped: true, components: [] })
  })
  it('placementOf: translocada, volumen, fuera de Aplicaciones o normal; el desarrollo no cuenta', () => {
    const classify = (p: string): 'translocated' | 'volume' | null =>
      p.includes('/AppTranslocation/') ? 'translocated' : p.startsWith('/Volumes/') ? 'volume' : null
    const o = { home: '/Users/a', packaged: true, platform: 'darwin', classify }
    expect(placementOf({ ...o, execPath: '/private/var/AppTranslocation/x/Lazunox' })).toBe('translocated')
    expect(placementOf({ ...o, execPath: '/Volumes/Lazunox/Lazunox.app/x' })).toBe('volume')
    expect(placementOf({ ...o, execPath: '/Users/a/Downloads/Lazunox.app/x' })).toBe('elsewhere')
    expect(placementOf({ ...o, execPath: '/Applications/Lazunox.app/x' })).toBeNull()
    expect(placementOf({ ...o, execPath: '/Users/a/Applications/Lazunox.app/x' })).toBeNull()
    expect(placementOf({ ...o, packaged: false, execPath: '/repo/node_modules/electron' })).toBeNull()
    expect(placementOf({ ...o, platform: 'win32', execPath: 'C:\\x' })).toBeNull()
  })
  it('failureDetail junta componente, motivo, mensaje y sistema', () => {
    const t = failureDetail({ id: 'craft', code: 'disk', message: 'Sin espacio', platform: 'darwin', arch: 'arm64', appVersion: '0.5.12' })
    expect(t).toBe('Componente: craft\nMotivo: disk\nMensaje: Sin espacio\nApp: 0.5.12\nSistema: darwin arm64')
  })
})

/**
 * «Aceptar» del panel Cambios: estado de interfaz por sesión, persistido, que NO toca el disco ni el motor.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

type Store = typeof import('./store')
let useCode: Store['useCode']

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  ;({ useCode } = await import('./store'))
})

const st = (): ReturnType<Store['useCode']['getState']> => useCode.getState()

describe('store: aceptar cambios', () => {
  it('acceptFiles acumula por sesión y se guarda', () => {
    st().acceptFiles('s1', { 'a.ts': 'h1' })
    st().acceptFiles('s1', { 'b.ts': 'h2' })
    st().acceptFiles('s2', { 'a.ts': 'x' })
    expect(st().reviewed.s1.files).toEqual({ 'a.ts': 'h1', 'b.ts': 'h2' })
    expect(st().reviewed.s1.sig).toBeUndefined()
    expect(st().reviewed.s2.files).toEqual({ 'a.ts': 'x' })
    expect(JSON.parse(localStorage.getItem('code.reviewed') ?? '{}').s1.files['b.ts']).toBe('h2')
  })

  it('acceptSession guarda la huella del resumen además de los archivos', () => {
    st().acceptSession('s1', '2:10:3', { 'a.ts': 'h1' })
    expect(st().reviewed.s1).toEqual({ sig: '2:10:3', files: { 'a.ts': 'h1' } })
  })

  it('acceptSession sin huella (sin resumen) no inventa una', () => {
    st().acceptSession('s1', null, { 'a.ts': 'h1' })
    expect(st().reviewed.s1.sig).toBeUndefined()
  })

  it('se recupera al reiniciar (otra carga del store)', async () => {
    st().acceptSession('s1', '1:1:0', { 'a.ts': 'h1' })
    vi.resetModules()
    const again = (await import('./store')).useCode
    expect(again.getState().reviewed.s1).toEqual({ sig: '1:1:0', files: { 'a.ts': 'h1' } })
  })

  it('primera ejecución sin registro: fija «desde cuándo» y lo conserva al reiniciar', async () => {
    const since = st().reviewedSince
    expect(typeof since).toBe('number')
    expect(localStorage.getItem('code.reviewed.since')).toBe(String(since))
    vi.resetModules()
    const again = (await import('./store')).useCode
    expect(again.getState().reviewedSince).toBe(since)
  })

  it('con un registro ya existente (sin «desde») no hay migración: se juzga todo normal', async () => {
    localStorage.clear()
    localStorage.setItem('code.reviewed', '{}')
    vi.resetModules()
    const again = (await import('./store')).useCode
    expect(again.getState().reviewedSince).toBeNull()
  })

  it('baselineReviewed fija la huella sin pisar lo aceptado y se guarda', () => {
    st().acceptSession('s1', '1:1:0', {})
    st().baselineReviewed({ s1: '9:9:9', s2: '2:2:2' })
    expect(st().reviewed.s1.sig).toBe('1:1:0')
    expect(st().reviewed.s2).toEqual({ sig: '2:2:2', files: {} })
    expect(JSON.parse(localStorage.getItem('code.reviewed') ?? '{}').s2.sig).toBe('2:2:2')
  })

  it('un valor guardado corrupto no rompe el arranque', async () => {
    localStorage.setItem('code.reviewed', '{"s1": 7, "s2": {"files": {"a": 1}}}')
    vi.resetModules()
    const again = (await import('./store')).useCode
    expect(again.getState().reviewed).toEqual({ s2: { files: {} } })
  })
})

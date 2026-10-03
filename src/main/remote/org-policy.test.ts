import { mkdtempSync, rmSync, utimesSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NO_ORG_POLICY, OrgRemotePolicy, invalidRemotePolicy, parseRemotePolicy } from './org-policy'

describe('parseRemotePolicy', () => {
  it('sin bloque `remote`: sin restricciones (pero hay política)', () => {
    expect(parseRemotePolicy({ disableFullAccess: true })).toEqual({ ...NO_ORG_POLICY, managed: true })
  })
  it('valores válidos', () => {
    expect(
      parseRemotePolicy({
        remote: { enabled: true, allowRemember: false, requirePin: true, maxDevices: 2, deviceTtlDays: 30, allowConfirmRemember12h: false }
      })
    ).toEqual({
      managed: true,
      blocked: false,
      allowRemember: false,
      requirePin: true,
      maxDevices: 2,
      deviceTtlDays: 30,
      allowConfirmRemember12h: false
    })
  })
  it('enabled:false deshabilita; un enabled que no es booleano también (fail closed)', () => {
    expect(parseRemotePolicy({ remote: { enabled: false } }).blocked).toBe('disabled')
    for (const v of ['true', 1, null, [], {}]) expect(parseRemotePolicy({ remote: { enabled: v } }).blocked).toBe('invalid')
  })
  it('raíz o bloque inválido: deshabilitado', () => {
    for (const raw of [null, 3, 'x', [], { remote: 'sí' }, { remote: null }, { remote: [] }]) {
      expect(parseRemotePolicy(raw)).toEqual(invalidRemotePolicy())
    }
    expect(invalidRemotePolicy().blocked).toBe('invalid')
  })
  it('booleanos: lo que relaja exige `true` exacto; lo que endurece solo cede con `false` exacto', () => {
    const p = parseRemotePolicy({ remote: { allowRemember: 'true', allowConfirmRemember12h: 1, requirePin: 0 } })
    expect(p).toMatchObject({ allowRemember: false, allowConfirmRemember12h: false, requirePin: true })
    expect(parseRemotePolicy({ remote: { requirePin: false } }).requirePin).toBe(false)
  })
  it('números fuera de rango: se recortan; los inválidos son lo más restrictivo', () => {
    expect(parseRemotePolicy({ remote: { maxDevices: 99, deviceTtlDays: 9999 } })).toMatchObject({ maxDevices: 3, deviceTtlDays: 365 })
    expect(parseRemotePolicy({ remote: { maxDevices: -4, deviceTtlDays: 0 } })).toMatchObject({ maxDevices: 0, deviceTtlDays: 1 })
    expect(parseRemotePolicy({ remote: { maxDevices: 1.5, deviceTtlDays: 'abc' } })).toMatchObject({ maxDevices: 0, deviceTtlDays: 1 })
    expect(parseRemotePolicy({ remote: { maxDevices: null, deviceTtlDays: NaN } })).toMatchObject({ maxDevices: 0, deviceTtlDays: 1 })
  })
  it('claves desconocidas se ignoran', () => {
    expect(parseRemotePolicy({ remote: { enabled: true, algoNuevo: 1 } })).toEqual({ ...NO_ORG_POLICY, managed: true })
  })
})

describe('OrgRemotePolicy (archivo real)', () => {
  let dir: string
  let file: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'org-policy-'))
    file = join(dir, 'managed.json')
  })
  afterEach(() => {
    try {
      chmodSync(file, 0o600)
    } catch {
      /* no existe */
    }
    rmSync(dir, { recursive: true, force: true })
  })

  it('archivo ausente: sin política', () => {
    expect(new OrgRemotePolicy(() => file).get()).toBe(NO_ORG_POLICY)
  })
  it('archivo roto (JSON inválido o vacío): deshabilitado', () => {
    writeFileSync(file, '{ no es json')
    const p = new OrgRemotePolicy(() => file)
    expect(p.get()).toEqual(invalidRemotePolicy())
    writeFileSync(file, '')
    utimesSync(file, new Date(2030, 0, 1), new Date(2030, 0, 1))
    expect(p.get().blocked).toBe('invalid')
  })
  it('archivo ilegible por permisos: deshabilitado', () => {
    writeFileSync(file, '{}')
    chmodSync(file, 0o000)
    if (process.getuid?.() === 0) return // root lo lee igualmente
    expect(new OrgRemotePolicy(() => file).get().blocked).toBe('invalid')
  })
  it('se aplica en caliente: cambios del archivo se ven sin reiniciar, y al borrarlo vuelve a no haber política', () => {
    writeFileSync(file, JSON.stringify({ remote: { enabled: true, deviceTtlDays: 90 } }))
    const p = new OrgRemotePolicy(() => file)
    expect(p.get()).toMatchObject({ blocked: false, deviceTtlDays: 90 })
    writeFileSync(file, JSON.stringify({ remote: { enabled: false } }))
    utimesSync(file, new Date(2031, 0, 1), new Date(2031, 0, 1))
    expect(p.get().blocked).toBe('disabled')
    writeFileSync(file, '[1]')
    utimesSync(file, new Date(2032, 0, 1), new Date(2032, 0, 1))
    expect(p.get().blocked).toBe('invalid')
    rmSync(file)
    expect(p.get()).toBe(NO_ORG_POLICY)
  })
  it('precedencia: la política manda; el usuario no tiene ruta para saltársela (el resultado no depende del entorno)', () => {
    writeFileSync(file, JSON.stringify({ remote: { enabled: false } }))
    const before = process.env.ONYXCODE_REMOTE
    process.env.ONYXCODE_REMOTE = '1'
    try {
      expect(new OrgRemotePolicy(() => file).get().blocked).toBe('disabled')
    } finally {
      if (before === undefined) delete process.env.ONYXCODE_REMOTE
      else process.env.ONYXCODE_REMOTE = before
    }
  })
  it('sin lectura repetida: mientras el archivo no cambie devuelve el mismo objeto', () => {
    writeFileSync(file, JSON.stringify({ remote: { maxDevices: 1 } }))
    const p = new OrgRemotePolicy(() => file)
    expect(p.get()).toBe(p.get())
  })
})

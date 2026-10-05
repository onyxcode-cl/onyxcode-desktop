import { mkdtempSync, rmSync, utimesSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NO_ORG_POLICY, OrgRemotePolicy, invalidRemotePolicy, parseRemotePolicy } from './org-policy'

describe('parseRemotePolicy', () => {
  /** Lo que queda cerrado con un archivo de política que no lo dice (fuera de casa y modo viaje). */
  const OUTSIDE_CLOSED = {
    allowOutsideNetwork: false,
    allowRelay: false,
    allowPush: false,
    allowTravelMode: false,
    travelMaxHours: 1,
    allowTravelRelay: false,
    allowTravelDownload: false
  }

  it('sin bloque `remote`: lo de siempre sin restricciones, pero «fuera de casa» cerrado (hay política y no lo autorizó)', () => {
    expect(parseRemotePolicy({ disableFullAccess: true })).toEqual({ ...NO_ORG_POLICY, managed: true, ...OUTSIDE_CLOSED })
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
      allowConfirmRemember12h: false,
      requireConnectionConfirm: false,
      ...OUTSIDE_CLOSED,
      requirePasskey: false
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
  it('requireConnectionConfirm: ausente = false; true = true; false = false; cualquier otro valor endurece (true)', () => {
    expect(parseRemotePolicy({ remote: {} }).requireConnectionConfirm).toBe(false)
    expect(NO_ORG_POLICY.requireConnectionConfirm).toBe(false)
    expect(parseRemotePolicy({ remote: { requireConnectionConfirm: true } }).requireConnectionConfirm).toBe(true)
    expect(parseRemotePolicy({ remote: { requireConnectionConfirm: false } }).requireConnectionConfirm).toBe(false)
    for (const v of ['sí', 'false', 0, 1, null, [], {}])
      expect(parseRemotePolicy({ remote: { requireConnectionConfirm: v } }).requireConnectionConfirm).toBe(true)
  })
  it('archivo inválido: la confirmación por conexión queda forzada (fail closed)', () => {
    expect(invalidRemotePolicy().requireConnectionConfirm).toBe(true)
    expect(parseRemotePolicy(null).requireConnectionConfirm).toBe(true)
  })
  it('números fuera de rango: se recortan; los inválidos son lo más restrictivo', () => {
    expect(parseRemotePolicy({ remote: { maxDevices: 99, deviceTtlDays: 9999 } })).toMatchObject({ maxDevices: 3, deviceTtlDays: 365 })
    expect(parseRemotePolicy({ remote: { maxDevices: -4, deviceTtlDays: 0 } })).toMatchObject({ maxDevices: 0, deviceTtlDays: 1 })
    expect(parseRemotePolicy({ remote: { maxDevices: 1.5, deviceTtlDays: 'abc' } })).toMatchObject({ maxDevices: 0, deviceTtlDays: 1 })
    expect(parseRemotePolicy({ remote: { maxDevices: null, deviceTtlDays: NaN } })).toMatchObject({ maxDevices: 0, deviceTtlDays: 1 })
  })
  it('claves desconocidas se ignoran', () => {
    expect(parseRemotePolicy({ remote: { enabled: true, algoNuevo: 1 } })).toEqual({ ...NO_ORG_POLICY, managed: true, ...OUTSIDE_CLOSED })
  })

  describe('fuera de casa (allowOutsideNetwork, allowRelay, allowPush, requirePasskey)', () => {
    it('sin archivo: todo permitido y sin passkey obligatoria', () => {
      expect(NO_ORG_POLICY).toMatchObject({ allowOutsideNetwork: true, allowRelay: true, allowPush: true, requirePasskey: false })
    })
    it('con archivo y clave ausente: lo que relaja queda en false; la passkey no se exige', () => {
      expect(parseRemotePolicy({ remote: {} })).toMatchObject({ ...OUTSIDE_CLOSED, requirePasskey: false })
    })
    it('solo `true` exacto permite; cualquier otro valor (raro) = false', () => {
      expect(parseRemotePolicy({ remote: { allowOutsideNetwork: true, allowRelay: true, allowPush: true } })).toMatchObject({
        allowOutsideNetwork: true,
        allowRelay: true,
        allowPush: true
      })
      for (const k of ['allowOutsideNetwork', 'allowRelay', 'allowPush'] as const)
        for (const v of ['true', 1, null, [], {}, false])
          expect(parseRemotePolicy({ remote: { [k]: v } })[k], `${k}=${String(v)}`).toBe(false)
    })
    it('requirePasskey: solo `false` exacto cede; cualquier otro valor endurece', () => {
      expect(parseRemotePolicy({ remote: { requirePasskey: false } }).requirePasskey).toBe(false)
      for (const v of [true, 'no', 0, null, [], {}]) expect(parseRemotePolicy({ remote: { requirePasskey: v } }).requirePasskey).toBe(true)
    })
    it('archivo inválido: nada fuera de casa y passkey exigida', () => {
      expect(invalidRemotePolicy()).toMatchObject({ ...OUTSIDE_CLOSED, requirePasskey: true })
      expect(parseRemotePolicy(null)).toMatchObject({ ...OUTSIDE_CLOSED, requirePasskey: true })
    })
    it('relajar una no relaja las demás', () => {
      expect(parseRemotePolicy({ remote: { allowOutsideNetwork: true } })).toMatchObject({
        allowOutsideNetwork: true,
        allowRelay: false,
        allowPush: false
      })
    })
  })
})

describe('modo viaje (allowTravelMode, travelMaxHours, allowTravelRelay, allowTravelDownload)', () => {
  it('sin archivo: permitido, 24 h', () => {
    expect(NO_ORG_POLICY).toMatchObject({ allowTravelMode: true, travelMaxHours: 24, allowTravelRelay: true, allowTravelDownload: true })
  })
  it('con archivo y la clave ausente: cerrado y 1 h (fail closed), con o sin bloque `remote`', () => {
    for (const raw of [{}, { remote: {} }, { disableFullAccess: true }, { remote: { enabled: true } }])
      expect(parseRemotePolicy(raw), JSON.stringify(raw)).toMatchObject({
        allowTravelMode: false,
        travelMaxHours: 1,
        allowTravelRelay: false,
        allowTravelDownload: false
      })
  })
  it('solo `true` exacto permite; cualquier otro valor raro = false', () => {
    expect(parseRemotePolicy({ remote: { allowTravelMode: true, allowTravelRelay: true, allowTravelDownload: true } })).toMatchObject({
      allowTravelMode: true,
      allowTravelRelay: true,
      allowTravelDownload: true
    })
    for (const k of ['allowTravelMode', 'allowTravelRelay', 'allowTravelDownload'] as const)
      for (const v of ['true', 'sí', 1, null, [], {}, false, undefined])
        expect(parseRemotePolicy({ remote: { [k]: v } })[k], `${k}=${String(v)}`).toBe(false)
  })
  it('relajar una clave no relaja las demás', () => {
    expect(parseRemotePolicy({ remote: { allowTravelMode: true } })).toMatchObject({
      allowTravelMode: true,
      allowTravelRelay: false,
      allowTravelDownload: false,
      allowOutsideNetwork: false
    })
    expect(parseRemotePolicy({ remote: { allowOutsideNetwork: true } }).allowTravelMode).toBe(false)
  })
  it('travelMaxHours: entero 1–24 (recorta); no entero o raro = 1; ausente con archivo = 1', () => {
    const h = (v: unknown): number => parseRemotePolicy({ remote: { travelMaxHours: v } }).travelMaxHours
    expect([h(1), h(6), h(24)]).toEqual([1, 6, 24])
    expect([h(0), h(-3), h(25), h(9999)]).toEqual([1, 1, 24, 24])
    for (const v of [1.5, '12', null, NaN, Infinity, [], {}, true]) expect(h(v), String(v)).toBe(1)
    expect(parseRemotePolicy({ remote: {} }).travelMaxHours).toBe(1)
  })
  it('archivo inválido o bloqueado: todo cerrado', () => {
    for (const p of [invalidRemotePolicy(), parseRemotePolicy(null), parseRemotePolicy({ remote: 'x' })])
      expect(p).toMatchObject({ allowTravelMode: false, travelMaxHours: 1, allowTravelRelay: false, allowTravelDownload: false })
  })
  it('requireConnectionConfirm o requirePasskey de la política NO se tocan por las claves de viaje', () => {
    expect(parseRemotePolicy({ remote: { allowTravelMode: true, requireConnectionConfirm: true } })).toMatchObject({
      allowTravelMode: true,
      requireConnectionConfirm: true
    })
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

import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({ app: { isPackaged: false } as { isPackaged: boolean } | undefined }))
vi.mock('electron', () => ({
  get app() {
    return electron.app
  }
}))

import { adminPolicyProbe, DEV_POLICY_OVERRIDE_VAR, pathPresent } from './engine-lastmile'

let tmp: string
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'lazunox-lm-'))
  electron.app = { isPackaged: false }
})
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('pathPresent: solo «no existe» cuenta como ausente', () => {
  it('archivo, carpeta y enlace roto cuentan como presentes (el motor decide; si no es un archivo, falla cerrado)', () => {
    writeFileSync(join(tmp, 'a.json'), '{}')
    mkdirSync(join(tmp, 'carpeta'))
    expect(pathPresent(join(tmp, 'a.json'))).toBe(true)
    expect(pathPresent(join(tmp, 'carpeta'))).toBe(true)
    if (process.platform !== 'win32') {
      symlinkSync(join(tmp, 'no-existe'), join(tmp, 'roto.json'))
      expect(pathPresent(join(tmp, 'roto.json'))).toBe(true)
    }
  })
  it('ENOENT y ENOTDIR son ausente', () => {
    expect(pathPresent(join(tmp, 'no-existe.json'))).toBe(false)
    writeFileSync(join(tmp, 'f'), 'x')
    expect(pathPresent(join(tmp, 'f', 'dentro.json'))).toBe(false)
  })
  it('un error al mirar (sin permiso) cuenta como PRESENTE: falla cerrado, no «sin política»', () => {
    if (process.platform === 'win32' || process.getuid?.() === 0) return
    const d = join(tmp, 'cerrada')
    mkdirSync(d)
    writeFileSync(join(d, 'motor-policy.json'), '{}')
    chmodSync(d, 0o000)
    try {
      expect(pathPresent(join(d, 'motor-policy.json'))).toBe(true)
    } finally {
      chmodSync(d, 0o700)
    }
  })
})

describe('adminPolicyProbe', () => {
  it('sin override mira la ruta de administrador de la plataforma', () => {
    const vistas: string[] = []
    const p = adminPolicyProbe('darwin', {}, (x) => (vistas.push(x), true))
    expect(vistas).toEqual(['/Library/Application Support/Lazunox/motor-policy.json'])
    expect(p).toMatchObject({ platform: 'darwin', exists: true, devOverride: undefined })
    const w = adminPolicyProbe('win32', { ProgramData: 'C:\\ProgramData' }, (x) => (vistas.push(x), false))
    expect(vistas[1]).toBe('C:\\ProgramData\\Lazunox\\motor-policy.json')
    expect(w.exists).toBe(false)
  })
  it('en desarrollo, el override absoluto sustituye la ruta; uno relativo se ignora', () => {
    const vistas: string[] = []
    const ok = adminPolicyProbe('darwin', { [DEV_POLICY_OVERRIDE_VAR]: '/tmp/p.json' }, (x) => (vistas.push(x), true))
    expect(vistas[0]).toBe('/tmp/p.json')
    expect(ok.devOverride).toBe('/tmp/p.json')
    const rel = adminPolicyProbe('darwin', { [DEV_POLICY_OVERRIDE_VAR]: 'p.json' }, (x) => (vistas.push(x), true))
    expect(vistas[1]).toBe('/Library/Application Support/Lazunox/motor-policy.json')
    expect(rel.devOverride).toBeUndefined()
  })
  it('EMPAQUETADA, el override se ignora siempre', () => {
    electron.app = { isPackaged: true }
    const vistas: string[] = []
    const p = adminPolicyProbe('darwin', { [DEV_POLICY_OVERRIDE_VAR]: '/tmp/p.json' }, (x) => (vistas.push(x), true))
    expect(vistas).toEqual(['/Library/Application Support/Lazunox/motor-policy.json'])
    expect(p.devOverride).toBeUndefined()
  })
  it('sin Electron (no se puede saber si está empaquetada) se trata como empaquetada', () => {
    electron.app = undefined
    const vistas: string[] = []
    adminPolicyProbe('darwin', { [DEV_POLICY_OVERRIDE_VAR]: '/tmp/p.json' }, (x) => (vistas.push(x), true))
    expect(vistas).toEqual(['/Library/Application Support/Lazunox/motor-policy.json'])
  })
})

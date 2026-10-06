import { describe, expect, it } from 'vitest'
import attack from './__fixtures__/attack-paths.json'
import { isApprovedPath, resolveUiPath, type ApprovedData } from './ui-path'
import { isInside } from '../util/paths'

describe('resolveUiPath en win32 (tabla compartida attack-paths.json)', () => {
  it.each(attack.reject.map((c) => [c.id, c.ui, c.reason] as const))('rechaza %s', (_id, ui, reason) => {
    expect(resolveUiPath(ui, 'win32')).toEqual({ ok: false, reason })
  })
  it.each(attack.accept.map((c) => [c.id, c.ui, c.win] as const))('acepta %s y lo canoniza', (_id, ui, win) => {
    expect(resolveUiPath(ui, 'win32')).toEqual({ ok: true, path: win })
  })
  it('es idempotente sobre su propia salida', () => {
    for (const c of attack.accept) {
      const once = resolveUiPath(c.ui, 'win32')
      if (!once.ok) throw new Error(c.id)
      expect(resolveUiPath(once.path, 'win32')).toEqual(once)
    }
  })
  it('un valor no cadena falla cerrado', () => {
    expect(resolveUiPath(undefined as unknown as string, 'win32').ok).toBe(false)
    expect(resolveUiPath(42 as unknown as string, 'darwin').ok).toBe(false)
  })
})

describe('resolveUiPath en darwin y linux: identidad', () => {
  it.each(['/Users/ben/x', '/win/c/x', 'relativa/x', '/a/../b', '\\\\srv\\x', 'C:\\x:ads', '/etc/passwd'])('%s', (p) => {
    for (const platform of ['darwin', 'linux'] as const) expect(resolveUiPath(p, platform)).toEqual({ ok: true, path: p })
  })
})

describe('isApprovedPath', () => {
  const data: ApprovedData = {
    folders: [{ path: 'C:\\Work\\a' }],
    linked: { x: [{ path: 'D:\\Link' }] },
    trusted: [{ path: 'C:\\Trust' }]
  }
  const inside = (p: string, d: string): boolean => isInside(p, d, 'win32')
  it('carpetas, vinculadas y de confianza', () => {
    expect(isApprovedPath('C:\\Work\\a\\f.txt', data, inside)).toBe(true)
    expect(isApprovedPath('d:\\link\\z', data, inside)).toBe(true)
    expect(isApprovedPath('C:\\Trust', data, inside)).toBe(true)
  })
  it('lo demás no, ni hermanas con el mismo prefijo, ni la forma Linux sin traducir', () => {
    expect(isApprovedPath('C:\\Work\\ab', data, inside)).toBe(false)
    expect(isApprovedPath('C:\\Windows', data, inside)).toBe(false)
    expect(isApprovedPath('/win/c/Work/a/f', data, inside)).toBe(false)
    expect(isApprovedPath('C:\\win\\c\\Work\\a', data, inside)).toBe(false)
  })
  it('sin datos no aprueba nada', () => {
    expect(isApprovedPath('C:\\x', { folders: [], linked: {}, trusted: [] }, inside)).toBe(false)
  })
})

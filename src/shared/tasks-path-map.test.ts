import { describe, expect, it } from 'vitest'
import attack from '../main/tasks/__fixtures__/attack-paths.json'
import { displayPath, IDENTITY_MAP, toHost, toSandbox, toSandboxOrNull, type PathMapWire } from './tasks-path-map'
import { mountFor, type PathMount } from './wsl-paths'

const mount = (w: string): PathMount => {
  const m = mountFor(w)
  if (!m.ok) throw new Error(w)
  return m.mount
}
const wsl = (...folders: string[]): PathMapWire => ({ kind: 'wsl', mounts: folders.map(mount) })

describe('identity (macOS): todo es identidad', () => {
  it.each(['/Users/ben/x', '/win/c/x', 'C:\\x', ''])('%s', (p) => {
    expect(toHost(IDENTITY_MAP, p)).toBe(p)
    expect(toSandbox(IDENTITY_MAP, p)).toBe(p)
    expect(toSandboxOrNull(IDENTITY_MAP, p)).toBe(p)
    expect(displayPath(IDENTITY_MAP, p)).toBe(p)
  })
})

describe('wsl: biyección Windows ⇄ /win/<letra>', () => {
  it('ida y vuelta de todos los vectores aceptados (la carpeta es la raíz de la unidad)', () => {
    for (const c of attack.accept) {
      const drive = c.win.slice(0, 3)
      const map = wsl(drive)
      const sb = toSandboxOrNull(map, c.ui.startsWith('/') ? c.win : c.ui)
      expect(sb, c.id).toBe(c.sandbox)
      expect(toHost(map, sb!), c.id).toBe(c.win)
      // vuelta: toSandbox(toHost(x)) = x
      expect(toSandbox(map, toHost(map, c.sandbox)!), c.id).toBe(c.sandbox)
    }
  })
  it('toHost solo traduce dentro de los montajes', () => {
    const map = wsl('C:\\Users\\Ben\\Docs')
    expect(toHost(map, '/win/c/Users/Ben/Docs/a.txt')).toBe('C:\\Users\\Ben\\Docs\\a.txt')
    expect(toHost(map, '/win/c/Users/Ben')).toBeNull()
    expect(toHost(map, '/win/d/x')).toBeNull()
    expect(toHost(map, '/etc/passwd')).toBeNull()
    expect(toHost(map, '/win/c/Users/Ben/Docs/../../x')).toBeNull()
  })
  it('los vectores de rechazo no producen ruta de sandbox', () => {
    const map = wsl('C:\\a')
    for (const c of attack.reject) {
      if (/^\/(?!\/)/.test(c.ui)) continue
      expect(toSandboxOrNull(map, c.ui), c.id).toBeNull()
    }
  })
  it('toSandbox deja la ruta intacta si no traduce; toSandboxOrNull da null', () => {
    const map = wsl('C:\\a')
    expect(toSandbox(map, '\\\\srv\\x')).toBe('\\\\srv\\x')
    expect(toSandboxOrNull(map, '\\\\srv\\x')).toBeNull()
  })
  it('displayPath: montajes, luego forma /win/…, si no la ruta sin tocar', () => {
    const map = wsl('C:\\a')
    expect(displayPath(map, '/win/c/a/b')).toBe('C:\\a\\b')
    expect(displayPath(map, '/win/d/otra/x')).toBe('D:\\otra\\x')
    expect(displayPath(map, '/etc/hosts')).toBe('/etc/hosts')
    expect(displayPath(map, '/win/c/a/../x')).toBe('/win/c/a/../x')
    expect(displayPath(map, 'texto libre')).toBe('texto libre')
  })
})

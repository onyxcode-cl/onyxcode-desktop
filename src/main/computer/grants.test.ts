import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ComputerGrantsStore } from './grants'

const chrome = 'exe:c:\\program files\\google\\chrome\\application\\chrome.exe|pub:google llc'
const notepad = 'exe:c:\\windows\\notepad.exe|pub:microsoft windows'
const consent = 'exe:c:\\windows\\system32\\consent.exe|pub:microsoft windows'
const own = 'exe:c:\\users\\a\\appdata\\local\\programs\\lazunox\\lazunox.exe|pub:lazunox'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'grants-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('concesiones por app con claves de Windows', () => {
  it('navegador: solo ver autoasignado; app desconocida: sin nivel (hay que preguntar)', () => {
    const g = new ComputerGrantsStore(join(dir, 'g.json'), 'win32')
    expect(g.resolve(chrome, 'Google Chrome')).toBe('view')
    expect(g.resolve(notepad, 'Bloc de notas')).toBeNull()
  })

  it('exentas (Lazunox, shell): siempre control total, sin tarjeta', () => {
    const g = new ComputerGrantsStore(join(dir, 'g.json'), 'win32')
    expect(g.resolve(own, 'Lazunox')).toBe('full')
  })

  it('bloqueadas: nunca concedibles, ni por concesión, ni desde Ajustes, ni con un archivo antiguo', () => {
    const g = new ComputerGrantsStore(join(dir, 'g.json'), 'win32')
    expect(g.isBlocked(consent)).toBe(true)
    expect(() => g.grant(consent, 'Consent', 'full')).toThrow()
    expect(g.resolve(consent, 'Consent')).toBeNull()
    expect(g.tierFor(consent)).toBeNull()
    // un nivel que ya estuviera en el archivo (editado a mano o de otra versión) tampoco vale
    const file = join(dir, 'old.json')
    writeFileSync(file, JSON.stringify({ grants: { [consent]: { bundleId: consent, name: 'x', tier: 'full', grantedAt: 1 } }, denied: [] }))
    const old = new ComputerGrantsStore(file, 'win32')
    expect(old.resolve(consent, 'x')).toBeNull()
    expect(old.tierFor(consent)).toBeNull()
  })

  it('conceder, subir y revocar funcionan igual que con bundle ids', () => {
    const g = new ComputerGrantsStore(join(dir, 'g.json'), 'win32')
    g.grant(notepad, 'Bloc de notas', 'click')
    expect(g.tierFor(notepad)).toBe('click')
    expect(g.snapshot().grants[0]).toMatchObject({ bundleId: notepad, tier: 'click' })
    g.deny(notepad)
    expect(g.resolve(notepad, 'Bloc')).toBeNull()
    g.undeny(notepad)
    g.revoke(notepad)
    expect(g.tierFor(notepad)).toBeNull()
  })
})

describe('macOS: sin cambios', () => {
  it('bundle ids: Safari solo ver, terminal ver y clic, Dock exento; nada se bloquea', () => {
    const g = new ComputerGrantsStore(join(dir, 'm.json'))
    expect(g.resolve('com.apple.Safari', 'Safari')).toBe('view')
    expect(g.resolve('com.apple.Terminal', 'Terminal')).toBe('click')
    expect(g.resolve('com.apple.dock', 'Dock')).toBe('full')
    expect(g.resolve('com.foo.bar', 'Foo')).toBeNull()
    expect(g.isBlocked(consent)).toBe(false)
    expect(g.grant(consent, 'x', 'view').tier).toBe('view')
  })
})

describe('macOS: apps bloqueadas (policy/mac-apps.ts)', () => {
  const pm = 'com.1password.1password'
  it('gestor de contraseñas: nunca concedible, ni por tarjeta ni desde Ajustes, ni con un archivo antiguo', () => {
    const g = new ComputerGrantsStore(join(dir, 'mb.json'))
    expect(g.isBlocked(pm)).toBe(true)
    expect(() => g.grant(pm, '1Password', 'full')).toThrow()
    expect(g.resolve(pm, '1Password')).toBeNull()
    expect(g.tierFor(pm)).toBeNull()
    const file = join(dir, 'mb-old.json')
    writeFileSync(file, JSON.stringify({ grants: { [pm]: { bundleId: pm, name: '1Password', tier: 'full', grantedAt: 1 } }, denied: [] }))
    const old = new ComputerGrantsStore(file)
    expect(old.resolve(pm, '1Password')).toBeNull()
    expect(old.tierFor(pm)).toBeNull()
  })

  it('apps normales de macOS siguen concediéndose y no quedan bloqueadas', () => {
    const g = new ComputerGrantsStore(join(dir, 'mn.json'))
    expect(g.isBlocked('com.apple.finder')).toBe(false)
    expect(g.isBlocked('com.apple.TextEdit')).toBe(false)
    expect(g.grant('com.apple.TextEdit', 'TextEdit', 'click').tier).toBe('click')
    expect(g.resolve('com.apple.finder', 'Finder')).toBeNull()
  })
})

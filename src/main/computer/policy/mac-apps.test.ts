import { describe, expect, it } from 'vitest'
import { isMacBlocked, MAC_BLOCKED_BUNDLE_IDS, MAC_BLOCKED_BUNDLE_PREFIXES } from './mac-apps'

describe('lista de apps de macOS bloqueadas', () => {
  it('bloquea gestores de contraseñas por bundle id exacto', () => {
    expect(isMacBlocked('com.apple.Passwords')).toBe(true)
    expect(isMacBlocked('com.lastpass.LastPass')).toBe(true)
  })

  it('bloquea gestores de contraseñas por prefijo de proveedor', () => {
    expect(isMacBlocked('com.1password.1password')).toBe(true)
    expect(isMacBlocked('com.agilebits.onepassword7')).toBe(true)
    expect(isMacBlocked('com.bitwarden.desktop')).toBe(true)
    expect(isMacBlocked('org.keepassxc.keepassxc')).toBe(true)
  })

  it('insensible a mayúsculas', () => {
    expect(isMacBlocked('COM.1PASSWORD.1PASSWORD')).toBe(true)
    expect(isMacBlocked('com.apple.passwords')).toBe(true)
    expect(isMacBlocked('Com.Bitwarden.Desktop')).toBe(true)
  })

  it('apps normales no quedan bloqueadas', () => {
    expect(isMacBlocked('com.apple.finder')).toBe(false)
    expect(isMacBlocked('com.apple.TextEdit')).toBe(false)
    expect(isMacBlocked('com.apple.Safari')).toBe(false)
    expect(isMacBlocked('com.apple.Terminal')).toBe(false)
  })

  it('un id vacío o solo con espacios no coincide con nada', () => {
    expect(isMacBlocked('')).toBe(false)
    expect(isMacBlocked('   ')).toBe(false)
  })

  it('las listas no contienen entradas con mayúsculas en los prefijos ni vacías', () => {
    for (const p of MAC_BLOCKED_BUNDLE_PREFIXES) expect(p).toBe(p.toLowerCase())
    for (const id of MAC_BLOCKED_BUNDLE_IDS) expect(id.trim().length).toBeGreaterThan(0)
  })
})

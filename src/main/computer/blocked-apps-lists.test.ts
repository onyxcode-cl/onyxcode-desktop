import { describe, expect, it } from 'vitest'
import { MAC_FIXED_BLOCKED, MAC_SUGGESTED_BLOCK, WIN_FIXED_BLOCKED, WIN_SUGGESTED_BLOCK, friendlyAppName } from '@shared/blocked-apps'
import { isMacBlocked, MAC_BLOCKED_BUNDLE_IDS, MAC_BLOCKED_BUNDLE_PREFIXES } from './policy/mac-apps'
import { WIN_BLOCKED_EXES } from './policy/win-apps'

describe('listas legibles de bloqueadas', () => {
  it('Windows: la lista legible coincide exactamente con WIN_BLOCKED_EXES', () => {
    expect(WIN_FIXED_BLOCKED.map((a) => a.id).sort()).toEqual([...WIN_BLOCKED_EXES].sort())
  })
  it('macOS: la lista legible coincide con ids y prefijos bloqueados', () => {
    expect(MAC_FIXED_BLOCKED.map((a) => a.id.toLowerCase()).sort()).toEqual(
      [...MAC_BLOCKED_BUNDLE_IDS, ...MAC_BLOCKED_BUNDLE_PREFIXES].map((x) => x.toLowerCase()).sort()
    )
  })
  it('las sugeridas NO están bloqueadas por defecto', () => {
    for (const a of MAC_SUGGESTED_BLOCK) expect(isMacBlocked(a.id)).toBe(false)
    expect(WIN_SUGGESTED_BLOCK).toEqual([])
  })
  it('friendlyAppName nunca devuelve vacío', () => {
    expect(friendlyAppName('com.acme.Wallet')).toBe('Wallet')
    expect(friendlyAppName('exe:c:\\apps\\foo.exe|pub:acme')).toBe('foo')
    expect(friendlyAppName('x')).toBe('X')
  })
})

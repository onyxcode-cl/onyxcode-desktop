import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MAX_HINT_CHARS, RECOVERY_HINTS, recoveryHint, recoveryNext, recoverySuffix, SAFE_NEXT_CALLS } from './recovery-hints'

/** Códigos que el servidor lanza hoy con `reject('<código>'` (también en varias líneas). */
function codesInServer(): string[] {
  const src = readFileSync(join(__dirname, 'mcp-server.ts'), 'utf8')
  const out = new Set<string>()
  for (const m of src.matchAll(/reject\(\s*'([a-z][a-z-]+)'/g)) out.add(m[1]!)
  // Los dos códigos de teclas de Windows se eligen con un ternario.
  for (const m of src.matchAll(/'(key-blocked|key-unknown)'/g)) out.add(m[1]!)
  return [...out]
}

describe('tabla de pistas de recuperación', () => {
  it('cubre TODOS los códigos de rechazo que lanza el servidor', () => {
    const codes = codesInServer()
    expect(codes.length).toBeGreaterThan(15)
    for (const c of codes) expect(RECOVERY_HINTS[c], `falta el código ${c}`).toBeDefined()
  })

  it('cada pista es corta y no vacía', () => {
    for (const [code, h] of Object.entries(RECOVERY_HINTS)) {
      expect(h.hint.length, code).toBeGreaterThan(5)
      expect(h.hint.length, code).toBeLessThanOrEqual(MAX_HINT_CHARS)
    }
  })

  it('la siguiente llamada es siempre inocua (solo lectura) o ninguna', () => {
    for (const [code, h] of Object.entries(RECOVERY_HINTS)) {
      if (h.next !== null) expect(SAFE_NEXT_CALLS as readonly string[], code).toContain(h.next)
    }
    // Nada que pida consentimiento o cambie estado.
    for (const h of Object.values(RECOVERY_HINTS)) expect(String(h.next)).not.toMatch(/request_|open_application|type_text|click|key/)
  })

  it('las pistas no dependen de una app ni de un entorno concreto', () => {
    for (const [code, h] of Object.entries(RECOVERY_HINTS)) {
      expect(h.hint, code).not.toMatch(/remot|windows app|anydesk|teamviewer|chrome|safari|finder|electron/i)
    }
  })

  it('lookups y sufijo', () => {
    expect(recoveryHint('stale')).toContain('app_screenshot')
    expect(recoveryHint('no-existe')).toBeUndefined()
    expect(recoveryNext('stale')).toBe('app_screenshot')
    expect(recoveryNext('no-grant')).toBeUndefined()
    expect(recoverySuffix('capture-expired')).toBe(' (siguiente: app_screenshot)')
    expect(recoverySuffix('no-grant')).toBe('')
    expect(recoverySuffix('inventado')).toBe('')
  })
})

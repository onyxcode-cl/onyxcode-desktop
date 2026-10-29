import { describe, expect, it } from 'vitest'
import { approvalKindOf, endsWithModeBlock, endsWithRuleset, isSafeLinkedPath, linkedFolderRules, rulesetForMode } from './permission-rules'

const rw = { path: '/Users/ben/Documents/facturas', mode: 'rw' as const }
const ro = { path: '/Users/ben/Documents/fotos', mode: 'ro' as const }

describe('carpetas añadidas al proyecto (reglas de permisos)', () => {
  it('rutas peligrosas o con comodines no generan reglas', () => {
    for (const bad of ['/', 'C:\\', '', 'relativa/carpeta', '/Users/ben/*', '/Users/ben/{a,b}', '/Users/ben/a?b']) {
      expect(isSafeLinkedPath(bad), bad).toBe(false)
      expect(linkedFolderRules([{ path: bad, mode: 'rw' }]), bad).toEqual([])
    }
    expect(isSafeLinkedPath('/Users/ben/Documents/facturas')).toBe(true)
    expect(isSafeLinkedPath('C:\\Users\\Bentec\\Documents\\x')).toBe(true)
  })

  it('lectura y escritura: solo permite entrar; solo lectura además niega editar y escribir', () => {
    const r = linkedFolderRules([rw, ro])
    const has = (permission: string, pattern: string, action: string): boolean =>
      r.some((x) => x.permission === permission && x.pattern === pattern && x.action === action)
    expect(has('external_directory', rw.path, 'allow')).toBe(true)
    expect(has('external_directory', `${rw.path}/*`, 'allow')).toBe(true)
    expect(r.some((x) => x.permission === 'edit' && x.pattern.startsWith(rw.path))).toBe(false)
    expect(has('edit', `${ro.path}/*`, 'deny')).toBe(true)
    expect(has('write', `${ro.path}/*`, 'deny')).toBe(true)
  })

  it('en Windows también deja la variante con «/»', () => {
    const r = linkedFolderRules([{ path: 'C:\\Users\\Bentec\\Docs', mode: 'rw' }])
    expect(r.some((x) => x.pattern === 'C:\\Users\\Bentec\\Docs\\*'.replace(/\\\*$/, '/*') || x.pattern === 'C:/Users/Bentec/Docs/*')).toBe(
      true
    )
    expect(r.some((x) => x.pattern === 'C:\\Users\\Bentec\\Docs')).toBe(true)
  })

  it('van DESPUÉS de «preguntar por lo externo» (la última regla que casa manda) y nunca en «Todo sin preguntar»', () => {
    for (const mode of ['manual', 'acceptEdits', 'plan', 'auto'] as const) {
      const block = rulesetForMode(mode, { linked: [rw] })
      const ask = block.findIndex((x) => x.permission === 'external_directory' && x.pattern === '*' && x.action === 'ask')
      const allow = block.findIndex((x) => x.permission === 'external_directory' && x.pattern === rw.path)
      expect(ask, mode).toBeGreaterThanOrEqual(0)
      expect(allow, mode).toBeGreaterThan(ask)
    }
    expect(rulesetForMode('bypass', { linked: [rw] })).toEqual(rulesetForMode('bypass'))
  })

  it('sin carpetas el bloque es idéntico al de siempre', () => {
    for (const mode of ['manual', 'acceptEdits', 'plan', 'auto', 'bypass'] as const) {
      expect(rulesetForMode(mode, { linked: [] })).toEqual(rulesetForMode(mode))
    }
  })

  it('la app sigue reconociendo el modo aunque haya carpetas añadidas, y reenvía si cambian', () => {
    const withLinked = rulesetForMode('auto', { linked: [rw, ro] })
    expect(approvalKindOf(withLinked)).toBe('auto')
    expect(approvalKindOf(rulesetForMode('plan', { linked: [ro] }))).toBe('plan')
    expect(endsWithModeBlock(withLinked, rulesetForMode('auto'))).toBe(true)
    // La idempotencia SÍ compara las carpetas: con otra lista hay que reenviar.
    expect(endsWithRuleset(withLinked, rulesetForMode('auto', { linked: [rw, ro] }))).toBe(true)
    expect(endsWithRuleset(withLinked, rulesetForMode('auto', { linked: [rw] }))).toBe(false)
    expect(endsWithRuleset(rulesetForMode('auto'), withLinked)).toBe(false)
  })
})

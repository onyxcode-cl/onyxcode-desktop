import { afterEach, describe, expect, it } from 'vitest'
import { setLang } from '@shared/i18n'
import { canDiscard, discardMessage, goesToTrash } from './discard-logic'

afterEach(() => setLang('es'))

describe('discard-logic', () => {
  it('lo nuevo va a la Papelera y lo demás se restaura', () => {
    expect(goesToTrash({ kind: 'untracked' })).toBe(true)
    expect(goesToTrash({ kind: 'added' })).toBe(true)
    expect(goesToTrash({ kind: 'renamed' })).toBe(true)
    expect(goesToTrash({ kind: 'modified' })).toBe(false)
    expect(goesToTrash({ kind: 'deleted' })).toBe(false)
  })

  it('no se pueden descartar conflictos ni ignorados', () => {
    expect(canDiscard({ kind: 'conflicted' })).toBe(false)
    expect(canDiscard({ kind: 'ignored' })).toBe(false)
    expect(canDiscard({ kind: 'modified' })).toBe(true)
  })

  it('modificado: avisa de la pérdida, del índice y de «Deshacer», y lista la ruta', () => {
    const m = discardMessage({ path: 'src/a.ts', kind: 'modified', staged: true })
    expect(m).toContain('Se perderán')
    expect(m).toContain('ya preparados')
    expect(m).toContain('Deshacer')
    expect(m).toContain('• src/a.ts')
  })

  it('nuevo: Papelera, sin «Deshacer»', () => {
    const m = discardMessage({ path: 'n.txt', kind: 'untracked', staged: false })
    expect(m).toContain('Papelera')
    expect(m).not.toContain('Deshacer')
  })

  it('renombrado: lista origen y destino', () => {
    const m = discardMessage({ path: 'nuevo.txt', origPath: 'viejo.txt', kind: 'renamed', staged: true })
    expect(m).toContain('• viejo.txt\n• nuevo.txt')
  })

  it('en inglés', () => {
    setLang('en')
    expect(discardMessage({ path: 'a.ts', kind: 'deleted', staged: false })).toContain('restored')
  })
})

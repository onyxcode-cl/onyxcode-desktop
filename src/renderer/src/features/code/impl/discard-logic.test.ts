import { afterEach, describe, expect, it } from 'vitest'
import { setLang } from '@shared/i18n'
import { canDiscard, discardMessage, goesToTrash, hunkLines } from './discard-logic'

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

describe('discard-logic: lo preparado y los bloques', () => {
  it('scope unstaged con cambios preparados: avisa de que se conserva y no de que se pierda', () => {
    const m = discardMessage({ path: 'src/a.ts', kind: 'modified', staged: true }, 'unstaged')
    expect(m).toContain('se conserva')
    expect(m).not.toContain('Se perderán')
    expect(m).toContain('• src/a.ts')
  })

  it('scope unstaged sin lo preparado se comporta como siempre', () => {
    expect(discardMessage({ path: 'a.ts', kind: 'modified', staged: false }, 'unstaged')).toContain('Se perderán')
  })

  it('hunkLines resume el rango del archivo nuevo', () => {
    expect(hunkLines('@@ -3,4 +3,6 @@ fn\n x\n')).toBe('3–8')
    expect(hunkLines('@@ -3 +9 @@\n')).toBe('9')
    expect(hunkLines('nada')).toBe('')
  })
})

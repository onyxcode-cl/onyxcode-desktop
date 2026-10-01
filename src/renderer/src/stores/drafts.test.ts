import { beforeEach, describe, expect, it } from 'vitest'
import { clearDrafts, getDraft, setDraft } from './drafts'

describe('borradores de compositor', () => {
  beforeEach(() => clearDrafts())

  it('guarda por clave y devuelve el vacío si no hay nada', () => {
    expect(getDraft('chat:a', '')).toBe('')
    setDraft('chat:a', 'hola')
    setDraft('chat:b', 'otro')
    expect(getDraft('chat:a', '')).toBe('hola')
    expect(getDraft('chat:b', '')).toBe('otro')
  })

  it('un valor vacío borra la entrada (no crece)', () => {
    setDraft('code:x', 'texto')
    setDraft('code:x', '')
    expect(getDraft('code:x', 'VACIO')).toBe('VACIO')
    setDraft('code:m', ['a'])
    setDraft('code:m', [])
    expect(getDraft<string[]>('code:m', [])).toEqual([])
  })
})

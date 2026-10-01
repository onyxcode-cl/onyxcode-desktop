import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearDrafts,
  clearSessionDrafts,
  DRAFT_ATTACH_MAX_BYTES,
  DRAFT_ATTACH_TOTAL_BYTES,
  draftAttachmentBytes,
  getDraft,
  setDraft
} from './drafts'

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

describe('adjuntos en borradores (R3-A)', () => {
  beforeEach(() => clearDrafts())
  const att = (id: string, chars: number): { id: string; url: string }[] => [{ id, url: 'd'.repeat(chars) }]

  it('guarda adjuntos por clave y los libera al vaciar', () => {
    setDraft('code:/p:s1:att', att('a', 100))
    expect(getDraft<unknown[]>('code:/p:s1:att', []).length).toBe(1)
    expect(draftAttachmentBytes()).toBe(100)
    setDraft('code:/p:s1:att', [])
    expect(draftAttachmentBytes()).toBe(0)
  })

  it('rechaza un borrador por encima del tope individual y conserva el anterior', () => {
    setDraft('code:/p:s1:att', att('a', 10))
    setDraft('code:/p:s1:att', att('b', DRAFT_ATTACH_MAX_BYTES + 1))
    expect(getDraft<{ id: string }[]>('code:/p:s1:att', [])[0]!.id).toBe('a')
  })

  it('al superar el total libera los borradores con adjuntos más antiguos, nunca el actual', () => {
    const chunk = DRAFT_ATTACH_MAX_BYTES
    for (const k of ['s1', 's2', 's3', 's4']) setDraft(`code:/p:${k}:att`, att(k, chunk))
    expect(draftAttachmentBytes()).toBeLessThanOrEqual(DRAFT_ATTACH_TOTAL_BYTES)
    expect(getDraft('code:/p:s1:att', [])).toEqual([]) // el más antiguo se fue
    expect(getDraft<unknown[]>('code:/p:s4:att', []).length).toBe(1)
  })

  it('clearSessionDrafts libera texto, menciones y adjuntos de esa conversación y solo de ella', () => {
    setDraft('chat:ses_1', 'hola')
    setDraft('chat-att:ses_1', att('a', 5))
    setDraft('code:/p:ses_1', 'x')
    setDraft('code:/p:ses_1:mentions', ['m'])
    setDraft('code:/p:ses_1:att', att('b', 5))
    setDraft('code:/p:ses_10', 'otra')
    clearSessionDrafts('ses_1')
    expect(getDraft('chat:ses_1', '')).toBe('')
    expect(draftAttachmentBytes()).toBe(0)
    expect(getDraft('code:/p:ses_1:mentions', [])).toEqual([])
    expect(getDraft('code:/p:ses_10', '')).toBe('otra')
  })
})

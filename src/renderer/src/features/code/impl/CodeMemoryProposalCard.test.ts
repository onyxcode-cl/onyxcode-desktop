import { describe, expect, it } from 'vitest'
import type { CodeMessage } from './types'
import { draftsFrom } from './CodeMemoryProposalCard'

function entry(role: 'user' | 'assistant', text: string, id: string): CodeMessage {
  return { info: { id, role }, parts: [{ id: `${id}p`, type: 'text', text }] } as unknown as CodeMessage
}

const block = (arr: unknown): string => '```lazunox-memoria\n' + JSON.stringify(arr) + '\n```'

describe('draftsFrom (Code)', () => {
  it('sin mensajes, undefined', () => {
    expect(draftsFrom([])).toBeUndefined()
  })

  it('una propuesta alcance "usuario": un borrador', () => {
    const text = block([{ alcance: 'usuario', tipo: 'preferencia', texto: 'prefiere tablas' }])
    const drafts = draftsFrom([entry('assistant', text, 'a1')])
    expect(drafts).toHaveLength(1)
    expect(drafts?.[0]).toMatchObject({ alcance: 'usuario', texto: 'prefiere tablas', selected: true })
  })

  it('una propuesta alcance "proyecto" se descarta entera: Code v1 no la puede guardar', () => {
    const text = block([{ alcance: 'proyecto', tipo: 'convencion', texto: 'usa Prettier' }])
    expect(draftsFrom([entry('assistant', text, 'a1')])).toBeUndefined()
  })

  it('con dos propuestas, una de cada alcance: solo queda la de "usuario"', () => {
    const text = block([
      { alcance: 'usuario', tipo: 'preferencia', texto: 'global' },
      { alcance: 'proyecto', tipo: 'convencion', texto: 'de proyecto' }
    ])
    const drafts = draftsFrom([entry('assistant', text, 'a1')])
    expect(drafts).toHaveLength(1)
    expect(drafts?.[0].texto).toBe('global')
  })
})

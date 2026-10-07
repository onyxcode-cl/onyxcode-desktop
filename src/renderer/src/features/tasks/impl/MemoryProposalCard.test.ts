import { describe, expect, it } from 'vitest'
import type { MessageEntry } from '../../../stores/sessions'
import { draftsFrom } from './MemoryProposalCard'

function entry(role: 'user' | 'assistant', text: string, id: string): MessageEntry {
  return { info: { id, role }, parts: [{ id: `${id}p`, type: 'text', text }] } as unknown as MessageEntry
}

const block = (arr: unknown): string => '```lazunox-memoria\n' + JSON.stringify(arr) + '\n```'

describe('draftsFrom', () => {
  it('sin mensajes, undefined (nada que pintar)', () => {
    expect(draftsFrom([])).toBeUndefined()
  })

  it('último mensaje del asistente sin bloque: undefined', () => {
    const entries = [entry('user', 'hola', 'u1'), entry('assistant', 'listo, sin nada que recordar', 'a1')]
    expect(draftsFrom(entries)).toBeUndefined()
  })

  it('con una propuesta válida: un borrador, preseleccionado (sin aviso)', () => {
    const text = 'Resumen.\n\n' + block([{ alcance: 'proyecto', tipo: 'convencion', texto: 'usa Prettier' }])
    const drafts = draftsFrom([entry('assistant', text, 'a1')])
    expect(drafts).toHaveLength(1)
    expect(drafts?.[0]).toMatchObject({ alcance: 'proyecto', tipo: 'convencion', texto: 'usa Prettier', selected: true })
  })

  it('una propuesta marcada (dato personal) llega SIN preseleccionar', () => {
    const text = block([{ alcance: 'usuario', tipo: 'solucion', texto: 'avisar a ana@acme.cl' }])
    const drafts = draftsFrom([entry('assistant', text, 'a1')])
    expect(drafts?.[0].selected).toBe(false)
    expect(drafts?.[0].flag).toBe('personal')
  })

  it('usa el último mensaje del asistente, no uno anterior', () => {
    const entries = [
      entry('assistant', block([{ alcance: 'usuario', tipo: 'preferencia', texto: 'vieja' }]), 'a1'),
      entry('user', 'otra cosa', 'u1'),
      entry('assistant', block([{ alcance: 'usuario', tipo: 'preferencia', texto: 'nueva' }]), 'a2')
    ]
    expect(draftsFrom(entries)?.[0].texto).toBe('nueva')
  })
})

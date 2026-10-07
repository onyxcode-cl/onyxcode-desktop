import { describe, expect, it } from 'vitest'
import type { MessageEntry } from '../../../stores/sessions'
import { draftFrom } from './SkillProposalCard'

function entry(role: 'user' | 'assistant', text: string, id: string): MessageEntry {
  return { info: { id, role }, parts: [{ id: `${id}p`, type: 'text', text }] } as unknown as MessageEntry
}

const block = (obj: unknown): string => '```lazunox-skill\n' + JSON.stringify(obj) + '\n```'

describe('draftFrom', () => {
  it('sin mensajes, undefined', () => {
    expect(draftFrom([])).toBeUndefined()
  })

  it('último mensaje del asistente sin bloque: undefined', () => {
    expect(draftFrom([entry('assistant', 'listo, nada que proponer', 'a1')])).toBeUndefined()
  })

  it('con una propuesta válida: el borrador con sus 3 campos', () => {
    const text = 'Resumen.\n\n' + block({ name: 'informe-mensual', description: 'Arma el informe mensual', body: 'Paso 1...' })
    const d = draftFrom([entry('assistant', text, 'a1')])
    expect(d).toEqual({ name: 'informe-mensual', description: 'Arma el informe mensual', body: 'Paso 1...' })
  })

  it('un bloque roto (JSON inválido) o rechazado (nombre inválido): undefined, no revienta', () => {
    expect(draftFrom([entry('assistant', '```lazunox-skill\nno es json\n```', 'a1')])).toBeUndefined()
    expect(draftFrom([entry('assistant', block({ name: 'MAYUS', description: 'x', body: 'y' }), 'a1')])).toBeUndefined()
  })

  it('usa el último mensaje del asistente, no uno anterior', () => {
    const entries = [
      entry('assistant', block({ name: 'vieja', description: 'd', body: 'b' }), 'a1'),
      entry('user', 'otra cosa', 'u1'),
      entry('assistant', block({ name: 'nueva', description: 'd', body: 'b' }), 'a2')
    ]
    expect(draftFrom(entries)?.name).toBe('nueva')
  })
})

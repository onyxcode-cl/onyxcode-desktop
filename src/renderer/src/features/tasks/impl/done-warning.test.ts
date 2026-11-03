import { describe, expect, it } from 'vitest'
import type { MessageEntry } from '../../../stores/sessions'
import { doneWarning, requestedTypes } from './done-warning'

const user = (text: string): MessageEntry =>
  ({ info: { id: 'u', role: 'user' }, parts: [{ type: 'text', text, id: 'p', messageID: 'u', sessionID: 's' }] }) as unknown as MessageEntry
const todoWrite = (todos: Array<{ content: string; status: string }>): MessageEntry =>
  ({
    info: { id: 'a', role: 'assistant' },
    parts: [
      {
        type: 'tool',
        tool: 'todowrite',
        state: { status: 'completed', input: { todos: todos.map((t) => ({ ...t, priority: 'medium' })) } }
      }
    ]
  }) as unknown as MessageEntry
const f = (relPath: string) => ({ path: `/x/${relPath}`, relPath })

describe('requestedTypes', () => {
  it('pide crear un Word/Excel/PowerPoint/PDF', () => {
    expect(requestedTypes('Crea un informe en Word sobre el agua')).toEqual(['docx'])
    expect(requestedTypes('haz una presentación y una planilla con las ventas')).toEqual(['xlsx', 'pptx'])
    expect(requestedTypes('genera guia.pdf')).toEqual(['pdf'])
  })
  it('leer, resumir o preguntar no cuenta como pedir un archivo', () => {
    expect(requestedTypes('Resume este Word')).toEqual([])
    expect(requestedTypes('¿Qué hay en la planilla ventas.xlsx?')).toEqual([])
  })
})

describe('doneWarning', () => {
  it('plan con pasos sin terminar → aviso de plan (aunque haya archivo)', () => {
    const entries = [
      user('Crea un Word'),
      todoWrite([
        { content: 'a', status: 'completed' },
        { content: 'b', status: 'pending' },
        { content: 'c', status: 'in_progress' }
      ])
    ]
    expect(doneWarning({ entries, storeTodos: [], files: [f('a.docx')] })).toEqual({ kind: 'plan', left: 2 })
  })
  it('plan completo y archivo presente → sin aviso', () => {
    const entries = [user('Crea un Word'), todoWrite([{ content: 'a', status: 'completed' }])]
    expect(doneWarning({ entries, storeTodos: [], files: [f('a.docx')] })).toBeNull()
  })
  it('pidió un Word y no hay ningún .docx → aviso de entregable', () => {
    expect(doneWarning({ entries: [user('Crea un informe en Word')], storeTodos: [], files: [f('notas.txt')] })).toEqual({
      kind: 'deliverable',
      types: ['docx']
    })
    expect(doneWarning({ entries: [user('Crea un informe en Word')], storeTodos: [], files: [] })).toEqual({
      kind: 'deliverable',
      types: ['docx']
    })
  })
  it('los archivos auxiliares no cuentan como entregable', () => {
    expect(doneWarning({ entries: [user('Crea un Word')], storeTodos: [], files: [f('.lazunox/trabajo/x.docx')] })).toEqual({
      kind: 'deliverable',
      types: ['docx']
    })
  })
  it('entregables aún sin cargar o petición que no pide archivo → sin aviso', () => {
    expect(doneWarning({ entries: [user('Crea un Word')], storeTodos: [], files: undefined })).toBeNull()
    expect(doneWarning({ entries: [user('Explícame qué es un Word')], storeTodos: [], files: [] })).toBeNull()
  })
  it('usa el plan guardado si el turno no publicó uno', () => {
    expect(
      doneWarning({ entries: [user('hola')], storeTodos: [{ content: 'x', status: 'pending', priority: 'low' } as never], files: [] })
    ).toEqual({ kind: 'plan', left: 1 })
  })
})

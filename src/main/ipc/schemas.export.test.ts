import { describe, expect, it } from 'vitest'
import { CHANNEL_ROLES, IPC_SCHEMAS } from './schemas'

describe('extras:exportConversation', () => {
  const v = IPC_SCHEMAS['extras:exportConversation']
  const doc = {
    title: 'Conversación',
    createdAt: 1_760_000_000_000,
    model: 'm',
    turns: [
      { role: 'user', at: 1, parts: [{ kind: 'text', text: 'hola' }], files: ['a.png'] },
      {
        role: 'assistant',
        at: 2,
        parts: [
          { kind: 'tool', tool: 'bash', detail: 'ls' },
          { kind: 'reasoning', text: 'x' }
        ],
        files: []
      }
    ]
  }
  const req = { format: 'md', doc, options: { reasoning: false, tools: true, attachments: true }, lang: 'es' }

  it('acepta una conversación válida en md y pdf', () => {
    expect(() => v(req)).not.toThrow()
    expect(() => v({ ...req, format: 'pdf' })).not.toThrow()
  })

  it('rechaza formatos que no sean md o pdf (nada de docx ni rutas)', () => {
    expect(() => v({ ...req, format: 'docx' })).toThrow()
    expect(() => v({ ...req, format: 'html' })).toThrow()
  })

  it('es estricto: una ruta de destino o una clave de más se rechaza', () => {
    expect(() => v({ ...req, path: '/tmp/x.md' })).toThrow()
    expect(() => v({ ...req, doc: { ...doc, extra: 1 } })).toThrow()
    expect(() => v({ ...req, options: { reasoning: false, tools: true, attachments: true, raw: true } })).toThrow()
  })

  it('rechaza partes desconocidas, roles inválidos y tipos erróneos', () => {
    expect(() => v({ ...req, doc: { ...doc, turns: [{ ...doc.turns[0], parts: [{ kind: 'html', text: '<b>' }] }] } })).toThrow()
    expect(() => v({ ...req, doc: { ...doc, turns: [{ ...doc.turns[0], role: 'system' }] } })).toThrow()
    expect(() => v({ ...req, options: { reasoning: 'si', tools: true, attachments: true } })).toThrow()
    expect(() => v({ ...req, doc: { ...doc, createdAt: 'ayer' } })).toThrow()
  })

  it('pone topes: demasiados turnos o texto total enorme', () => {
    const many = Array.from({ length: 5001 }, () => doc.turns[0])
    expect(() => v({ ...req, doc: { ...doc, turns: many } })).toThrow()
    const big = { kind: 'text', text: 'x'.repeat(1_900_000) }
    const turn = { ...doc.turns[0], parts: Array.from({ length: 12 }, () => big) }
    expect(() => v({ ...req, doc: { ...doc, turns: [turn] } })).toThrow()
  })

  it('solo la ventana principal puede invocarlo', () => {
    expect((CHANNEL_ROLES as Record<string, unknown>)['extras:exportConversation']).toBeUndefined()
  })
})

import { describe, expect, it } from 'vitest'
import { parseModelChanged } from './model-change'

const valid = {
  sessionID: 'ses_1',
  anterior: { providerID: 'p', modelID: 'old' },
  nuevo: { providerID: 'q', modelID: 'new', variant: 'high' },
  motivo: 'Lo pidió la persona'
}

describe('session.modelo.cambiado', () => {
  it('valida proveedor, modelo y esfuerzo opcional sin mutar el evento', () => {
    expect(parseModelChanged(valid)).toEqual(valid)
    const noVariant = { ...valid, nuevo: { providerID: 'q', modelID: 'new' } }
    expect(parseModelChanged(noVariant)).toEqual(noVariant)
  })
  it.each([
    null,
    [],
    {},
    { ...valid, sessionID: '' },
    { ...valid, sessionID: 'x'.repeat(201) },
    { ...valid, sessionID: 'a\nb' },
    { ...valid, anterior: null },
    { ...valid, anterior: [] },
    { ...valid, anterior: { providerID: 'p' } },
    { ...valid, anterior: { ...valid.anterior, variant: 'high' } },
    { ...valid, nuevo: { ...valid.nuevo, providerID: 3 } },
    { ...valid, nuevo: { ...valid.nuevo, modelID: ' ' } },
    { ...valid, nuevo: { ...valid.nuevo, variant: null } },
    { ...valid, nuevo: { ...valid.nuevo, variant: '' } },
    { ...valid, nuevo: { ...valid.nuevo, extra: true } },
    { ...valid, motivo: undefined },
    { ...valid, motivo: '' },
    { ...valid, motivo: 'x'.repeat(4097) },
    { ...valid, extra: true }
  ])('ignora un payload mal formado (%#)', (payload) => {
    expect(parseModelChanged(payload)).toBeNull()
  })
})

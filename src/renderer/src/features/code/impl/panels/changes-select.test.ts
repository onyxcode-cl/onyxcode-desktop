import { beforeEach, describe, expect, it } from 'vitest'
import {
  forgetSelections,
  moveSelection,
  nextPending,
  orderedRows,
  pickSelection,
  recallSelection,
  rememberSelection,
  rowKey
} from './changes-select'

const rows = orderedRows([{ path: 'a.ts' }], [{ path: 'b.ts' }, { path: 'c.ts' }])

describe('selección del panel Cambios', () => {
  beforeEach(() => forgetSelections())

  it('ordena preparadas primero y da claves distintas', () => {
    expect(rows.map(rowKey)).toEqual(['s:a.ts', 'u:b.ts', 'u:c.ts'])
    expect(rowKey({ path: 'x', staged: true })).not.toBe(rowKey({ path: 'x', staged: false }))
  })

  it('sin selección elige el primer archivo', () => {
    expect(pickSelection(rows, null)).toEqual({ path: 'a.ts', staged: true })
  })

  it('sin filas no hay selección', () => {
    expect(pickSelection([], { path: 'a.ts', staged: true })).toBeNull()
  })

  it('conserva la selección actual si el archivo sigue existiendo', () => {
    expect(pickSelection(rows, { path: 'c.ts', staged: false })).toEqual({ path: 'c.ts', staged: false })
  })

  it('si el archivo actual desapareció usa el recordado y, si no, el primero', () => {
    const rest = orderedRows([], [{ path: 'b.ts' }, { path: 'c.ts' }])
    expect(pickSelection(rest, { path: 'zzz', staged: false }, { path: 'c.ts', staged: false })).toEqual({ path: 'c.ts', staged: false })
    expect(pickSelection(rest, { path: 'zzz', staged: false }, { path: 'otro', staged: false })).toEqual({ path: 'b.ts', staged: false })
  })

  it('si el archivo pasa de sin preparar a preparado conserva el archivo', () => {
    const now = orderedRows([{ path: 'b.ts' }], [{ path: 'c.ts' }])
    expect(pickSelection(now, { path: 'b.ts', staged: false })).toEqual({ path: 'b.ts', staged: true })
  })

  it('↑/↓ se mueve sin dar la vuelta', () => {
    expect(moveSelection(rows, { path: 'a.ts', staged: true }, 1)).toEqual({ path: 'b.ts', staged: false })
    expect(moveSelection(rows, { path: 'a.ts', staged: true }, -1)).toEqual({ path: 'a.ts', staged: true })
    expect(moveSelection(rows, { path: 'c.ts', staged: false }, 1)).toEqual({ path: 'c.ts', staged: false })
    expect(moveSelection(rows, null, 1)).toEqual({ path: 'a.ts', staged: true })
    expect(moveSelection([], null, 1)).toBeNull()
  })

  it('siguiente pendiente salta lo ya revisado y da la vuelta', () => {
    const pending = new Set(['a.ts', 'c.ts'])
    expect(nextPending(rows, { path: 'a.ts', staged: true }, (p) => pending.has(p))).toEqual({ path: 'c.ts', staged: false })
    expect(nextPending(rows, { path: 'c.ts', staged: false }, (p) => pending.has(p))).toEqual({ path: 'a.ts', staged: true })
    expect(nextPending(rows, { path: 'a.ts', staged: true }, () => false)).toBeNull()
  })

  it('recuerda la selección por carpeta', () => {
    rememberSelection('/p', { path: 'b.ts', staged: false })
    expect(recallSelection('/p')).toEqual({ path: 'b.ts', staged: false })
    expect(recallSelection('/q')).toBeNull()
    rememberSelection('/p', null)
    expect(recallSelection('/p')).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { markUnattended, unattendedFor } from './unattended'

describe('unattended', () => {
  it('marca y desmarca por carpeta (con o sin barra final); anota en todas las ejecuciones de esa carpeta', () => {
    const a: string[] = []
    const b: string[] = []
    const offA = markUnattended('/Users/ana/p/', (w) => a.push(w.permission))
    const offB = markUnattended('/Users/ana/p', (w) => b.push(w.permission))
    expect(unattendedFor('/Users/ana/otra')).toBeNull()
    unattendedFor('/Users/ana/p')!({ permission: 'x', detail: '' })
    expect([a, b]).toEqual([['x'], ['x']])
    offA()
    expect(unattendedFor('/Users/ana/p')).not.toBeNull()
    offB()
    expect(unattendedFor('/Users/ana/p')).toBeNull()
  })
})

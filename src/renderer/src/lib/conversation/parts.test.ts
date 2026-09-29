import { describe, expect, it } from 'vitest'
import { parseTodos } from './parts'

describe('parseTodos', () => {
  it('devuelve los elementos válidos de un arreglo', () => {
    const todos = [
      { content: 'a', status: 'pending', priority: 'high' },
      { content: 'b', status: 'completed', priority: 'low' }
    ]
    expect(parseTodos(todos)).toEqual(todos)
  })
  it('filtra basura', () => {
    expect(parseTodos([null, 1, 'x', {}, { content: 3 }, { content: 'ok', status: 'pending', priority: 'low' }])).toEqual([
      { content: 'ok', status: 'pending', priority: 'low' }
    ])
  })
  it('no-arreglo devuelve null', () => {
    expect(parseTodos(undefined)).toBeNull()
    expect(parseTodos(null)).toBeNull()
    expect(parseTodos({ content: 'a' })).toBeNull()
    expect(parseTodos('x')).toBeNull()
  })
})

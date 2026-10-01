import { describe, expect, it } from 'vitest'
import { LineRing } from './log-ring'

describe('LineRing', () => {
  it('une trozos partidos y devuelve la última línea parcial', () => {
    const r = new LineRing()
    r.push('uno\ndo')
    expect(r.lines()).toEqual(['uno', 'do'])
    r.push('s\ntres')
    expect(r.lines()).toEqual(['uno', 'dos', 'tres'])
    r.push('\n')
    expect(r.lines()).toEqual(['uno', 'dos', 'tres'])
  })

  it('maneja CRLF y trozos vacíos', () => {
    const r = new LineRing()
    r.push('')
    r.push('a\r\nb\r\n')
    expect(r.lines()).toEqual(['a', 'b'])
  })

  it('conserva solo las últimas 2000 líneas', () => {
    const r = new LineRing()
    for (let i = 0; i < 2500; i++) r.push(`l${i}\n`)
    const lines = r.lines()
    expect(lines).toHaveLength(2000)
    expect(lines[0]).toBe('l500')
    expect(lines[1999]).toBe('l2499')
  })

  it('respeta el tope de bytes', () => {
    const r = new LineRing(2000, 1000)
    for (let i = 0; i < 100; i++) r.push(`${'x'.repeat(99)}\n`)
    const total = r.lines().reduce((n, l) => n + l.length + 1, 0)
    expect(total).toBeLessThanOrEqual(1000)
    expect(r.lines().length).toBeGreaterThan(5)
  })

  it('una línea parcial gigante no crece sin límite', () => {
    const r = new LineRing(10, 1000)
    for (let i = 0; i < 50; i++) r.push('y'.repeat(500))
    expect(r.lines().join('').length).toBeLessThanOrEqual(1000)
  })

  it('lines(max) y tail(n) devuelven el final', () => {
    const r = new LineRing()
    r.push('a\nb\nc\nd\n')
    expect(r.lines(2)).toEqual(['c', 'd'])
    expect(r.tail(3)).toBe('b\nc\nd')
    r.clear()
    expect(r.size).toBe(0)
  })
})

import { describe, expect, it } from 'vitest'
import { createHistorySync } from './nav-history'

function make(initial = 1) {
  let depth = initial
  const log: string[] = []
  const sync = createHistorySync({ push: () => log.push('push'), go: (n) => log.push(`go${n}`) }, () => depth - 1)
  return {
    sync,
    log,
    setDepth: (d: number) => {
      depth = d
      sync.reconcile()
    }
  }
}

describe('historial sincronizado con la pila', () => {
  it('añade una entrada por pantalla apilada', () => {
    const h = make()
    h.setDepth(2)
    h.setDepth(3)
    expect(h.log).toEqual(['push', 'push'])
    expect(h.sync.entries()).toBe(2)
  })

  it('«atrás» del sistema: se desapila y no sobran entradas', () => {
    const h = make()
    h.setDepth(3)
    expect(h.sync.popstate()).toBe('user')
    h.setDepth(2)
    expect(h.sync.entries()).toBe(1)
    expect(h.log).toEqual(['push', 'push'])
  })

  it('cambiar de pestaña con la pila apilada retira las entradas viejas (el primer «atrás» desde la raíz no queda sin efecto)', () => {
    const h = make()
    h.setDepth(3)
    h.setDepth(1) // otra pestaña, en su raíz
    expect(h.log.at(-1)).toBe('go-2')
    expect(h.sync.popstate()).toBe('own')
    expect(h.sync.entries()).toBe(0)
    // el siguiente popstate ya es del usuario y no consume nada
    expect(h.sync.popstate()).toBe('user')
    expect(h.sync.entries()).toBe(0)
  })

  it('al volver a la pestaña apilada se reponen las entradas', () => {
    const h = make()
    h.setDepth(3)
    h.setDepth(1)
    h.sync.popstate()
    h.setDepth(3)
    expect(h.sync.entries()).toBe(2)
    expect(h.log.filter((x) => x === 'push')).toHaveLength(4)
  })

  it('mientras espera su popstate no hace más saltos; settle libera la espera', () => {
    const h = make()
    h.setDepth(3)
    h.setDepth(1)
    h.setDepth(2) // todavía pendiente: no empuja
    expect(h.log.filter((x) => x === 'push')).toHaveLength(2)
    h.sync.settle()
    expect(h.sync.entries()).toBe(1)
  })
})

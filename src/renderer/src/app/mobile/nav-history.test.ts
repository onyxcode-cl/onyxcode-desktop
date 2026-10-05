import { describe, expect, it } from 'vitest'
import { createHistorySync, historyTarget, userBackAction } from './nav-history'

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

describe('el panel lateral cuenta como una entrada', () => {
  function makeDrawer(depth = 1) {
    let drawer = false
    let d = depth
    const log: string[] = []
    const sync = createHistorySync({ push: () => log.push('push'), go: (n) => log.push(`go${n}`) }, () => historyTarget(d, drawer))
    return {
      sync,
      log,
      setDrawer: (v: boolean) => {
        drawer = v
        sync.reconcile()
      },
      setDepth: (v: number) => {
        d = v
        sync.reconcile()
      },
      isOpen: () => drawer
    }
  }

  it('historyTarget suma una entrada con el panel abierto y nunca baja de 0', () => {
    expect(historyTarget(1, false)).toBe(0)
    expect(historyTarget(1, true)).toBe(1)
    expect(historyTarget(3, true)).toBe(3)
    expect(historyTarget(0, false)).toBe(0)
  })

  it('abrir el panel añade una entrada; cerrarlo con la X la retira con history.go(-1)', () => {
    const h = makeDrawer()
    h.setDrawer(true)
    expect(h.log).toEqual(['push'])
    h.setDrawer(false)
    expect(h.log).toEqual(['push', 'go-1'])
    expect(h.sync.popstate()).toBe('own')
    expect(h.sync.entries()).toBe(0)
  })

  it('«atrás» del sistema con el panel abierto lo cierra y NO desapila la pantalla', () => {
    const h = makeDrawer(2)
    h.setDepth(2)
    h.setDrawer(true)
    expect(h.sync.entries()).toBe(2)
    // popstate del usuario: ya consumió la entrada del panel
    expect(h.sync.popstate()).toBe('user')
    expect(userBackAction(h.isOpen())).toBe('close-drawer')
    h.setDrawer(false) // el shell cierra el panel
    // no hace falta ningún salto más: las entradas ya coinciden con la profundidad
    expect(h.log).toEqual(['push', 'push'])
    expect(h.sync.entries()).toBe(1)
    // el siguiente «atrás» sí desapila
    expect(h.sync.popstate()).toBe('user')
    expect(userBackAction(h.isOpen())).toBe('pop')
  })

  it('elegir un hilo (cierra el panel y apila detalle a la vez) deja las entradas en su sitio', () => {
    const h = makeDrawer(1)
    h.setDrawer(true)
    h.setDrawer(false)
    h.sync.popstate()
    h.setDepth(2)
    expect(h.sync.entries()).toBe(1)
  })

  it('con el panel abierto, cambiar de pestaña a la raíz retira solo las entradas sobrantes', () => {
    const h = makeDrawer(3)
    h.setDepth(3)
    h.setDrawer(true)
    expect(h.sync.entries()).toBe(3)
    h.setDepth(1)
    expect(h.log.at(-1)).toBe('go-2')
    expect(h.sync.popstate()).toBe('own')
    expect(h.sync.entries()).toBe(1)
  })
})

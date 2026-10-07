import { describe, expect, it } from 'vitest'
import { createKeepAwake, type PowerBlocker } from './keep-awake'

function fakeBlocker(): PowerBlocker & { live: Set<number>; starts: string[]; stops: number[] } {
  let next = 1
  const live = new Set<number>()
  const starts: string[] = []
  const stops: number[] = []
  return {
    live,
    starts,
    stops,
    start: (t) => {
      starts.push(t)
      live.add(next)
      return next++
    },
    stop: (id) => {
      stops.push(id)
      live.delete(id)
    },
    isStarted: (id) => live.has(id)
  }
}
const make = (platform = 'win32', enabled = true, b = fakeBlocker()) => ({
  b,
  ka: createKeepAwake({ platform, enabled: () => enabled, blocker: b })
})

describe('keep-awake (Windows, remoto activo)', () => {
  it('bloquea con prevent-app-suspension al activarse y libera al apagarse', () => {
    const { b, ka } = make()
    ka.update('pairing')
    expect(b.starts).toEqual(['prevent-app-suspension'])
    expect(ka.held).toBe(true)
    ka.update('off')
    expect(b.live.size).toBe(0)
    expect(ka.held).toBe(false)
  })

  it('idempotente: pairing → active → active deja UN solo bloqueador', () => {
    const { b, ka } = make()
    for (const m of ['pairing', 'active', 'active', 'pairing']) ka.update(m)
    expect(b.starts).toHaveLength(1)
    expect(b.live.size).toBe(1)
  })

  it('sin fugas tras varios ciclos activar/desactivar', () => {
    const { b, ka } = make()
    for (let i = 0; i < 20; i++) {
      ka.update('active')
      ka.update('off')
    }
    expect(b.starts).toHaveLength(20)
    expect(b.live.size).toBe(0)
    ka.update('off')
    expect(b.stops).toHaveLength(20)
  })

  it('release() (salir de la app) libera y es repetible', () => {
    const { b, ka } = make()
    ka.update('active')
    ka.release()
    ka.release()
    expect(b.live.size).toBe(0)
    expect(b.stops).toHaveLength(1)
  })

  it('si el sistema soltó el bloqueador, se pide otro sin dejar el viejo', () => {
    const { b, ka } = make()
    ka.update('active')
    b.live.clear()
    ka.update('active')
    expect(b.starts).toHaveLength(2)
    expect(b.live.size).toBe(1)
  })

  it('nunca pide prevent-display-sleep', () => {
    const { b, ka } = make()
    ka.update('active')
    expect(b.starts.every((t) => t === 'prevent-app-suspension')).toBe(true)
  })

  it('errores del bloqueador no se propagan', () => {
    const bad: PowerBlocker = {
      start: () => {
        throw new Error('x')
      },
      stop: () => {
        throw new Error('y')
      },
      isStarted: () => {
        throw new Error('z')
      }
    }
    const ka = createKeepAwake({ platform: 'win32', enabled: () => true, blocker: bad })
    expect(() => {
      ka.update('active')
      ka.update('off')
      ka.release()
    }).not.toThrow()
    expect(ka.held).toBe(false)
  })
})

describe('keep-awake: dónde NO actúa', () => {
  it('macOS y Linux: nada', () => {
    for (const p of ['darwin', 'linux']) {
      const { b, ka } = make(p)
      ka.update('active')
      expect(b.starts).toEqual([])
      expect(ka.held).toBe(false)
    }
  })
  it('Windows con la bandera remoteWin apagada: nada; si se apaga con el remoto activo, libera', () => {
    const off = make('win32', false)
    off.ka.update('active')
    expect(off.b.starts).toEqual([])
    let on = true
    const b = fakeBlocker()
    const ka = createKeepAwake({ platform: 'win32', enabled: () => on, blocker: b })
    ka.update('active')
    on = false
    ka.update('active')
    expect(b.live.size).toBe(0)
  })
})

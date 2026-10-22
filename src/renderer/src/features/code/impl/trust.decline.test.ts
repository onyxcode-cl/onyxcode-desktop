/**
 * Denegar la confianza del proyecto restaurado al arrancar: `declineFocusedProject` nunca deja enfocada una carpeta sin
 * confianza, conserva las de confianza y no toca nada si la carpeta ya era de confianza o no tiene el foco.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

type Store = typeof import('./store')
let useCode: Store['useCode']

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  ;({ useCode } = await import('./store'))
})
const st = (): ReturnType<Store['useCode']['getState']> => useCode.getState()

describe('declineFocusedProject', () => {
  it('único proyecto sin confianza: sale de los abiertos, no queda foco y se persiste', () => {
    useCode.setState({ directory: '/a', openDirectories: ['/a'] })
    st().declineFocusedProject('/a')
    expect(st().directory).toBeNull()
    expect(st().openDirectories).toEqual([])
    expect(JSON.parse(localStorage.getItem('code.projects')!)).toEqual({ v: 1, open: [], focus: null })
    expect(st().isTrusted('/a')).toBe(false)
  })

  it('el foco pasa a uno de confianza', () => {
    st().trustFolder('/b')
    useCode.setState({ directory: '/a', openDirectories: ['/a', '/b'] })
    st().declineFocusedProject('/a')
    expect(st().directory).toBe('/b')
    expect(st().openDirectories).toEqual(['/b'])
  })

  it('si los demás tampoco son de confianza, no se les da el foco sin preguntar (siguen en la barra)', () => {
    useCode.setState({ directory: '/a', openDirectories: ['/a', '/c'] })
    st().declineFocusedProject('/a')
    expect(st().directory).toBeNull()
    expect(st().openDirectories).toEqual(['/c'])
    expect(st().isTrusted('/c')).toBe(false)
  })

  it('carpeta de confianza o sin el foco: no hace nada', () => {
    st().trustFolder('/a')
    useCode.setState({ directory: '/a', openDirectories: ['/a', '/d'] })
    st().declineFocusedProject('/a')
    st().declineFocusedProject('/d')
    expect(st().directory).toBe('/a')
    expect(st().openDirectories).toEqual(['/a', '/d'])
  })
})

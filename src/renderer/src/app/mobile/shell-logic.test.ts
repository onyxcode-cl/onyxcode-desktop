import { describe, expect, it } from 'vitest'
import { bannerFor } from './link'
import { navAnimation } from './nav'

describe('navAnimation', () => {
  const at = (tab: 'chat' | 'code' | 'tasks' | 'more', depth: number) => ({ tab, depth })
  it('sin pantalla anterior o con el gesto atrás del navegador no anima', () => {
    expect(navAnimation(null, at('chat', 1), false)).toBe('none')
    expect(navAnimation(at('chat', 2), at('chat', 1), true)).toBe('none')
  })
  it('otra pestaña: fundido', () => {
    expect(navAnimation(at('chat', 2), at('code', 1), false)).toBe('tab')
  })
  it('más profundo entra por la derecha y menos profundo por la izquierda', () => {
    expect(navAnimation(at('chat', 1), at('chat', 2), false)).toBe('push')
    expect(navAnimation(at('more', 3), at('more', 2), false)).toBe('pop')
  })
  it('misma pestaña y misma profundidad: nada', () => {
    expect(navAnimation(at('tasks', 2), at('tasks', 2), false)).toBe('none')
  })
})

describe('bannerFor', () => {
  it('reconectando y sin conexión mientras duran', () => {
    expect(bannerFor('online', 'reconnecting')).toBe('reconnecting')
    expect(bannerFor('reconnecting', 'offline')).toBe('offline')
    expect(bannerFor('offline', 'offline')).toBe('offline')
  })
  it('«conectado de nuevo» solo al volver desde reconectando o sin conexión', () => {
    expect(bannerFor('reconnecting', 'online')).toBe('recovered')
    expect(bannerFor('offline', 'online')).toBe('recovered')
    expect(bannerFor('connecting', 'online')).toBeNull()
    expect(bannerFor('locked', 'online')).toBeNull()
    expect(bannerFor('online', 'online')).toBeNull()
  })
  it('bloqueado o conectando: sin aviso (los pinta la capa ligera)', () => {
    expect(bannerFor('online', 'locked')).toBeNull()
    expect(bannerFor('offline', 'connecting')).toBeNull()
  })
})

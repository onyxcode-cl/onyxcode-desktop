import { describe, expect, it } from 'vitest'
import { initialNav, navPop, navPush, navSetTab, navShowTab, topScreen, useMobileNavStore, ROOT_SCREEN } from './nav'

describe('navegación en pila del celular', () => {
  it('empieza en Chat, en la lista, sin atrás', () => {
    const s = initialNav()
    expect(s.tab).toBe('chat')
    expect(topScreen(s)).toBe(ROOT_SCREEN)
    expect(navPop(s)).toBe(s)
  })

  it('push apila y pop desapila; la base nunca se quita', () => {
    let s = navPush(initialNav(), 'detail')
    expect(topScreen(s)).toBe('detail')
    s = navPush(s, 'changes')
    expect(s.stacks.chat).toEqual(['root', 'detail', 'changes'])
    s = navPop(navPop(s))
    expect(topScreen(s)).toBe('root')
    expect(navPop(s)).toBe(s)
  })

  it('no repite la pantalla de arriba ni pasa de la profundidad máxima', () => {
    const a = navPush(initialNav(), 'detail')
    expect(navPush(a, 'detail')).toBe(a)
    let s = initialNav()
    for (let i = 0; i < 20; i++) s = navPush(s, `p${i}`)
    expect(s.stacks.chat.length).toBe(8)
  })

  it('cada pestaña conserva su propia pila', () => {
    let s = navPush(initialNav('chat'), 'detail')
    s = navSetTab(s, 'code')
    expect(topScreen(s)).toBe('root')
    s = navPush(s, 'detail')
    s = navSetTab(s, 'chat')
    expect(topScreen(s)).toBe('detail')
    expect(s.stacks.code).toEqual(['root', 'detail'])
  })

  it('tocar la pestaña activa vuelve a su lista; showTab no lo hace', () => {
    const s = navPush(initialNav(), 'detail')
    expect(topScreen(navSetTab(s, 'chat'))).toBe('root')
    expect(navShowTab(s, 'chat')).toBe(s)
    expect(navShowTab(s, 'more').tab).toBe('more')
  })

  it('el store expone push/pop/setTab', () => {
    const st = useMobileNavStore
    st.getState().reset()
    st.getState().push('detail')
    expect(st.getState().stacks.chat).toEqual(['root', 'detail'])
    st.getState().pop()
    st.getState().setTab('more')
    expect(st.getState().tab).toBe('more')
    st.getState().reset()
  })
})

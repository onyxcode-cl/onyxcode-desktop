import { describe, expect, it } from 'vitest'
import {
  initialNav,
  isSettingsScreen,
  navOpenDetail,
  navPop,
  navPush,
  navSetDrawer,
  navSetTab,
  navShowTab,
  topScreen,
  useMobileNavStore,
  MOBILE_TABS,
  ROOT_SCREEN
} from './nav'

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
    expect(navShowTab(s, 'routines').tab).toBe('routines')
  })

  it('el store expone push/pop/setTab', () => {
    const st = useMobileNavStore
    st.getState().reset()
    st.getState().push('detail')
    expect(st.getState().stacks.chat).toEqual(['root', 'detail'])
    st.getState().pop()
    st.getState().setTab('routines')
    expect(st.getState().tab).toBe('routines')
    st.getState().reset()
  })

  it('las pestañas son Chat · Code · Tareas · Rutinas (ya no hay «Más»)', () => {
    expect(MOBILE_TABS).toEqual(['chat', 'code', 'tasks', 'routines'])
    expect(Object.keys(initialNav().stacks).sort()).toEqual(['chat', 'code', 'routines', 'tasks'])
  })

  it('el panel empieza cerrado; abrirlo no toca las pilas y repetir el mismo estado no cambia nada', () => {
    const s = navPush(initialNav(), 'detail')
    expect(s.drawerOpen).toBe(false)
    const open = navSetDrawer(s, true)
    expect(open.drawerOpen).toBe(true)
    expect(open.stacks).toBe(s.stacks)
    expect(navSetDrawer(open, true)).toBe(open)
    expect(navSetDrawer(open, false).drawerOpen).toBe(false)
  })

  it('el estado del panel sobrevive a apilar, cambiar de pestaña y abrir detalle', () => {
    let s = navSetDrawer(initialNav(), true)
    s = navPush(s, 'detail')
    s = navSetTab(s, 'code')
    s = navOpenDetail(s, 'tasks')
    expect(s.drawerOpen).toBe(true)
  })

  it('Ajustes se apila en la pestaña activa, sea cual sea, y se desapila con «atrás»', () => {
    for (const tab of MOBILE_TABS) {
      let s = initialNav(tab)
      s = navPush(s, 'settings')
      s = navPush(s, 'settings:general')
      expect(s.tab).toBe(tab)
      expect(s.stacks[tab]).toEqual(['root', 'settings', 'settings:general'])
      for (const other of MOBILE_TABS.filter((x) => x !== tab)) expect(s.stacks[other]).toEqual(['root'])
      expect(topScreen(navPop(s))).toBe('settings')
    }
  })

  it('isSettingsScreen reconoce Ajustes, sus secciones y la conexión', () => {
    for (const ok of ['settings', 'settings:general', 'settings:models', 'phone']) expect(isSettingsScreen(ok)).toBe(true)
    for (const no of ['root', 'detail', 'code:changes', 'routines']) expect(isSettingsScreen(no)).toBe(false)
  })

  it('el store expone setDrawer y reset lo cierra', () => {
    const st = useMobileNavStore
    st.getState().reset()
    st.getState().setDrawer(true)
    expect(st.getState().drawerOpen).toBe(true)
    st.getState().reset()
    expect(st.getState().drawerOpen).toBe(false)
  })
})

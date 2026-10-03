/**
 * Navegación en pila de la interfaz móvil (PWA del celular): cada pestaña (Chat · Code · Tareas · Más) tiene su propia pila de
 * pantallas, cuya base es siempre `root` (la lista). Entrar a una conversación = `push('detail')`; el botón atrás = `pop()`.
 * Las pantallas son cadenas libres: el shell usa `root`/`detail`/`routines`/`settings`/`phone`, y otras tandas (p. ej. Cambios y
 * Archivos de Code) pueden apilar las suyas (`changes`, `files`…) sin tocar este archivo. Sin DOM: lo prueba un test unitario.
 */
import { create } from 'zustand'

export type MobileTab = 'chat' | 'code' | 'tasks' | 'more'
export const MOBILE_TABS: readonly MobileTab[] = ['chat', 'code', 'tasks', 'more']
export type MobileScreenId = string
export const ROOT_SCREEN: MobileScreenId = 'root'
export const DETAIL_SCREEN: MobileScreenId = 'detail'
const MAX_DEPTH = 8

export interface NavState {
  tab: MobileTab
  stacks: Record<MobileTab, readonly MobileScreenId[]>
}

export const initialNav = (tab: MobileTab = 'chat'): NavState => ({
  tab,
  stacks: { chat: [ROOT_SCREEN], code: [ROOT_SCREEN], tasks: [ROOT_SCREEN], more: [ROOT_SCREEN] }
})

export const topScreen = (s: NavState): MobileScreenId => s.stacks[s.tab][s.stacks[s.tab].length - 1] ?? ROOT_SCREEN

/** Apila una pantalla en la pestaña activa (no repite la de arriba; tope de profundidad). */
export function navPush(s: NavState, screen: MobileScreenId): NavState {
  const stack = s.stacks[s.tab]
  if (stack[stack.length - 1] === screen || stack.length >= MAX_DEPTH) return s
  return { ...s, stacks: { ...s.stacks, [s.tab]: [...stack, screen] } }
}

/** Quita la pantalla de arriba de la pestaña activa (la base nunca se quita). */
export function navPop(s: NavState): NavState {
  const stack = s.stacks[s.tab]
  if (stack.length <= 1) return s
  return { ...s, stacks: { ...s.stacks, [s.tab]: stack.slice(0, -1) } }
}

/** Cambia de pestaña. Volver a tocar la pestaña activa la devuelve a su lista (patrón habitual de las apps). */
export function navSetTab(s: NavState, tab: MobileTab): NavState {
  if (tab !== s.tab) return { ...s, tab }
  return s.stacks[tab].length > 1 ? { ...s, stacks: { ...s.stacks, [tab]: [ROOT_SCREEN] } } : s
}

/** Cambia de pestaña SIN el gesto de «volver a la lista» (cambios externos: notificación, atajo). */
export function navShowTab(s: NavState, tab: MobileTab): NavState {
  return tab === s.tab ? s : { ...s, tab }
}

/** Muestra la pestaña con su conversación abierta (`root` → `detail`), p. ej. al tocar una notificación. */
export function navOpenDetail(s: NavState, tab: MobileTab): NavState {
  const stack = s.stacks[tab]
  if (s.tab === tab && stack[stack.length - 1] === DETAIL_SCREEN) return s
  const keep = stack.includes(DETAIL_SCREEN) ? stack : [ROOT_SCREEN, DETAIL_SCREEN]
  return { tab, stacks: { ...s.stacks, [tab]: keep } }
}

interface NavStore extends NavState {
  push: (screen: MobileScreenId) => void
  pop: () => void
  setTab: (tab: MobileTab) => void
  showTab: (tab: MobileTab) => void
  openDetail: (tab: MobileTab) => void
  /** Vuelve a la lista de la pestaña activa. */
  toRoot: () => void
  /** Solo pruebas: restablece el estado. */
  reset: (tab?: MobileTab) => void
}

export const useMobileNavStore = create<NavStore>((set) => ({
  ...initialNav(),
  push: (screen) => set((s) => navPush(s, screen)),
  pop: () => set((s) => navPop(s)),
  setTab: (tab) => set((s) => navSetTab(s, tab)),
  showTab: (tab) => set((s) => navShowTab(s, tab)),
  openDetail: (tab) => set((s) => navOpenDetail(s, tab)),
  toRoot: () => set((s) => ({ ...s, stacks: { ...s.stacks, [s.tab]: [ROOT_SCREEN] } })),
  reset: (tab) => set(initialNav(tab))
}))

/** Navegación mínima para las pantallas: dónde estoy y cómo apilar/desapilar. */
export function useMobileNav(): {
  tab: MobileTab
  screen: MobileScreenId
  depth: number
  canGoBack: boolean
  push: (screen: MobileScreenId) => void
  pop: () => void
  setTab: (tab: MobileTab) => void
} {
  const tab = useMobileNavStore((s) => s.tab)
  const stack = useMobileNavStore((s) => s.stacks[s.tab])
  const push = useMobileNavStore((s) => s.push)
  const pop = useMobileNavStore((s) => s.pop)
  const setTab = useMobileNavStore((s) => s.setTab)
  return { tab, screen: stack[stack.length - 1] ?? ROOT_SCREEN, depth: stack.length, canGoBack: stack.length > 1, push, pop, setTab }
}

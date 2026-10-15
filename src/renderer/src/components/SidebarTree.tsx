import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'

/**
 * Árbol de la barra lateral de escritorio (2c): proyectos con sesiones anidadas.
 *
 * `SidebarTreeContext` solo tiene valor dentro del `<SidebarTree>` de la barra de escritorio (`SidebarTreeRoot.tsx`). Las filas compartidas
 * (Chat, Code, Tareas) lo leen para añadir roles ARIA, el punto de estado y la guía del árbol; fuera de él (celular, pruebas de marcado
 * fijado) su marcado no cambia ni un atributo. Este archivo NO contiene textos de interfaz (lo importa código que llega a la PWA): los
 * textos viajan en el valor del contexto, que los pone `SidebarTreeRoot.tsx`.
 */
export interface SidebarTreeValue {
  /** Nombre accesible de una fila con estado («… · esperando aprobación»); `undefined` si no hay estado (queda el nombre del contenido). */
  stateAria: (title: string, state: SessionState | null | undefined) => string | undefined
  /** Nombre accesible de cada región `tree` (lo pone `SidebarTreeRoot.tsx`: aquí no hay textos). */
  treeLabel: string
}
export const SidebarTreeContext = createContext<SidebarTreeValue | null>(null)
export const useSidebarTree = (): SidebarTreeValue | null => useContext(SidebarTreeContext)

/**
 * Región `role="tree"`: SOLO las filas (proyectos y sesiones). ARIA exige que un `tree` contenga únicamente `treeitem`: los campos de búsqueda,
 * selectores y botones de la cabecera de la lista van FUERA de la región. Sin ninguna fila (solo el texto «aún no hay…») la región es un div
 * normal. Fuera de la barra lateral de escritorio (celular, pruebas de marcado fijado) no añade ni un elemento.
 */
export function SidebarTreeRegion({ children }: { children: React.ReactNode }): React.JSX.Element {
  const tree = useSidebarTree()
  const ref = useRef<HTMLDivElement>(null)
  const [hasItems, setHasItems] = useState(true)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const sync = (): void => setHasItems(el.querySelector('[role="treeitem"]') !== null)
    sync()
    const mo = new MutationObserver(sync)
    mo.observe(el, { childList: true, subtree: true })
    return () => mo.disconnect()
  }, [tree])
  if (!tree) return <>{children}</>
  return (
    <div ref={ref} role={hasItems ? 'tree' : undefined} aria-label={hasItems ? tree.treeLabel : undefined}>
      {children}
    </div>
  )
}

// ───────────────────────────── Teclado (puro, probable sin DOM) ─────────────────────────────

export interface TreeNode {
  /** `aria-level` del elemento (1 = proyecto, 2 = sesión). */
  level: number
  /** `aria-expanded`: solo los proyectos lo llevan. */
  expanded?: boolean
}

export type TreeKey = 'ArrowDown' | 'ArrowUp' | 'ArrowRight' | 'ArrowLeft' | 'Home' | 'End'
export const TREE_KEYS: readonly string[] = ['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End']

export type TreeMove = { type: 'focus'; index: number } | { type: 'toggle'; index: number } | null

/**
 * Qué hace una tecla sobre el elemento `from` de la lista plana de elementos VISIBLES (en orden de documento).
 * ↑ ↓ Inicio Fin mueven el foco; → despliega un proyecto plegado o baja a su primera sesión; ← pliega un proyecto desplegado o sube a su proyecto.
 */
export function treeMove(nodes: readonly TreeNode[], from: number, key: TreeKey): TreeMove {
  const cur = nodes[from]
  if (!cur || nodes.length === 0) return null
  switch (key) {
    case 'ArrowDown':
      return from < nodes.length - 1 ? { type: 'focus', index: from + 1 } : null
    case 'ArrowUp':
      return from > 0 ? { type: 'focus', index: from - 1 } : null
    case 'Home':
      return { type: 'focus', index: 0 }
    case 'End':
      return { type: 'focus', index: nodes.length - 1 }
    case 'ArrowRight': {
      if (cur.expanded === false) return { type: 'toggle', index: from }
      const next = nodes[from + 1]
      return cur.expanded === true && next && next.level > cur.level ? { type: 'focus', index: from + 1 } : null
    }
    case 'ArrowLeft': {
      if (cur.expanded === true) return { type: 'toggle', index: from }
      for (let i = from - 1; i >= 0; i--) if ((nodes[i] as TreeNode).level < cur.level) return { type: 'focus', index: i }
      return null
    }
  }
}

const isVisible = (el: HTMLElement): boolean => el.getClientRects().length > 0

/**
 * Un `treeitem` es la FILA entera (así sus botones de acción —opciones, nueva sesión…— cuelgan de él y el árbol cumple ARIA); su botón
 * principal lleva `data-tree-primary` y es quien recibe el foco. Una fila de un solo botón puede ser ella misma el `treeitem`.
 */
const primaryOf = (item: HTMLElement): HTMLElement => item.querySelector<HTMLElement>('[data-tree-primary]') ?? item

/** Manejador de teclado del árbol: actúa solo si el foco está en el botón principal de un `treeitem` (no en un campo de texto ni en un botón de acción). */
export function onTreeKeyDown(e: KeyboardEvent<HTMLElement>): void {
  if (!TREE_KEYS.includes(e.key) || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
  const active = document.activeElement
  if (!(active instanceof HTMLElement)) return
  const current = active.closest<HTMLElement>('[role="treeitem"]')
  if (!current || primaryOf(current) !== active) return
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="treeitem"]')).filter(isVisible)
  const nodes: TreeNode[] = items.map((el) => {
    const exp = el.getAttribute('aria-expanded')
    return { level: Number(el.getAttribute('aria-level') ?? 1), expanded: exp === null ? undefined : exp === 'true' }
  })
  const move = treeMove(nodes, items.indexOf(current), e.key as TreeKey)
  if (!move) return
  e.preventDefault()
  const target = primaryOf(items[move.index] as HTMLElement)
  if (move.type === 'toggle') target.click()
  else target.focus()
}

// ───────────────────────────── Estado de una sesión ─────────────────────────────

/**
 * Esperando aprobación o respuesta (aviso) · trabajando (acento) · cambios por revisar (acento, punto hueco) · lista/sin leer (éxito).
 * Sin estado = sin punto.
 */
export type SessionState = 'waiting' | 'working' | 'review' | 'done'

const DOT: Record<SessionState, string> = {
  waiting: 'bg-warning',
  working: 'bg-accent animate-pulse motion-reduce:animate-none',
  // Hueco (no solo otro color): se distingue de «trabajando» y «lista» sin depender del tono.
  review: 'border-[1.5px] border-accent bg-transparent',
  done: 'bg-success'
}

/** Punto de estado de 7 px. Nunca va solo: la fila lleva el texto («Aprobar», «Trabajando») y `stateAria` lo repite para lectores. */
export function StateDot({ state }: { state: SessionState }): React.JSX.Element {
  return <span aria-hidden="true" data-state={state} className={`size-[7px] shrink-0 rounded-full ${DOT[state]}`} />
}

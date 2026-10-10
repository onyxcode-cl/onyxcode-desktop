import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SidebarTreeRegion, StateDot, treeMove, useSidebarTree, type TreeNode } from './SidebarTree'
import { SidebarTree } from './SidebarTreeRoot'

// Árbol de ejemplo: [0] proyecto A (desplegado) · [1] [2] sus sesiones · [3] proyecto B (plegado) · [4] sin proyecto.
const nodes: TreeNode[] = [{ level: 1, expanded: true }, { level: 2 }, { level: 2 }, { level: 1, expanded: false }, { level: 1 }]

describe('treeMove (teclado del árbol)', () => {
  it('↑ ↓ Inicio Fin mueven el foco y se detienen en los extremos', () => {
    expect(treeMove(nodes, 0, 'ArrowDown')).toEqual({ type: 'focus', index: 1 })
    expect(treeMove(nodes, 2, 'ArrowUp')).toEqual({ type: 'focus', index: 1 })
    expect(treeMove(nodes, 0, 'ArrowUp')).toBeNull()
    expect(treeMove(nodes, 4, 'ArrowDown')).toBeNull()
    expect(treeMove(nodes, 2, 'Home')).toEqual({ type: 'focus', index: 0 })
    expect(treeMove(nodes, 1, 'End')).toEqual({ type: 'focus', index: 4 })
  })

  it('→ despliega un proyecto plegado o baja a su primera sesión; en una sesión no hace nada', () => {
    expect(treeMove(nodes, 3, 'ArrowRight')).toEqual({ type: 'toggle', index: 3 })
    expect(treeMove(nodes, 0, 'ArrowRight')).toEqual({ type: 'focus', index: 1 })
    expect(treeMove(nodes, 1, 'ArrowRight')).toBeNull()
  })

  it('← pliega un proyecto desplegado o sube del hijo a su proyecto', () => {
    expect(treeMove(nodes, 0, 'ArrowLeft')).toEqual({ type: 'toggle', index: 0 })
    expect(treeMove(nodes, 2, 'ArrowLeft')).toEqual({ type: 'focus', index: 0 })
    expect(treeMove(nodes, 3, 'ArrowLeft')).toBeNull()
    expect(treeMove(nodes, 4, 'ArrowLeft')).toBeNull()
  })

  it('un proyecto desplegado sin sesiones visibles no baja con →', () => {
    expect(treeMove([{ level: 1, expanded: true }, { level: 1 }], 0, 'ArrowRight')).toBeNull()
  })

  it('lista vacía o índice fuera de rango: nada', () => {
    expect(treeMove([], 0, 'ArrowDown')).toBeNull()
    expect(treeMove(nodes, -1, 'ArrowDown')).toBeNull()
  })
})

describe('SidebarTree', () => {
  const Probe = (): React.JSX.Element => createElement('i', null, String(!!useSidebarTree()))

  it('activa el contexto solo dentro de él; el role=tree lo pone cada región de filas', () => {
    expect(renderToStaticMarkup(createElement(Probe))).toBe('<i>false</i>')
    const html = renderToStaticMarkup(createElement(SidebarTree, null, createElement(Probe)))
    expect(html).toBe('<div><i>true</i></div>')
    // Fuera de la barra lateral de escritorio la región no añade ni un elemento.
    expect(renderToStaticMarkup(createElement(SidebarTreeRegion, null, createElement(Probe)))).toBe('<i>false</i>')
    // Dentro, es un tree con nombre.
    expect(renderToStaticMarkup(createElement(SidebarTree, null, createElement(SidebarTreeRegion, null, createElement(Probe))))).toBe(
      '<div><div role="tree" aria-label="Proyectos y conversaciones"><i>true</i></div></div>'
    )
  })

  it('el punto de estado es decorativo, de 7 px y usa solo tokens', () => {
    const cases = { waiting: 'bg-warning', working: 'bg-accent', done: 'bg-success' } as const
    for (const [state, token] of Object.entries(cases)) {
      const html = renderToStaticMarkup(createElement(StateDot, { state: state as keyof typeof cases }))
      expect(html).toContain('aria-hidden="true"')
      expect(html).toContain('size-[7px]')
      expect(html).toContain(token)
    }
    // El pulso de «trabajando» se apaga con prefers-reduced-motion.
    expect(renderToStaticMarkup(createElement(StateDot, { state: 'working' }))).toContain('motion-reduce:animate-none')
  })
})

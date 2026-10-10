import { describe, expect, it } from 'vitest'
import { foldTitle, isMenuChild, pickMenuNode, type MenuNodeLike } from './menu-path'

const bar: MenuNodeLike[] = [
  { ref: 'm.0', role: 'AXMenuBarItem', title: 'Apple' },
  { ref: 'm.2', role: 'AXMenuBarItem', title: 'Connections' },
  { ref: 'm.2.0', role: 'AXMenu', title: 'Connections' },
  { ref: 'm.2.0.0', role: 'AXMenuItem', title: 'Keyboard Mode' },
  { ref: 'm.2.0.0.0', role: 'AXMenu', title: 'Keyboard Mode' },
  { ref: 'm.2.0.0.0.0', role: 'AXMenuItem', title: 'Scancode' },
  { ref: 'm.2.0.0.0.1', role: 'AXMenuItem', title: 'Unicode' },
  { ref: 'm.2.0.1', role: 'AXMenuItem', title: 'Preferencias…' },
  { ref: 'm.12.0.3', role: 'AXMenuItem', title: 'Otra' }
]

describe('ruta de menús por accesibilidad', () => {
  it('reconoce los hijos directos de cada nivel', () => {
    expect(isMenuChild('m.2', null)).toBe(true)
    expect(isMenuChild('m.2.0', null)).toBe(false)
    expect(isMenuChild('m.2.0.1', 'm.2')).toBe(true)
    expect(isMenuChild('m.2.0.0.0.1', 'm.2')).toBe(false)
    expect(isMenuChild('m.2.0.0.0.1', 'm.2.0.0')).toBe(true)
    // `m.2` no debe confundirse con `m.20`
    expect(isMenuChild('m.20.0.1', 'm.2')).toBe(false)
  })

  it('recorre la ruta tramo a tramo', () => {
    const a = pickMenuNode(bar, null, 'connections')
    expect(a.node?.ref).toBe('m.2')
    const b = pickMenuNode(bar, a.node!.ref, 'Keyboard Mode')
    expect(b.node?.ref).toBe('m.2.0.0')
    const c = pickMenuNode(bar, b.node!.ref, 'Unicode')
    expect(c.node?.ref).toBe('m.2.0.0.0.1')
    expect(c.options).toEqual(['Scancode', 'Unicode'])
  })

  it('ignora acentos y los puntos suspensivos finales', () => {
    expect(foldTitle('Preferencias…')).toBe('preferencia')
    expect(pickMenuNode(bar, 'm.2', 'preferencias').node?.ref).toBe('m.2.0.1')
    expect(foldTitle('Conexión')).toBe('conexion')
    // singular/plural: el agente pide «rutas» y el menú de Finder dice «ruta»
    expect(foldTitle('Mostrar barra de rutas')).toBe(foldTitle('Mostrar barra de ruta'))
  })

  it('tolera plural/singular entre lo pedido y el título real', () => {
    const nodes: MenuNodeLike[] = [{ ref: 'm.4.0.18', role: 'AXMenuItem', title: 'Mostrar barra de ruta' }]
    expect(pickMenuNode(nodes, 'm.4', 'Mostrar barra de rutas').node?.ref).toBe('m.4.0.18')
  })

  it('si no existe devuelve las opciones de ese nivel para poder corregir', () => {
    const r = pickMenuNode(bar, 'm.2', 'Inexistente')
    expect(r.node).toBeUndefined()
    expect(r.options).toEqual(['Keyboard Mode', 'Preferencias…'])
  })

  it('una coincidencia parcial ambigua no elige a ciegas', () => {
    const nodes: MenuNodeLike[] = [
      { ref: 'm.1.0.0', role: 'AXMenuItem', title: 'Guardar como' },
      { ref: 'm.1.0.1', role: 'AXMenuItem', title: 'Guardar todo' }
    ]
    expect(pickMenuNode(nodes, 'm.1', 'Guardar').node).toBeUndefined()
    expect(pickMenuNode(nodes, 'm.1', 'Guardar como').node?.ref).toBe('m.1.0.0')
  })
})

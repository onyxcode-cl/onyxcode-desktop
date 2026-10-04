/** Elementos del navegador en el compositor de Tareas: chips del borrador (añadir, tope, casillas, quitar). */
import { beforeEach, describe, expect, it } from 'vitest'
import { pickedElement } from '../../../../../test/fixtures/element'
import { MAX_ELEMENTS } from '../../browser/element-context'
import { addPickedElement, removeElement, setElementInclude } from './actions'
import { useTasks } from './store'

beforeEach(() => useTasks.setState({ elements: [], draft: '' }))

describe('elementos del navegador en Tareas', () => {
  it('un elemento elegido queda como chip con captura y errores marcados por defecto, sin tocar el borrador', () => {
    useTasks.setState({ draft: 'escribe aquí' })
    addPickedElement(pickedElement())
    const [el] = useTasks.getState().elements
    expect(el).toMatchObject({ kind: 'element', name: '<button> [data-testid="buy"]', include: { image: true, diagnostics: true } })
    expect(useTasks.getState().draft).toBe('escribe aquí')
  })
  it('un elemento sensible nace sin captura', () => {
    addPickedElement(pickedElement({ flags: { sensitive: true, truncated: false } }))
    expect(useTasks.getState().elements[0]!.include.image).toBe(false)
  })
  it('conserva solo los más recientes', () => {
    for (let i = 0; i < MAX_ELEMENTS + 1; i++) addPickedElement(pickedElement({ selector: `#e${i}` }))
    const list = useTasks.getState().elements
    expect(list).toHaveLength(MAX_ELEMENTS)
    expect(list[0]!.element.selector).toBe('#e1')
  })
  it('las casillas y quitar actúan sobre el elemento indicado', () => {
    addPickedElement(pickedElement({ selector: '#a' }))
    addPickedElement(pickedElement({ selector: '#b' }))
    const [a, b] = useTasks.getState().elements
    setElementInclude(a!.id, { image: false, diagnostics: false })
    expect(useTasks.getState().elements[0]!.include).toEqual({ image: false, diagnostics: false })
    expect(useTasks.getState().elements[1]!.include).toEqual({ image: true, diagnostics: true })
    removeElement(b!.id)
    expect(useTasks.getState().elements.map((e) => e.id)).toEqual([a!.id])
  })
})

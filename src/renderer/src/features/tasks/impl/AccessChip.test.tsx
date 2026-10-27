// @vitest-environment jsdom
import { vi } from 'vitest'

vi.hoisted(() => vi.unstubAllGlobals())
const setAccessMode = vi.hoisted(() => vi.fn())
vi.mock('./actions', () => ({ setAccessMode }))
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setLang } from '@shared/i18n'
import { useLang } from '../../../lib/i18n'
import { AccessChip } from './AccessChip'
import { useTasks } from './store'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  setLang('es')
  useLang.setState({ lang: 'es' })
  setAccessMode.mockReset()
  useTasks.setState({ conn: null, phase: 'ready', fullAccess: false } as never)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const render = (props: { disabled?: boolean } = {}): void => act(() => root.render(createElement(AccessChip, props)))
const trigger = (): HTMLButtonElement => host.querySelector('button[aria-haspopup="menu"]') as HTMLButtonElement
const items = (): HTMLButtonElement[] => Array.from(host.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'))

describe('AccessChip (Overdrive)', () => {
  it('siempre muestra el modo de acceso (texto + nombre accesible) y el modo por defecto es una carpeta', () => {
    render()
    expect(trigger().textContent).toContain('Una carpeta')
    expect(trigger().getAttribute('aria-label')).toBe('Modo de acceso: Una carpeta')
    const label = Array.from(trigger().querySelectorAll('span')).find((s) => s.textContent === 'Una carpeta')!
    expect(label.className).toContain('desk:@max-[34rem]:sr-only')
  })

  it('el menú ofrece las dos opciones con su frase y marca la actual', () => {
    render()
    act(() => trigger().click())
    expect(items().map((i) => i.dataset.option)).toEqual(['sandbox', 'full'])
    expect(items().map((i) => i.getAttribute('aria-checked'))).toEqual(['true', 'false'])
    expect(items()[0]!.textContent).toContain('Carpeta aislada y obligatoria')
    expect(items()[1]!.textContent).toContain('la carpeta es opcional')
  })

  it('elegir Control total llama a la acción de siempre (setAccessMode(true)); no cambia nada por su cuenta', () => {
    render()
    act(() => trigger().click())
    act(() => items()[1]!.click())
    expect(setAccessMode).toHaveBeenCalledTimes(1)
    expect(setAccessMode).toHaveBeenCalledWith(true)
  })

  it('con Control total activo el chip se marca de aviso y deshabilitado no abre', () => {
    useTasks.setState({ fullAccess: true } as never)
    render({ disabled: true })
    expect(trigger().textContent).toContain('El computador completo')
    expect(trigger().className).toContain('text-warning')
    expect(trigger().disabled).toBe(true)
  })
})

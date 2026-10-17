// @vitest-environment jsdom
import { vi } from 'vitest'

vi.hoisted(() => vi.unstubAllGlobals())
const native = vi.hoisted(() => ({
  git: { currentBranch: vi.fn((_dir: string) => Promise.resolve('feat/caja')) },
  dialog: { revealInFinder: vi.fn((_dir: string) => Promise.resolve()) }
}))
const pickAndOpen = vi.hoisted(() => vi.fn(() => Promise.resolve()))
vi.mock('./client', async (orig) => ({ ...(await orig<typeof import('./client')>()), nativeCode: () => native }))
vi.mock('./ProjectPicker', () => ({ pickAndOpenFolder: pickAndOpen }))
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useLang } from '../../../lib/i18n'
import { ProjectChip } from './ComposerControls'
import { useCode } from './store'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
const focusProject = vi.fn((_dir: string) => Promise.resolve())

beforeEach(async () => {
  useLang.setState({ lang: 'es' })
  focusProject.mockClear()
  pickAndOpen.mockClear()
  native.dialog.revealInFinder.mockClear()
  useCode.setState({
    directory: '/Users/yo/app-uno',
    openDirectories: ['/Users/yo/app-uno', '/Users/yo/app-dos'],
    activeSessionID: null,
    sessions: {},
    focusProject
  } as never)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root.render(createElement(ProjectChip)))
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const trigger = (): HTMLButtonElement => host.querySelector('button[aria-haspopup="menu"]') as HTMLButtonElement
const radios = (): HTMLButtonElement[] => Array.from(host.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'))
const actions = (): HTMLButtonElement[] => Array.from(host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))

describe('ProjectChip (Code)', () => {
  it('muestra la carpeta y la rama; el nombre accesible es «ajuste: valor» e incluye la rama aunque se oculte', () => {
    expect(trigger().getAttribute('aria-label')).toBe('Proyecto: app-uno (rama feat/caja)')
    expect(trigger().textContent).toContain('app-uno')
    expect(trigger().textContent).toContain('rama feat/caja')
    const label = Array.from(trigger().querySelectorAll('span')).find((s) => s.textContent === 'app-uno')!
    expect(label.className).toContain('desk:@max-[44rem]:sr-only')
    const detail = Array.from(trigger().querySelectorAll('span')).find((s) => s.textContent === 'rama feat/caja')!
    expect(detail.className).toContain('desk:@min-[56rem]:inline')
    expect(detail.getAttribute('aria-hidden')).toBe('true')
  })

  it('usa la carpeta efectiva de la sesión abierta (p. ej. un worktree), no solo la del proyecto con foco', async () => {
    useCode.setState({ activeSessionID: 's1', sessions: { s1: { id: 's1', directory: '/Users/yo/app-uno-wt' } } } as never)
    await act(async () => root.render(createElement(ProjectChip)))
    expect(trigger().getAttribute('aria-label')).toContain('Proyecto: app-uno-wt')
    expect(native.git.currentBranch).toHaveBeenLastCalledWith('/Users/yo/app-uno-wt')
  })

  it('el menú lista los proyectos abiertos (el actual marcado), «Agregar proyecto…» y «Mostrar en Finder»', () => {
    act(() => trigger().click())
    expect(radios().map((r) => r.dataset.option)).toEqual(['/Users/yo/app-uno', '/Users/yo/app-dos'])
    expect(radios().map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false'])
    expect(actions().length).toBe(2)
    expect(actions()[0]!.textContent).toContain('Agregar proyecto…')
  })

  it('elegir otro proyecto abierto le da el foco; no lo repite si es el actual', () => {
    act(() => trigger().click())
    act(() => radios()[0]!.click())
    expect(focusProject).not.toHaveBeenCalled()
    act(() => trigger().click())
    act(() => radios()[1]!.click())
    expect(focusProject).toHaveBeenCalledWith('/Users/yo/app-dos')
  })

  it('«Agregar proyecto…» abre el selector de carpeta y «Mostrar en Finder» revela la carpeta efectiva', () => {
    act(() => trigger().click())
    act(() => actions()[0]!.click())
    expect(pickAndOpen).toHaveBeenCalledTimes(1)
    act(() => trigger().click())
    act(() => actions()[1]!.click())
    expect(native.dialog.revealInFinder).toHaveBeenCalledWith('/Users/yo/app-uno')
  })

  it('teclado: ↓ abre el menú, Fin salta a la última acción, Esc cierra y devuelve el foco', () => {
    act(() => {
      trigger().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    })
    const menu = host.querySelector('[role="menu"]')!
    expect(document.activeElement).toBe(radios()[0])
    act(() => {
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }))
    })
    expect(document.activeElement).toBe(actions()[1])
    act(() => {
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
    expect(host.contains(menu)).toBe(false)
    expect(document.activeElement).toBe(trigger())
  })
})

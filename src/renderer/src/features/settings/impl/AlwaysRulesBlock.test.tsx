// @vitest-environment jsdom
import '../../../../../test/jsdom-first'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const callMock = vi.hoisted(() => vi.fn())
vi.mock('../../../lib/api', () => ({ call: callMock, api: { on: () => () => undefined } }))

import { AlwaysRulesBlock } from './AlwaysRulesBlock'
import { useSettings } from '../../../stores/settings'
import { applyLangPref } from '../../../lib/i18n'

let host: HTMLDivElement
let root: Root

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}
const mount = async (folders: string[] = ['/work/a', '/work/b']): Promise<void> => {
  act(() => useSettings.setState({ settings: { ...DEFAULT_SETTINGS, recentFolders: folders } }))
  act(() => root.render(createElement(AlwaysRulesBlock)))
  await flush()
}
const LIST = {
  available: true,
  active: true,
  truncated: false,
  rules: [
    { id: 'r1', permission: 'bash', pattern: 'git status' },
    { id: 'r2', permission: 'read', pattern: '<img src=x onerror=alert(1)>' }
  ]
}

beforeEach(() => {
  callMock.mockReset()
  applyLangPref('es')
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  applyLangPref('es')
})

describe('AlwaysRulesBlock', () => {
  it('lista las reglas de la carpeta más reciente y pinta el texto del motor como texto plano', async () => {
    callMock.mockResolvedValue(LIST)
    await mount()
    expect(callMock).toHaveBeenCalledWith('settings:alwaysList', { directory: '/work/a' })
    expect(host.textContent).toContain('git status')
    expect(host.querySelector('img')).toBeNull()
    expect(host.textContent).toContain('<img src=x onerror=alert(1)>')
  })

  it('«Quitar» pide borrar solo esa regla y vuelve a listar', async () => {
    callMock.mockImplementation(async (ch: string) => (ch === 'settings:alwaysRevoke' ? { available: true, ok: true } : LIST))
    await mount()
    const btn = host.querySelector<HTMLButtonElement>('button[aria-label*="git status"]')!
    await act(async () => btn.click())
    await flush()
    expect(callMock).toHaveBeenCalledWith('settings:alwaysRevoke', { directory: '/work/a', id: 'r1' })
    expect(callMock.mock.calls.filter((c) => c[0] === 'settings:alwaysList').length).toBe(2)
    expect(host.textContent).toContain('se quitó ese permiso')
  })

  it('cambiar de carpeta vuelve a consultar esa carpeta', async () => {
    callMock.mockResolvedValue({ ...LIST, rules: [] })
    await mount()
    const sel = host.querySelector('select')!
    await act(async () => {
      sel.value = '/work/b'
      sel.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()
    expect(callMock).toHaveBeenLastCalledWith('settings:alwaysList', { directory: '/work/b' })
    expect(host.textContent).toContain('no tiene permisos')
  })

  it('motor sin las rutas: avisa y no ofrece quitar', async () => {
    callMock.mockResolvedValue({ available: false })
    await mount()
    expect(host.textContent).toContain('todavía no permite gestionar')
    expect(host.querySelector('ul')).toBeNull()
  })

  it('sin carpetas recientes no llama al motor', async () => {
    await mount([])
    expect(callMock).not.toHaveBeenCalled()
    expect(host.textContent).toContain('Aún no hay carpetas recientes')
  })

  it('un error del motor se muestra y no rompe la vista', async () => {
    callMock.mockRejectedValue(new Error('El motor respondió 500'))
    await mount()
    expect(host.textContent).toContain('500')
  })
})

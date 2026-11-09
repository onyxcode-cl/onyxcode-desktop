// @vitest-environment jsdom
// Fallo 1 (1.8.12): con la carpeta restaurada pendiente, montar Code (CodeWorkspace + barra + selector de recientes) con un motor falso que
// cuenta las llamadas: NINGUNA puede llevar una carpeta que no pasó la confianza, mientras el diálogo está en pantalla ni tras Cancelar.
import { vi } from 'vitest'

vi.hoisted(() => vi.unstubAllGlobals())
const F = '/work/focus'
const AJENA = '/work/ajena-sin-confianza'
const native = vi.hoisted(() => ({
  git: { status: () => undefined, currentBranch: () => Promise.resolve(undefined), log: () => Promise.resolve([]) },
  dialog: { checkFolderAccess: vi.fn(() => Promise.resolve({ status: 'ok', canReset: false })) },
  project: {
    scan: vi.fn((_p: string) =>
      Promise.resolve({
        items: [{ id: 'plugin-x', kind: 'plugin', name: 'x.js', where: '.opencode/plugin/x.js', risky: true }],
        huella: 'h-nueva',
        complete: true,
        instructionFiles: []
      })
    )
  }
}))
vi.mock('./client', async (orig) => ({ ...(await orig<typeof import('./client')>()), nativeCode: () => native, requireCode: () => native }))
vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useLang } from '../../../lib/i18n'
import { useServer } from '../../../stores/server'
import { useSettings } from '../../../stores/settings'
import { CodeWorkspace } from './CodeWorkspace'
import { SessionList } from './SessionList'
import { CONFIRM_DELAY_MS, resolveTrust } from './trust'
import { useCode } from './store'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
const calls: string[] = []
/** Motor falso: cualquier `client.a.b(...)` se anota con su `directory`. */
const fakeClient = (): never => {
  const leaf =
    (path: string) =>
    (arg?: { directory?: string }): Promise<{ data: unknown[] }> => {
      calls.push(`${path}:${arg?.directory ?? ''}`)
      return Promise.resolve({ data: [] })
    }
  const make = (path: string): unknown =>
    new Proxy(() => undefined, {
      get: (_t, k) => make(`${path}.${String(k)}`),
      apply: (_t, _th, args) => leaf(path)(args[0])
    })
  return make('client') as never
}
const withDir = (): string[] => calls.filter((c) => !c.endsWith(':'))
const flush = (): Promise<void> => act(async () => void (await vi.advanceTimersByTimeAsync(10)))

beforeEach(() => {
  vi.useFakeTimers()
  calls.length = 0
  useLang.setState({ lang: 'es' } as never)
  localStorage.clear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  useSettings.setState({ settings: { ...useSettings.getState().settings, recentFolders: [F, AJENA] } } as never)
  // Sesión anterior: F con foco y de confianza, con lo visto antes.
  useCode.setState({
    directory: null,
    restoredFocus: F,
    openDirectories: [F],
    trustedFolders: [F],
    trustedScans: { [F]: { huella: 'h-vieja', ids: [] } }
  } as never)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
  useServer.setState({ client: null } as never)
  native.project.scan.mockClear()
})

describe('CodeWorkspace con la carpeta restaurada pendiente', () => {
  it('complemento nuevo: mientras el diálogo está en pantalla no hay NINGUNA llamada al motor con carpeta; Cancelar la cierra y sigue sin haberlas', async () => {
    useServer.setState({ client: fakeClient() } as never)
    await act(async () => root.render(createElement(CodeWorkspace)))
    await flush()
    await flush()
    expect(native.project.scan).toHaveBeenCalledWith(F)
    expect(host.textContent).toContain('Esta carpeta trae algo nuevo')
    expect(host.textContent).toContain('Revisando la carpeta antes de abrirla')
    expect(withDir()).toEqual([])
    await act(async () => void (await vi.advanceTimersByTimeAsync(CONFIRM_DELAY_MS + 50)))
    await act(async () => resolveTrust(false))
    await flush()
    expect(useCode.getState().openDirectories).toEqual([])
    expect(useCode.getState().directory).toBeNull()
    // Con la carpeta ya cerrada aparece el selector: solo carpetas ya verificadas piden sesiones (ninguna lo está).
    expect(withDir()).toEqual([])
  })

  it('el selector de recientes (sin carpeta pendiente) no pide sesiones de carpetas que no pasaron la confianza', async () => {
    useCode.setState({ restoredFocus: null, openDirectories: [] } as never)
    useServer.setState({ client: fakeClient() } as never)
    await act(async () => root.render(createElement(CodeWorkspace)))
    await flush()
    expect(host.textContent).not.toContain('Revisando la carpeta')
    expect(host.textContent).toContain('ajena-sin-confianza') // el selector SÍ se pintó
    expect(withDir()).toEqual([])
  })

  it('«+» de la barra en el grupo de la carpeta pendiente: no crea sesión ni llama al motor, ni durante el diálogo ni tras Cancelar', async () => {
    useServer.setState({ client: fakeClient() } as never)
    await act(async () => root.render(createElement('div', null, createElement(SessionList), createElement(CodeWorkspace))))
    await flush()
    const plus = host.querySelector('[data-testid="project-new-session"]') as HTMLButtonElement
    expect(plus).toBeTruthy()
    await act(async () => void plus.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })))
    await flush()
    await flush()
    expect(host.textContent).toContain('Esta carpeta trae algo nuevo')
    expect(withDir()).toEqual([])
    await act(async () => void (await vi.advanceTimersByTimeAsync(CONFIRM_DELAY_MS + 50)))
    await act(async () => resolveTrust(false))
    await flush()
    await flush()
    expect(useCode.getState().openDirectories).toEqual([])
    expect(withDir()).toEqual([])
  })

  it('«+» en una carpeta abierta SIN confianza (diálogo en pantalla): no crea la sesión al instante', async () => {
    useCode.setState({
      directory: '/work/otra',
      restoredFocus: null,
      openDirectories: ['/work/otra', F],
      trustedFolders: ['/work/otra']
    } as never)
    useServer.setState({ client: fakeClient() } as never)
    await act(async () => root.render(createElement('div', null, createElement(SessionList))))
    await flush()
    const plusF = [...host.querySelectorAll('[data-testid="project-new-session"]')].at(-1) as HTMLButtonElement
    await act(async () => void plusF.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })))
    await flush()
    await flush()
    expect(withDir().filter((c) => c.includes(F))).toEqual([])
  })
})

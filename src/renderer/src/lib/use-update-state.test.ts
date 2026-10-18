import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateState } from '@shared/update-check'
import { IDLE_INSTALL } from '@shared/update-install'

const mocks = vi.hoisted(() => ({ call: vi.fn(), invoke: vi.fn() }))
vi.mock('./api', () => ({ call: mocks.call, api: { invoke: mocks.invoke, on: vi.fn(() => () => undefined) } }))
vi.mock('./platform', () => ({ isRemoteSurface: () => false }))

import { runUpdateAction } from './use-update-state'
import { updateView } from './update-notice'

const state = (over: Partial<UpdateState> = {}): UpdateState => ({
  available: true,
  configured: true,
  enabled: true,
  current: '1.2.0',
  latest: { version: '1.2.1', url: 'https://github.com/o/r/releases/tag/v1.2.1' },
  dismissed: null,
  lastCheck: 1,
  checking: false,
  installable: false,
  install: IDLE_INSTALL,
  ...over
})
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  mocks.call.mockReset()
  mocks.invoke.mockReset()
})

describe('aviso de versión nueva sin instalación automática', () => {
  it('copia no instalable (portable, Mac o Windows): el botón dice «Ver descarga» y abre la página de la release', () => {
    const view = updateView(state())!
    expect(view.actions[0]).toMatchObject({ id: 'download-manual', label: 'Ver descarga' })
    expect(view.actions.some((a) => a.id === 'install')).toBe(false)
    runUpdateAction('download-manual', state(), vi.fn())
    expect(mocks.invoke).toHaveBeenCalledWith('app:openExternal', { url: 'https://github.com/o/r/releases/tag/v1.2.1' })
    expect(mocks.call).not.toHaveBeenCalled()
  })

  it('instalable: sigue «Actualizar» y baja por el canal de descarga', () => {
    expect(updateView(state({ installable: true }))!.actions[0]).toMatchObject({ id: 'install', label: 'Actualizar' })
  })

  it('si la descarga se rechaza, el mensaje de main llega a la interfaz y se relee el estado', async () => {
    const fresh = state()
    mocks.call.mockImplementation((ch: string) =>
      ch === 'app:updateDownload' ? Promise.reject(new Error('Esta copia de la app no se puede actualizar sola.')) : Promise.resolve(fresh)
    )
    const setState = vi.fn()
    const onError = vi.fn()
    runUpdateAction('install', state({ installable: true }), setState, onError)
    await tick()
    expect(onError).toHaveBeenLastCalledWith('Esta copia de la app no se puede actualizar sola.')
    expect(setState).toHaveBeenCalledWith(fresh)
  })

  it('un rechazo sin texto muestra un mensaje de respaldo en llano', async () => {
    mocks.call.mockImplementation((ch: string) => (ch === 'app:updateDownload' ? Promise.reject(new Error('')) : Promise.resolve(state())))
    const onError = vi.fn()
    runUpdateAction('retry', state({ installable: true }), vi.fn(), onError)
    await tick()
    expect(onError).toHaveBeenLastCalledWith('No se pudo iniciar la descarga. Inténtalo de nuevo.')
  })
})

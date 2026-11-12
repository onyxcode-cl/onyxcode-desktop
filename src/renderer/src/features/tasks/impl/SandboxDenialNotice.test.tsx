// @vitest-environment jsdom
import '../../../../../test/jsdom-first'
import { act } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type Mounted } from '../../../../../test/dom-render'
import { setLang } from '@shared/i18n'
import type { SandboxDenial } from '@shared/ipc-tasks'

const mock = vi.hoisted(() => ({ state: {} as Record<string, unknown>, allow: vi.fn(async () => {}) }))
vi.mock('./store', () => ({ useTasks: (selector: (s: unknown) => unknown) => selector(mock.state) }))
vi.mock('./actions', () => ({ setDeleteGrantAllowed: mock.allow }))
vi.mock('../../../lib/i18n', async () => {
  const { t } = await import('@shared/i18n')
  return { useT: () => t }
})
import { SandboxDenialNotice } from './SandboxDenialNotice'
let mounted: Mounted | undefined
const event = (kind: SandboxDenial['kind'], canAllowDelete = false): SandboxDenial => ({ kind, at: 1, canAllowDelete })
const html = (): string => renderToStaticMarkup(<SandboxDenialNotice />)
beforeEach(() => {
  setLang('es')
  mock.allow.mockReset().mockResolvedValue(undefined)
  mock.state = {
    folder: '/fixture/tarea',
    sandboxDenials: {},
    denialMonitorUnavailable: {},
    prefs: { sandboxDenialNotices: true },
    deleteGrant: false,
    deleteGrantBusy: false
  }
})
afterEach(() => {
  mounted?.unmount()
  mounted = undefined
  setLang('es')
})

describe('aviso de aislamiento en la tarea', () => {
  it('sin registro o con ajuste apagado no afirma un bloqueo', () => {
    expect(html()).toBe('')
    mock.state.sandboxDenials = { '/fixture/tarea': [event('delete', true)] }
    mock.state.prefs = { sandboxDenialNotices: false }
    expect(html()).toBe('')
  })
  it('muestra categorías sin repetir y explica el ámbito carpeta', () => {
    mock.state.sandboxDenials = { '/fixture/tarea': [event('read'), event('network'), event('read')] }
    const text = html()
    expect(text.match(/leer información protegida/g)).toHaveLength(1)
    expect(text).toContain('conexión de red directa')
    expect(text).toContain('Puede haber varias tareas')
    expect(text).not.toContain('/fixture')
    expect(text).not.toContain('<button')
  })
  it('el botón real concede el permiso de la carpeta y avisa del reinicio', async () => {
    mock.state.sandboxDenials = { '/fixture/tarea': [event('delete', true)] }
    mounted = mount(<SandboxDenialNotice />)
    expect(mounted.host.textContent).toContain('reinicia las tareas')
    const button = mounted.q('button')!
    expect(button.textContent).toContain('Permitir borrar, mover y renombrar')
    await act(async () => {
      button.click()
    })
    expect(mock.allow).toHaveBeenCalledWith(true)
  })
  it('nunca ofrece ampliar permisos para rutas protegidas o permiso ya concedido', () => {
    mock.state.sandboxDenials = { '/fixture/tarea': [event('delete'), event('git-hooks')] }
    expect(html()).not.toContain('<button')
    mock.state.sandboxDenials = { '/fixture/tarea': [event('delete', true)] }
    mock.state.deleteGrant = true
    expect(html()).not.toContain('<button')
  })
  it('distingue un lector no disponible de la ausencia de negaciones', () => {
    mock.state.denialMonitorUnavailable = { '/fixture/tarea': true }
    expect(html()).toContain('Las restricciones siguen activas')
    expect(html()).not.toContain('El aislamiento impidió')
  })
  it('traduce el aviso y la acción al inglés', () => {
    setLang('en')
    mock.state.sandboxDenials = { '/fixture/tarea': [event('delete', true)] }
    expect(html()).toContain('Isolation prevented deleting')
    expect(html()).toContain('Allow delete, move and rename')
  })
})

// @vitest-environment jsdom
import '../../../../../test/jsdom-first'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const callMock = vi.hoisted(() => vi.fn())
vi.mock('../../../lib/api', () => ({ call: callMock, api: { on: () => () => undefined } }))

import { HelpersSection } from './HelpersSection'
import { useSettings } from '../../../stores/settings'
import { applyLangPref } from '../../../lib/i18n'

let host: HTMLDivElement
let root: Root
const DIR = '/Users/x/proyecto'

const base = {
  model: 'inherit',
  maxTurns: null,
  background: false,
  skills: null,
  allowedTools: [],
  blockedTools: [],
  whitelist: false,
  native: false
}
const HELPERS = [
  {
    ...base,
    name: 'lector',
    description: '# [x](https://malo.test) <b>negrita</b>',
    model: 'small',
    maxTurns: 3,
    blockedTools: ['edit'],
    origin: 'opencode',
    editable: true
  },
  { ...base, name: 'de-claude', description: 'viene de fuera', origin: 'claude', editable: false },
  {
    ...base,
    name: 'explore',
    description: 'nativo',
    native: true,
    whitelist: true,
    allowedTools: ['grep', 'read'],
    origin: 'native',
    editable: false
  }
]

const btn = (re: RegExp): HTMLButtonElement => [...host.querySelectorAll('button')].find((b) => re.test(b.textContent ?? ''))!
function type(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function mount(): Promise<void> {
  localStorage.setItem('settings.helpers.folder', DIR)
  act(() => useSettings.setState({ settings: { ...DEFAULT_SETTINGS, recentFolders: [DIR] } }))
  await act(async () => root.render(createElement(HelpersSection)))
}

beforeEach(() => {
  callMock.mockReset()
  localStorage.clear()
  applyLangPref('es')
  callMock.mockImplementation(async (channel: string) => {
    if (channel === 'helpers:list') return { available: true, helpers: HELPERS, claudeNames: ['de-claude'] }
    if (channel === 'helpers:save') return { ok: true }
    if (channel === 'helpers:read')
      return {
        ok: true,
        def: {
          name: 'lector',
          description: 'd',
          prompt: 'p',
          model: 'small',
          disallowedTools: ['edit'],
          maxTurns: 3,
          background: false,
          skills: null
        }
      }
    return null
  })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('Ajustes › Ayudantes', () => {
  it('lista los ayudantes con origen, modelo, herramientas y turnos; el texto del archivo es plano', async () => {
    await mount()
    expect(callMock).toHaveBeenCalledWith('helpers:list', { directory: DIR })
    const text = host.textContent ?? ''
    expect(text).toContain('lector')
    expect(text).toContain('Carpeta .opencode/agents')
    expect(text).toContain('Carpeta .claude/agents')
    expect(text).toContain('Incluido en la app')
    expect(text).toContain('Modelo pequeño del mismo servicio de IA')
    expect(text).toContain('Herramientas bloqueadas: edit')
    expect(text).toContain('Máximo de turnos: 3')
    expect(text).toContain('grep, read')
    // Markdown y HTML de la descripción: texto literal, sin enlaces ni etiquetas.
    expect(text).toContain('# [x](https://malo.test) <b>negrita</b>')
    expect(host.querySelector('a, b, img, script')).toBeNull()
  })

  it('muestra siempre el texto llano de que los permisos nunca superan los de la sesión', async () => {
    await mount()
    expect(host.textContent).toContain('Los permisos de un ayudante nunca superan los de la sesión que lo lanza.')
  })

  it('marca como pendiente el ayudante que el motor aún no cargó y no promete una conversación nueva', async () => {
    callMock.mockImplementation(async (channel: string) =>
      channel === 'helpers:list' ? { available: true, helpers: [{ ...HELPERS[0], name: 'recien', pending: true }], claudeNames: [] } : null
    )
    await mount()
    const text = host.textContent ?? ''
    expect(text).toContain('Pendiente: se activa al reiniciar Lazunox')
    expect(text).toContain('Los ayudantes nuevos se activan al reiniciar Lazunox.')
    expect(text).not.toContain('conversación nueva')
  })

  it('solo los de .opencode/agents tienen «Editar»', async () => {
    await mount()
    expect([...host.querySelectorAll('button')].filter((b) => b.textContent === 'Editar')).toHaveLength(1)
  })

  it('crear: rechaza nombres reservados y con rutas sin llamar a main; un nombre válido guarda', async () => {
    await mount()
    act(() => btn(/Nuevo ayudante/).click())
    const name = host.querySelector<HTMLInputElement>('input')!
    for (const bad of ['build', 'Plan', '../x', 'a/b', '.oculto']) {
      type(name, bad)
      await act(async () => btn(/Guardar/).click())
      expect(
        callMock.mock.calls.some((c) => c[0] === 'helpers:save'),
        bad
      ).toBe(false)
      expect(host.querySelector('[role="alert"]')).not.toBeNull()
    }
    type(name, 'nuevo-ayudante')
    await act(async () => btn(/Guardar/).click())
    const save = callMock.mock.calls.find((c) => c[0] === 'helpers:save')!
    expect(save[1]).toMatchObject({ directory: DIR, mode: 'create', def: { name: 'nuevo-ayudante', model: 'inherit', maxTurns: null } })
  })

  it('editar abre el formulario con el archivo leído y el nombre no se cambia', async () => {
    await mount()
    await act(async () => btn(/^Editar$/).click())
    expect(callMock).toHaveBeenCalledWith('helpers:read', { directory: DIR, name: 'lector' })
    expect(host.querySelector<HTMLInputElement>('input')!.disabled).toBe(true)
    await act(async () => btn(/Guardar/).click())
    expect(callMock.mock.calls.find((c) => c[0] === 'helpers:save')![1]).toMatchObject({
      mode: 'edit',
      def: { name: 'lector', maxTurns: 3 }
    })
  })

  it('sin carpeta pide elegir una; el motor sin la ruta lo dice', async () => {
    localStorage.clear()
    act(() => useSettings.setState({ settings: { ...DEFAULT_SETTINGS, recentFolders: [] } }))
    await act(async () => root.render(createElement(HelpersSection)))
    expect(host.textContent).toContain('Elige la carpeta de un proyecto')
    expect(callMock).not.toHaveBeenCalledWith('helpers:list', expect.anything())
  })
})

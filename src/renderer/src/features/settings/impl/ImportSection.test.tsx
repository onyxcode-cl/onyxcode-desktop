// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ImportPreview } from '@shared/ipc-extras'
import { selectListCollapsed } from '../../../stores/ui'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const invoke = vi.hoisted(() => vi.fn())
vi.mock('./extras', () => ({ getExtras: () => ({ invoke }) }))

import { ImportSection } from './ImportSection'

const PREVIEW: ImportPreview = {
  token: 'a'.repeat(32),
  label: 'mi-proyecto',
  items: [
    {
      id: 'i0',
      kind: 'instructions',
      name: 'CLAUDE.md',
      origin: 'CLAUDE.md',
      summary: '# Reglas Responde breve',
      status: 'ok',
      reasons: [],
      envRefs: []
    },
    {
      id: 'm1',
      kind: 'mcp',
      name: 'buscador',
      origin: '.mcp.json',
      summary: 'npx -y pkg',
      status: 'ok',
      reasons: [{ code: 'values-referenced', detail: 'API_KEY' }],
      envRefs: ['API_KEY']
    },
    {
      id: 'm2',
      kind: 'mcp',
      name: 'malo',
      origin: '.mcp.json',
      summary: 'sudo x',
      status: 'discarded',
      reasons: [{ code: 'dangerous-command', detail: 'sudo' }],
      envRefs: []
    }
  ]
}

let host: HTMLDivElement
let root: Root
const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}
const click = async (el: Element | null): Promise<void> => {
  await act(async () => (el as HTMLElement).click())
}

beforeEach(async () => {
  vi.unstubAllGlobals()
  localStorage.setItem('lazunox.langPref', 'es')
  invoke.mockReset()
  invoke.mockImplementation(async (channel: string) => {
    if (channel === 'extras:import:pick') return PREVIEW
    if (channel === 'extras:import:apply') return { results: [{ id: 'm1', ok: true }], mcp: { path: 'x', servers: {} } }
    return null
  })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root.render(createElement(ImportSection)))
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('Ajustes › Importar', () => {
  it('explica las garantías y ofrece elegir carpeta o archivo (nada se lee hasta elegir)', () => {
    expect(host.textContent).toContain('no se copian')
    expect(host.textContent).toContain('desactivados')
    expect(host.querySelector('[data-import-pick="project-folder"]')).not.toBeNull()
    expect(host.querySelector('[data-import-pick="mcp-file"]')).not.toBeNull()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('muestra la vista previa con casillas desmarcadas, lo descartado con su motivo y las variables por nombre', async () => {
    await click(host.querySelector('[data-import-pick="project-folder"]'))
    await flush()
    expect(invoke).toHaveBeenCalledWith('extras:import:pick', { source: 'project-folder' })
    const boxes = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
    expect(boxes).toHaveLength(2)
    expect(boxes.every((b) => !b.checked)).toBe(true)
    const dropped = host.querySelector('[data-testid="import-discarded"]')!
    expect(dropped.textContent).toContain('sudo')
    expect(dropped.querySelector('input')).toBeNull() // lo descartado no tiene casilla
    expect(host.textContent).toContain('API_KEY')
    expect(host.textContent).toContain('Entrará desactivado')
    const apply = host.querySelector<HTMLButtonElement>('[data-import-apply]')!
    expect(apply.disabled).toBe(true)
  })

  it('importa solo lo marcado, con la ficha de la vista previa, y muestra el resultado', async () => {
    await click(host.querySelector('[data-import-pick="project-folder"]'))
    await flush()
    const box = host.querySelector('[data-import-item="m1"] input') as HTMLInputElement
    const key = Object.keys(box).find((k) => k.startsWith('__reactProps'))!
    await act(async () =>
      (box as unknown as Record<string, { onChange: (e: unknown) => void }>)[key].onChange({ target: { checked: true } })
    )
    const apply = host.querySelector<HTMLButtonElement>('[data-import-apply]')!
    expect(apply.disabled).toBe(false)
    await click(apply)
    await flush()
    expect(invoke).toHaveBeenLastCalledWith('extras:import:apply', { token: PREVIEW.token, ids: ['m1'] })
    expect(host.querySelector('[data-testid="import-done"]')).not.toBeNull()
    expect(host.textContent).toContain('Importado y desactivado')
  })

  it('un fallo al leer se muestra como aviso, no rompe la sección', async () => {
    invoke.mockRejectedValueOnce(new Error('no es JSON'))
    await click(host.querySelector('[data-import-pick="mcp-file"]'))
    await flush()
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('no es JSON')
  })
})

describe('Ajustes: lista de conversaciones plegada', () => {
  it('con Ajustes abierto la lista se pliega aunque estuviera abierta, y se restaura al salir (H14)', () => {
    const base = { narrow: false, narrowOpen: false, sidebarCollapsed: false }
    expect(selectListCollapsed({ ...base, settingsOpen: false })).toBe(false)
    expect(selectListCollapsed({ ...base, settingsOpen: true })).toBe(true)
    expect(selectListCollapsed({ ...base, settingsOpen: false, sidebarCollapsed: true })).toBe(true)
    expect(selectListCollapsed({ ...base, settingsOpen: true, narrow: true, narrowOpen: true })).toBe(true)
  })
})

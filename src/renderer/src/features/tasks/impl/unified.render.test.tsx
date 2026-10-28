/** Modo unificado en la pantalla de inicio y los chips: sin selector de dos opciones, carpeta opcional, Manual/Automático siempre. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

// zustand en render de servidor devuelve el estado inicial: la bandera y el store se leen de un estado de prueba.
const o = vi.hoisted(() => ({ unified: false, patch: {} as Record<string, unknown> }))
vi.mock('./unified', async (orig) => {
  const mod = await orig<typeof import('./unified')>()
  return { ...mod, useUnifiedApps: () => o.unified }
})
vi.mock('./store', async (orig) => {
  const mod = await orig<typeof import('./store')>()
  const useTasks = Object.assign((sel: (s: unknown) => unknown) => sel({ ...mod.useTasks.getState(), ...o.patch }), mod.useTasks)
  return { ...mod, useTasks }
})

import { AutoModeChip } from './AutoModeChip'
import { Home } from './Home'
import { UnifiedScopeChip } from './ScopePicker'

afterEach(() => {
  o.unified = false
  o.patch = {}
})
const noop = async (): Promise<void> => undefined
const home = (): string => renderToStaticMarkup(<Home onSend={noop} sendError={null} folderBusy={false} />)

describe('inicio con la bandera', () => {
  it('sin ScopePicker de dos opciones; carpeta opcional, Manual/Automático y enlace «Avanzado»', () => {
    o.unified = true
    const html = home()
    expect(html).not.toContain('radiogroup')
    expect(html).not.toContain('data-testid="scope-folder"')
    expect(html).not.toContain('El computador completo')
    expect(html).toContain('Carpeta: ninguna')
    expect(html).toContain('Manual')
    expect(html).toContain('data-testid="unified-advanced"')
    expect(html).toContain('Avanzado: sin aislamiento')
    expect(html).toContain('no quedan aislados en una carpeta')
  })
  it('sin la bandera: el selector de siempre y nada del modo unificado', () => {
    const html = home()
    expect(html).toContain('radiogroup')
    expect(html).toContain('El computador completo')
    expect(html).not.toContain('unified-advanced')
    expect(html).not.toContain('Carpeta: ninguna')
  })
  it('en Control total no se ofrece de nuevo el enlace «Avanzado»', () => {
    o.unified = true
    o.patch = { fullAccess: true }
    expect(home()).not.toContain('unified-advanced')
  })
})

describe('chips', () => {
  it('Manual/Automático se ve siempre con la bandera, aunque el interruptor maestro esté apagado', () => {
    o.unified = true
    o.patch = { autoMode: { settings: { enabled: false, folders: [], tasks: [], viewApps: [] }, log: [], policyDisabled: false } }
    const html = renderToStaticMarkup(<AutoModeChip />)
    expect(html).toContain('Manual')
    expect(html).toContain('auto-mode-chip')
  })
  it('sin la bandera y con el maestro apagado no se pinta nada (como hoy)', () => {
    o.patch = { autoMode: { settings: { enabled: false, folders: [], tasks: [], viewApps: [] }, log: [], policyDisabled: false } }
    expect(renderToStaticMarkup(<AutoModeChip />)).toBe('')
  })
  it('el chip de la barra superior dice «Carpeta: <nombre>» o «Sin carpeta elegida», sin ofrecer cambiar de modo', () => {
    o.patch = { folder: '/Users/x/Proyecto' }
    let html = renderToStaticMarkup(<UnifiedScopeChip />)
    expect(html).toContain('Carpeta: Proyecto')
    expect(html).not.toContain('<button')
    o.patch = { folder: '/Users/x/Lazunox/Chats/abc' }
    html = renderToStaticMarkup(<UnifiedScopeChip />)
    expect(html).toContain('Sin carpeta elegida')
  })
  it('en Control total muestra «Sin aislamiento (avanzado)» con un clic para volver', () => {
    o.patch = { fullAccess: true, folder: '/Users/x' }
    const html = renderToStaticMarkup(<UnifiedScopeChip />)
    expect(html).toContain('Sin aislamiento (avanzado)')
    expect(html).toContain('<button')
  })
})

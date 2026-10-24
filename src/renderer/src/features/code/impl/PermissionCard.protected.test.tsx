/**
 * Ruta protegida del motor (`metadata.lazunoxProtegido`): la tarjeta de Code avisa con una línea clara y NO ofrece «Permitir siempre»
 * (el motor ya manda `always: []`; la UI tampoco se rompe con eso). Escritorio y celular.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PermissionCardDesk } from './PermissionCardDesk'
import { PermissionCard } from './PermissionCard'
import type { PendingPermission } from './types'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

const g = globalThis as unknown as { window?: { api?: { platform?: string } } }
afterEach(() => {
  delete g.window
})

const AVISO = 'Ruta protegida: cambia cómo se ejecuta código o la configuración de la IA'

const perm = (over: Partial<PendingPermission> = {}): PendingPermission => ({
  id: 'p1',
  sessionID: 'ses_1',
  permission: 'edit',
  patterns: ['.claude/settings.json'],
  metadata: { filepath: '/proj/.claude/settings.json', lazunoxProtegido: true },
  always: [],
  api: 'v1',
  ...over
})

describe('tarjeta de permiso de Code con ruta protegida', () => {
  it('escritorio: muestra el aviso, no ofrece «Permitir siempre» y sí «Permitir una vez» y «Rechazar»', () => {
    g.window = { api: { platform: 'darwin' } }
    const html = renderToStaticMarkup(<PermissionCardDesk request={perm()} root="/proj" hotkeys />)
    expect(html).toContain(AVISO)
    expect(html).not.toContain('Permitir siempre')
    expect(html).toContain('Permitir una vez')
    expect(html).toContain('Rechazar')
  })

  it('escritorio: una petición normal conserva «Permitir siempre» y no lleva el aviso', () => {
    g.window = { api: { platform: 'darwin' } }
    const html = renderToStaticMarkup(
      <PermissionCardDesk request={perm({ metadata: { filepath: '/proj/a.ts' }, always: ['a.ts'] })} root="/proj" hotkeys />
    )
    expect(html).not.toContain(AVISO)
    expect(html).toContain('Permitir siempre')
  })

  it('una marca que no es el booleano true no cuenta', () => {
    g.window = { api: { platform: 'darwin' } }
    const html = renderToStaticMarkup(
      <PermissionCardDesk request={perm({ metadata: { lazunoxProtegido: 'true' }, always: ['x'] })} root="/proj" hotkeys />
    )
    expect(html).not.toContain(AVISO)
    expect(html).toContain('Permitir siempre')
  })

  it('con `always: []` y sin marca tampoco se rompe', () => {
    g.window = { api: { platform: 'darwin' } }
    const html = renderToStaticMarkup(<PermissionCardDesk request={perm({ metadata: {}, always: [] })} root="/proj" />)
    expect(html).toContain('Permitir una vez')
  })

  it('celular: también avisa y no ofrece «siempre»', () => {
    g.window = { api: { platform: 'ios' } }
    const html = renderToStaticMarkup(<PermissionCard request={perm()} root="/proj" />)
    expect(html).not.toContain('Permitir siempre')
  })
})

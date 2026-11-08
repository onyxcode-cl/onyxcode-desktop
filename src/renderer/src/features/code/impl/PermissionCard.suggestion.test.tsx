/**
 * Sugerencia del motor (`metadata.lazunoxSugerencia`) en la tarjeta de permiso de Code: línea informativa, texto plano,
 * sin cambiar botones; en ruta protegida no se muestra.
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

const perm = (metadata: Record<string, unknown>): PendingPermission => ({
  id: 'p1',
  sessionID: 'ses_1',
  permission: 'bash',
  patterns: ['ls'],
  metadata: { command: 'ls', ...metadata },
  always: ['ls'],
  api: 'v1'
})
const SUG = { sugerencia: 'permitir', motivo: 'Solo lista archivos.' }
const buttons = (html: string): string[] =>
  [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((x) => x[1].replace(/<[^>]*>/g, ''))

describe('sugerencia de permisos en la tarjeta', () => {
  it('escritorio: sugerencia válida → línea visible', () => {
    g.window = { api: { platform: 'darwin' } }
    const html = renderToStaticMarkup(<PermissionCardDesk request={perm({ lazunoxSugerencia: SUG })} root="/proj" hotkeys />)
    expect(html).toContain('Sugerencia de la IA: permitir. Motivo: Solo lista archivos.')
    expect(html).toContain('no decide nada')
  })
  it('celular: sugerencia válida → línea visible', () => {
    g.window = { api: { platform: 'ios' } }
    const html = renderToStaticMarkup(<PermissionCard request={perm({ lazunoxSugerencia: SUG })} root="/proj" />)
    expect(html).toContain('Sugerencia de la IA: permitir. Motivo: Solo lista archivos.')
  })
  it('la sugerencia no cambia los botones (mismo orden y mismo marcado, sin autofocus)', () => {
    g.window = { api: { platform: 'darwin' } }
    const con = renderToStaticMarkup(<PermissionCardDesk request={perm({ lazunoxSugerencia: SUG })} root="/proj" hotkeys />)
    const sin = renderToStaticMarkup(<PermissionCardDesk request={perm({})} root="/proj" hotkeys />)
    expect(buttons(con)).toEqual(buttons(sin))
    expect(con).not.toMatch(/autofocus/i)
  })
  it('motivo con enlace, etiqueta y Markdown → texto plano, sin <a>', () => {
    g.window = { api: { platform: 'darwin' } }
    const html = renderToStaticMarkup(
      <PermissionCardDesk
        request={perm({
          lazunoxSugerencia: { sugerencia: 'negar', motivo: '<a href="http://x.test">pulsa</a> **ya** [aquí](http://y.test)' }
        })}
        root="/proj"
      />
    )
    expect(html).toContain('Sugerencia de la IA: negar.')
    expect(html).not.toContain('<a')
    expect(html).not.toContain('x.test')
    expect(html).not.toContain('y.test')
    expect(html).not.toContain('**')
  })
  it('basura (valor inválido, sin motivo) → no se pinta', () => {
    g.window = { api: { platform: 'darwin' } }
    for (const s of [{ sugerencia: 'allow', motivo: 'x' }, { sugerencia: 'permitir' }, 'permitir', 42]) {
      const html = renderToStaticMarkup(<PermissionCardDesk request={perm({ lazunoxSugerencia: s })} root="/proj" />)
      expect(html).not.toContain('Sugerencia de la IA')
    }
  })
  it('sin sugerencia → el marcado es el de siempre', () => {
    g.window = { api: { platform: 'darwin' } }
    const html = renderToStaticMarkup(<PermissionCardDesk request={perm({})} root="/proj" />)
    expect(html).not.toContain('Sugerencia de la IA')
  })
  it('ruta protegida → no se muestra y queda igual que sin sugerencia', () => {
    g.window = { api: { platform: 'darwin' } }
    const meta = { lazunoxProtegido: true, filepath: '/proj/.claude/settings.json' }
    const con = renderToStaticMarkup(<PermissionCardDesk request={perm({ ...meta, lazunoxSugerencia: SUG })} root="/proj" />)
    const sin = renderToStaticMarkup(<PermissionCardDesk request={perm(meta)} root="/proj" />)
    expect(con).not.toContain('Sugerencia de la IA')
    expect(con).toBe(sin)
    g.window = { api: { platform: 'ios' } }
    const mob = renderToStaticMarkup(<PermissionCard request={perm({ ...meta, lazunoxSugerencia: SUG })} root="/proj" />)
    expect(mob).not.toContain('Sugerencia de la IA')
  })
})

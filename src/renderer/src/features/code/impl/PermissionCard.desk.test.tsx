/**
 * Tarjeta de permiso de Code en ESCRITORIO (render estático, `darwin`): anatomía, orden y retirada
 * del 1/2/3. El celular se cubre en `PermissionCard.mobile-pin.test.tsx` y `MobileCode.render.test.tsx`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PermissionCardDesk } from './PermissionCardDesk'
import type { PendingPermission } from './types'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

const g = globalThis as unknown as { window?: { api?: { platform?: string } } }
function surface(platform: string | null): void {
  if (platform === null) delete g.window
  else g.window = { api: { platform } }
}
afterEach(() => surface(null))

const perm = (over: Partial<PendingPermission> = {}): PendingPermission => ({
  id: 'p1',
  sessionID: 'ses_1',
  permission: 'bash',
  patterns: ['npm run build'],
  metadata: { command: 'npm run build' },
  always: ['npm run build'],
  api: 'v1',
  ...over
})

const render = (r: PendingPermission, root: string | null = '/proj'): string =>
  renderToStaticMarkup(<PermissionCardDesk request={r} root={root} hotkeys />)

describe('tarjeta de permiso de escritorio (Code)', () => {
  it('es un alertdialog con nombre y descripción; sin el atajo 1/2/3', () => {
    surface('darwin')
    const html = render(perm())
    expect(html).toContain('role="alertdialog"')
    expect(html).toContain('aria-labelledby="perm-title-p1"')
    expect(html).toContain('id="perm-title-p1"')
    expect(html).not.toContain('<kbd>1</kbd>')
    expect(html).not.toContain('<kbd>2</kbd>')
    expect(html).not.toContain('<kbd>3</kbd>')
  })

  it('orden: Permitir siempre a la izquierda; par Rechazar → Permitir una vez a la derecha', () => {
    surface('darwin')
    const html = render(perm())
    const i = (s: string): number => html.indexOf(s)
    expect(i('Permitir siempre')).toBeLessThan(i('Rechazar'))
    expect(i('Rechazar')).toBeLessThan(i('Permitir una vez'))
  })

  it('«Permitir una vez» con ⌘↵ (aria-hidden) y Meta+Enter; deshabilitado en el primer render', () => {
    surface('darwin')
    const html = render(perm())
    expect(html).toContain('aria-keyshortcuts="Meta+Enter"')
    expect(html).toContain('aria-hidden')
    expect(html).toContain('⌘↵')
    expect(html).toContain('Esc')
    expect(html).toContain('>Permitir una vez<')
    expect(html).toMatch(/disabled=""[^>]*>Permitir una vez</)
  })

  it('alcance «Sin sandbox · {root}» y comando bash con $', () => {
    surface('darwin')
    const html = render(perm())
    expect(html).toContain('Sin sandbox · /proj')
    expect(html).toContain('npm run build')
    expect(html).toContain('aria-hidden')
  })

  it('comando de 300 líneas se recorta con max-h-96 y aviso del total', () => {
    surface('darwin')
    const command = Array.from({ length: 300 }, (_, i) => `echo línea ${i}`).join('\n')
    const html = render(perm({ metadata: { command } }))
    expect(html).toContain('max-h-96')
    expect(html).toContain('El comando sigue: 300 líneas en total')
  })

  it('la descripción del modelo va aparte y marcada como no verificada (nunca como consecuencia)', () => {
    const html = render(perm({ metadata: { command: 'ls', description: 'Solo lista archivos' } }))
    expect(html).toContain('Descripción del agente (no verificada)')
    expect(html).toContain('Solo lista archivos')
    expect(html).not.toContain('aria-describedby')
  })
})

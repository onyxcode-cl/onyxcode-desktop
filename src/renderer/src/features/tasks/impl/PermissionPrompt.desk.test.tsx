/**
 * Tarjeta de permiso de Tareas en ESCRITORIO (render estático, `darwin`): anatomía, orden, teclado
 * seguro y armado. El celular se cubre en `PermissionPrompt.mobile-pin.test.tsx` (sin cambios).
 */
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PermissionRequest } from '@opencode-ai/sdk/v2/client'

const mock = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))
vi.mock('./store', () => {
  const noop = () => undefined
  return {
    useTasks: Object.assign((sel?: (s: unknown) => unknown) => (sel ? sel(mock.state) : mock.state), {
      getState: () => mock.state,
      setState: () => undefined,
      subscribe: () => () => undefined
    }),
    rootTaskId: (id: string) => id,
    currentTasksModel: () => null,
    currentTasksVariant: () => null,
    dismissNetworkBlocked: noop,
    resolveNetworkBlocked: noop,
    clearFolder: noop,
    clearUnseen: noop,
    connectFolder: noop,
    disconnect: noop,
    forgetTaskMeta: noop,
    fullAccessFor: () => false,
    loadFullAccessInfo: noop,
    loadGrants: noop,
    loadProjectAndMemory: noop,
    loadTask: noop,
    refreshComputerStatus: noop,
    rememberFolder: noop,
    rememberFullAccess: noop,
    setTaskMeta: noop
  }
})
vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

import { PermissionCardDesk } from './PermissionCardDesk'

const DIFF =
  'Index: /w/a.txt\n===================================================================\n--- /w/a.txt\n+++ /w/a.txt\n@@ -1,2 +1,2 @@\n uno\n-dos\n+DOS\n'

const req = (over: Partial<PermissionRequest> = {}): PermissionRequest =>
  ({
    id: 'p1',
    sessionID: 's',
    permission: 'bash',
    patterns: ['npm run build'],
    metadata: { command: 'npm run build' },
    always: ['npm run build'],
    ...over
  }) as PermissionRequest

const render = (r: PermissionRequest, state: Record<string, unknown>): string => {
  mock.state = state
  return renderToStaticMarkup(<PermissionCardDesk request={r} />)
}

const base = { folder: '/Users/ana/proyectos', conn: null, policy: {}, fullAccessInfo: null }

describe('tarjeta de permiso de escritorio (Tareas)', () => {
  it('es un alertdialog con nombre y descripción y data-armed=false en el primer render', () => {
    const html = render(req(), base)
    expect(html).toContain('role="alertdialog"')
    expect(html).toContain('aria-modal="false"')
    expect(html).toContain('id="perm-title-p1"')
    expect(html).toContain('id="perm-effect-p1"')
    expect(html).toContain('aria-labelledby="perm-title-p1"')
    expect(html).toContain('aria-describedby="perm-effect-p1"')
    expect(html).not.toContain('data-armed="true"')
    expect(html).not.toContain('autofocus')
  })

  it('orden DOM: título < consecuencia < comando < alcance < acciones', () => {
    const html = render(req(), base)
    const i = (s: string): number => html.indexOf(s)
    expect(i('perm-title-p1')).toBeLessThan(i('perm-effect-p1'))
    expect(i('perm-effect-p1')).toBeLessThan(i('<pre'))
    expect(i('<pre')).toBeLessThan(i('Sandbox activo'))
    expect(i('Sandbox activo')).toBeLessThan(i('Permitir una vez'))
  })

  it('comando bash con $ aria-hidden, sin max-h para 5000 caracteres', () => {
    const command = 'echo ' + 'x'.repeat(5000)
    const html = render(req({ metadata: { command } }), base)
    expect(html).toContain('aria-hidden')
    expect(html).toContain(command)
    expect(html).not.toContain('max-h-96')
  })

  it('comando de 300 líneas se recorta con max-h-96 y aviso del total', () => {
    const command = Array.from({ length: 300 }, (_, i) => `echo línea ${i}`).join('\n')
    const html = render(req({ metadata: { command } }), base)
    expect(html).toContain('max-h-96')
    expect(html).toContain('El comando sigue: 300 líneas en total')
  })

  it('aviso de caracteres ocultos', () => {
    const html = render(req({ metadata: { command: 'ls\u200B -la' } }), base)
    expect(html).toContain('Contiene caracteres de control')
  })

  it('neutral: orden de botones Rechazar con indicaciones → Permitir siempre → Rechazar → Permitir una vez', () => {
    const html = render(req(), base)
    const i = (s: string): number => html.indexOf(s)
    expect(i('Rechazar con indicaciones')).toBeLessThan(i('Permitir siempre'))
    expect(i('Permitir siempre')).toBeLessThan(i('>Rechazar<'))
    expect(i('>Rechazar<')).toBeLessThan(i('Permitir una vez'))
  })

  it('destructivo: sin «Permitir siempre», mismo par Rechazar → Permitir una vez', () => {
    const r = req({ permission: 'bash', patterns: ['rm -rf x'], metadata: { command: 'rm -rf x' }, always: [] })
    const html = render(r, base)
    expect(html).not.toContain('Permitir siempre')
    const i = (s: string): number => html.indexOf(s)
    expect(i('>Rechazar<')).toBeLessThan(i('Permitir una vez'))
  })

  it('«Permitir» deshabilitado en el primer render y con atajo aria (⌘↵ y Esc) como kbd aria-hidden', () => {
    const html = render(req(), base)
    expect(html).toContain('aria-keyshortcuts="Meta+Enter"')
    expect(html).toContain('aria-hidden')
    expect(html).toContain('⌘↵')
    expect(html).toContain('Esc')
    // El texto accesible del botón es exactamente la etiqueta (el kbd no cuenta).
    expect(html).toContain('>Permitir una vez<')
    // El botón «Permitir una vez» está disabled (armed=false en el primer render).
    expect(html).toMatch(/disabled=""[^>]*>Permitir una vez</)
  })

  it('disableAlwaysAllow oculta «Permitir siempre»', () => {
    const html = render(req(), { ...base, policy: { disableAlwaysAllow: true } })
    expect(html).not.toContain('Permitir siempre')
  })

  it('sandbox activo frente a control total (texto, no solo color)', () => {
    expect(render(req(), base)).toContain('Sandbox activo')
    expect(render(req(), { ...base, conn: { fullAccess: true } })).toContain('Control total: sin sandbox')
  })

  it('edit muestra el diff con DiffView (tabla) y la ruta, sin prefijo $', () => {
    const r = req({ permission: 'edit', patterns: ['a.txt'], metadata: { filepath: '/w/a.txt', diff: DIFF }, always: [] })
    const html = render(r, base)
    expect(html).toContain('<table')
    expect(html).toContain('DOS')
    expect(html).toContain('/w/a.txt')
  })
})

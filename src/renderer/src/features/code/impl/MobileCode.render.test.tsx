/**
 * Code en el celular (superficie `remote`) frente a escritorio: lo que cambia solo cambia en `remote`.
 * Render estático con `window.api.platform` simulada (el módulo `lib/platform` la lee en cada llamada).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PermissionCard } from './PermissionCard'
import { ConfirmButton } from './ui'
import { DiffView } from '../../../components/DiffView'
import { MessageStream } from './MessageStream'
import { allEntries } from '../../../../../test/fixtures/entries'
import type { PendingPermission } from './types'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

const g = globalThis as unknown as { window?: { api?: { platform?: string } } }
function surface(platform: string | null): void {
  if (platform === null) delete g.window
  else g.window = { api: { platform } }
}
afterEach(() => surface(null))

const perm = (permission: string): PendingPermission => ({
  id: 'per_1',
  sessionID: 'ses_1',
  permission,
  patterns: ['/Users/ana/otra/*'],
  metadata: {},
  always: ['/Users/ana/otra/*'],
  api: 'v1'
})
const card = (permission: string): string => renderToStaticMarkup(<PermissionCard request={perm(permission)} root="/proj" hotkeys />)

describe('tarjeta de permisos', () => {
  it('escritorio: una vez, siempre y rechazar, con atajos', () => {
    surface('darwin')
    const html = card('edit')
    expect(html).toContain('Permitir una vez')
    expect(html).toContain('Permitir siempre')
    expect(html).toContain('Rechazar')
    expect(html).toContain('<kbd')
    expect(html).not.toContain('Apruébalo en el Mac')
  })
  it('celular: «una vez» y «rechazar», nunca «siempre», sin atajos y botones de 44 px', () => {
    surface('remote')
    const html = card('edit')
    expect(html).toContain('Permitir una vez')
    expect(html).toContain('Rechazar')
    expect(html).not.toContain('Permitir siempre')
    expect(html).not.toContain('<kbd')
    expect(html).toContain('min-h-11')
  })
  it('celular: fuera del proyecto se aprueba en el Mac (solo se ofrece rechazar)', () => {
    surface('remote')
    const html = card('external_directory')
    expect(html).toContain('Apruébalo en el Mac')
    expect(html).not.toContain('Permitir una vez')
    expect(html).not.toContain('Permitir siempre')
    expect(html).toContain('Rechazar')
  })
  it('escritorio: fuera del proyecto sigue igual (tres botones)', () => {
    surface('darwin')
    const html = card('external_directory')
    expect(html).toContain('Permitir una vez')
    expect(html).toContain('Permitir siempre')
    expect(html).not.toContain('Apruébalo en el Mac')
  })
})

describe('confirmación con botón', () => {
  const el = (
    <ConfirmButton title="¿Seguro?" body="Texto" confirmLabel="Sí" onConfirm={() => undefined}>
      x
    </ConfirmButton>
  )
  it('escritorio y celular cerrados se ven igual por fuera (el popover/hoja solo existe al abrir)', () => {
    surface('darwin')
    const a = renderToStaticMarkup(el)
    surface('remote')
    const b = renderToStaticMarkup(el)
    expect(a).toBe(b)
  })
})

describe('diff y conversación', () => {
  const PATCH = ['--- a/x.ts', '+++ b/x.ts', '@@ -1,2 +1,2 @@', '-uno', '+dos', ' tres'].join('\n')
  it('celular: «Descartar este bloque» de 44 px, una sola columna de números y los encabezados largos no ensanchan la tabla', () => {
    surface('remote')
    const html = renderToStaticMarkup(<DiffView patch={PATCH} onDiscardHunk={() => undefined} />)
    expect(html).toContain('min-h-11')
    expect(html).toContain('class="hidden"')
    expect(html).toContain('max-w-0')
  })
  it('celular: la columna del mensaje es más angosta; escritorio conserva sus márgenes', () => {
    const props = { busy: false, error: null, root: '/proj', permissions: [], questions: [], onUnrevert: () => undefined, loading: false }
    surface('darwin')
    expect(renderToStaticMarkup(<MessageStream {...props} entries={allEntries} />)).toContain('gap-6 px-6 py-6')
    surface('remote')
    const html = renderToStaticMarkup(<MessageStream {...props} entries={allEntries} />)
    expect(html).toContain('gap-5 px-3 py-4')
    expect(html).not.toContain('gap-6 px-6 py-6')
  })
})

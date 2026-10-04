/** MessageStream en el celular: indicador único de «pensando», barra de aprobación pendiente y acciones solo en el último turno. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MessageStream } from './MessageStream'
import { PendingBar } from '../../../components/mobile/PendingBar'
import { allEntries, userWithFile } from '../../../../../test/fixtures/entries'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

const g = globalThis as unknown as { window?: { api?: { platform?: string } } }
function surface(platform: string | null): void {
  if (platform === null) delete g.window
  else g.window = { api: { platform } }
}
afterEach(() => surface(null))

const props = { busy: true, error: null, root: '/proj', permissions: [], questions: [], onUnrevert: () => undefined, loading: false }

describe('MessageStream en el celular', () => {
  it('ocupado y sin salida: chispa con shimmer y sin los tres puntos que rebotan', () => {
    surface('remote')
    const html = renderToStaticMarkup(<MessageStream {...props} entries={[userWithFile]} />)
    expect(html).toContain('text-shimmer')
    expect(html).not.toContain('animate-bounce')
  })
  it('escritorio ocupado: los tres puntos de siempre', () => {
    surface('darwin')
    const html = renderToStaticMarkup(<MessageStream {...props} entries={[userWithFile]} />)
    expect(html).toContain('animate-bounce')
    expect(html).not.toContain('text-shimmer')
  })
  it('sin botones de fila por mensaje (Revertir va en la hoja de mantener pulsado)', () => {
    surface('remote')
    const html = renderToStaticMarkup(<MessageStream {...props} busy={false} entries={allEntries} />)
    expect(html).not.toContain('group-hover/user:opacity-100')
    expect(html).not.toContain('Revertir')
    surface('darwin')
    expect(renderToStaticMarkup(<MessageStream {...props} busy={false} entries={allEntries} />)).toContain('Revertir')
  })
})

describe('PendingBar', () => {
  it('sin pendientes no se pinta; con pendientes espera a saber si la tarjeta se ve', () => {
    const scrollRef = { current: null }
    expect(renderToStaticMarkup(<PendingBar scrollRef={scrollRef} count={0} />)).toBe('')
    expect(renderToStaticMarkup(<PendingBar scrollRef={scrollRef} count={2} />)).toBe('')
  })
})

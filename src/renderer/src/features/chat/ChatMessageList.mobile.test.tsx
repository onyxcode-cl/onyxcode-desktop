/** Chat en el celular (superficie `remote`) frente a escritorio: ganchos `data-m`, acciones solo en la última respuesta, herramientas sin JSON. */
import { afterEach, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChatMessageList } from './ChatMessageList'
import { ChatToolCall } from './ChatToolCall'
import { allEntries } from '../../../../test/fixtures/entries'
import { toolPart } from '../../../../test/fixtures/events'

const g = globalThis as unknown as { window?: { api?: { platform?: string } } }
function surface(platform: string | null): void {
  if (platform === null) delete g.window
  else g.window = { api: { platform } }
}
afterEach(() => surface(null))

describe('ChatMessageList en el celular', () => {
  it('columna de 16 px, burbuja y metadatos con gancho, sin botones por mensaje ni etiquetas de escritorio', () => {
    surface('remote')
    const html = renderToStaticMarkup(<ChatMessageList entries={allEntries} busy={false} onEdit={() => Promise.resolve()} />)
    expect(html).toContain('gap-6 px-4 pt-3 pb-4')
    expect(html).toContain('data-m="user-bubble"')
    expect(html).toContain('data-m="meta"')
    expect(html).toContain('data-long-press')
    expect(html).not.toContain('group-hover:opacity-100')
    expect(html).not.toContain('Editar y reintentar') // la edición vive en la hoja de mantener pulsado
  })
  it('escritorio: sin ganchos móviles', () => {
    surface('darwin')
    const html = renderToStaticMarkup(<ChatMessageList entries={allEntries} busy={false} />)
    expect(html).not.toContain('data-m=')
    expect(html).not.toContain('data-long-press')
    expect(html).toContain('px-6 pt-8 pb-10')
  })
})

describe('ChatToolCall', () => {
  const part = toolPart('prt_x', 'msg_x', 'ses_x', 'read', {
    status: 'completed',
    input: { filePath: '/proj/a.ts' },
    output: 'hola',
    title: 'a.ts',
    metadata: {},
    time: { start: 1, end: 2 }
  } as never)
  it('celular: fila humanizada de Code (verbo, sin JSON crudo)', () => {
    surface('remote')
    const html = renderToStaticMarkup(<ChatToolCall part={part as never} />)
    expect(html).toContain('Leyó')
    expect(html).toContain('min-h-11')
    expect(html).not.toContain('{&quot;')
  })
  it('escritorio: la tarjeta de siempre con el nombre de la herramienta', () => {
    surface('darwin')
    const html = renderToStaticMarkup(<ChatToolCall part={part as never} />)
    expect(html).toContain('font-mono')
    expect(html).not.toContain('Leyó')
  })
})

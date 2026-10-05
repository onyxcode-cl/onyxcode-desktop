/** Chat de escritorio: las herramientas consecutivas se agrupan como en Code; el celular las deja sueltas. */
import { afterEach, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Part } from '@opencode-ai/sdk/v2/client'
import { ChatMessageList } from './ChatMessageList'
import { assistantFull, userWithFile } from '../../../../test/fixtures/entries'
import { toolPart } from '../../../../test/fixtures/events'

const g = globalThis as unknown as { window?: { api?: { platform?: string } } }
function surface(platform: string | null): void {
  if (platform === null) delete g.window
  else g.window = { api: { platform } }
}
afterEach(() => surface(null))

const tool = (id: string): Part =>
  toolPart(id, 'msg_x', 'ses_x', 'read', { status: 'completed', input: { filePath: `/proj/${id}.ts` }, output: 'x' }) as unknown as Part
const entries = [userWithFile, { info: assistantFull.info, parts: [tool('a'), tool('b'), tool('c')] }] as unknown as Parameters<
  typeof ChatMessageList
>[0]['entries']

describe('ChatMessageList: agrupar herramientas', () => {
  it('escritorio: tres llamadas seguidas forman un grupo plegado con su resumen', () => {
    surface('darwin')
    const html = renderToStaticMarkup(<ChatMessageList entries={entries} busy={false} />)
    expect(html).toContain('3 pasos')
  })
  it('celular: siguen sueltas, sin grupo', () => {
    surface('remote')
    const html = renderToStaticMarkup(<ChatMessageList entries={entries} busy={false} />)
    expect(html).not.toContain('3 pasos')
  })
})

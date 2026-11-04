import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ToolPart } from '@opencode-ai/sdk/v2/client'
import { ToolRow } from './ToolCard'
import { MessageStream } from './MessageStream'
import { assistantMessage, textPart, toolPart, userMessage } from '../../../../../test/fixtures/events'
import { friendlyTool } from '../../tasks/impl/util'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

const g = globalThis as unknown as { window?: { api?: { platform?: string } } }
afterEach(() => {
  delete g.window
})
const bash = (metadata: Record<string, unknown>): ToolPart =>
  toolPart('p1', 'm1', 's1', 'bash', {
    status: 'completed',
    input: { command: 'npm run dev', description: 'Servidor de pruebas' },
    output: 'listo',
    title: 'npm run dev',
    metadata,
    time: { start: 0, end: 1 }
  }) as ToolPart

describe('P6: comando que sigue en segundo plano', () => {
  it('Code: el paso muestra «Sigue en segundo plano»', () => {
    g.window = { api: { platform: 'darwin' } }
    const html = renderToStaticMarkup(<ToolRow part={bash({ running: true, shellId: 'sh_1' })} root={null} />)
    expect(html).toContain('Sigue en segundo plano')
  })
  it('Code: un comando terminado no lo muestra', () => {
    g.window = { api: { platform: 'darwin' } }
    const html = renderToStaticMarkup(<ToolRow part={bash({ running: false, shellId: 'sh_1', exit: 0 })} root={null} />)
    expect(html).not.toContain('segundo plano')
  })
  it('Tareas: el texto del paso lo dice', () => {
    expect(friendlyTool(bash({ running: true, shellId: 'sh_1' })).detail).toBe('Servidor de pruebas · sigue en segundo plano')
    expect(friendlyTool(bash({ running: false })).detail).toBe('Servidor de pruebas')
  })
})

describe('P6: avisos del motor en la conversación (motor nuevo)', () => {
  it('Code: la anotación de reintento (sintética e ignorada) se pinta en llano', () => {
    g.window = { api: { platform: 'darwin' } }
    const note = textPart('n1', 'm2', 's1', '', {
      synthetic: true,
      ignored: true,
      metadata: { lazunox_reintento: JSON.stringify({ attempt: 1, max: 4, cause: 'red', waitMs: 3000 }) }
    })
    const entries = [
      { info: userMessage('m1', 's1'), parts: [textPart('u1', 'm1', 's1', 'hola')] },
      { info: assistantMessage('m2', 's1'), parts: [note, textPart('t1', 'm2', 's1', 'Hecho')] }
    ]
    const html = renderToStaticMarkup(
      <MessageStream busy={false} error={null} root="/p" permissions={[]} questions={[]} onUnrevert={() => undefined} loading={false} entries={entries as never} />
    )
    expect(html).toContain('Reintento 1 de 4: falló la conexión. Esperando 3 s.')
    expect(html).toContain('Hecho')
  })
})

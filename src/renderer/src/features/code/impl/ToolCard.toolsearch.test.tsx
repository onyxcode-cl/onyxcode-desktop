import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ToolPart } from '@opencode-ai/sdk/v2/client'
import { ToolRow, realMcpCall } from './ToolCard'
import { stepLine } from '@shared/conversation-work'
import { toolPart } from '../../../../../test/fixtures/events'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

const g = globalThis as unknown as { window?: { api?: { platform?: string } } }
afterEach(() => {
  delete g.window
})

const part = (tool: string, state: Record<string, unknown>): ToolPart => toolPart('p1', 'm1', 's1', tool, state) as ToolPart

describe('búsqueda diferida de herramientas de conectores', () => {
  it('tool_search: fila legible con la consulta, no el nombre técnico', () => {
    g.window = { api: { platform: 'darwin' } }
    const html = renderToStaticMarkup(
      <ToolRow
        part={part('tool_search', {
          status: 'completed',
          input: { query: 'crear ticket' },
          output: 'muchas_create_ticket',
          time: { start: 0, end: 1 }
        })}
        root={null}
      />
    )
    expect(html).toContain('Buscó herramientas del conector')
    expect(html).toContain('crear ticket')
    expect(html).not.toContain('>tool_search<')
  })

  it('tool_search en curso dice «Buscando…»', () => {
    g.window = { api: { platform: 'darwin' } }
    const html = renderToStaticMarkup(
      <ToolRow part={part('tool_search', { status: 'running', input: { query: 'x' }, time: { start: 0 } })} root={null} />
    )
    expect(html).toContain('Buscando herramientas del conector')
  })

  it('mcp_call: muestra el nombre real y el conector desde metadata.lazunoxMcp, nunca «mcp_call»', () => {
    g.window = { api: { platform: 'darwin' } }
    const html = renderToStaticMarkup(
      <ToolRow
        part={part('mcp_call', {
          status: 'completed',
          input: { tool: 'otra_cosa', arguments: { title: 'hola' } },
          metadata: { lazunoxMcp: { tool: 'muchas_create_ticket', server: 'muchas' } },
          output: 'ok',
          title: 'muchas_create_ticket',
          time: { start: 0, end: 1 }
        })}
        root={null}
      />
    )
    expect(html).toContain('muchas_create_ticket')
    expect(html).toContain('conector muchas')
    expect(html).toContain('aria-expanded="false"') // los datos enviados van plegados
    expect(html).not.toContain('mcp_call')
    expect(html).not.toContain('otra_cosa')
  })

  it('mcp_call sin metadatos (motor anterior o llamada rota): usa lo que dijo el modelo y no revienta con metadatos raros', () => {
    expect(realMcpCall(undefined, { tool: 'gmail_send' })).toEqual({ tool: 'gmail_send', server: '' })
    expect(realMcpCall({ lazunoxMcp: 5 }, {})).toEqual({ tool: '', server: '' })
    expect(realMcpCall({ lazunoxMcp: { tool: 'a\nb  c', server: 7 } }, {})).toEqual({ tool: 'a b c', server: '' })
    g.window = { api: { platform: 'darwin' } }
    const html = renderToStaticMarkup(
      <ToolRow part={part('mcp_call', { status: 'running', input: { tool: 'gmail_send' }, time: { start: 0 } })} root={null} />
    )
    expect(html).toContain('gmail_send')
  })

  it('stepLine (resumen de pasos del Chat/Code) usa el nombre real y la consulta', () => {
    expect(stepLine({ tool: 'mcp_call', state: { status: 'completed', title: 'muchas_create_ticket', input: { tool: 'x' } } })).toBe(
      'muchas_create_ticket'
    )
    expect(stepLine({ tool: 'tool_search', state: { status: 'completed', input: { query: 'ticket' } } })).toBe(
      'Buscó herramientas del conector: ticket'
    )
    expect(stepLine({ tool: 'tool_search', state: { status: 'running', input: {} } })).toBe('Buscando herramientas del conector')
  })
})

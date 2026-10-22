import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ToolPart } from '@opencode-ai/sdk/v2/client'
import { ToolRow, innerCalls, summarizeCallInput } from './ToolCard'
import { toolPart } from '../../../../../test/fixtures/events'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

const g = globalThis as unknown as { window?: { api?: { platform?: string } } }
afterEach(() => {
  delete g.window
})

const exec = (status: string, toolCalls: unknown): ToolPart =>
  toolPart('p1', 'm1', 's1', 'execute', {
    status,
    input: { code: 'await tools.x()' },
    metadata: { toolCalls },
    ...(status === 'completed' ? { output: 'ok', title: 'execute', time: { start: 0, end: 1 } } : { time: { start: 0 } })
  }) as ToolPart

describe('tarjeta del modo código (execute)', () => {
  it('en curso: abierta, con cada llamada interna (herramienta, estado y entrada) y el aviso de permiso', () => {
    g.window = { api: { platform: 'darwin' } }
    const html = renderToStaticMarkup(
      <ToolRow
        part={exec('running', [
          { tool: 'fs_read', status: 'completed', input: { path: '/a/b.txt' } },
          { tool: 'web_get', status: 'running', input: { url: 'https://x.test', headers: {} } },
          { tool: 'db_query', status: 'error' }
        ])}
        root={null}
      />
    )
    expect(html).toContain('Modo código')
    expect(html).toContain('3 llamadas')
    expect(html).toContain('Cada llamada pide tu permiso antes de ejecutarse.')
    expect(html).toContain('aria-label="Llamadas que hizo el código"')
    expect(html).toContain('fs_read')
    expect(html).toContain('/a/b.txt')
    expect(html).toContain('https://x.test')
    expect(html).toContain('En curso')
    expect(html).toContain('Lista')
    expect(html).toContain('Falló')
    expect(html).not.toContain('await tools.x()') // no vuelca el JSON crudo de la entrada
  })

  it('sin llamadas todavía lo dice; y una sola llamada va en singular', () => {
    g.window = { api: { platform: 'darwin' } }
    expect(renderToStaticMarkup(<ToolRow part={exec('running', [])} root={null} />)).toContain('Todavía no hizo ninguna llamada.')
    expect(renderToStaticMarkup(<ToolRow part={exec('running', [{ tool: 'a', status: 'running' }])} root={null} />)).toContain('1 llamada<')
  })

  it('terminada: plegada por defecto (no vuelca la lista)', () => {
    g.window = { api: { platform: 'darwin' } }
    const html = renderToStaticMarkup(<ToolRow part={exec('completed', [{ tool: 'fs_read', status: 'completed' }])} root={null} />)
    expect(html).toContain('Modo código')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('fs_read')
  })
})

describe('innerCalls / summarizeCallInput', () => {
  it('descarta lo que no tiene forma y rellena el estado ausente', () => {
    expect(innerCalls(undefined)).toEqual([])
    expect(innerCalls({ toolCalls: 'x' })).toEqual([])
    expect(innerCalls({ toolCalls: [null, 3, { status: 'x' }, { tool: 'a' }] })).toEqual([{ tool: 'a', status: 'pending', input: '' }])
  })
  it('resume la entrada: campo conocido, JSON compacto recortado o vacío', () => {
    expect(summarizeCallInput({ command: 'ls   -la\n' })).toBe('ls -la')
    expect(summarizeCallInput({})).toBe('')
    expect(summarizeCallInput({ k: 'x'.repeat(300) }).length).toBeLessThanOrEqual(120)
    expect(summarizeCallInput(undefined)).toBe('')
  })
})

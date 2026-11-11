import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ToolPart } from '@opencode-ai/sdk/v2/client'
import { EditChip } from './ToolCard'
import { stepLine, summarizeSteps } from '@shared/conversation-work'
import { toolPart } from '../../../../../test/fixtures/events'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

const g = globalThis as unknown as { window?: { api?: { platform?: string } } }
afterEach(() => {
  delete g.window
})

const part = (tool: string, state: Record<string, unknown>): ToolPart => toolPart('p1', 'm1', 's1', tool, state) as ToolPart
const input = { filePath: '/p/a.ts', oldString: 'a', newString: 'b' }
const DENY = 'The user has specified a rule which prevents you from using this specific tool call.'

describe('edición negada o fallida no se muestra como hecha', () => {
  it('completada: «Editó»', () => {
    g.window = { api: { platform: 'darwin' } }
    const html = renderToStaticMarkup(<EditChip part={part('edit', { status: 'completed', input, output: '', time: { start: 0, end: 1 } })} root={null} />)
    expect(html).toContain('Editó')
  })
  it('error por regla deny: no «Editó»', () => {
    g.window = { api: { platform: 'darwin' } }
    const html = renderToStaticMarkup(<EditChip part={part('edit', { status: 'error', input, error: DENY, time: { start: 0, end: 1 } })} root={null} />)
    expect(html).not.toContain('Editó')
    expect(html).toContain('No se hizo')
  })
  it('rechazada por la persona: igual que hoy', () => {
    g.window = { api: { platform: 'darwin' } }
    const html = renderToStaticMarkup(
      <EditChip part={part('edit', { status: 'error', input, error: 'The user rejected permission to use this specific tool call.', time: { start: 0, end: 1 } })} root={null} />
    )
    expect(html).toContain('No se hizo')
  })
})

describe('edición no aplicada no enseña diff como hecho', () => {
  it('error: sin +/− y sin diff aunque haya texto nuevo', () => {
    g.window = { api: { platform: 'darwin' } }
    const html = renderToStaticMarkup(<EditChip part={part('edit', { status: 'error', input, error: DENY, time: { start: 0, end: 1 } })} root={null} />)
    expect(html).not.toMatch(/\+1/)
    expect(html).not.toMatch(/>\+1<|>-1</)
  })
  it('write nuevo con error: sin +N', () => {
    g.window = { api: { platform: 'darwin' } }
    const html = renderToStaticMarkup(
      <EditChip part={part('write', { status: 'error', input: { filePath: '/p/n.txt', content: 'x\ny' }, error: DENY, time: { start: 0, end: 1 } })} root={null} />
    )
    expect(html).toContain('No se hizo')
    expect(html).not.toMatch(/\+2/)
  })
  it('completada: conserva +/−', () => {
    g.window = { api: { platform: 'darwin' } }
    const html = renderToStaticMarkup(<EditChip part={part('edit', { status: 'completed', input, output: '', time: { start: 0, end: 1 } })} root={null} />)
    expect(html).toMatch(/\+1/)
  })
})

describe('resumen de pasos', () => {
  const ok = { tool: 'edit', state: { status: 'completed' } }
  const bad = { tool: 'edit', state: { status: 'error' } }
  it('2 completadas + 1 error: Editó 2', () => {
    expect(summarizeSteps([ok, ok, bad])).toBe('Editó 2 archivos')
  })
  it('solo errores: no cuenta ediciones', () => {
    expect(summarizeSteps([bad])).not.toContain('Editó')
  })
  it('stepLine de edición con error: No se hizo', () => {
    expect(stepLine({ tool: 'edit', state: { status: 'error', input } })).toBe('No se hizo a.ts')
    expect(stepLine({ tool: 'edit', state: { status: 'completed', input } })).toBe('Editó a.ts')
  })
})

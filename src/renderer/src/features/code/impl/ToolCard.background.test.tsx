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
      <MessageStream
        busy={false}
        error={null}
        root="/p"
        permissions={[]}
        questions={[]}
        onUnrevert={() => undefined}
        loading={false}
        entries={entries as never}
      />
    )
    expect(html).toContain('Reintento 1 de 4: falló la conexión. Esperando 3 s.')
    expect(html).toContain('Hecho')
  })
})

it.each(['shell_wait', 'bgshell_stop'])('V28: %s dice que detuvo el comando', (tool) => {
  const part = toolPart('stop', 'm1', 's1', tool, {
    status: 'completed',
    input: { terminate: true },
    output: 'stopped',
    title: '',
    metadata: {},
    time: { start: 0, end: 1 }
  }) as ToolPart
  const html = renderToStaticMarkup(<ToolRow part={part} root={null} />)
  expect(html).toContain('Detuvo el comando')
  expect(html).not.toContain('Esperó el comando')
})

it.each(['pending', 'running'] as const)('V28: inicio en segundo plano %s usa la etiqueta de la tarjeta', (status) => {
  const part = toolPart(
    'bg',
    'm1',
    's1',
    'bgshell_start',
    status === 'pending'
      ? { status, input: {}, raw: '' }
      : { status, input: { command: 'python3 -m http.server 8191' }, time: { start: 0 } }
  ) as ToolPart
  const html = renderToStaticMarkup(<ToolRow part={part} root={null} />)
  expect(html).toContain('Correr un comando en segundo plano')
  expect(html).not.toContain('bgshell_start')
})

it.each(['pending', 'running', 'completed'] as const)('V28 ronda 3: herramientas visibles en español (%s)', (status) => {
  for (const [tool, label] of [
    ['browser_new_page', 'Abrir una página'],
    ['question', status === 'completed' ? 'Hizo una pregunta' : 'Haciendo una pregunta']
  ]) {
    const part = toolPart('translated', 'm1', 's1', tool, {
      status,
      input: { questions: [{ question: '¿Qué formato prefieres?' }], url: 'http://localhost:8765' },
      raw: '',
      output: 'Asked 1 question',
      title: 'Asked 1 question',
      metadata: {},
      time: { start: 1, end: 2 }
    } as never) as ToolPart
    const html = renderToStaticMarkup(<ToolRow part={part} root={null} />)
    expect(html).toContain(label)
    expect(html).not.toContain(tool)
    expect(html).not.toContain('Asked 1 question')
  }
})

it('V28 ronda 4: al recibir write sin argumentos no dibuja una caja vacía; al llegar la ruta muestra el archivo', () => {
  for (const input of [{}, { filePath: '/proj/index.html' }]) {
    const part = toolPart('p', 'm', 's', 'write', { status: 'running', input, time: { start: 1 } }) as ToolPart
    const html = renderToStaticMarkup(<ToolRow part={part} root="/proj" />)
    expect(html).toContain('Quiere crear')
    if ('filePath' in input) expect(html).toContain('index.html')
    else expect(html).not.toContain('<button')
  }
})

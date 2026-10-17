/**
 * El trabajo plegado en Chat y en Code (render estático, escritorio): una línea «Trabajó durante Xs · N pasos», la narración
 * y la respuesta final fuera/dentro donde toca, y lo que nunca se esconde (permiso pendiente, error de herramienta).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Part } from '@opencode-ai/sdk/v2/client'
import { ChatMessageList } from '../../chat/ChatMessageList'
import { MessageStream } from './MessageStream'
import { useReadingMode, type ReadingMode } from '../../../lib/reading-mode'
import { assistantFull, userWithFile } from '../../../../../test/fixtures/entries'
import { toolPart } from '../../../../../test/fixtures/events'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

const g = globalThis as unknown as { window?: { api?: { platform?: string } } }
function surface(platform: string | null): void {
  if (platform === null) delete g.window
  else g.window = { api: { platform } }
}
/** El render estático lee el estado INICIAL de zustand (getServerSnapshot): hay que fijar la vista ahí. */
function setViews(views: { chat: ReadingMode | null; code: ReadingMode | null }): void {
  Object.assign(useReadingMode.getInitialState().stored, views)
  useReadingMode.setState({ stored: { ...views } })
}
afterEach(() => {
  surface(null)
  setViews({ chat: null, code: null })
})

const T0 = 1_760_000_000_000
const done = (id: string, tool: string, input: Record<string, unknown>, at: number): Part =>
  toolPart(id, 'msg_x', 'ses_x', tool, {
    status: 'completed',
    input,
    output: 'resultado',
    title: tool,
    metadata: {},
    time: { start: T0 + at * 1000, end: T0 + (at + 2) * 1000 }
  })
const text = (id: string, body: string): Part => ({ id, sessionID: 'ses_x', messageID: 'msg_x', type: 'text', text: body }) as Part

const parts: Part[] = [
  text('t0', 'Voy a mirar el proyecto.'),
  done('a', 'read', { filePath: '/proj/uno.ts' }, 0),
  text('t1', 'Ahora lo cambio.'),
  done('b', 'edit', { filePath: '/proj/uno.ts', oldString: 'x', newString: 'y' }, 2),
  done('c', 'bash', { command: 'npm test' }, 4),
  text('t2', 'Listo: quedó arreglado.')
]
const entries = [userWithFile, { info: assistantFull.info, parts }] as never[]

describe('Chat: trabajo plegado', () => {
  it('Resumida (predeterminada en Chat): una línea, la narración dentro y la respuesta final fuera', () => {
    surface('darwin')
    const html = renderToStaticMarkup(<ChatMessageList entries={entries} busy={false} />)
    expect(html).toContain('Trabajó durante 6 s · 3 pasos')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('Voy a mirar el proyecto.')
    expect(html).toContain('Listo: quedó arreglado.')
    expect(html).not.toContain('Ahora lo cambio.')
    expect(html).not.toContain('uno.ts')
    expect(html).not.toContain('npm test')
  })

  it('Detallada: abierta, con la narración intermedia y cada paso', () => {
    surface('darwin')
    setViews({ chat: 'detailed', code: null })
    const html = renderToStaticMarkup(<ChatMessageList entries={entries} busy={false} />)
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('Ahora lo cambio.')
    expect(html).toContain('npm test')
  })

  it('en vivo: abierta, con el giro que sobrevive a movimiento reducido y sin respuesta final todavía', () => {
    surface('darwin')
    const live = [userWithFile, { info: assistantFull.info, parts: parts.slice(0, 5) }] as never[]
    const html = renderToStaticMarkup(<ChatMessageList entries={live} busy />)
    expect(html).toContain('Trabajando…')
    expect(html).toContain('animate-spin')
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('npm test')
  })

  it('un error de herramienta sigue a la vista con el trabajo plegado', () => {
    surface('darwin')
    const failing = [
      userWithFile,
      {
        info: assistantFull.info,
        parts: [
          done('a', 'read', { filePath: '/proj/uno.ts' }, 0),
          toolPart('e', 'msg_x', 'ses_x', 'bash', {
            status: 'error',
            input: { command: 'rm -rf nada' },
            error: 'Permiso denegado',
            time: { start: T0, end: T0 + 1000 }
          }),
          text('t2', 'No pude terminarlo.')
        ]
      }
    ] as never[]
    const html = renderToStaticMarkup(<ChatMessageList entries={failing} busy={false} />)
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('data-work-attention')
    expect(html).toContain('rm -rf nada')
    expect(html).not.toContain('uno.ts')
  })

  it('el celular conserva su comportamiento (sin línea de trabajo)', () => {
    surface('remote')
    const html = renderToStaticMarkup(<ChatMessageList entries={entries} busy={false} />)
    expect(html).not.toContain('data-work-fold')
  })
})

describe('Code: trabajo plegado', () => {
  const base = { busy: false, error: null, root: '/proj', permissions: [], questions: [], onUnrevert: () => undefined, loading: false }

  it('Con pasos (predeterminada en Code): plegado, dice qué hizo y deja a la vista el archivo editado', () => {
    surface('darwin')
    const html = renderToStaticMarkup(<MessageStream {...base} entries={entries} />)
    expect(html).toContain('Trabajó durante 6 s · 3 pasos')
    expect(html).toContain('Leyó 1 archivo')
    expect(html).toContain('Editó 1 archivo')
    expect(html).toContain('uno.ts') // el chip del archivo editado
    expect(html).not.toContain('npm test')
    expect(html).not.toContain('Ahora lo cambio.')
    expect(html).toContain('Listo: quedó arreglado.')
  })

  it('Resumida: nada más que la línea', () => {
    surface('darwin')
    setViews({ chat: null, code: 'summary' })
    const html = renderToStaticMarkup(<MessageStream {...base} entries={entries} />)
    expect(html).toContain('Trabajó durante 6 s · 3 pasos')
    expect(html).not.toContain('Leyó 1 archivo')
    expect(html).not.toContain('uno.ts')
  })

  it('un permiso pendiente NO queda oculto con el trabajo plegado', () => {
    surface('darwin')
    setViews({ chat: null, code: 'summary' })
    const waiting = toolPart(
      'w',
      'msg_x',
      'ses_x',
      'bash',
      { status: 'running', input: { command: 'git push' }, time: { start: T0 } },
      'call_w'
    )
    const pendingEntries = [
      userWithFile,
      { info: assistantFull.info, parts: [done('a', 'read', { filePath: '/proj/uno.ts' }, 0), waiting] }
    ] as never[]
    const perm = {
      id: 'perm_1',
      sessionID: 'ses_x',
      permission: 'bash',
      patterns: ['git push'],
      metadata: {},
      always: [],
      tool: { messageID: 'msg_x', callID: 'call_w' },
      api: 'v1' as const
    }
    const html = renderToStaticMarkup(<MessageStream {...base} busy entries={pendingEntries} permissions={[perm]} />)
    expect(html).toContain('git push')
    expect(html).toContain('Trabajando…')
    // Con el trabajo plegado (aquí: no en vivo, como cuando la persona lo cierra) el permiso sigue a la vista, fuera del plegado.
    const closed = renderToStaticMarkup(<MessageStream {...base} entries={pendingEntries} permissions={[perm]} />)
    expect(closed).toContain('aria-expanded="false"')
    expect(closed).toContain('data-work-attention')
    expect(closed).toContain('git push')
    expect(closed).not.toContain('uno.ts')
  })
})

describe('Chat: respuestas seguidas del asistente', () => {
  it('el motor abre un mensaje por vuelta del modelo: se pintan como una sola respuesta con un solo trabajo', () => {
    surface('darwin')
    const first = { info: { ...assistantFull.info, id: 'msg_a' }, parts: [done('a', 'read', { filePath: '/proj/uno.ts' }, 0)] }
    const second = {
      info: { ...assistantFull.info, id: 'msg_b' },
      parts: [done('b', 'bash', { command: 'npm test' }, 2), text('t9', 'Todo listo.')]
    }
    const html = renderToStaticMarkup(<ChatMessageList entries={[userWithFile, first, second] as never[]} busy={false} />)
    expect((html.match(/data-work-fold/g) ?? []).length).toBe(1)
    expect(html).toContain('Trabajó durante 4 s · 2 pasos')
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeSession, resetEventIds, sessionCreated, statusIdle } from '../../../../../test/fixtures/events'
import type { FileAttachment } from './types'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

type Store = typeof import('./store')
let useCode: Store['useCode']
let useServer: (typeof import('../../../stores/server'))['useServer']
const directory = '/work/code'
const savedWindow = window
const attachments: FileAttachment[] = [
  { id: 'gld', name: 'datos.gld', mime: 'application/octet-stream', url: '', reference: { path: 'C:\\proyecto\\datos.gld' } },
  { id: 'bin', name: 'datos.bin', mime: 'application/octet-stream', url: '', reference: {} },
  { id: 'md', name: 'leeme.md', mime: 'text/plain', url: 'data:text/plain;base64,IyBob2xh' },
  { id: 'img', name: 'foto.png', mime: 'image/png', url: 'data:image/png;base64,iVBORw==' },
  { id: 'pdf', name: 'informe.pdf', mime: 'application/pdf', url: 'data:application/pdf;base64,JVBERg==' }
]

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  resetEventIds()
  ;({ useCode } = await import('./store'))
  ;({ useServer } = await import('../../../stores/server'))
  useCode.setState({ directory })
  useCode.getState().applyEvent(sessionCreated(makeSession('s1', directory)).event, directory)
  useCode.setState({ activeSessionID: 's1' })
})

afterEach(() => vi.stubGlobal('window', savedWindow))

function install() {
  const promptAsync = vi.fn((_req: { parts: Array<{ type: string; mime?: string; text?: string; url?: string }> }) =>
    Promise.resolve({ data: {} })
  )
  useServer.setState({
    client: {
      session: {
        update: (a: { sessionID: string; permission?: unknown }) =>
          Promise.resolve({ data: { id: a.sessionID, permission: a.permission } }),
        promptAsync
      }
    } as never
  })
  return promptAsync
}

describe('partes enviadas por Código', () => {
  it('mezcla referencias en texto con texto normalizado, imagen y PDF', async () => {
    const prompt = install()
    expect(await useCode.getState().send('revisa estos archivos', [], attachments)).toBe(true)
    const parts = prompt.mock.calls[0]![0].parts
    expect(parts.map((p) => p.type)).toEqual(['text', 'text', 'text', 'file', 'file', 'file'])
    expect(parts[1]).toEqual({
      type: 'text',
      text: 'Archivo adjunto: datos.gld\nRuta: C:\\proyecto\\datos.gld\nPuedes abrirlo con las herramientas del proyecto.'
    })
    expect(parts[2]!.text).toContain('datos.bin. No hay una ruta local disponible')
    expect(parts.slice(3)).toEqual(attachments.slice(2).map((a) => ({ type: 'file', mime: a.mime, filename: a.name, url: a.url })))
  })

  it('envía una referencia sin texto de usuario y la conserva al esperar en la cola', async () => {
    const prompt = install()
    expect(await useCode.getState().send('', [], [attachments[0]!])).toBe(true)
    expect(prompt.mock.calls[0]![0].parts).toHaveLength(1)
    expect(useCode.getState().enqueue('s1', '', [], [attachments[1]!])).toBe(true)
    useCode.getState().applyEvent(statusIdle('s1', directory).event, directory)
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(2))
    expect(prompt.mock.calls[1]![0].parts[0]).toMatchObject({ type: 'text', text: expect.stringContaining('datos.bin') })
  })

  it('el celular conserva solo los adjuntos data: de siempre', async () => {
    vi.stubGlobal('window', { ...window, api: { ...window.api, platform: 'remote' } })
    const prompt = install()
    expect(await useCode.getState().send('hola', [], attachments)).toBe(true)
    expect(prompt.mock.calls[0]![0].parts).toEqual([
      { type: 'text', text: 'hola' },
      ...attachments.slice(2).map((a) => ({ type: 'file', mime: a.mime, filename: a.name, url: a.url }))
    ])
  })
})

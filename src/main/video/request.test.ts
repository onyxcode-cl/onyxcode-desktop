import { expect, it, vi } from 'vitest'
import { videoRequest } from './request'
const connection = { baseUrl: 'http://127.0.0.1:1234', authorization: 'Basic test' }
const info = (id: string, created: number, extra = {}) => ({ info: { id, role: 'user', sessionID: 'ses_1', time: { created }, ...extra } })
it('elige el último pedido humano de esa sesión, sin depender del orden ni de mensajes del asistente', async () => {
  const fetcher = vi.fn(async () =>
    Response.json([
      info('msg_new', 5),
      info('msg_old', 1),
      info('msg_other', 10, { sessionID: 'ses_2' }),
      info('msg_assistant', 12, { role: 'assistant' })
    ])
  ) as unknown as typeof fetch
  expect(await videoRequest(connection, '/proyecto con espacio', 'ses_1', fetcher)).toBe('msg_new')
  expect(fetcher).toHaveBeenCalledWith(
    expect.stringContaining('directory=%2Fproyecto%20con%20espacio&limit=100'),
    expect.objectContaining({ redirect: 'error' })
  )
})
it('sin identidad fiable o respuesta acotada no autoriza reemplazos', async () => {
  for (const response of [
    Response.json({}),
    Response.json([]),
    new Response('mal'),
    new Response('no', { status: 403 }),
    Response.json([info('msg_big', 1), 'x'.repeat(2 * 1024 * 1024)])
  ]) {
    expect(await videoRequest(connection, '/p', 'ses_1', async () => response)).toBeNull()
  }
  const fetcher = vi.fn()
  expect(await videoRequest(connection, '/p', '../fuera', fetcher)).toBeNull()
  expect(fetcher).not.toHaveBeenCalled()
})

it('solo entrega adjuntos humanos de la sesión; nombre ambiguo exige id y nunca sigue URLs o rutas', async () => {
  const { videoAttachment } = await import('./request')
  const attachment = (id: string, filename: string, content: string) => ({
    id,
    type: 'file',
    filename,
    url: `data:image/png;base64,${Buffer.from(content).toString('base64')}`
  })
  const messages = [
    { ...info('msg_1', 1), parts: [attachment('prt_1', 'foto.png', 'uno')] },
    { ...info('msg_2', 2), parts: [attachment('prt_2', 'foto.png', 'dos')] },
    { ...info('msg_a', 3, { role: 'assistant' }), parts: [attachment('prt_ai', 'ajena.png', 'no')] },
    { ...info('msg_o', 4, { sessionID: 'ses_other' }), parts: [attachment('prt_o', 'otra.png', 'no')] }
  ]
  const fetcher = (async () => Response.json(messages)) as typeof fetch
  expect(await videoAttachment(connection, '/chat', 'ses_1', 'prt_1', 'photo', fetcher)).toEqual(Buffer.from('uno'))
  for (const origin of ['foto.png', 'ajena.png', 'otra.png', '/etc/a.png', 'https://example.com/a.png'])
    expect(await videoAttachment(connection, '/chat', 'ses_1', origin, 'photo', fetcher)).toBeNull()
  expect(await videoAttachment(connection, '/chat', 'ses_1', 'prt_1', 'audio', fetcher)).toBeNull()
})

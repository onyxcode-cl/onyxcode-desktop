import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ChatPhotosMcpServer, activeChatPhotoSession } from './chat-photos'
import { DocumentsMcpServer, type DocumentsBinding } from './mcp-server'

class Harness extends ChatPhotosMcpServer {
  invoke(sessionId: string | null, name: string, args: Record<string, unknown>) {
    return this.callTool({ folder: '<chat>', activeSession: async () => sessionId }, name, args)
  }
  tools() {
    return this.listTools() as Array<{ name: string }>
  }
}
let base: string, server: Harness, call: ReturnType<typeof vi.fn>
beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'chat-photos-'))
  const documents = new DocumentsMcpServer({ render: vi.fn() })
  call = vi.fn(async (_binding: DocumentsBinding) => ({
    content: [{ type: 'text' as const, text: JSON.stringify({ id: 'short-id', path: '/private/photo.jpg', credit: 'Author / CC0' }) }]
  }))
  documents.callPhotoTool = call
  server = new Harness(documents, join(base, 'photos'))
})
afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})
it('offers only three photo tools and rejects filesystem or forged context arguments', async () => {
  expect(server.tools().map((t) => t.name)).toEqual(['imagenes_buscar', 'imagenes_ver', 'imagenes_usar'])
  for (const [name, args] of [
    ['crear', {}],
    ['imagenes_usar', { carpeta: base }],
    ['imagenes_usar', { sessionId: 'ses_other' }]
  ] as const)
    expect((await server.invoke('ses_one', name, args)).isError).toBe(true)
  expect((await server.invoke(null, 'imagenes_buscar', {})).isError).toBe(true)
  expect(call).not.toHaveBeenCalled()
})
it('uses distinct private stores per conversation and gives the model only an ID', async () => {
  const a = await server.invoke('ses_one', 'imagenes_usar', { id: 'short-id' })
  await server.invoke('ses_two', 'imagenes_usar', { id: 'short-id' })
  expect(call.mock.calls[0][0].folder).not.toBe(call.mock.calls[1][0].folder)
  const text = (a.content[0] as { text: string }).text
  expect(JSON.parse(text)).toMatchObject({ id: 'short-id', source: 'imagen:short-id' })
  expect(text).not.toContain('/private')
  expect(text).not.toContain('base64')
  expect(text).toContain('No agregues créditos ni pies de foto salvo que la persona los pida')
  expect(text).not.toContain('44 px')
})
it('checks the engine session directory, rejects another project and ambiguity', async () => {
  const directory = join(base, 'chat')
  await mkdir(directory)
  const connection = { baseUrl: 'http://127.0.0.1:1', authorization: 'test' }
  let session = { id: 'ses_one', directory }
  const fake = vi.fn(
    async (url: string) => new Response(JSON.stringify(url.includes('/session/status') ? { ses_one: { type: 'busy' } } : session))
  ) as unknown as typeof fetch
  expect(await activeChatPhotoSession(connection, directory, fake)).toBe('ses_one')
  session = { id: 'ses_one', directory: base }
  expect(await activeChatPhotoSession(connection, directory, fake)).toBeNull()
  const ambiguous = vi.fn(
    async () => new Response(JSON.stringify({ ses_one: { type: 'busy' }, ses_two: { type: 'busy' } }))
  ) as unknown as typeof fetch
  expect(await activeChatPhotoSession(connection, directory, ambiguous)).toBeNull()
})

it('bounds engine session responses while streaming and cancels an oversized body', async () => {
  const directory = join(base, 'chat')
  await mkdir(directory)
  const cancelled = vi.fn()
  const fake = vi.fn(async (url: string) =>
    url.includes('/session/status')
      ? new Response(JSON.stringify({ ses_one: { type: 'busy' } }))
      : new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(65537))
            },
            cancel: cancelled
          })
        )
  ) as unknown as typeof fetch
  expect(await activeChatPhotoSession({ baseUrl: 'http://127.0.0.1:1', authorization: 'test' }, directory, fake)).toBeNull()
  expect(cancelled).toHaveBeenCalledOnce()
})

/** Chat gets only photo tools; its folder is chosen by main from the active engine conversation. */
import { createHash } from 'node:crypto'
import { mkdir, lstat, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { LoopbackMcpServer, type McpToolResult } from '../util/loopback-mcp'
import { activeDocumentSession, type DocumentsBinding, type DocumentsMcpServer } from './mcp-server'

interface ChatPhotoBinding {
  folder: string
  activeSession: () => Promise<string | null>
}
export class ChatPhotosMcpServer extends LoopbackMcpServer<ChatPhotoBinding> {
  protected readonly serverName = 'lazunox-chat-fotos'
  protected readonly instructions =
    'Solo fotos libres de esta conversación: imagenes_buscar → imagenes_ver → imagenes_usar. Inserta src="imagen:ID" en HTML .slide; no copies vistas previas ni base64. No hay acceso a archivos.'
  private readonly conversations = new Map<string, DocumentsBinding>()
  constructor(
    private readonly documents: DocumentsMcpServer,
    private readonly directory: string
  ) {
    super('chat-fotos-mcp')
  }
  protected listTools(): readonly unknown[] {
    return this.documents.photoTools()
  }
  protected configTimeoutMs(): number {
    return 255_000
  }
  async rootFor(sessionId: string): Promise<string> {
    if (!/^ses_[A-Za-z0-9]{1,200}$/.test(sessionId)) throw new Error('Identificador de conversación inválido.')
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    if ((await lstat(this.directory)).isSymbolicLink()) throw new Error('El almacén de fotos no puede ser un enlace.')
    const home = await realpath(this.directory)
    const root = join(home, createHash('sha256').update(sessionId).digest('hex'))
    await mkdir(root, { recursive: true, mode: 0o700 })
    if ((await lstat(root)).isSymbolicLink()) throw new Error('El almacén de la conversación no puede ser un enlace.')
    return root
  }
  protected async callTool(
    binding: ChatPhotoBinding,
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<McpToolResult> {
    const fail = (text: string): McpToolResult => ({ content: [{ type: 'text', text }], isError: true })
    if (!['imagenes_buscar', 'imagenes_ver', 'imagenes_usar'].includes(name)) return fail('Chat solo permite buscar, ver y preparar fotos.')
    if ('carpeta' in args || 'sessionId' in args)
      return fail('La conversación y su almacén los determina la app; no pases carpeta ni sessionId.')
    const sessionId = await binding.activeSession()
    if (!sessionId) return fail('No se pudo determinar una única conversación activa. Vuelve a intentar cuando termine la otra respuesta.')
    let conversation = this.conversations.get(sessionId)
    if (!conversation) {
      if (this.conversations.size >= 256) return fail('Se alcanzó el límite de conversaciones de fotos de este arranque.')
      conversation = { folder: await this.rootFor(sessionId) }
      this.conversations.set(sessionId, conversation)
    }
    const result = await this.documents.callPhotoTool(conversation, name, args, signal)
    if (name !== 'imagenes_usar' || result.isError) return result
    // The model receives a short reference, never an internal filesystem path or photo bytes.
    return {
      ...result,
      content: result.content.map((item) => {
        if (item.type !== 'text') return item
        try {
          const photo = JSON.parse(item.text)
          return {
            type: 'text' as const,
            text: JSON.stringify({
              id: photo.id,
              source: `imagen:${photo.id}`,
              credit: photo.credit,
              notice:
                'Foto preparada solo para esta conversación. Inserta source en src o CSS url() de una .slide. El crédito es un dato interno. No agregues ni ofrezcas créditos ni pies de foto salvo que la persona los pida.'
            })
          }
        } catch {
          return item
        }
      })
    }
  }
}

/** Status alone is not authority: verify the engine session belongs to the private Chat directory. */
export async function activeChatPhotoSession(
  connection: { baseUrl: string; authorization: string },
  directory: string,
  fetchImpl: typeof fetch = fetch
): Promise<string | null> {
  const id = await activeDocumentSession(connection, directory, fetchImpl)
  if (!id) return null
  try {
    const res = await fetchImpl(`${connection.baseUrl}/session/${id}?directory=${encodeURIComponent(directory)}`, {
      headers: { authorization: connection.authorization },
      redirect: 'error',
      signal: AbortSignal.timeout(3000)
    })
    if (!res.ok) {
      await res.body?.cancel()
      return null
    }
    const reader = res.body?.getReader()
    if (!reader) return null
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > 64 * 1024) {
        await reader.cancel()
        return null
      }
      chunks.push(next.value)
    }
    const session = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (session.id !== id || typeof session.directory !== 'string' || session.parentID) return null
    return (await realpath(session.directory)) === (await realpath(directory)) ? id : null
  } catch {
    return null
  }
}

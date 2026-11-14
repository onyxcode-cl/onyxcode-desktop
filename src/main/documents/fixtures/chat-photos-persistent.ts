/** Child process for the restart regression: no Electron, provider traffic or real userData. */
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { ChatPhotosMcpServer } from '../chat-photos'
import { DocumentsMcpServer } from '../mcp-server'
import { FreeImageRegistry } from '../free-image-registry'
import type { FreeImageAsset } from '../free-images'
import type { McpToolResult } from '../../util/loopback-mcp'

const [directory, phase] = process.argv.slice(2)
const id = 'prepared-before-restart'
const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH7sAAAAASUVORK5CYII=', 'base64')
const evaluation = { mode: 'manual' as const, observed: 'Selected by the person', meets: [], doubts: '' }
const asset: FreeImageAsset = {
  bytes,
  ext: 'jpg',
  credit: 'Author · CC0 1.0',
  provenance: {
    id,
    provider: 'Wikimedia Commons',
    status: 'licencia-comprobada',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    credit: 'Author · CC0 1.0',
    author: 'Author',
    license: 'CC0 1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    source: 'https://commons.wikimedia.org/wiki/File:Test.jpg',
    title: 'Test photo',
    sourceSha1: 'abc123',
    checkedAt: '2026-11-13T00:00:00.000Z',
    queries: ['test'],
    requirements: { subject: 'Photo', usage: 'Slides', required: [], excluded: [], realPhoto: true },
    evaluation,
    evaluationStatus: 'seleccion-manual-declarada',
    width: 1,
    height: 1,
    transformations: [],
    notices: ''
  }
}
const documents = new DocumentsMcpServer({
  render: async () => {
    throw new Error('The restart test must not render a document or launch Electron')
  },
  photoRegistry: new FreeImageRegistry(join(directory, 'documentos-fotos')),
  // The preparation test injects only the selected photo. Reload uses the real, empty search service.
  ...(phase === 'prepare'
    ? {
        freeImages: () => ({
          search: async () => {
            throw new Error('Unexpected provider search')
          },
          view: async () => {
            throw new Error('Unexpected provider preview')
          },
          use: async (selected: string) => {
            if (selected !== id) throw new Error('Unexpected photo id')
            return asset
          }
        })
      }
    : {}),
  audit: () => undefined
})
let session = 'ses_original'
class Harness extends ChatPhotosMcpServer {
  invoke(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    return this.callTool({ folder: '<chat>', activeSession: async () => session }, name, args)
  }
}
const chat = new Harness(documents, join(directory, 'chat-fotos'))
const loopback = process.env.LAZUNOX_PHOTO_RESTART_LOOPBACK === '1'
// The sandbox forbids listen(). Replace only socket startup; clientFor still issues its real token.
// Set LAZUNOX_PHOTO_RESTART_LOOPBACK=1 to exercise the same regression through real HTTP MCP.
if (!loopback) Object.defineProperty(chat, 'ensureServer', { value: async () => 1 })
const textOf = (result: McpToolResult): string => result.content.flatMap((item) => (item.type === 'text' ? [item.text] : [])).join('\n')

async function main(): Promise<void> {
  const client = await chat.clientFor({ folder: '<chat>', activeSession: async () => session })
  const rpc = async (name: string, args: Record<string, unknown>): Promise<McpToolResult> => {
    if (!loopback) return chat.invoke(name, args)
    const response = await fetch(`http://127.0.0.1:${client.port}/mcp`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${client.token}`, 'content-type': 'application/json', Connection: 'close' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
      signal: AbortSignal.timeout(5000)
    })
    if (!response.ok) throw new Error(`MCP returned ${response.status}`)
    const body = (await response.json()) as { result?: McpToolResult; error?: unknown }
    if (!body.result) throw new Error(`MCP failed: ${JSON.stringify(body.error)}`)
    return body.result
  }
  let used = phase === 'prepare' ? await rpc('imagenes_usar', { id, evaluation }) : null
  if (used?.isError) throw new Error(textOf(used))
  const html = `<section class="slide"><img src="imagen:${id}"></section>`
  const resolved = await documents.resolveHtmlPhotos(html, { root: await chat.rootFor(session) })
  used ??= await rpc('imagenes_usar', { id })
  if (used.isError) throw new Error(textOf(used))
  const expired = phase === 'reload' ? await rpc('imagenes_ver', { ids: [id] }) : null
  session = 'ses_other'
  let otherHtmlError = ''
  try {
    await documents.resolveHtmlPhotos(html, { root: await chat.rootFor(session) })
  } catch (error) {
    otherHtmlError = error instanceof Error ? error.message : String(error)
  }
  const otherUse = await rpc('imagenes_usar', { id })
  process.stdout.write(
    `RESULT ${JSON.stringify({
      pid: process.pid,
      transport: loopback ? 'http' : 'direct-with-real-token',
      tokenHash: createHash('sha256').update(client.token).digest('hex'),
      used: JSON.parse(textOf(used)),
      embedded: resolved.includes(`data:image/jpeg;base64,${bytes.toString('base64')}`),
      unresolved: resolved.includes(`imagen:${id}`),
      automaticCredit: resolved.includes('<figcaption') || resolved.includes('data-lzx-credit'),
      otherHtmlError,
      otherUseRejected: otherUse.isError === true,
      expired: expired ? { isError: expired.isError, text: textOf(expired) } : null
    })}\n`
  )
}

void main()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await chat.stop()
    await documents.stop()
  })

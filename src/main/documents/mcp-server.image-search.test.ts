import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DocumentsMcpServer, IMAGE_TOOLS, type DocumentsBinding } from './mcp-server'
import type { FreeImagesService } from './free-images'

class Harness extends DocumentsMcpServer {
  search(binding: DocumentsBinding, args: Record<string, unknown>) {
    return this.callTool(binding, 'imagenes_buscar', args)
  }
}
const queries = ['interior cafetería', 'coffee shop interior']
let root: string
let server: Harness
const search = vi.fn(async () => ({ searchId: 'round-id', round: 1, candidates: [], mimeType: 'image/png' as const }))
const text = (r: Awaited<ReturnType<Harness['search']>>) => (r.content[0] as { text: string }).text
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'lzx-search-schema-')))
  search.mockClear()
  server = new Harness({
    render: async () => {
      throw new Error('La búsqueda no debe renderizar documentos')
    },
    freeImages: () => ({ search }) as unknown as FreeImagesService,
    audit: () => undefined
  })
})
afterEach(async () => {
  await server.stop()
  await rm(root, { recursive: true, force: true })
})

describe('entrada de búsqueda de fotos', () => {
  it.each(['horizontal', 'vertical', 'cuadrada', 'cualquiera', 'landscape', 'portrait', 'square', 'any'])(
    'admite orientation=%s también dentro de requirements sin perder una llamada',
    async (orientation) => {
      const args = { queries, requirements: { subject: 'Cafetería', usage: 'Portada', orientation } }
      expect((await server.search({ folder: root }, args)).isError).not.toBe(true)
      expect(search).toHaveBeenLastCalledWith(args)
      expect(IMAGE_TOOLS[0].inputSchema.properties.requirements.properties.orientation.enum).toContain(orientation)
      expect(IMAGE_TOOLS[0].inputSchema.properties.orientation.enum).toContain(orientation)
    }
  )

  it('publica ficha mínima y permite segunda ronda sin repetir requisitos', async () => {
    const schema = IMAGE_TOOLS[0].inputSchema
    expect(schema.required).toEqual(['queries'])
    expect(schema.properties.requirements.required).toEqual(['subject', 'usage'])
    const first = { queries, requirements: { subject: 'Cafetería', usage: 'Portada' } }
    expect((await server.search({ folder: root }, first)).isError).not.toBe(true)
    expect(search).toHaveBeenLastCalledWith(first)
    const second = { queries, searchId: 'round-id' }
    expect((await server.search({ folder: root }, second)).isError).not.toBe(true)
    expect(search).toHaveBeenLastCalledWith(second)
  })

  it('explica campos inesperados y da ejemplo JSON utilizable antes de llamar al proveedor', async () => {
    const result = await server.search(
      { folder: root },
      {
        queries,
        requirements: { subject: 'Cafetería', usage: 'Portada', style: 'documental' }
      }
    )
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('requirements: style')
    expect(text(result)).toContain('Campos permitidos: subject, action, place, required, excluded, usage, realPhoto')
    const example = text(result).match(/Ejemplo válido: (\{.*?\})\. Segunda ronda:/)![1]
    expect(JSON.parse(example).requirements).toEqual({ subject: 'Interior de cafetería', usage: 'Portada' })
    expect(search).not.toHaveBeenCalled()
    expect((await server.search({ folder: root }, JSON.parse(example))).isError).not.toBe(true)
  })

  it('mantiene rechazo de URL arbitraria con instrucciones de reparación', async () => {
    const result = await server.search({ folder: root }, { queries, url: 'https://example.test/foto.jpg' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('Argumentos no admitidos: url')
    expect(text(result)).toContain('Nunca pases URLs')
    expect(text(result)).toContain('Ejemplo válido:')
    expect(search).not.toHaveBeenCalled()
  })
})

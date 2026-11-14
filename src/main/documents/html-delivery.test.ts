import { afterEach, beforeEach, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile, readFile, symlink, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FreeImageAsset } from './free-images'
import { FreeImageRegistry } from './free-image-registry'
import { prepareHtmlDelivery } from './html-delivery'
import { DocumentsMcpServer, type DocumentsBinding } from './mcp-server'
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH7sAAAAASUVORK5CYII=', 'base64')
const evaluation = { mode: 'manual' as const, observed: 'Foto elegida por la persona.', meets: [], doubts: '' }
const credit = 'Foto: Author · CC BY 4.0 · Wikimedia Commons'
const photo = (id: string): FreeImageAsset => {
  const bytes = Buffer.concat([PNG, Buffer.from(id)])
  return {
    bytes,
    ext: 'jpg',
    credit,
    provenance: {
      provider: 'Wikimedia Commons',
      id,
      title: 'Photo',
      author: 'Author',
      license: 'CC BY 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      source: 'https://commons.wikimedia.org/wiki/File:Photo.jpg',
      credit,
      sourceSha1: 'abc123',
      sha256: createHash('sha256').update(bytes).digest('hex'),
      checkedAt: '2026-11-13T00:00:00.000Z',
      queries: ['photo'],
      requirements: { subject: 'Photo', usage: 'Report', required: [], excluded: [], realPhoto: true },
      evaluation,
      evaluationStatus: 'seleccion-manual-declarada',
      status: 'licencia-comprobada',
      transformations: [],
      width: 1,
      height: 1,
      notices: 'Aviso de atribución completo',
      fullCredit: 'Texto completo original del autor'
    }
  }
}

let base: string, root: string, registry: FreeImageRegistry
const rel = 'img/free-12345678901234567890.jpg'
beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'html-photos-'))
  root = join(base, 'scope')
  await mkdir(join(root, 'img'), { recursive: true })
  registry = new FreeImageRegistry(join(base, 'registry'))
  const asset = photo('p1')
  await writeFile(join(root, rel), asset.bytes)
  await registry.remember(root, 'p1', rel, asset)
})
afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

it('entrega una copia autónoma portable sin créditos visibles ni JSON suelto, deduplica y conserva el borrador', async () => {
  const draft = '<body><section class="slide"><img src="' + rel + '"><img src="imagen:p1"></section></body>'
  await writeFile(join(root, 'deck.html'), draft)
  const output = await prepareHtmlDelivery(root, 'deck.html', [root], registry)
  const html = await readFile(output.abs, 'utf8')
  expect(output.rel).toBe('deck-autonomo.html')
  expect(html).not.toContain('src="img/')
  expect(html).not.toContain('imagen:p1')
  expect(html.split(photo('p1').bytes.toString('base64'))).toHaveLength(2)
  expect(html).not.toContain('data-lzx-photo-credit')
  expect(html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')).not.toContain('Foto:')
  expect(html).toContain('data-lzx-photo-provenance')
  expect(await readdir(root)).toEqual(['deck-autonomo.html', 'deck.html', 'img'])
  expect(await readdir(join(root, 'img'))).toEqual(['free-12345678901234567890.jpg'])
  expect(await readFile(join(root, 'deck.html'), 'utf8')).toBe(draft)
  // Ya no depende del registro ni de img al copiarla fuera de la carpeta.
  await mkdir(join(base, 'destination'))
  await writeFile(join(base, 'destination', 'deck.html'), html)
  await rm(join(root, 'img'), { recursive: true })
  const copy = await prepareHtmlDelivery(join(base, 'destination'), 'deck.html', [], undefined)
  expect(await readFile(copy.abs, 'utf8')).toBe(html)
})
it.each(['img/missing.jpg', 'https://example.org/photo.jpg', '../outside.jpg'])(
  'rechaza foto %s sin entregar una copia parcial',
  async (ref) => {
    await writeFile(join(root, 'deck.html'), '<section class="slide"><img src="' + ref + '"></section>')
    await expect(prepareHtmlDelivery(root, 'deck.html', [root], registry)).rejects.toThrow()
    expect(await readdir(root)).not.toContain('deck-autonomo.html')
  }
)
it('rechaza otro ámbito, enlaces y un HTML sobre el presupuesto', async () => {
  const other = join(base, 'other')
  await mkdir(other)
  await writeFile(join(other, 'deck.html'), '<section class="slide"><img src="imagen:p1"></section>')
  await expect(prepareHtmlDelivery(other, 'deck.html', [other], registry)).rejects.toThrow('no está preparada')
  await symlink(join(other, 'deck.html'), join(root, 'linked.html'))
  await expect(prepareHtmlDelivery(root, 'linked.html', [root], registry)).rejects.toThrow('enlace')
  await writeFile(join(root, 'large.html'), 'x'.repeat(24 * 1024 * 1024 + 1))
  await expect(prepareHtmlDelivery(root, 'large.html', [root], registry)).rejects.toThrow('24 MiB')
})
it('cancelar antes de preparar no crea entregable', async () => {
  const signal = AbortSignal.abort()
  await expect(prepareHtmlDelivery(root, 'deck.html', [root], registry, signal)).rejects.toThrow()
  expect(await readdir(root)).toEqual(['img'])
})
class TestServer extends DocumentsMcpServer {
  invoke(binding: DocumentsBinding, args: Record<string, unknown>) {
    return this.callTool(binding, 'preparar_html', args)
  }
  tools() {
    return this.listTools()
  }
}
it('MCP exige ruta, campos estrictos y proyecto abierto de Code; Tareas usa su atadura', async () => {
  const server = new TestServer({ render: async () => Buffer.from('unused'), photoRegistry: registry, audit: () => undefined })
  await writeFile(join(root, 'deck.html'), '<section class="slide"><img src="imagen:p1"></section>')
  const text = (r: Awaited<ReturnType<TestServer['invoke']>>) => JSON.stringify(r)
  expect(server.tools()).toContainEqual(
    expect.objectContaining({ name: 'preparar_html', inputSchema: expect.objectContaining({ additionalProperties: false }) })
  )
  expect(text(await server.invoke({ folder: root }, { ruta: 1 }))).toContain('ruta:')
  expect(text(await server.invoke({ folder: root }, { ruta: 'deck.html', extra: true }))).toContain('extra')
  const code = { folder: '<code>', code: { roots: () => [root] } }
  expect((await server.invoke(code, { ruta: 'deck.html', carpeta: base })).isError).toBe(true)
  const result = await server.invoke({ folder: root }, { ruta: 'deck.html' })
  expect(result.isError).toBeUndefined()
  expect(text(result)).toContain('deck-autonomo.html')
  expect(await readFile(join(root, 'deck-autonomo.html'), 'utf8')).toContain('data:image/jpeg;base64,')
})

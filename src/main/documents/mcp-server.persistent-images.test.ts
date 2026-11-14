/** Follow-up documents use trusted persistent photos after rebinding/restarting; no network or Electron. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, realpath, rm, readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import JSZip from 'jszip'
import { DocumentsMcpServer, type DocumentsBinding } from './mcp-server'
import { FreeImageRegistry } from './free-image-registry'
import type { FreeImageAsset } from './free-images'
import type { ChatDocInput } from './engine'
import type { ImageMap } from './image-files'
import { renderPptx } from '../extras/render-pptx'
vi.mock('./free-images-visual', async (original) => ({
  ...(await original<typeof import('./free-images-visual')>()),
  protectFreeImagePreview: async (bytes: Buffer) => bytes
}))
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
      notices: ''
    }
  }
}

class Harness extends DocumentsMcpServer {
  invoke(binding: DocumentsBinding, name: string, args: Record<string, unknown>) {
    return this.callTool(binding, name, args)
  }
}
const text = (r: Awaited<ReturnType<Harness['invoke']>>) => (r.content[0] as { text: string }).text
// Minimal real PDF with selectable text for the document pipeline.
function pdf(content: string): Buffer {
  const stream = `BT /F1 10 Tf 30 700 Td (${content.replace(/[()\\]/g, '\\$&')}) Tj ET`
  const bodies = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`
  ]
  let out = '%PDF-1.4\n'
  const offsets = [0]
  bodies.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'))
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const start = Buffer.byteLength(out, 'latin1')
  out += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`
  return Buffer.from(out, 'latin1')
}
let base: string, root: string, store: string, server: Harness
let seen: Array<{ input: ChatDocInput; images: Buffer[] }>
let use: ReturnType<typeof vi.fn>
function restart(): Harness {
  return new Harness({
    photoRegistry: new FreeImageRegistry(store),
    freeImages: () => ({ search: vi.fn(), view: vi.fn(), use }),
    render: async (input, _title, opts: { remoteImages: false; images?: ImageMap }) => {
      seen.push({ input, images: await Promise.all([...(opts.images?.values() ?? [])].map((image) => readFile(image.file))) })
      if (input.kind === 'pptx') return renderPptx(input.data, opts.images)
      if (input.kind === 'pdf') return pdf(input.html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' '))
      if (input.kind !== 'docx') throw new Error('Unexpected kind')
      const zip = new JSZip()
      const caption = input.data.blocks
        .map((block) => (block.type === 'image' ? (block.caption ?? '') : 'text' in block ? block.text : ''))
        .join(' ')
      zip.file('word/document.xml', `<w:document><w:body><w:p><w:r><w:t>${caption}</w:t></w:r></w:p></w:body></w:document>`)
      for (const [i, bytes] of seen.at(-1)!.images.entries()) zip.file(`word/media/image${i}.jpg`, bytes)
      return zip.generateAsync({ type: 'nodebuffer' })
    },
    review: async () => ({ ok: true, items: [] }),
    audit: () => undefined
  })
}
async function prepare(id = 'photo-1') {
  const result = await server.invoke({ folder: root }, 'imagenes_usar', { id, evaluation })
  expect(result.isError, text(result)).not.toBe(true)
  return JSON.parse(text(result)) as { id: string; path: string; recoveryId: string }
}
const docx = (paths: string[], title = 'Informe') => ({
  tipo: 'docx',
  nombre: title,
  spec: { blocks: [{ type: 'paragraph', text: title }, ...paths.map((path) => ({ type: 'image', path, alt: 'Paisaje' }))] }
})
beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'lzx-persistent-')))
  root = join(base, 'task')
  store = join(base, 'private')
  await mkdir(root)
  seen = []
  use = vi.fn(async (id: string) => photo(id))
  server = restart()
})
afterEach(async () => {
  await server.stop()
  await rm(base, { recursive: true, force: true })
})

describe('procedencia persistente en seguimientos reales de herramientas', () => {
  it.each(['docx', 'pptx'] as const)('%s → PDF mantiene ambas fotos sin créditos automáticos tras servidor nuevo sin red', async (tipo) => {
    const a = await prepare('one'),
      b = await prepare('two')
    const source =
      tipo === 'docx'
        ? docx([a.path, b.path])
        : {
            tipo,
            nombre: 'Original',
            spec: {
              slides: [
                { title: 'Portada', layout: 'cover', image: { path: a.path } },
                { title: 'Paisaje', layout: 'image', image: { path: b.path } }
              ]
            }
          }
    expect((await server.invoke({ folder: root }, 'crear', source)).isError).not.toBe(true)
    await server.stop()
    server = restart()
    use.mockRejectedValue(new Error('offline'))
    const next = await server.invoke({ folder: root, session: async () => 'ses_tomorrow' }, 'crear', {
      tipo: 'pdf',
      nombre: 'Version',
      html: `<html><body><h1>Informe</h1><img src="${a.path}"><img src="${b.path}"></body></html>`
    })
    expect(next.isError, text(next)).not.toBe(true)
    const final = seen.at(-1)!
    expect(final.images).toEqual([photo('one').bytes, photo('two').bytes])
    expect(final.input.kind).toBe('pdf')
    if (final.input.kind === 'pdf') {
      expect(final.input.html.match(/data:image\//g)).toHaveLength(2)
      expect(final.input.html).not.toContain('Foto: Author')
    }
    expect(text(next)).not.toContain('Créditos de imágenes')
    expect(use).toHaveBeenCalledTimes(2)
  })

  it('PDF conserva intacto el crédito solicitado y su estilo, sin enlaces ni pie añadido', async () => {
    const a = await prepare()
    const caption = '<figcaption class="personal" style="color:red;font-size:17px">Foto: crédito solicitado</figcaption>'
    const result = await server.invoke({ folder: root }, 'crear', {
      tipo: 'pdf',
      nombre: 'Credito solicitado',
      html: `<html><body><img src="${a.path}">${caption}</body></html>`
    })
    expect(result.isError, text(result)).not.toBe(true)
    const input = seen.at(-1)!.input
    if (input.kind !== 'pdf') throw new Error('kind')
    expect(input.html).toContain(caption)
    expect(input.html.match(/Foto:/g)).toHaveLength(1)
    expect(input.html).not.toContain('<small')
    expect(input.html).not.toContain('<aside')
    expect(input.html).not.toContain('Fuente')
    expect(input.html).not.toContain('Licencia')
  })

  it('agrega otra foto, cambia portada y traduce al inglés en sesiones nuevas, sin crédito automático', async () => {
    const a = await prepare('one')
    await server.stop()
    server = restart()
    const b = await prepare('two')
    expect((await server.invoke({ folder: root }, 'crear', docx([a.path, b.path], 'Con otra foto'))).isError).not.toBe(true)
    expect(seen.at(-1)!.images).toEqual([photo('one').bytes, photo('two').bytes])
    expect(
      (
        await server.invoke({ folder: root }, 'crear', {
          tipo: 'pptx',
          nombre: 'Nueva portada',
          spec: {
            slides: [
              { title: 'Cover', layout: 'cover', image: { id: b.id } },
              { title: 'Original', layout: 'image', image: { id: a.id } }
            ]
          }
        })
      ).isError
    ).not.toBe(true)
    expect(seen.at(-1)!.images).toEqual([photo('two').bytes, photo('one').bytes])
    await server.stop()
    server = restart()
    expect((await server.invoke({ folder: root }, 'crear', docx([a.path, b.path], 'Marine conservation'))).isError).not.toBe(true)
    expect(JSON.stringify(seen.at(-1)!.input)).toContain('Marine conservation')
    expect(JSON.stringify(seen.at(-1)!.input)).not.toContain('Foto: Author')
  })

  it('retoma al día siguiente por id y ruta WSL absoluta sin confiar en el JSON de carpeta', async () => {
    const a = await prepare()
    await writeFile(join(root, 'procedencia-inventada.json'), JSON.stringify({ credit: 'CREDITO FALSO' }))
    await server.stop()
    server = restart()
    const binding = { folder: root, toAgentPath: (path: string) => path.replace(root, '/win/c/Informe') }
    expect((await server.invoke(binding, 'crear', docx([`/win/c/Informe/${a.path}`]))).isError).not.toBe(true)
    expect(JSON.stringify(seen.at(-1)!.input)).not.toContain('FALSO')
    await rm(join(root, 'procedencia-inventada.json'))
    expect(
      (await server.invoke({ folder: root }, 'crear', { tipo: 'docx', spec: { blocks: [{ type: 'image', id: a.id }] } })).isError
    ).not.toBe(true)
    expect(seen.at(-1)!.images).toEqual([photo('photo-1').bytes])
  })

  it.each(['changed', 'missing'])('foto %s se recupera en un paso offline con id persistente, sin reevaluación visual', async (mode) => {
    const a = await prepare()
    if (mode === 'changed') await writeFile(join(root, a.path), photo('different').bytes)
    else await rm(join(root, a.path))
    await server.stop()
    server = restart()
    use.mockRejectedValue(new Error('offline'))
    const rejected = await server.invoke({ folder: root }, 'crear', docx([a.path]))
    expect(rejected.isError).toBe(true)
    expect(text(rejected)).toContain(a.recoveryId)
    expect(text(rejected)).toContain('al principio')
    const result = await server.invoke({ folder: root }, 'imagenes_usar', { id: a.recoveryId })
    expect(result.isError, text(result)).not.toBe(true)
    const restored = JSON.parse(text(result))
    expect(await readFile(join(root, restored.path))).toEqual(photo('photo-1').bytes)
    expect((await server.invoke({ folder: root }, 'crear', docx([restored.path]))).isError).not.toBe(true)
    expect(use).toHaveBeenCalledTimes(1)
  })

  it('si falta la segunda foto indica su recuperación, nunca la primera que sigue intacta', async () => {
    const a = await prepare('one'),
      b = await prepare('two')
    await rm(join(root, b.path))
    await server.stop()
    server = restart()
    const rejected = await server.invoke({ folder: root }, 'crear', docx([a.path, b.path]))
    expect(rejected.isError).toBe(true)
    expect(text(rejected)).toContain(b.recoveryId)
    expect(text(rejected)).not.toContain(a.recoveryId)
    const recovered = await server.invoke({ folder: root }, 'imagenes_usar', { id: b.recoveryId })
    expect(recovered.isError).not.toBe(true)
    expect((await server.invoke({ folder: root }, 'crear', docx([a.path, JSON.parse(text(recovered)).path]))).isError).not.toBe(true)
  })

  it('JSON fabricado o hash cambiado no autoriza una imagen; recuperación no atraviesa carpetas', async () => {
    const a = await prepare()
    const other = join(base, 'other')
    await mkdir(other)
    await mkdir(join(other, 'img'))
    const fake = 'img/free-00000000000000000000.jpg'
    await writeFile(join(other, fake), photo('inventada').bytes)
    await writeFile(join(other, fake.replace('.jpg', '.json')), JSON.stringify({ credit }))
    await server.stop()
    server = restart()
    expect((await server.invoke({ folder: other }, 'crear', docx([fake]))).isError).toBe(true)
    expect((await server.invoke({ folder: other }, 'imagenes_usar', { id: a.recoveryId })).isError).toBe(true)
    expect(seen).toHaveLength(0)
  })

  it('registro interno corrupto falla cerrado', async () => {
    const a = await prepare()
    const sha = createHash('sha256').update(photo('photo-1').bytes).digest('hex')
    await writeFile(join(store, `photo-${sha}.json`), '{}')
    await server.stop()
    server = restart()
    const result = await server.invoke({ folder: root }, 'crear', docx([a.path]))
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('procedencia comprobada')
    expect(seen).toHaveLength(0)
  })

  it('el registro está fuera de la tarea y no puede autorizarse como proyecto Code', async () => {
    await prepare()
    expect(await readdir(root)).toEqual(['img'])
    const result = await server.invoke({ folder: base }, 'imagenes_usar', { id: 'photo-2', evaluation })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('registro privado')
  })
})

/** Recorrido MCP real: píxeles, autoridad por carpeta y créditos en el archivo final. Sin proveedor ni Electron reales. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, realpath, readFile, rm, writeFile, copyFile, symlink, readdir, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import JSZip from 'jszip'
import { DocumentsMcpServer, type DocumentsBinding } from './mcp-server'
import { CODE_BINDING_FOLDER } from '@shared/documents-permissions'
import type { FreeImageAsset, FreeImagesService } from './free-images'
import type { ChatDocInput } from './engine'
import { FREE_IMAGE_PREVIEW_MARKER } from './free-image-preview'
import { renderPptx } from '../extras/render-pptx'
vi.mock('./free-images-visual', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./free-images-visual')>()),
  protectFreeImagePreview: async (bytes: Buffer) =>
    Buffer.concat([bytes, Buffer.from('lazunox-free-image-preview:not-for-document-use:v1')])
}))

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH7sAAAAASUVORK5CYII=', 'base64')
const CREDIT =
  'Interior de café — Autora Ejemplo — CC BY 4.0 — https://commons.wikimedia.org/wiki/File:Cafe.jpg — https://creativecommons.org/licenses/by/4.0/ — Reducida sin recorte.'
const searchArgs = {
  queries: ['interior cafetería', 'coffee shop interior'],
  requirements: {
    subject: 'Interior de cafetería',
    required: ['mobiliario'],
    excluded: ['taza aislada'],
    usage: 'Portada',
    realPhoto: true
  }
}
const evaluation = { mode: 'visual', observed: 'Se ve mobiliario y barra.', meets: ['mobiliario'], doubts: '' }
const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
class Harness extends DocumentsMcpServer {
  invoke(binding: DocumentsBinding, tool: string, args: Record<string, unknown>) {
    return this.callTool(binding, tool, args)
  }
}
let root: string
let other: string
let server: Harness
let binding: DocumentsBinding
let count = 0
let offline = false
let loseCredits = false
let renderInputs: ChatDocInput[]
let services: Array<Pick<FreeImagesService, 'search' | 'view' | 'use'>>

function service(): Pick<FreeImagesService, 'search' | 'view' | 'use'> {
  const id = `photo-${++count}`
  const candidate = {
    id,
    title: 'Interior de café',
    author: 'Autora Ejemplo',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    source: 'https://commons.wikimedia.org/wiki/File:Cafe.jpg',
    width: 1600,
    height: 1000,
    description: 'Interior'
  }
  let seen = false
  const fake = {
    search: vi.fn(async () => {
      if (offline) throw new Error('network unavailable')
      return { searchId: `search-${id}`, round: 1, candidates: [candidate], sheet: PNG, mimeType: 'image/png' as const }
    }),
    view: vi.fn(async (ids: string[]) => {
      if (ids.some((value) => value !== id)) throw new Error('unknown id')
      seen = true
      return [{ id, image: PNG, mimeType: 'image/jpeg' as const, candidate }]
    }),
    use: vi.fn(async (chosen: string) => {
      if (!seen || chosen !== id) throw new Error('unknown or unseen id')
      return {
        bytes: PNG,
        ext: 'jpg',
        credit: CREDIT,
        provenance: { provider: 'Wikimedia Commons', evaluationStatus: 'declarada-por-el-modelo', evaluation }
      } as FreeImageAsset
    })
  }
  services.push(fake)
  return fake
}
const text = (r: Awaited<ReturnType<Harness['invoke']>>) => (r.content[0] as { text: string }).text
async function prepare(
  extra: Record<string, unknown> = {},
  owner = binding
): Promise<{ path: string; agentPath: string; provenance: string }> {
  const found = await server.invoke(owner, 'imagenes_buscar', { ...searchArgs, ...extra })
  const id = JSON.parse(text(found)).candidates[0].id
  await server.invoke(owner, 'imagenes_ver', { ids: [id], ...extra })
  return JSON.parse(text(await server.invoke(owner, 'imagenes_usar', { id, evaluation, ...extra })))
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'lzx-fotos-')))
  other = await realpath(await mkdtemp(join(tmpdir(), 'lzx-fotos-otro-')))
  binding = { folder: root }
  services = []
  renderInputs = []
  offline = false
  loseCredits = false
  server = new Harness({
    freeImages: service,
    render: async (input) => {
      renderInputs.push(input)
      const zip = new JSZip()
      const strings =
        input.kind === 'docx' ? input.data.blocks.map((b) => ('text' in b ? b.text : b.type === 'image' ? b.caption : '')).join(' ') : ''
      zip.file(
        'word/document.xml',
        `<w:document><w:body><w:p><w:r><w:t>${xmlEscape(loseCredits ? 'Sin crédito' : strings)}</w:t></w:r></w:p></w:body></w:document>`
      )
      zip.file('word/media/photo.jpg', PNG)
      return zip.generateAsync({ type: 'nodebuffer' })
    },
    review: async () => ({ ok: true, items: [] }),
    audit: () => undefined
  })
})
afterEach(async () => {
  await server.stop()
  await rm(root, { recursive: true, force: true })
  await rm(other, { recursive: true, force: true })
})

describe('fotos libres por MCP', () => {
  it('usa atribución comprobada de main para el pie breve bajo la foto y conserva la ficha completa', async () => {
    const found = await server.invoke(binding, 'imagenes_buscar', searchArgs)
    const id = JSON.parse(text(found)).candidates[0].id
    await server.invoke(binding, 'imagenes_ver', { ids: [id] })
    const originalUse = services[0].use
    services[0].use = async (...args) => {
      const asset = await originalUse(...args)
      return {
        ...asset,
        provenance: {
          ...asset.provenance,
          author: 'Autora Ejemplo',
          license: 'CC BY 4.0',
          source: 'https://commons.wikimedia.org/wiki/File:Cafe.jpg',
          licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
          notices: '',
          transformations: ['Conversión a JPEG sobre fondo blanco y reducción de tamaño si era necesaria; imagen completa, sin recorte.']
        }
      }
    }
    const prepared = await server.invoke(binding, 'imagenes_usar', { id, evaluation })
    expect(prepared.isError).not.toBe(true)
    const saved = JSON.parse(text(prepared))
    expect(saved.caption).toBe('Foto: Autora Ejemplo · CC BY 4.0 · Wikimedia Commons · ajustada')
    expect(saved.credit).toBe(CREDIT)
    expect(JSON.parse(await readFile(join(root, saved.provenance), 'utf8')).credit).toBe(CREDIT)
    const created = await server.invoke(binding, 'crear', {
      tipo: 'docx',
      nombre: 'Pie-breve',
      spec: { blocks: [{ type: 'image', path: saved.path, caption: 'Interior de cafetería' }] }
    })
    expect(created.isError).not.toBe(true)
    const input = renderInputs.at(-1)!
    if (input.kind !== 'docx') throw new Error('kind')
    expect(input.data.blocks).toHaveLength(1)
    expect(input.data.blocks[0]).toMatchObject({ type: 'image', caption: expect.stringContaining(saved.caption) })
  })

  it('la búsqueda indica la llamada siguiente y ver devuelve el paso de usar sin inventar evaluación', async () => {
    const found = await server.invoke(binding, 'imagenes_buscar', searchArgs)
    const payload = JSON.parse(text(found))
    expect(payload.selection).toContain('imagenes_buscar → imagenes_ver → imagenes_usar')
    expect(payload.selection).toContain('todavía no llames a imagenes_usar')
    expect(payload.selection).toContain('marcas de agua')
    expect(payload.nextStep.tool).toBe('imagenes_ver')
    expect(payload.nextStep.chooseIds).toBe(true)
    const viewed = await server.invoke(binding, payload.nextStep.tool, payload.nextStep.arguments)
    expect(viewed.isError).not.toBe(true)
    const enlarged = JSON.parse(text(viewed))
    expect(enlarged.nextStep).toEqual({
      tool: 'imagenes_usar',
      ids: [payload.candidates[0].id],
      evaluationRequired: ['mode', 'observed', 'meets', 'doubts']
    })
    expect(enlarged.notice).toContain('foto original')
    expect(enlarged.notice).toContain('añadida por la app')
    expect((await server.invoke(binding, enlarged.nextStep.tool, { id: enlarged.nextStep.ids[0], evaluation })).isError).not.toBe(true)
  })

  it('rechaza la copia renombrada de tool-output cuando usar falla, antes de renderizar', async () => {
    const found = await server.invoke(binding, 'imagenes_buscar', searchArgs)
    const id = JSON.parse(text(found)).candidates[0].id
    const viewed = await server.invoke(binding, 'imagenes_ver', { ids: [id] })
    services[0].use = vi.fn(async () => {
      throw new Error('provider unavailable')
    })
    const failed = await server.invoke(binding, 'imagenes_usar', { id, evaluation })
    expect(failed.isError).toBe(true)
    expect(text(failed)).toContain('No uses otra vía')
    const image = viewed.content[1] as { data: string }
    await mkdir(join(root, '.lazunox/trabajo/img'), { recursive: true })
    await writeFile(join(root, '.lazunox/trabajo/img/colibri.jpg'), Buffer.from(image.data, 'base64'))
    const result = await server.invoke(binding, 'crear', {
      tipo: 'pptx',
      nombre: 'Colibries',
      spec: {
        slides: [{ layout: 'cover', title: 'Colibríes', image: { path: '.lazunox/trabajo/img/colibri.jpg' }, speaker_notes: CREDIT }]
      }
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('vista previa')
    expect(renderInputs).toHaveLength(0)
    expect(await readdir(root)).not.toContain('Colibries.pptx')
    for (const html of [
      `<img src="data:image/jpeg;base64,${image.data}">`,
      `<img src="data:application/octet-stream;base64,${image.data}">`,
      `<img src="data:;base64,${image.data}">`,
      `<img src="data:image/jpeg,${[...Buffer.from(image.data, 'base64')].map((byte) => `%${byte.toString(16).padStart(2, '0')}`).join('')}">`,
      `<img src="data&#58;image/jpeg;base64,${image.data}">`,
      `<img src="data&colon;image/jpeg;charset=utf-8;base64,${encodeURIComponent(image.data)}">`,
      `<div style="background-image:url('data\\3a image/jpeg;base64,${image.data}')">Colibrí</div>`,
      `<div style="background-image:url('data:image/jpeg;base64,${image.data}')">Colibrí</div>`
    ]) {
      const inline = await server.invoke(binding, 'crear', { tipo: 'pdf', nombre: 'Copia-inline', html })
      expect(inline.isError).toBe(true)
      expect(text(inline)).toContain('vista previa sin procedencia')
    }
    expect(renderInputs).toHaveLength(0)
  })

  it('rechaza free-* bajo cualquier carpeta y rutas de caché sin procedencia de main', async () => {
    for (const path of ['img/free-falsa.jpg', '.lazunox/trabajo/img/free-falsa.jpg', 'tool-output/falsa.jpg', '.cache/falsa.jpg']) {
      await mkdir(join(root, path, '..'), { recursive: true })
      await writeFile(join(root, path), PNG)
      const result = await server.invoke(binding, 'crear', { tipo: 'docx', spec: { blocks: [{ type: 'image', path }] } })
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('procedencia comprobada')
    }
    expect(renderInputs).toHaveLength(0)
  })

  it('PPTX incorpora crédito visible aunque el modelo lo pusiera solo en las notas; rechaza motor que solo conserva notas', async () => {
    await server.stop()
    let notesOnly = false
    server = new Harness({
      freeImages: service,
      render: async (input, _title, options) => {
        if (input.kind !== 'pptx') throw new Error('kind')
        if (!notesOnly) return renderPptx(input.data, options?.images)
        const zip = new JSZip()
        zip.file('ppt/slides/slide1.xml', '<p:sld><a:t>Colibríes</a:t></p:sld>')
        zip.file('ppt/notesSlides/notesSlide1.xml', `<a:t>${xmlEscape(CREDIT)}</a:t>`)
        return zip.generateAsync({ type: 'nodebuffer' })
      },
      review: async () => ({ ok: true, items: [] }),
      audit: () => undefined
    })
    const saved = await prepare()
    const args = {
      tipo: 'pptx',
      nombre: 'Credito-visible',
      spec: { slides: [{ title: 'Colibríes', layout: 'cover', image: { path: saved.path }, speaker_notes: CREDIT }] }
    }
    const result = await server.invoke(binding, 'crear', args)
    expect(result.isError).not.toBe(true)
    const zip = await JSZip.loadAsync(await readFile(join(root, 'Credito-visible.pptx')))
    expect(await zip.file('ppt/slides/slide1.xml')!.async('string')).toContain('CC BY 4.0')
    expect(zip.file('ppt/slides/slide2.xml')).toBeNull()
    expect(text(result)).toContain('Créditos de imágenes: ✔')
    notesOnly = true
    const failed = await server.invoke(binding, 'crear', { ...args, nombre: 'Solo-notas' })
    expect(failed.isError).toBe(true)
    expect(text(failed)).toContain('No se guardó')
    expect(await readdir(root)).not.toContain('Solo-notas.pptx')
  })

  it('entrega la hoja y ampliación como bloques image por JSON-RPC, no solo URLs', async () => {
    const { token, port } = await server.clientFor(binding)
    const url = `http://127.0.0.1:${port}/mcp`
    const rpc = async (name: string, args: object) =>
      (
        await (
          await fetch(url, {
            method: 'POST',
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
          })
        ).json()
      ).result
    const found = await rpc('imagenes_buscar', searchArgs)
    expect(found.content[1]).toEqual({
      type: 'image',
      data: Buffer.concat([PNG, Buffer.from(FREE_IMAGE_PREVIEW_MARKER)]).toString('base64'),
      mimeType: 'image/jpeg'
    })
    const id = JSON.parse(found.content[0].text).candidates[0].id
    const views = await rpc('imagenes_ver', { ids: [id] })
    expect(views.content[1].type).toBe('image')
    expect(Buffer.from(views.content[1].data, 'base64')).toEqual(Buffer.concat([PNG, Buffer.from(FREE_IMAGE_PREVIEW_MARKER)]))
    expect(views.content[0].text).toContain('MUESTRA NO USAR')
    expect(views.content[0].text).toContain('evaluación visual aún no declarada')
  })

  it('ids aislados por atadura y por carpeta vigente de Code; sin URLs arbitrarias', async () => {
    const found = await server.invoke(binding, 'imagenes_buscar', searchArgs)
    const id = JSON.parse(text(found)).candidates[0].id
    expect((await server.invoke({ folder: other }, 'imagenes_ver', { ids: [id] })).isError).toBe(true)
    expect((await server.invoke(binding, 'imagenes_buscar', { ...searchArgs, url: 'https://evil.test' })).isError).toBe(true)
    expect((await server.invoke(binding, 'imagenes_ver', { ids: ['https://evil.test'] })).isError).toBe(true)
    const roots = [root, other]
    const code = { folder: CODE_BINDING_FOLDER, code: { roots: () => roots } }
    const results = await server.invoke(code, 'imagenes_buscar', { ...searchArgs, carpeta: root })
    const codeId = JSON.parse(text(results)).candidates[0].id
    expect((await server.invoke(code, 'imagenes_ver', { ids: [codeId], carpeta: other })).isError).toBe(true)
    roots.splice(0, 1)
    expect((await server.invoke(code, 'imagenes_ver', { ids: [codeId], carpeta: root })).isError).toBe(true)
  })

  it('guarda foto y JSON en carpeta segura; ruta traducida WSL y crédito automático verificable', async () => {
    binding.toAgentPath = (host) => host.replace(root, '/win/c/Mis fotos')
    const saved = await prepare()
    expect(saved.agentPath).toBe(`/win/c/Mis fotos/${saved.path}`)
    expect(await readFile(join(root, saved.path))).toEqual(PNG)
    const provenance = JSON.parse(await readFile(join(root, saved.provenance), 'utf8'))
    expect(provenance.credit).toBe(CREDIT)
    expect(provenance.evaluationStatus).toBe('declarada-por-el-modelo')
    expect(provenance.stage).toBe('preparada')
    const result = await server.invoke(binding, 'crear', {
      tipo: 'docx',
      nombre: 'Informe',
      spec: { blocks: [{ type: 'image', path: saved.path, alt: 'Interior', caption: 'Cafetería' }] }
    })
    expect(result.isError).not.toBe(true)
    expect(text(result)).toContain('Créditos de imágenes: ✔')
    const bytes = await readFile(join(root, 'Informe.docx'))
    const zip = await JSZip.loadAsync(bytes)
    expect(await zip.file('word/document.xml')!.async('string')).toContain(CREDIT)
    const usagePath = (await readdir(root)).find((name) => name.startsWith('Informe-imagenes-'))!
    const usage = JSON.parse(await readFile(join(root, usagePath), 'utf8'))
    expect(usage.stage).toBe('documento-creado-con-referencias')
    expect(usage.insertionVerification).toContain('presencia-visual-pendiente')
    expect(usage.images[0].file).toBe(saved.path)
    expect(usage.visualReview).toBe('pendiente-del-modelo')
  })

  it('crédito sobre copias por hash, JSON no es autoridad y modificación de foto rechazada', async () => {
    const saved = await prepare()
    await copyFile(join(root, saved.path), join(root, 'copia.jpg'))
    const manifest = await readFile(join(root, saved.provenance))
    const args = { tipo: 'docx', nombre: 'Copia', spec: { blocks: [{ type: 'image', path: 'copia.jpg' }] } }
    expect((await server.invoke(binding, 'crear', args)).isError).not.toBe(true)
    expect(JSON.stringify(renderInputs.at(-1))).toContain(CREDIT)
    await writeFile(join(root, saved.provenance), JSON.stringify({ credit: 'Crédito inventado' }))
    expect((await server.invoke(binding, 'crear', args)).isError).toBe(true)
    expect(JSON.stringify(renderInputs.at(-1))).not.toContain('Crédito inventado')
    await rm(join(root, saved.provenance))
    const missing = await server.invoke(binding, 'crear', args)
    expect(missing.isError).toBe(true)
    expect(text(missing)).toContain('JSON de procedencia')
    await writeFile(join(root, saved.provenance), manifest)
    await writeFile(join(root, saved.path), Buffer.concat([PNG, Buffer.from('changed')]))
    expect((await server.invoke(binding, 'crear', { ...args, spec: { blocks: [{ type: 'image', path: saved.path }] } })).isError).toBe(true)
  })

  it('no entrega documento cuyo motor omite los créditos', async () => {
    const saved = await prepare()
    loseCredits = true
    const result = await server.invoke(binding, 'crear', {
      tipo: 'docx',
      nombre: 'Sincredito',
      spec: { blocks: [{ type: 'image', path: saved.path }] }
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('No se guardó')
    expect(await readdir(root)).not.toContain('Sincredito.docx')
  })

  it('sin red continúa documento sin fotos; impide escritura por enlace en img', async () => {
    offline = true
    expect((await server.invoke(binding, 'imagenes_buscar', searchArgs)).isError).toBe(true)
    expect(
      (
        await server.invoke(binding, 'crear', {
          tipo: 'docx',
          spec: { blocks: [{ type: 'paragraph', text: 'Sin fotos por fallo de red.' }] }
        })
      ).isError
    ).not.toBe(true)
    offline = false
    await symlink(other, join(root, 'img'), 'dir')
    const found = JSON.parse(text(await server.invoke(binding, 'imagenes_buscar', searchArgs)))
    const id = found.candidates[0].id
    await server.invoke(binding, 'imagenes_ver', { ids: [id] })
    expect((await server.invoke(binding, 'imagenes_usar', { id, evaluation })).isError).toBe(true)
    expect(await readdir(other)).toEqual([])
  })
})

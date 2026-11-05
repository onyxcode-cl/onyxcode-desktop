/** `crear` con imágenes de la carpeta de la tarea: ruta segura, copia temporal propia, limpieza y rechazo del documento entero ante una ruta mala. */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DocumentsMcpServer } from './mcp-server'
import type { ChatDocInput } from './engine'
import type { ImageMap } from './image-files'
import { setPrivateTmpBase } from '../office/craft/private-tmp'

let folder: string
let tmpBase: string
let server: DocumentsMcpServer
let seen: Array<{ input: ChatDocInput; images?: ImageMap; existed: boolean[] }>

const PNG = ((): Buffer => {
  const b = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0)
  b.writeUInt32BE(13, 8)
  b.write('IHDR', 12, 'latin1')
  b.writeUInt32BE(4, 16)
  b.writeUInt32BE(3, 20)
  return b
})()

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'lzx-mcpimg-'))
  tmpBase = mkdtempSync(join(tmpdir(), 'lzx-mcpimg-tmp-'))
  setPrivateTmpBase(tmpBase)
  mkdirSync(join(folder, 'img'))
  writeFileSync(join(folder, 'img', 'logo.png'), PNG)
  seen = []
  server = new DocumentsMcpServer({
    render: async (input, _title, opts) => {
      seen.push({ input, images: opts.images, existed: [...(opts.images?.values() ?? [])].map((i) => existsSync(i.file)) })
      return Buffer.from('ARCHIVO')
    },
    audit: () => undefined
  })
})
afterEach(async () => {
  await server.stop()
  setPrivateTmpBase(null)
  rmSync(folder, { recursive: true, force: true })
  rmSync(tmpBase, { recursive: true, force: true })
})

function call(port: number, token: string, args: Record<string, unknown>): Promise<{ isError?: boolean; text: string }> {
  const payload = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'crear', arguments: args } })
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path: '/mcp',
        method: 'POST',
        agent: false,
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), authorization: `Bearer ${token}` }
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          const r = JSON.parse(Buffer.concat(chunks).toString('utf8')).result
          resolve({ isError: r.isError, text: r.content[0].text })
        })
      }
    )
    req.on('error', reject)
    req.end(payload)
  })
}

const DOCX = (path: string) => ({
  blocks: [
    { type: 'paragraph', text: 'Hola' },
    { type: 'image', path, alt: 'Logo' }
  ]
})
const PPTX = (path: string) => ({
  slides: [
    { title: 'Portada', bullets: ['x'] },
    { title: 'Logo', layout: 'image', image: { path, alt: 'Logo' } }
  ]
})

describe('crear con imágenes', () => {
  it('Word: la imagen se valida, ArtCraft recibe una copia temporal propia y después se borra', async () => {
    const { token, port } = await server.clientFor({ folder })
    const r = await call(port, token, { tipo: 'docx', nombre: 'Con imagen', spec: DOCX('img/logo.png') })
    expect(r.isError).toBeUndefined()
    expect(seen).toHaveLength(1)
    const img = seen[0].images!.get('img/logo.png')!
    expect(img).toMatchObject({ kind: 'png', width: 4, height: 3 })
    expect(img.file.startsWith(tmpBase)).toBe(true)
    expect(seen[0].existed).toEqual([true]) // existía MIENTRAS se armaba el documento
    expect(existsSync(img.file)).toBe(false) // y ya no
    expect(readdirSync(tmpBase)).toEqual([])
  })

  it('PowerPoint: lo mismo con la lámina de imagen', async () => {
    const { token, port } = await server.clientFor({ folder })
    const r = await call(port, token, { tipo: 'pptx', nombre: 'Deck', spec: PPTX('img/logo.png') })
    expect(r.isError).toBeUndefined()
    expect(seen[0].images!.size).toBe(1)
    expect(readdirSync(tmpBase)).toEqual([])
  })

  it('sin imágenes en el spec no se crea ningún temporal ni se pasa el mapa', async () => {
    const { token, port } = await server.clientFor({ folder })
    await call(port, token, { tipo: 'docx', nombre: 'Sin', spec: { blocks: [{ type: 'paragraph', text: 'Hola' }] } })
    expect(seen[0].images).toBeUndefined()
  })

  it.each([
    ['ruta con ..', '../fuera.png', /schema|esquema|nada/i],
    ['URL remota', 'https://evil.example/x.png', /esquema/i],
    ['ruta absoluta', '/etc/hosts', /esquema/i],
    ['no existe', 'img/no-esta.png', /No se encuentra/]
  ])('rechaza el documento entero: %s (y no llega a armarse)', async (_n, path, msg) => {
    const { token, port } = await server.clientFor({ folder })
    const r = await call(port, token, { tipo: 'docx', nombre: 'Malo', spec: DOCX(path) })
    expect(r.isError).toBe(true)
    expect(r.text).toMatch(msg)
    expect(seen).toHaveLength(0)
    expect(existsSync(join(folder, 'Malo.docx'))).toBe(false)
    expect(readdirSync(tmpBase)).toEqual([])
  })

  it('un archivo que no es imagen o un enlace simbólico se rechazan', async () => {
    writeFileSync(join(folder, 'img', 'falsa.png'), Buffer.from('%PDF-1.7 nada de imagen'))
    const outside = mkdtempSync(join(tmpdir(), 'lzx-mcpimg-out-'))
    try {
      writeFileSync(join(outside, 'x.png'), PNG)
      symlinkSync(join(outside, 'x.png'), join(folder, 'img', 'enlace.png'))
      const { token, port } = await server.clientFor({ folder })
      const a = await call(port, token, { tipo: 'pptx', nombre: 'A', spec: PPTX('img/falsa.png') })
      expect(a.isError).toBe(true)
      expect(a.text).toMatch(/no es una imagen/)
      const b = await call(port, token, { tipo: 'docx', nombre: 'B', spec: DOCX('img/enlace.png') })
      expect(b.isError).toBe(true)
      expect(b.text).toMatch(/enlace/)
      expect(seen).toHaveLength(0)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })
})

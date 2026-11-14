import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DocumentsMcpServer, type DocumentsBinding } from './mcp-server'

class Harness extends DocumentsMcpServer {
  invoke(binding: DocumentsBinding, args: Record<string, unknown>) {
    return this.callTool(binding, 'crear', args)
  }
}
// PDF pequeño válido: catálogo, árbol, páginas, tabla xref. El comentario confunde el contador regex antiguo.
const pdf = (pages: number) => {
  const bodies = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${i + 3} 0 R`).join(' ')}] /Count ${pages} >>`,
    ...Array.from({ length: pages }, () => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> >>')
  ]
  let result = '%PDF-1.4\n% /Type /Pages /Count 99\n'
  const offsets = [0]
  bodies.forEach((body, i) => {
    offsets.push(Buffer.byteLength(result))
    result += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = Buffer.byteLength(result)
  result += `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')}trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(result)
}

const args = { tipo: 'pdf', nombre: 'Folleto', html: '<html lang="es"><body><h1>Folleto</h1></body></html>', paginas_objetivo: 1 }
let root: string, server: Harness, binding: DocumentsBinding, bytes: Buffer
const render = vi.fn(async () => bytes)
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'lzx-pagination-')))
  binding = { folder: root, session: async () => 'ses_test' }
  bytes = pdf(2)
  render.mockClear()
  server = new Harness({
    render,
    preview: async () => ({ pages: 2, images: [Buffer.from('preview')], truncated: false }),
    review: async () => ({ ok: true, items: [] }),
    audit: () => undefined
  })
})
afterEach(async () => {
  await server.stop()
  await rm(root, { recursive: true, force: true })
})
const text = (result: Awaited<ReturnType<Harness['invoke']>>) => (result.content[0] as { text: string }).text

describe('PDF: el intento fuera de paginas_objetivo no queda como entregable', () => {
  it('devuelve imágenes de borrador y error; una corrección deja un solo PDF', async () => {
    const rejected = await server.invoke(binding, args)
    expect(rejected.isError).toBe(true)
    expect(text(rejected)).toContain('tiene 2 página(s)')
    expect(text(rejected)).toContain('no extraigas ni borres páginas')
    expect(rejected.content.some((item) => item.type === 'image')).toBe(true)
    expect(await readdir(root)).toEqual([])
    bytes = pdf(1)
    const accepted = await server.invoke(binding, args)
    expect(accepted.isError).not.toBe(true)
    expect(await readdir(root)).toEqual(['Folleto.pdf'])
    expect(await readFile(join(root, 'Folleto.pdf'))).toEqual(pdf(1))
  })
  it('conserva una versión correcta si la siguiente revisión excede el encargo', async () => {
    bytes = pdf(1)
    await server.invoke(binding, args)
    bytes = pdf(2)
    expect((await server.invoke(binding, args)).isError).toBe(true)
    expect(await readdir(root)).toEqual(['Folleto.pdf'])
    expect(await readFile(join(root, 'Folleto.pdf'))).toEqual(pdf(1))
  })
  it('acepta rangos inclusivos y rechaza también faltar páginas', async () => {
    expect((await server.invoke(binding, { ...args, paginas_objetivo: '2-3' })).isError).not.toBe(true)
    expect((await server.invoke(binding, { ...args, nombre: 'Otro', paginas_objetivo: '3–4' })).isError).toBe(true)
    expect(await readdir(root)).toEqual(['Folleto.pdf'])
  })
  it.each([0, '3-2', 'una', '1.5'])('rechaza objetivo inválido %s sin guardar', async (target) => {
    const rejected = await server.invoke(binding, { ...args, paginas_objetivo: target })
    expect(rejected.isError).toBe(true)
    expect(text(rejected)).toContain('paginas_objetivo debe ser')
    expect(render).not.toHaveBeenCalled()
    expect(await readdir(root)).toEqual([])
  })
  it('no confunde un conteo desconocido con un PDF de una página', async () => {
    bytes = Buffer.from('%PDF-sin-conteo')
    const rejected = await server.invoke(binding, args)
    expect(rejected.isError).toBe(true)
    expect(text(rejected)).toContain('no se pudo comprobar')
    expect(await readdir(root)).toEqual([])
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DocumentsMcpServer, type DocumentsBinding } from './mcp-server'
import { CODE_BINDING_FOLDER } from '@shared/documents-permissions'

class Harness extends DocumentsMcpServer {
  invoke(binding: DocumentsBinding, args: Record<string, unknown>, signal?: AbortSignal) {
    return this.callTool(binding, 'exportar_pdf', args, signal)
  }
  tools() {
    return this.listTools()
  }
}
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

let root: string, server: Harness, binding: DocumentsBinding
const original = Buffer.from('PK\x03\x04Original con fotos y créditos incrustados')
const convert = vi.fn(async (_tipo: 'docx' | 'pptx', _bytes: Buffer) => pdf(2))
const render = vi.fn(async () => Buffer.from('no debe recrearse'))
const preview = vi.fn(async () => ({ pages: 2, images: [Buffer.from('vista1'), Buffer.from('vista2')], truncated: false }))
const text = (result: Awaited<ReturnType<Harness['invoke']>>) => (result.content[0] as { text: string }).text
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'lzx-export-mcp-')))
  binding = { folder: root, session: async () => 'ses_test' }
  convert.mockReset().mockImplementation(async () => pdf(2))
  render.mockClear()
  preview.mockClear()
  await writeFile(join(root, 'Informe.docx'), original)
  server = new Harness({ render, exportPdf: convert, preview, audit: () => undefined, renderTimeoutMs: 1000 })
})
afterEach(async () => {
  await server.stop()
  await rm(root, { recursive: true, force: true })
})

describe('exportar_pdf conserva el original en seguimientos', () => {
  it.each(['docx', 'pptx'] as const)('%s → PDF pasa exactamente el archivo al motor y entrega vistas', async (tipo) => {
    await writeFile(join(root, `Original.${tipo}`), original)
    const result = await server.invoke({ folder: root }, { ruta: `Original.${tipo}`, paginas_objetivo: 2 })
    expect(result.isError).toBeUndefined()
    expect(convert).toHaveBeenCalledWith(tipo, original)
    expect(render).not.toHaveBeenCalled()
    expect(await readFile(join(root, 'Original.pdf'))).toEqual(pdf(2))
    expect(await readFile(join(root, `Original.${tipo}`))).toEqual(original)
    expect(result.content.filter((block) => block.type === 'image')).toHaveLength(2)
  })
  it('expone la herramienta solo si tiene conversor', () => {
    expect(server.tools()).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'exportar_pdf' })]))
    expect(new Harness({ render }).tools()).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: 'exportar_pdf' })]))
  })
  it('acepta nueva sesión y ruta traducida WSL', async () => {
    binding = { folder: root, toAgentPath: (path) => path.replace(root, '/win/c/Tarea') }
    const result = await server.invoke(binding, { ruta: '/win/c/Tarea/Informe.docx' })
    expect(result.isError).toBeUndefined()
    expect(text(result)).toContain('/win/c/Tarea/Informe.pdf')
  })
  it('Code exige proyecto abierto antes de leer o convertir', async () => {
    binding = { folder: CODE_BINDING_FOLDER, code: { roots: () => [root] } }
    expect((await server.invoke(binding, { ruta: 'Informe.docx' })).isError).toBe(true)
    expect(convert).not.toHaveBeenCalled()
    expect((await server.invoke(binding, { ruta: 'Informe.docx', carpeta: root })).isError).toBeUndefined()
  })
  it('repetir en la misma sesión sustituye solo el PDF propio intacto', async () => {
    await server.invoke(binding, { ruta: 'Informe.docx' })
    await server.invoke(binding, { ruta: 'Informe.docx' })
    expect((await readdir(root)).filter((name) => name.endsWith('.pdf'))).toEqual(['Informe.pdf'])
    await writeFile(join(root, 'Informe.pdf'), 'edición del usuario')
    await server.invoke(binding, { ruta: 'Informe.docx' })
    expect(await readFile(join(root, 'Informe.pdf'), 'utf8')).toBe('edición del usuario')
    expect((await readdir(root)).filter((name) => name.endsWith('.pdf'))).toHaveLength(2)
  })
  it.each(['../Informe.docx', '/etc/passwd', 'https://example.org/a.docx'])('rechaza ruta no autorizada %s', async (ruta) => {
    expect((await server.invoke(binding, { ruta })).isError).toBe(true)
    expect(convert).not.toHaveBeenCalled()
  })
  it('rechaza enlace aunque apunte dentro de la tarea', async () => {
    await symlink(join(root, 'Informe.docx'), join(root, 'Enlace.docx'))
    expect((await server.invoke(binding, { ruta: 'Enlace.docx' })).isError).toBe(true)
    expect(convert).not.toHaveBeenCalled()
  })
  it.each(['motor', 'pdf-invalido', 'paginas', 'sin-motor', 'cancelada'] as const)('no entrega un PDF parcial: %s', async (failure) => {
    if (failure === 'motor') convert.mockRejectedValue(new Error('motor falló'))
    if (failure === 'sin-motor') convert.mockRejectedValue(Object.assign(new Error('falta motor'), { code: 'no-craft' }))
    if (failure === 'pdf-invalido') convert.mockResolvedValue(Buffer.from('no PDF'))
    const result = await server.invoke(
      binding,
      { ruta: 'Informe.docx', ...(failure === 'paginas' ? { paginas_objetivo: 1 } : {}) },
      failure === 'cancelada' ? AbortSignal.abort() : undefined
    )
    expect(result.isError).toBe(true)
    expect((await readdir(root)).filter((name) => name.endsWith('.pdf'))).toEqual([])
    expect(render).not.toHaveBeenCalled()
  })
  it('cancelar durante la conversión no publica un archivo', async () => {
    const controller = new AbortController()
    convert.mockImplementation(async () => {
      controller.abort()
      return pdf(2)
    })
    expect((await server.invoke(binding, { ruta: 'Informe.docx' }, controller.signal)).isError).toBe(true)
    expect(await readdir(root)).toEqual(['Informe.docx'])
  })
})

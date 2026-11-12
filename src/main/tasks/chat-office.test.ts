import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { OFFICE_MAX_BYTES } from '@shared/attach-office'
import { prepareChatOffice } from './chat-office'
import { safeWriteOps } from './safe-write'

const roots: string[] = []
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})
async function office(ext: string, padding = 0): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<Types/>')
  zip.file({ docx: 'word/document.xml', xlsx: 'xl/workbook.xml', pptx: 'ppt/presentation.xml' }[ext]!, '<document/>')
  if (padding) zip.file('padding', Buffer.alloc(padding))
  return zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' })
}
function manager() {
  const root = mkdtempSync(join(tmpdir(), 'chat-office-'))
  roots.push(root)
  let n = 0
  const createChatFolder = vi.fn(async () => {
    const path = join(root, `Tarea ñ ${++n}`)
    mkdirSync(path)
    return { path, name: 'Tarea', approvedAt: 1 }
  })
  return { createChatFolder, assertInsideApproved: vi.fn((p: string) => p) }
}
const hash = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

describe('copias originales del Chat a una carpeta nueva', () => {
  it.each(['docx', 'xlsx', 'pptx'])('%s: conserva bytes/hash y crea una carpeta distinta en cada pedido', async (ext) => {
    const bytes = await office(ext),
      originalHash = hash(bytes),
      tasks = manager()
    const req = { files: [{ name: `Archivo ñ.${ext}`, base64: bytes.toString('base64') }] }
    const a = await prepareChatOffice(req, tasks),
      b = await prepareChatOffice(req, tasks)
    expect(a.folder.path).not.toBe(b.folder.path)
    for (const result of [a, b]) {
      expect(result.files[0].relPath).toBe(`Archivo ñ.${ext}`)
      expect(readFileSync(result.files[0].path)).toEqual(bytes)
      expect(hash(readFileSync(result.files[0].path))).toBe(originalHash)
    }
    expect(hash(bytes)).toBe(originalHash)
  })
  it('usa nombres portátiles y nunca sobrescribe archivos con el mismo nombre (también camino de escritura Windows)', async () => {
    vi.spyOn(safeWriteOps, 'isWindows').mockReturnValue(true)
    const bytes = await office('docx'),
      tasks = manager()
    const files = ['CON.docx', 'CON.docx', 'informe:final?.docx'].map((name) => ({ name, base64: bytes.toString('base64') }))
    const result = await prepareChatOffice({ files }, tasks)
    expect(result.files.map((f) => f.relPath)).toEqual(['_CON.docx', '_CON-1.docx', 'informe_final_.docx'])
    for (const file of result.files) expect(readFileSync(file.path)).toEqual(bytes)
  })
  it('rechaza extensiones, rutas, NUL, base64 inválido/no canónico, firma falsa y ZIP de otra familia ANTES de crear carpeta', async () => {
    const base64 = (await office('docx')).toString('base64'),
      tasks = manager()
    const invalid = [
      { name: 'x.docm', base64 },
      { name: '../x.docx', base64 },
      { name: 'C:\\x.docx', base64 },
      { name: 'a\0.docx', base64 },
      { name: 'x.docx', base64: '!###' },
      { name: 'x.docx', base64: 'UEsDBB==' },
      { name: 'x.docx', base64: Buffer.from('%PDF-texto').toString('base64') },
      { name: 'x.docx', base64: Buffer.from('PK\x03\x04basura').toString('base64') },
      { name: 'x.xlsx', base64 },
      { name: 'x.docx', base64: Buffer.alloc(OFFICE_MAX_BYTES + 1).toString('base64') }
    ]
    for (const file of invalid) await expect(prepareChatOffice({ files: [file] }, tasks)).rejects.toThrow()
    await expect(prepareChatOffice({ files: [] }, tasks)).rejects.toThrow()
    await expect(prepareChatOffice({ files: Array(6).fill({ name: 'x.docx', base64 }) }, tasks)).rejects.toThrow()
    expect(tasks.createChatFolder).not.toHaveBeenCalled()
  })
  it('aplica el tope total del Chat al lote sin crear carpeta y acepta hasta 10 MB por archivo', async () => {
    const overhead = (await office('xlsx', 1)).length - 1
    const bytes = await office('xlsx', OFFICE_MAX_BYTES - overhead),
      tasks = manager()
    expect(bytes.length).toBe(OFFICE_MAX_BYTES)
    const file = { name: 'a.xlsx', base64: bytes.toString('base64') }
    await expect(prepareChatOffice({ files: [file, file] }, tasks)).rejects.toThrow()
    expect(tasks.createChatFolder).not.toHaveBeenCalled()
    const result = await prepareChatOffice({ files: [file] }, tasks)
    expect(result.files[0].size).toBe(bytes.length)
  })
  it('propaga fallos de política y escritura sin anunciar una copia', async () => {
    const file = { name: 'x.pptx', base64: (await office('pptx')).toString('base64') },
      tasks = manager()
    tasks.createChatFolder.mockRejectedValueOnce(new Error('política'))
    await expect(prepareChatOffice({ files: [file] }, tasks)).rejects.toThrow('política')
    tasks.assertInsideApproved.mockImplementationOnce(() => {
      throw new Error('carpeta inválida')
    })
    await expect(prepareChatOffice({ files: [file] }, tasks)).rejects.toThrow('carpeta inválida')
    vi.spyOn(safeWriteOps, 'link').mockImplementation(() => {
      throw new Error('copia fallida')
    })
    await expect(prepareChatOffice({ files: [file] }, tasks)).rejects.toThrow('copia fallida')
  })
})

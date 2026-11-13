import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatDocInput } from '../documents/engine'

const mock = vi.hoisted(() => ({
  temp: '',
  render: vi.fn(),
  save: vi.fn(),
  pdf: vi.fn(),
  craft: vi.fn()
}))
vi.mock('electron', () => ({ app: { getPath: () => mock.temp }, dialog: { showSaveDialog: mock.save } }))
vi.mock('./artifact-window', () => ({ safeDocumentName: (name: string) => name }))
vi.mock('../documents/engine', () => ({
  DOC_EXT: { pdf: 'pdf', docx: 'docx', xlsx: 'xlsx', pptx: 'pptx' },
  renderBytes: mock.render,
  craftBinary: mock.craft,
  ChatDocError: class extends Error {}
}))
vi.mock('../office/craft/chat-word', () => ({ docxToPdf: mock.pdf }))
vi.mock('../office/craft/chat-grid', () => ({ gridToPdf: mock.pdf }))
vi.mock('../office/craft/chat-deck', () => ({ deckToPdf: mock.pdf }))
vi.mock('../viewer/scheme', () => ({ registerViewerPathValidator: vi.fn() }))

let docs: typeof import('./chat-docs')
const inputs: ChatDocInput[] = [
  { kind: 'pdf', html: '<p>Informe</p>' },
  { kind: 'docx', data: { title: 'Informe', blocks: [{ type: 'paragraph', text: 'Contenido' }] } },
  { kind: 'xlsx', data: { sheets: [{ name: 'Datos', rows: [[1]] }] } },
  { kind: 'pptx', data: { slides: [{ title: 'Informe' }] } }
]

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  mock.temp = mkdtempSync(join(tmpdir(), 'lzx-chat-cache-'))
  mock.render.mockImplementation(async () => Buffer.from(`original-${mock.render.mock.calls.length}`))
  mock.save.mockResolvedValue({ canceled: false, filePath: join(mock.temp, 'descarga') })
  mock.craft.mockReturnValue('craft')
  mock.pdf.mockImplementation(async (_cli: string, _source: string, out: string) => {
    writeFileSync(out, '%PDF-respaldo')
    return out
  })
  docs = await import('./chat-docs')
})
afterEach(() => rmSync(mock.temp, { recursive: true, force: true }))

describe('bytes compartidos del documento de Chat', () => {
  it.each(inputs)('$kind: vista, descarga y apertura externa conservan los mismos bytes', async (input) => {
    const doc = await docs.generateChatDoc(input, 'Informe', 'session')
    const original = readFileSync(doc.file)
    // Una edición del temporal nunca sustituye los bytes originalmente generados.
    writeFileSync(doc.file, 'editado fuera')
    const downloaded = await docs.downloadChatDoc(structuredClone(input), 'Informe', null)
    const external = await docs.writeChatDocForExternal(input, 'Informe')
    expect(readFileSync(downloaded!)).toEqual(original)
    expect(readFileSync(external)).toEqual(original)
    expect(mock.render).toHaveBeenCalledTimes(1)
    expect(mock.pdf).not.toHaveBeenCalled()
  })

  it('comparte generación simultánea y no comparte tokens ni temporales', async () => {
    let finish!: (value: Buffer) => void
    mock.render.mockImplementationOnce(
      () =>
        new Promise<Buffer>((resolve) => {
          finish = resolve
        })
    )
    const first = docs.generateChatDoc(inputs[1], 'Informe', 'a')
    const second = docs.generateChatDoc(inputs[1], 'Informe', 'b')
    const external = docs.writeChatDocForExternal(inputs[1], 'Informe')
    expect(mock.render).toHaveBeenCalledTimes(1)
    finish(Buffer.from('mismos bytes'))
    const [a, b, file] = await Promise.all([first, second, external])
    expect(a.token).not.toBe(b.token)
    expect(a.file).not.toBe(b.file)
    expect(readFileSync(a.file)).toEqual(readFileSync(file))
  })

  it('la clave compara contenido y título, independientemente del orden de las propiedades', async () => {
    await docs.writeChatDocForExternal(inputs[1], 'Informe')
    await docs.writeChatDocForExternal(
      { kind: 'docx', data: { blocks: [{ text: 'Contenido', type: 'paragraph' }], title: 'Informe' } },
      'Informe'
    )
    expect(mock.render).toHaveBeenCalledTimes(1)
    await docs.writeChatDocForExternal(inputs[1], 'Otro título')
    await docs.writeChatDocForExternal({ kind: 'docx', data: { blocks: [{ type: 'paragraph', text: 'Otro contenido' }] } }, 'Informe')
    await docs.writeChatDocForExternal(inputs[0], 'Informe')
    expect(mock.render).toHaveBeenCalledTimes(4)
  })

  it('un fallo de generación no impide el siguiente intento', async () => {
    mock.render.mockRejectedValueOnce(new Error('fallo transitorio'))
    await expect(docs.writeChatDocForExternal(inputs[1], 'Informe')).rejects.toThrow('fallo transitorio')
    await expect(docs.writeChatDocForExternal(inputs[1], 'Informe')).resolves.toMatch(/\.docx$/)
    expect(mock.render).toHaveBeenCalledTimes(2)
  })

  it('cancelar Guardar no genera un documento', async () => {
    mock.save.mockResolvedValueOnce({ canceled: true })
    expect(await docs.downloadChatDoc(inputs[1], 'Informe', null)).toBeNull()
    expect(mock.render).not.toHaveBeenCalled()
  })

  it('mantiene como máximo dieciséis documentos recientes', async () => {
    for (let i = 0; i < 17; i++) await docs.writeChatDocForExternal(inputs[1], `Informe ${i}`)
    await docs.writeChatDocForExternal(inputs[1], 'Informe 16')
    expect(mock.render).toHaveBeenCalledTimes(17)
    await docs.writeChatDocForExternal(inputs[1], 'Informe 0')
    expect(mock.render).toHaveBeenCalledTimes(18)
  })
})

describe('PDF de respaldo bajo demanda', () => {
  it.each(inputs.slice(1))('$kind: convertir la vista previa no cambia lo descargado', async (input) => {
    const doc = await docs.generateChatDoc(input, 'Informe', 'a')
    expect(mock.pdf).not.toHaveBeenCalled()
    const preview = await docs.prepareChatDocPreview(doc)
    expect(preview.kind).toBe('pdf')
    expect(preview.file).toBe(doc.file)
    expect(preview.token).not.toBe(doc.token)
    expect(mock.pdf).toHaveBeenCalledTimes(1)
    const path = await docs.downloadChatDoc(input, 'Informe', null)
    expect(readFileSync(path!)).toEqual(readFileSync(doc.file))
    expect(mock.render).toHaveBeenCalledTimes(1)
  })

  it('conserva el visor original cuando falta Craft o la conversión falla', async () => {
    const doc = await docs.generateChatDoc(inputs[1], 'Informe', 'a')
    mock.craft.mockReturnValueOnce(null)
    expect(await docs.prepareChatDocPreview(doc)).toBe(doc)
    expect(mock.pdf).not.toHaveBeenCalled()
    mock.pdf.mockResolvedValueOnce(null)
    expect(await docs.prepareChatDocPreview(doc)).toBe(doc)
  })

  it('un PDF ya generado no se convierte otra vez', async () => {
    const doc = await docs.generateChatDoc(inputs[0], 'Informe', 'a')
    expect(await docs.prepareChatDocPreview(doc)).toBe(doc)
    expect(mock.pdf).not.toHaveBeenCalled()
  })
})

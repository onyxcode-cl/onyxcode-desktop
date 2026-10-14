import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const webDir = vi.fn<(p: string) => string | null>()
const openWebDoc = vi.fn()
vi.mock('./service', () => ({ craftService: () => ({ webDir }) }))
vi.mock('./web-view', () => ({
  MAX_WEB_FILE_BYTES: 1000,
  openWebDoc: (...a: unknown[]) => openWebDoc(...a),
  attachWeb: vi.fn(),
  closeWeb: vi.fn(),
  deactivateWeb: vi.fn(),
  isWebActive: () => false
}))
const recordCraftProblem = vi.fn()
vi.mock('./craft-problems', () => ({ recordCraftProblem: (...a: unknown[]) => recordCraftProblem(...a) }))
vi.mock('../../viewer/view', () => ({ attach: vi.fn(), closeView: vi.fn() }))

import { WEB_PROGRAM, openInCraftWeb } from './web-open'

let dir: string
beforeEach(() => {
  webDir.mockReset()
  openWebDoc.mockReset()
  recordCraftProblem.mockReset()
  dir = mkdtempSync(join(tmpdir(), 'web-open-'))
  return () => rmSync(dir, { recursive: true, force: true })
})
const file = (bytes = 10): string => {
  const f = join(dir, 'a.bin')
  writeFileSync(f, Buffer.alloc(bytes, 1))
  return f
}

describe('web-open (prueba Craft)', () => {
  it('cada tipo de documento va al programa que le corresponde', () => {
    expect(WEB_PROGRAM).toEqual({ xlsx: 'gridcraft', pptx: 'deckcraft', docx: 'wordcraft', pdf: 'pdfcraft' })
  })

  it('sin la versión web instalada no hace nada y devuelve false (se usa el visor de siempre)', async () => {
    webDir.mockReturnValue(null)
    expect(await openInCraftWeb('xlsx', file(), 'T')).toBe(false)
    expect(openWebDoc).not.toHaveBeenCalled()
  })

  it('con la versión web abre el archivo con el nombre limpio y la extensión del tipo', async () => {
    webDir.mockImplementation((p) => `/web/${p}`)
    openWebDoc.mockResolvedValue(true)
    expect(await openInCraftWeb('pdf', file(), 'Informe / 2026: "Q3"')).toBe(true)
    const [dirArg, ext, name, bytes] = openWebDoc.mock.calls[0]
    expect(dirArg).toBe('/web/pdfcraft')
    expect(ext).toBe('pdf')
    expect(name).toBe('Informe  2026 Q3.pdf')
    expect((bytes as Buffer).length).toBe(10)
  })

  it('un título vacío o raro cae a «documento»', async () => {
    webDir.mockReturnValue('/web/x')
    openWebDoc.mockResolvedValue(true)
    await openInCraftWeb('docx', file(), '///')
    expect(openWebDoc.mock.calls[0][2]).toBe('documento.docx')
  })

  it('un archivo demasiado grande no se abre en la vista web', async () => {
    webDir.mockReturnValue('/web/x')
    expect(await openInCraftWeb('pptx', file(2000), 'T')).toBe(false)
    expect(openWebDoc).not.toHaveBeenCalled()
  })

  it('si la vista web falla (lanza o devuelve false) devuelve false en vez de propagar el error', async () => {
    webDir.mockReturnValue('/web/x')
    openWebDoc.mockRejectedValueOnce(new Error('boom'))
    expect(await openInCraftWeb('xlsx', file(), 'T')).toBe(false)
    openWebDoc.mockResolvedValueOnce(false)
    expect(await openInCraftWeb('xlsx', file(), 'T')).toBe(false)
  })

  it('un archivo que no existe devuelve false', async () => {
    webDir.mockReturnValue('/web/x')
    expect(await openInCraftWeb('xlsx', join(dir, 'no-existe'), 'T')).toBe(false)
  })

  it('cada fallo de la vista web (incluido un plazo agotado) queda en el registro de problemas', async () => {
    webDir.mockReturnValue('/web/x')
    openWebDoc.mockRejectedValueOnce(new Error('La vista web de ArtCraft no respondió a tiempo'))
    expect(await openInCraftWeb('docx', file(), 'T')).toBe(false)
    expect(recordCraftProblem).toHaveBeenCalledWith('vista web', expect.any(Error), { programa: 'wordcraft' })
    openWebDoc.mockResolvedValueOnce(false)
    await openInCraftWeb('docx', file(), 'T')
    expect(recordCraftProblem).toHaveBeenCalledTimes(2)
  })

  it('sin la versión web instalada se anota como aviso (no como error)', async () => {
    webDir.mockReturnValue(null)
    await openInCraftWeb('docx', file(), 'T')
    expect(recordCraftProblem).toHaveBeenCalledWith('vista web', expect.any(Error), { programa: 'wordcraft' }, { level: 'warn' })
  })
})

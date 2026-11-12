import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

import { closeWeb } from './web-view'
import { WEB_PROGRAM, openInCraftWeb, panelAttach, panelClose } from './web-open'
import { attachWeb } from './web-view'
import { attach as attachViewer } from '../../viewer/view'

let dir: string
beforeEach(() => {
  webDir.mockReset()
  openWebDoc.mockReset()
  recordCraftProblem.mockReset()
  dir = mkdtempSync(join(tmpdir(), 'web-open-'))
  return () => rmSync(dir, { recursive: true, force: true })
})
afterEach(() => vi.useRealTimers())
const file = (bytes = 10): string => {
  const f = join(dir, 'a.bin')
  writeFileSync(f, Buffer.alloc(bytes, 1))
  return f
}

describe('web-open (prueba Craft)', () => {
  it('tras cerrar por cambio de tema restituye la superficie ANTES de arrancar el motor', async () => {
    const win = {} as never
    const rect = { x: 12, y: 50, width: 500, height: 700 }
    panelAttach(win, rect, true)
    panelClose()
    vi.mocked(attachWeb).mockClear()
    webDir.mockReturnValue('/web/wordcraft')
    openWebDoc.mockImplementation(async () => {
      expect(attachWeb).toHaveBeenCalledWith(win, rect, true)
      return true
    })
    expect(await openInCraftWeb('docx', file(), 'T')).toBe(true)
  })
  it('cada tipo de documento va al programa que le corresponde', () => {
    expect(WEB_PROGRAM).toEqual({ xlsx: 'gridcraft', pptx: 'deckcraft', docx: 'wordcraft' })
  })

  it.each([null, '/web/pdfcraft'])('PDF usa PDF.js aunque PdfCraft esté instalado: %s', async (installed) => {
    webDir.mockReturnValue(installed)
    const win = {} as never
    const rect = { x: 0, y: 0, width: 392, height: 600 }
    panelAttach(win, rect, true)
    vi.mocked(closeWeb).mockClear()
    vi.mocked(attachViewer).mockClear()
    expect(await openInCraftWeb('pdf', 'C:\\Trabajo\\Informe #1 ñ.pdf', 'Informe')).toBe(false)
    expect(webDir).not.toHaveBeenCalled()
    expect(openWebDoc).not.toHaveBeenCalled()
    expect(recordCraftProblem).not.toHaveBeenCalled()
    expect(closeWeb).toHaveBeenCalledOnce()
    expect(attachViewer).toHaveBeenCalledWith(win, rect, true)
  })

  it('sin la versión web instalada no hace nada y devuelve false (se usa el visor de siempre)', async () => {
    webDir.mockReturnValue(null)
    expect(await openInCraftWeb('xlsx', file(), 'T')).toBe(false)
    expect(openWebDoc).not.toHaveBeenCalled()
  })

  it.each(['docx', 'xlsx', 'pptx'] as const)('Office sigue abriendo %s con nombre limpio y su motor', async (kind) => {
    webDir.mockImplementation((p) => `/web/${p}`)
    openWebDoc.mockResolvedValue(true)
    expect(await openInCraftWeb(kind, file(), 'Informe / 2026: "Q3"')).toBe(true)
    const [dirArg, ext, name, bytes] = openWebDoc.mock.calls[0]
    expect(dirArg).toBe(`/web/${WEB_PROGRAM[kind]}`)
    expect(ext).toBe(kind)
    expect(name).toBe(`Informe  2026 Q3.${kind}`)
    expect((bytes as Buffer).length).toBe(10)
  })

  it('abrir PDF cancela una apertura Office pendiente sin volver a mostrar Craft al terminar', async () => {
    webDir.mockReturnValue('/web/wordcraft')
    let finish!: (ok: boolean) => void
    openWebDoc.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve
        })
    )
    const office = openInCraftWeb('docx', file(), 'Office')
    await vi.waitFor(() => expect(openWebDoc).toHaveBeenCalledOnce())
    expect(await openInCraftWeb('pdf', 'informe.pdf', 'PDF')).toBe(false)
    vi.mocked(attachWeb).mockClear()
    finish(true)
    expect(await office).toBe(false)
    expect(attachWeb).not.toHaveBeenCalled()
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

  it('a los cinco segundos cierra la web y devuelve false para mostrar el visor clásico', async () => {
    webDir.mockReturnValue('/web/x')
    let done!: (ok: boolean) => void
    openWebDoc.mockImplementation(
      () =>
        new Promise<boolean>((r) => {
          done = r
        })
    )
    vi.useFakeTimers()
    const second = openInCraftWeb('docx', file(), 'T')
    await vi.waitFor(() => expect(openWebDoc).toHaveBeenCalledOnce())
    await vi.advanceTimersByTimeAsync(5000)
    expect(await second).toBe(false)
    expect(closeWeb).toHaveBeenCalled()
    done(true)
    await Promise.resolve()
  })

  it('sin la versión web instalada se anota como aviso (no como error)', async () => {
    webDir.mockReturnValue(null)
    await openInCraftWeb('docx', file(), 'T')
    expect(recordCraftProblem).toHaveBeenCalledWith('vista web', expect.any(Error), { programa: 'wordcraft' }, { level: 'warn' })
  })
})

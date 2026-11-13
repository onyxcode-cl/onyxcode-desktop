import { describe, expect, it, vi } from 'vitest'
const wired = vi.hoisted(() => ({
  deps: null as null | Record<string, unknown>,
  registryPath: '',
  export: vi.fn(async () => Buffer.from('PDF')),
  ensure: vi.fn(async () => undefined)
}))
vi.mock('electron', () => ({ app: { getPath: () => '/private/app-data' } }))
vi.mock('../office/craft/private-tmp', () => ({ setPrivateTmpBase: vi.fn() }))
vi.mock('../viewer/capture', () => ({ captureDeckSlides: vi.fn(), captureDocxPages: vi.fn() }))
vi.mock('./pdf-raster', () => ({ rasterizePdf: vi.fn() }))
vi.mock('./preview', () => ({ renderPreview: vi.fn() }))
vi.mock('./engine', () => ({ ensureCraft: wired.ensure, craftBinary: (name: string) => `/${name}`, renderBytes: vi.fn() }))
vi.mock('./mcp-server', () => ({
  DocumentsMcpServer: class {
    constructor(deps: Record<string, unknown>) {
      wired.deps = deps
    }
  }
}))
vi.mock('./free-image-registry', () => ({
  FreeImageRegistry: class {
    constructor(path: string) {
      wired.registryPath = path
    }
  }
}))
vi.mock('./export-pdf', () => ({ exportDocumentPdf: wired.export }))

describe('instancia real de documentos', () => {
  it('registra las fotos en userData y exporta usando los binarios de la app', async () => {
    await import('./index')
    expect(wired.registryPath).toBe('/private/app-data/documentos-fotos')
    expect(wired.deps?.photoRegistry).toBeDefined()
    const convert = wired.deps!.exportPdf as (tipo: 'docx', bytes: Buffer) => Promise<Buffer>
    const bytes = Buffer.from('original')
    expect(await convert('docx', bytes)).toEqual(Buffer.from('PDF'))
    expect(wired.ensure).toHaveBeenCalledOnce()
    expect(wired.export).toHaveBeenCalledWith('docx', bytes, { wordcraft: '/wordcraft', deckcraft: '/deckcraft' })
  })
})

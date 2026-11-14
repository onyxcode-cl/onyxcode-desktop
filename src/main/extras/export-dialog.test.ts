import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ app: { isPackaged: false }, save: vi.fn() }))
vi.mock('electron', () => ({ app: mocks.app, dialog: { showSaveDialog: mocks.save } }))
import { resolveE2eExportDir, showExportSaveDialog } from './export-dialog'

afterEach(() => {
  mocks.app.isPackaged = false
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('destino de exportación exclusivo de pruebas', () => {
  it('solo acepta una ruta absoluta con la app sin empaquetar', () => {
    const path = join(tmpdir(), 'exports')
    expect(resolveE2eExportDir({ isPackaged: false, env: { LAZUNOX_E2E_EXPORT_DIR: path } })).toBe(path)
    expect(resolveE2eExportDir({ isPackaged: true, env: { LAZUNOX_E2E_EXPORT_DIR: path } })).toBeNull()
    expect(resolveE2eExportDir({ isPackaged: false, env: { LAZUNOX_E2E_EXPORT_DIR: 'relative' } })).toBeNull()
    expect(resolveE2eExportDir({ isPackaged: false, env: {} })).toBeNull()
  })

  it('producción conserva el diálogo aunque se inyecte la variable', async () => {
    mocks.app.isPackaged = true
    vi.stubEnv('LAZUNOX_E2E_EXPORT_DIR', tmpdir())
    mocks.save.mockResolvedValueOnce({ canceled: true })
    const options = { defaultPath: 'deck.html' }
    expect(await showExportSaveDialog(null, options)).toEqual({ canceled: true })
    expect(mocks.save).toHaveBeenCalledWith(options)
  })

  it('HTML, PDF y PPTX quedan en destinos únicos sin diálogo ni sobrescritura', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lzx-export-test-'))
    vi.stubEnv('LAZUNOX_E2E_EXPORT_DIR', join(dir, 'nested'))
    try {
      const paths: string[] = []
      for (const ext of ['html', 'pdf', 'pptx', 'html']) {
        const saved = await showExportSaveDialog(null, { defaultPath: join(tmpdir(), `deck.${ext}`) })
        expect(saved.canceled).toBe(false)
        expect(isAbsolute(saved.filePath!)).toBe(true)
        expect(basename(saved.filePath!)).toBe(`deck.${ext}`)
        expect(dirname(dirname(saved.filePath!))).toBe(join(dir, 'nested'))
        paths.push(saved.filePath!)
      }
      expect(new Set(paths).size).toBe(4)
      expect(mocks.save).not.toHaveBeenCalled()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

import { describe, expect, it, vi } from 'vitest'
import { findCraftApp, openExternally, type FindDeps } from './open-external'

const mac = (have: string[]): FindDeps => ({ platform: 'darwin', env: {}, home: '/Users/x', exists: (p) => have.includes(p) })
const win = (have: string[]): FindDeps => ({
  platform: 'win32',
  env: { LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local', ProgramFiles: 'C:\\Program Files' },
  home: 'C:\\Users\\x',
  exists: (p) => have.includes(p)
})

describe('findCraftApp', () => {
  it('macOS: /Applications y ~/Applications, un programa por tipo', () => {
    expect(findCraftApp('docx', mac(['/Applications/WordCraft.app']))).toBe('/Applications/WordCraft.app')
    expect(findCraftApp('pptx', mac(['/Users/x/Applications/DeckCraft.app']))).toBe('/Users/x/Applications/DeckCraft.app')
    expect(findCraftApp('xlsx', mac(['/Applications/WordCraft.app']))).toBeNull()
  })
  it('Windows: Programs del usuario y Program Files', () => {
    const d = win([])
    expect(findCraftApp('pdf', d)).toBeNull()
    const found = findCraftApp('pdf', { ...d, exists: (p) => p.endsWith('pdfcraft.exe') })
    expect(found).toMatch(/PdfCraft[\\/]pdfcraft\.exe$/)
  })
  it('otras plataformas: null', () => {
    expect(findCraftApp('pptx', { platform: 'linux', env: {}, home: '/h', exists: () => true })).toBeNull()
  })
})

describe('openExternally', () => {
  it('sin el programa instalado usa el del sistema', async () => {
    const openPath = vi.fn().mockResolvedValue('')
    await expect(openExternally('xlsx', '/tmp/a.xlsx', openPath, mac([]))).resolves.toBe('system')
    expect(openPath).toHaveBeenCalledWith('/tmp/a.xlsx')
  })
  it('si el sistema tampoco puede, lanza con su mensaje', async () => {
    await expect(openExternally('xlsx', '/tmp/a.xlsx', async () => 'sin programa', mac([]))).rejects.toThrow('sin programa')
  })
})

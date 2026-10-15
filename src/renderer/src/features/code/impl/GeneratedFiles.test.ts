import { describe, expect, it, vi } from 'vitest'
import { fileCardActions, fileCardType } from './GeneratedFiles'

describe('fileCardActions', () => {
  it('«Abrir» llama a la apertura del sistema; «Mostrar» solo a revelar', async () => {
    const api = { openDoc: vi.fn().mockResolvedValue(undefined), revealDoc: vi.fn().mockResolvedValue(undefined) }
    const a = fileCardActions(api, '/p', '/p/a.xlsx')
    await a.open()
    expect(api.openDoc).toHaveBeenCalledWith('/p', '/p/a.xlsx')
    expect(api.revealDoc).not.toHaveBeenCalled()
    await a.reveal()
    expect(api.revealDoc).toHaveBeenCalledWith('/p', '/p/a.xlsx')
    expect(api.openDoc).toHaveBeenCalledTimes(1)
  })
  it('tipo por extensión', () => {
    expect(fileCardType('a.XLSM')).toBe('xlsx')
    expect(fileCardType('a.htm')).toBe('slides')
  })
})

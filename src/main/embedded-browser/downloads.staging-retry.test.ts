import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', getName: () => 'Lazunox' },
  dialog: {},
  Notification: class {}
}))
vi.mock('./surface', () => ({ tabByWebContents: () => null }))
vi.mock('./approvals', () => ({ requestApproval: vi.fn() }))
vi.mock('../migrations/migrate-folder-scratch', () => ({ migrateFolderScratch: () => {} }))

import { removeStagingWithRetry } from './downloads'

const err = (code: string): Error => Object.assign(new Error(`${code}: simulado`), { code })

afterEach(() => vi.restoreAllMocks())

describe('removeStagingWithRetry', () => {
  it('reintenta ante ENOTEMPTY y termina sin ensuciar el registro', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let n = 0
    const rm = vi.fn(() => {
      if (++n < 3) throw err('ENOTEMPTY')
    })
    await removeStagingWithRetry('/x', { rm, waits: [1, 1, 1] })
    expect(rm).toHaveBeenCalledTimes(3)
    expect(warn).not.toHaveBeenCalled()
  })

  it('si sigue ocupada tras los reintentos, se rinde sin escribir en el registro', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const rm = vi.fn(() => {
      throw err('EBUSY')
    })
    await removeStagingWithRetry('/x', { rm, waits: [1, 1] })
    expect(rm).toHaveBeenCalledTimes(3)
    expect(warn).not.toHaveBeenCalled()
  })

  it('otro error se registra y no se reintenta', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const rm = vi.fn(() => {
      throw err('EIO')
    })
    await removeStagingWithRetry('/x', { rm, waits: [1, 1] })
    expect(rm).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledTimes(1)
  })
})

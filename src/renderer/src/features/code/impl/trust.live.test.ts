/** R2: el renderer informa a main SOLO de las carpetas abiertas con confianza vigente y verificada en esta ejecución. */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))
type Store = typeof import('./store')
type Trust = typeof import('./trust')
let useCode: Store['useCode']
let t: Trust
const setLive = vi.fn((_d: string[]) => Promise.resolve())
const scan = vi.fn()
const A = '/work/a'
const B = '/work/b'
const R = '/work/reciente-sin-abrir'
const last = (): string[] => setLive.mock.calls.at(-1)?.[0] ?? []

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  setLive.mockClear()
  scan.mockReset()
  ;(window.api as unknown as Record<string, unknown>).code = { git: { status: () => undefined }, project: { scan, setLive } }
  ;({ useCode } = await import('./store'))
  t = await import('./trust')
})
afterEach(() => {
  delete (window.api as unknown as Record<string, unknown>).code
})

describe('syncLiveFolders', () => {
  it('una carpeta abierta y de confianza pero NO verificada todavía no se informa; al verificarse sí', async () => {
    scan.mockResolvedValue({ items: [], huella: 'v', complete: true, instructionFiles: [] })
    useCode.setState({ openDirectories: [A], trustedFolders: [A], trustedScans: { [A]: { huella: 'v', ids: [] } } } as never)
    t.syncLiveFolders()
    expect(last()).toEqual([])
    await expect(t.verifyTrustedFolder(A)).resolves.toBe(true)
    expect(last()).toEqual([A])
  })

  it('las recientes que no están abiertas, y las abiertas sin confianza, nunca entran', async () => {
    scan.mockResolvedValue({ items: [], huella: 'v', complete: true, instructionFiles: [] })
    useCode.setState({ openDirectories: [A, B], trustedFolders: [A] } as never)
    await t.verifyTrustedFolder(A)
    expect(last()).toEqual([A])
    expect(last()).not.toContain(R)
    expect(last()).not.toContain(B)
  })

  it('cerrar la carpeta o quitarle la confianza la saca de la lista', async () => {
    scan.mockResolvedValue({ items: [], huella: 'v', complete: true, instructionFiles: [] })
    useCode.setState({ openDirectories: [A], trustedFolders: [A] } as never)
    await t.verifyTrustedFolder(A)
    expect(last()).toEqual([A])
    useCode.setState({ openDirectories: [] } as never)
    expect(last()).toEqual([])
  })
})

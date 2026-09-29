/**
 * Workspace trust de Code (F7-B20): carpeta ya confiada no molesta, peticiones concurrentes no dejan
 * promesas colgadas y `openProjectTrusted` solo abre tras confiar.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

type Store = typeof import('./store')
type Trust = typeof import('./trust')
let useCode: Store['useCode']
let t: Trust
const openProject = vi.fn(() => Promise.resolve())

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  openProject.mockClear()
  ;({ useCode } = await import('./store'))
  t = await import('./trust')
  useCode.setState({ openProject } as never)
})

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('ensureTrusted', () => {
  it('carpeta ya confiada: true directo, sin diálogo', async () => {
    useCode.getState().trustFolder('/a')
    await expect(t.ensureTrusted('/a')).resolves.toBe(true)
    await expect(t.openProjectTrusted('/a')).resolves.toBe(true)
    expect(openProject).toHaveBeenCalledWith('/a')
  })

  it('confiar guarda la carpeta y resuelve true', async () => {
    const p = t.ensureTrusted('/b')
    t.resolveTrust(true)
    await expect(p).resolves.toBe(true)
    expect(useCode.getState().isTrusted('/b')).toBe(true)
  })

  it('cancelar resuelve false y no abre el proyecto', async () => {
    const p = t.openProjectTrusted('/c')
    await tick()
    t.resolveTrust(false)
    await expect(p).resolves.toBe(false)
    expect(openProject).not.toHaveBeenCalled()
    expect(useCode.getState().isTrusted('/c')).toBe(false)
  })

  it('una petición concurrente resuelve la anterior con false y la nueva sigue pendiente', async () => {
    const first = t.ensureTrusted('/d1')
    const second = t.ensureTrusted('/d2')
    await expect(first).resolves.toBe(false)
    expect(useCode.getState().isTrusted('/d1')).toBe(false)
    t.resolveTrust(true)
    await expect(second).resolves.toBe(true)
    expect(useCode.getState().isTrusted('/d2')).toBe(true)
    expect(useCode.getState().isTrusted('/d1')).toBe(false)
  })
})

/**
 * Motor lazunox.16 (confianza obligatoria): cuando una carpeta de Code pasa la verificación de confianza, la app se la declara al motor ANTES de
 * darle el foco (quienes esperan siguen cuando el motor ya fue avisado); cuando la persona le quita la confianza, también se le quita al motor.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))
type Store = typeof import('./store')
type Trust = typeof import('./trust')
let useCode: Store['useCode']
let t: Trust
const scan = vi.fn()
const setLive = vi.fn((_d: string[]) => Promise.resolve())
const events: string[] = []
let release: (() => void) | null = null
const trustEngine = vi.fn((dir: string) => {
  events.push(`declara:${dir}`)
  return new Promise<{ ok: boolean }>((res) => {
    release = () => res({ ok: true })
  })
})
const untrustEngine = vi.fn((dir: string) => {
  events.push(`quita:${dir}`)
  return Promise.resolve({ ok: true })
})
const A = '/work/a'
const SCAN = { items: [], huella: 'v', complete: true, instructionFiles: [] }

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  events.length = 0
  release = null
  scan.mockReset()
  scan.mockResolvedValue(SCAN)
  trustEngine.mockClear()
  untrustEngine.mockClear()
  ;(window.api as unknown as Record<string, unknown>).code = {
    git: { status: () => undefined },
    project: { scan, setLive, trustEngine, untrustEngine }
  }
  ;({ useCode } = await import('./store'))
  t = await import('./trust')
})
afterEach(() => {
  delete (window.api as unknown as Record<string, unknown>).code
})

describe('confianza de Code → motor', () => {
  it('carpeta de confianza que se verifica sin novedades: se declara al motor y SOLO entonces cuenta como verificada', async () => {
    useCode.setState({ openDirectories: [A], trustedFolders: [A], trustedScans: { [A]: { huella: 'v', ids: [] } } } as never)
    const p = t.verifyTrustedFolder(A)
    await vi.waitFor(() => expect(trustEngine).toHaveBeenCalledWith(A))
    expect(t.isFolderVerified(A)).toBe(false) // el motor aún no contestó
    release!()
    await expect(p).resolves.toBe(true)
    expect(t.isFolderVerified(A)).toBe(true)
  })

  it('la persona acepta el diálogo: quien esperaba (abrir la carpeta) sigue después de avisar al motor, y se guarda la confianza', async () => {
    const p = t.ensureTrusted(A)
    let done = false
    void p.then(() => (done = true))
    await vi.waitFor(() => expect(t.getPendingTrust()?.dir).toBe(A))
    t.resolveTrust(true)
    await vi.waitFor(() => expect(trustEngine).toHaveBeenCalledWith(A))
    await Promise.resolve()
    expect(done).toBe(false) // todavía esperando al motor
    release!()
    await expect(p).resolves.toBe(true)
    expect(useCode.getState().isTrusted(A)).toBe(true)
  })

  it('si avisar al motor falla, igual se abre (cada pantalla trata el 403 como «sin confianza»)', async () => {
    trustEngine.mockImplementationOnce(() => Promise.reject(new Error('sin red')))
    useCode.setState({ openDirectories: [A], trustedFolders: [A], trustedScans: { [A]: { huella: 'v', ids: [] } } } as never)
    await expect(t.verifyTrustedFolder(A)).resolves.toBe(true)
  })

  it('cancelar un diálogo de carpeta nueva NO declara nada al motor', async () => {
    const p = t.ensureTrusted(A)
    await vi.waitFor(() => expect(t.getPendingTrust()?.dir).toBe(A))
    t.resolveTrust(false)
    await expect(p).resolves.toBe(false)
    expect(trustEngine).not.toHaveBeenCalled()
    expect(untrustEngine).not.toHaveBeenCalled()
  })

  it('cancelar la re-pregunta de una carpeta que ya era de confianza le quita la confianza también ante el motor', async () => {
    scan.mockResolvedValue({ ...SCAN, huella: 'otra' })
    useCode.setState({ openDirectories: [A], trustedFolders: [A], trustedScans: { [A]: { huella: 'v', ids: [] } } } as never)
    // El escaneo falla (sin resultado): falla cerrado y se pregunta.
    scan.mockResolvedValue(null)
    const p = t.verifyTrustedFolder(A)
    await vi.waitFor(() => expect(t.getPendingTrust()?.dir).toBe(A))
    t.resolveTrust(false)
    await expect(p).resolves.toBe(false)
    expect(untrustEngine).toHaveBeenCalledWith(A)
    expect(useCode.getState().isTrusted(A)).toBe(false)
  })

  it('sin API nativa (celular, pruebas) no hay nada que declarar y todo sigue como antes', async () => {
    delete (window.api as unknown as Record<string, unknown>).code
    useCode.setState({ openDirectories: [A], trustedFolders: [A] } as never)
    await expect(t.verifyTrustedFolder(A)).resolves.toBe(true)
  })
})

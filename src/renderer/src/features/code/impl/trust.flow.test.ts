/**
 * W-A2: flujo de `trust.ts` con el escaneo de la carpeta. Carpeta nueva (diálogo inmediato, «Revisando…», luego la lista), carpeta de
 * confianza con huella igual o distinta, entrada antigua sin huella, Cancelar en la re-pregunta, fallo del escaneo y plazo.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { ProjectScanItem, ProjectScanResult } from '@shared/ipc-code'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

type Store = typeof import('./store')
type Trust = typeof import('./trust')
type PR = typeof import('./permission-rules')
let useCode: Store['useCode']
let t: Trust
let pr: PR
const scan = vi.fn<(path: string) => Promise<ProjectScanResult>>()
const D = '/work/p'

const mcp = (name: string, extra: Partial<ProjectScanItem> = {}): ProjectScanItem => ({
  id: `mcp-${name}`,
  kind: 'mcp',
  name,
  trustName: name,
  detail: 'node',
  mcpKey: `${name}_*`,
  where: 'opencode.json',
  risky: true,
  ...extra
})
const agent = (name: string): ProjectScanItem => ({
  id: `agent-${name}`,
  kind: 'agent',
  name,
  where: `.opencode/agent/${name}.md`,
  risky: false
})
const result = (items: ProjectScanItem[], huella = items.map((i) => i.id).join('|') || 'vacia', complete = true): ProjectScanResult => ({
  items,
  huella,
  complete,
  instructionFiles: []
})

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  scan.mockReset()
  ;(window.api as unknown as Record<string, unknown>).code = { git: { status: () => undefined }, project: { scan } }
  ;({ useCode } = await import('./store'))
  t = await import('./trust')
  pr = await import('./permission-rules')
  useCode.setState({ openProject: vi.fn(() => Promise.resolve()) } as never)
})
afterEach(() => {
  vi.useRealTimers()
  delete (window.api as unknown as Record<string, unknown>).code
})

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
const st = (): ReturnType<Store['useCode']['getState']> => useCode.getState()

describe('carpeta nueva', () => {
  it('el diálogo sale de inmediato en «revisando» y, al llegar el escaneo, trae la lista; confiar guarda huella e ids y las reglas de la sesión', async () => {
    let done!: (r: ProjectScanResult) => void
    scan.mockReturnValue(new Promise((res) => (done = res)))
    const p = t.ensureTrusted(D)
    // Aún sin respuesta: está revisando y las reglas fallan cerrado.
    expect(pr.folderMcpOf(D)).toEqual({ servers: [], askAll: true })
    done(result([mcp('crm'), agent('rev')]))
    await flush()
    t.resolveTrust(true)
    await expect(p).resolves.toBe(true)
    expect(st().isTrusted(D)).toBe(true)
    expect(st().trustedScans[D]).toEqual({ huella: 'mcp-crm|agent-rev', ids: ['mcp-crm', 'agent-rev'] })
    expect(pr.projectAskOf(D)).toEqual([{ permission: 'crm_*', pattern: '*', action: 'ask' }])
  })

  it('fallo del escaneo: se sigue pidiendo confianza, sin huella, y las reglas quedan en «todo pregunta»', async () => {
    scan.mockRejectedValue(new Error('boom'))
    const p = t.ensureTrusted(D)
    await flush()
    t.resolveTrust(true)
    await expect(p).resolves.toBe(true)
    expect(st().trustedScans[D]).toBeUndefined()
    expect(pr.folderMcpOf(D)?.askAll).toBe(true)
  })

  it('el plazo se cumple: un escaneo que no responde se trata como «no se pudo revisar» y no deja la apertura colgada', async () => {
    vi.useFakeTimers()
    scan.mockReturnValue(new Promise(() => undefined))
    const p = t.ensureTrusted(D)
    await vi.advanceTimersByTimeAsync(t.SCAN_TIMEOUT_MS + 10)
    t.resolveTrust(true)
    await expect(p).resolves.toBe(true)
    expect(pr.folderMcpOf(D)?.askAll).toBe(true)
  })

  it('cancelar no confía y conserva las reglas (siguen preguntando los conectores)', async () => {
    scan.mockResolvedValue(result([mcp('crm')]))
    const p = t.ensureTrusted(D)
    await flush()
    t.resolveTrust(false)
    await expect(p).resolves.toBe(false)
    expect(st().isTrusted(D)).toBe(false)
    expect(pr.projectAskOf(D).map((r) => r.permission)).toEqual(['crm_*'])
  })
})

describe('carpeta de confianza', () => {
  const trusted = (r: ProjectScanResult): void => st().trustFolder(D, { huella: r.huella, ids: r.items.map((i) => i.id) })

  it('misma huella: no pregunta y deja las reglas del escaneo', async () => {
    const r = result([mcp('crm')])
    trusted(r)
    scan.mockResolvedValue(r)
    await expect(t.ensureTrusted(D)).resolves.toBe(true)
    expect(pr.projectAskOf(D).map((x) => x.permission)).toEqual(['crm_*'])
  })

  it('huella distinta pero nada riesgoso nuevo: no pregunta y guarda la huella nueva', async () => {
    trusted(result([mcp('crm')]))
    const next = result([mcp('crm'), agent('nuevo')])
    scan.mockResolvedValue(next)
    await expect(t.ensureTrusted(D)).resolves.toBe(true)
    expect(st().trustedScans[D]!.huella).toBe(next.huella)
  })

  it('conector nuevo: repregunta mostrando SOLO lo nuevo; Cancelar quita la confianza y conserva las reglas', async () => {
    trusted(result([mcp('crm')]))
    scan.mockResolvedValue(result([mcp('crm'), mcp('otro')]))
    const p = t.ensureTrusted(D)
    await flush()
    t.resolveTrust(false)
    await expect(p).resolves.toBe(false)
    expect(st().isTrusted(D)).toBe(false)
    expect(st().trustedScans[D]).toBeUndefined()
    expect(pr.projectAskOf(D).map((x) => x.permission)).toEqual(['crm_*', 'otro_*'])
  })

  it('entrada antigua sin huella: si no trae nada riesgoso se guarda en silencio; si trae un conector se pregunta una vez', async () => {
    st().trustFolder(D)
    scan.mockResolvedValue(result([agent('a')]))
    await expect(t.ensureTrusted(D)).resolves.toBe(true)
    expect(st().trustedScans[D]).toBeDefined()

    const E = '/work/q'
    st().trustFolder(E)
    scan.mockResolvedValue(result([mcp('crm')]))
    const p = t.ensureTrusted(E)
    await flush()
    t.resolveTrust(true)
    await expect(p).resolves.toBe(true)
    expect(st().trustedScans[E]!.ids).toEqual(['mcp-crm'])
  })

  it('el escaneo falla en una carpeta de confianza: se abre, con las reglas en «todo pregunta»', async () => {
    st().trustFolder(D)
    scan.mockRejectedValue(new Error('boom'))
    await expect(t.ensureTrusted(D)).resolves.toBe(true)
    expect(pr.folderMcpOf(D)?.askAll).toBe(true)
  })
})

describe('vías que no pasan por openProjectTrusted', () => {
  it('verifyTrustedFolder: carpeta de confianza sin escanear se escanea; si trae algo nuevo y se cancela, pierde la confianza y no se carga', async () => {
    const r = result([mcp('crm')])
    st().trustFolder(D, { huella: r.huella, ids: r.items.map((i) => i.id) })
    scan.mockResolvedValue(result([mcp('crm'), mcp('nuevo')]))
    const p = t.verifyTrustedFolder(D)
    await flush()
    t.resolveTrust(false)
    await expect(p).resolves.toBe(false)
    expect(st().isTrusted(D)).toBe(false)
  })

  it('verifyTrustedFolder: ya escaneada en esta ejecución, no vuelve a escanear', async () => {
    st().trustFolder(D)
    pr.setFolderMcp(D, { items: [], complete: true })
    await expect(t.verifyTrustedFolder(D)).resolves.toBe(true)
    expect(scan).not.toHaveBeenCalled()
  })

  it('restoreOpenProjects: no carga (loadSessions) la carpeta que no se aceptó', async () => {
    const A = '/work/a'
    const B = '/work/b'
    const rb = result([mcp('crm')])
    st().trustFolder(B, { huella: rb.huella, ids: rb.items.map((i) => i.id) })
    useCode.setState({ directory: A, openDirectories: [A, B] })
    const loadSessions = vi.fn(() => Promise.resolve())
    useCode.setState({ loadSessions } as never)
    scan.mockResolvedValue(result([mcp('crm'), mcp('nuevo')]))
    const p = st().restoreOpenProjects()
    await flush()
    await flush()
    t.resolveTrust(false)
    await p
    expect(loadSessions).not.toHaveBeenCalled()
  })
})

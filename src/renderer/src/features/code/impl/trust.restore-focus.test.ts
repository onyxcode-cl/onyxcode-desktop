/**
 * Fallo 1 de las pruebas de la 1.8.12: la carpeta con foco que se restaura al abrir la app NO puede ser el foco (`directory`) hasta pasar por
 * el escaneo y la confianza. Si lo es, el compositor, los paneles y las listas piden al motor con ella y el motor arranca sus conectores
 * mientras el diálogo «Esta carpeta trae algo nuevo» sigue en pantalla.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { ProjectScanItem, ProjectScanResult } from '@shared/ipc-code'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

type Store = typeof import('./store')
type Trust = typeof import('./trust')
let useCode: Store['useCode']
let t: Trust
const scan = vi.fn<(path: string) => Promise<ProjectScanResult>>()
const F = '/work/focus'
const B = '/work/otra'
/** Llamadas al motor con `directory` (lo que hacen el compositor, los paneles y las listas en cuanto una carpeta es el foco). */
let engineCalls: string[] = []

const mcp = (name: string): ProjectScanItem => ({
  id: `mcp-${name}`,
  kind: 'mcp',
  name,
  trustName: name,
  detail: 'node',
  mcpKey: `${name}_*`,
  where: 'opencode.json',
  risky: true
})
const result = (items: ProjectScanItem[]): ProjectScanResult => ({
  items,
  huella: items.map((i) => i.id).join('|') || 'vacia',
  complete: true,
  instructionFiles: []
})
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

/** Arranca «la app»: lo guardado por la sesión anterior (foco F, F de confianza con lo visto antes) y un consumidor que habla con el motor al haber foco. */
async function boot(opts: { focusTrusted?: boolean } = {}): Promise<void> {
  vi.resetModules()
  localStorage.clear()
  engineCalls = []
  scan.mockReset()
  localStorage.setItem('code.projects', JSON.stringify({ v: 1, open: [F, B], focus: F }))
  if (opts.focusTrusted !== false) {
    localStorage.setItem('code.trustedFolders', JSON.stringify([F]))
    localStorage.setItem('code.trustedScans', JSON.stringify({ [F]: { huella: result([mcp('viejo')]).huella, ids: ['mcp-viejo'] } }))
  }
  ;(window.api as unknown as Record<string, unknown>).code = { git: { status: () => undefined }, project: { scan } }
  ;({ useCode } = await import('./store'))
  t = await import('./trust')
  // Igual que `useServerCommands` del compositor: pide al motor en cuanto una carpeta es el foco.
  const seen = new Set<string>()
  const ask = (): void => {
    const d = useCode.getState().directory
    if (d && !seen.has(d)) {
      seen.add(d)
      engineCalls.push(d)
    }
  }
  ask()
  useCode.subscribe(ask)
}
afterEach(() => {
  delete (window.api as unknown as Record<string, unknown>).code
})

describe('foco restaurado al arrancar', () => {
  beforeEach(() => boot())

  it('al arrancar la carpeta restaurada NO es el foco (nada habla con el motor con ella), pero sigue abierta en la barra', () => {
    expect(useCode.getState().directory).toBeNull()
    expect(useCode.getState().restoredFocus).toBe(F)
    expect(useCode.getState().openDirectories).toEqual([F, B])
    expect(engineCalls).toEqual([])
  })

  it('trae un conector nuevo: mientras el diálogo está en pantalla no hay foco ni llamadas al motor; Cancelar la cierra y nunca las hay', async () => {
    scan.mockResolvedValue(result([mcp('viejo'), mcp('nuevo')]))
    const openProject = vi.fn(() => Promise.resolve())
    useCode.setState({ openProject } as never)
    const p = t.restoreFocusedProject()
    await flush()
    await flush()
    expect(scan).toHaveBeenCalledWith(F)
    expect(useCode.getState().directory).toBeNull()
    expect(engineCalls).toEqual([])
    expect(openProject).not.toHaveBeenCalled()
    t.resolveTrust(false)
    await p
    expect(useCode.getState().isTrusted(F)).toBe(false)
    expect(useCode.getState().directory).toBeNull()
    expect(useCode.getState().openDirectories).toEqual([B])
    expect(openProject).not.toHaveBeenCalled()
    expect(engineCalls).toEqual([])
  })

  it('trae un conector nuevo y la persona confía: solo entonces se abre (openProject) y se guarda lo nuevo', async () => {
    scan.mockResolvedValue(result([mcp('viejo'), mcp('nuevo')]))
    const openProject = vi.fn(() => Promise.resolve())
    useCode.setState({ openProject } as never)
    const p = t.restoreFocusedProject()
    await flush()
    await flush()
    expect(openProject).not.toHaveBeenCalled()
    t.resolveTrust(true)
    await p
    expect(openProject).toHaveBeenCalledWith(F)
    expect(useCode.getState().trustedScans[F]?.ids).toEqual(['mcp-viejo', 'mcp-nuevo'])
  })

  it('no trae nada nuevo: se abre igual que antes, sin diálogo', async () => {
    scan.mockResolvedValue(result([mcp('viejo')]))
    const openProject = vi.fn(() => Promise.resolve())
    useCode.setState({ openProject } as never)
    await t.restoreFocusedProject()
    expect(openProject).toHaveBeenCalledWith(F)
    expect(t.isFolderVerified(F)).toBe(true)
  })

  it('complemento de código nuevo (no conector): también se pregunta antes de abrir', async () => {
    const plugin: ProjectScanItem = { id: 'plugin-x', kind: 'plugin', name: 'x.js', where: '.opencode/plugin/x.js', risky: true }
    scan.mockResolvedValue(result([mcp('viejo'), plugin]))
    const openProject = vi.fn(() => Promise.resolve())
    useCode.setState({ openProject } as never)
    const p = t.restoreFocusedProject()
    await flush()
    await flush()
    expect(useCode.getState().restoredFocus).toBe(F) // sigue «revisando» mientras el diálogo está abierto
    expect(openProject).not.toHaveBeenCalled()
    t.resolveTrust(false)
    await p
    expect(useCode.getState().restoredFocus).toBeNull()
    expect(engineCalls).toEqual([])
  })

  it('el escaneo falla: NO se abre sola; pregunta («no pudimos revisar») y Cancelar la cierra', async () => {
    scan.mockRejectedValue(new Error('boom'))
    const openProject = vi.fn(() => Promise.resolve())
    useCode.setState({ openProject } as never)
    const p = t.restoreFocusedProject()
    await flush()
    await flush()
    expect(openProject).not.toHaveBeenCalled()
    t.resolveTrust(false)
    await p
    expect(openProject).not.toHaveBeenCalled()
    expect(useCode.getState().isTrusted(F)).toBe(false)
    expect(engineCalls).toEqual([])
  })

  it('restoreOpenProjects no carga el foco restaurado por su cuenta (lo verifica restoreFocusedProject)', async () => {
    scan.mockResolvedValue(result([mcp('viejo'), mcp('nuevo')]))
    const loadSessions = vi.fn(() => Promise.resolve())
    useCode.setState({ loadSessions } as never)
    await useCode.getState().restoreOpenProjects()
    expect(scan).not.toHaveBeenCalledWith(F)
    expect(loadSessions).not.toHaveBeenCalledWith(F)
  })

  it('cerrar la carpeta desde la barra antes de verificarla borra el foco restaurado', () => {
    useCode.getState().closeOneProject(F)
    expect(useCode.getState().restoredFocus).toBeNull()
  })
})

describe('foco restaurado sin confianza', () => {
  beforeEach(() => boot({ focusTrusted: false }))

  it('pasa por el diálogo de carpeta nueva antes de ser el foco; Cancelar la cierra', async () => {
    scan.mockResolvedValue(result([mcp('nuevo')]))
    const openProject = vi.fn(() => Promise.resolve())
    useCode.setState({ openProject } as never)
    const p = t.restoreFocusedProject()
    await flush()
    expect(useCode.getState().directory).toBeNull()
    t.resolveTrust(false)
    await p
    expect(openProject).not.toHaveBeenCalled()
    expect(engineCalls).toEqual([])
    expect(useCode.getState().openDirectories).toEqual([B])
  })
})

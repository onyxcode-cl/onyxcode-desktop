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

  it('Windows, rareza A (1.8.12): lo aprobado SÍ persiste; si el motor crea `.opencode/package.json` después, sale la re-pregunta SOLO de eso y, aceptada, no vuelve', async () => {
    // El motor puede crear `.opencode/package.json` (y `node_modules`) al instanciar la carpeta sin que la persona la haya abierto (Fallo 1 de Windows). Es un
    // elemento riesgoso NUEVO respecto de lo aprobado: la re-pregunta es correcta (no es una huella que no persiste), pero solo trae lo nuevo.
    const pkg: ProjectScanItem = {
      id: 'package-.opencode/package.json',
      kind: 'package',
      name: 'package.json',
      where: '.opencode/package.json',
      risky: true
    }
    const before = result([agent('a')])
    trusted(before)
    expect(st().trustedScans[D]!.huella).toBe(before.huella) // persistió la huella aprobada
    const after = result([agent('a'), pkg])
    scan.mockResolvedValue(after)
    const p = t.ensureTrusted(D)
    await flush()
    const pending = t.getPendingTrust()
    expect(pending?.again).toBe(true)
    expect(pending?.items.map((i) => i.id)).toEqual([pkg.id]) // solo lo nuevo, no la lista completa
    t.resolveTrust(true)
    await expect(p).resolves.toBe(true)
    expect(st().trustedScans[D]!.huella).toBe(after.huella)
    // Segunda apertura con lo mismo: sin diálogo.
    await expect(t.ensureTrusted(D)).resolves.toBe(true)
    expect(t.getPendingTrust()).toBeNull()
  })

  it('H2 (1.8.14): el `.opencode/package.json` con la forma exacta del motor que aparece después de confiar se guarda en silencio; uno distinto sí repregunta', async () => {
    const pkg = (engineGenerated?: boolean): ProjectScanItem => ({
      id: `package-${engineGenerated ? 'gen' : 'otro'}`,
      kind: 'package',
      name: 'package.json',
      where: '.opencode/package.json',
      risky: true,
      ...(engineGenerated ? { engineGenerated: true } : {})
    })
    trusted(result([agent('a')]))
    const gen = result([agent('a'), pkg(true)])
    scan.mockResolvedValue(gen)
    await expect(t.ensureTrusted(D)).resolves.toBe(true)
    expect(t.getPendingTrust()).toBeNull()
    expect(st().trustedScans[D]!.huella).toBe(gen.huella)
    // Otro contenido (sin la marca) después de confiar: sí se pregunta.
    scan.mockResolvedValue(result([agent('a'), pkg(false)]))
    const p = t.ensureTrusted(D)
    await flush()
    expect(t.getPendingTrust()?.items.map((i) => i.id)).toEqual(['package-otro'])
    t.resolveTrust(false)
    await p
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

  it('el escaneo falla en una carpeta de confianza: NO se abre sola (falla cerrado): diálogo «no pudimos revisar»; Cancelar la cierra y quita la confianza', async () => {
    st().trustFolder(D)
    scan.mockRejectedValue(new Error('boom'))
    const p = t.ensureTrusted(D)
    await flush()
    await flush()
    let settled = false
    void p.then(() => (settled = true))
    await flush()
    expect(settled).toBe(false)
    expect(pr.folderMcpOf(D)?.askAll).toBe(true)
    t.resolveTrust(false)
    await expect(p).resolves.toBe(false)
    expect(st().isTrusted(D)).toBe(false)
  })

  it('el escaneo vence el plazo en una carpeta de confianza: tampoco se abre sola', async () => {
    vi.useFakeTimers()
    st().trustFolder(D)
    scan.mockReturnValue(new Promise(() => undefined))
    const p = t.ensureTrusted(D)
    let settled = false
    void p.then(() => (settled = true))
    await vi.advanceTimersByTimeAsync(t.SCAN_TIMEOUT_MS + 100)
    expect(settled).toBe(false)
    t.resolveTrust(true)
    await expect(p).resolves.toBe(true)
  })

  it('escaneo incompleto y distinto de lo aprobado, sin nada riesgoso nuevo visible: se pregunta, no se guarda en silencio', async () => {
    const r = result([mcp('crm')])
    st().trustFolder(D, { huella: r.huella, ids: r.items.map((i) => i.id) })
    scan.mockResolvedValue(result([mcp('crm')], 'i-otra-huella', false))
    const p = t.ensureTrusted(D)
    await flush()
    await flush()
    let settled = false
    void p.then(() => (settled = true))
    await flush()
    expect(settled).toBe(false)
    expect(st().trustedScans[D]?.huella).toBe(r.huella)
    t.resolveTrust(false)
    await expect(p).resolves.toBe(false)
  })

  it('escaneo completo, misma carpeta de confianza sin novedades: abre sin diálogo', async () => {
    const r = result([mcp('crm')])
    st().trustFolder(D, { huella: r.huella, ids: r.items.map((i) => i.id) })
    scan.mockResolvedValue(r)
    await expect(t.ensureTrusted(D)).resolves.toBe(true)
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

  it('verifyTrustedFolder: ya aceptada en esta ejecución, no vuelve a escanear', async () => {
    st().trustFolder(D)
    scan.mockResolvedValue(result([]))
    await expect(t.verifyTrustedFolder(D)).resolves.toBe(true)
    await expect(t.verifyTrustedFolder(D)).resolves.toBe(true)
    expect(scan).toHaveBeenCalledTimes(1)
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

describe('RI2: diálogos reemplazados, cancelar sin foco, foco a carpeta sin confianza y resync', () => {
  const A = '/work/a'
  const B = '/work/b'
  const withNew = (): ProjectScanResult => result([mcp('crm'), mcp('nuevo')])
  const trustedWith = (dir: string): void => {
    const r = result([mcp('crm')])
    st().trustFolder(dir, { huella: r.huella, ids: r.items.map((i) => i.id) })
  }

  it('una re-pregunta NO se cancela porque llegue otro diálogo: espera su turno en la cola', async () => {
    trustedWith(B)
    scan.mockResolvedValue(withNew())
    const first = t.verifyTrustedFolder(B)
    await flush()
    scan.mockResolvedValue(result([]))
    const second = t.ensureTrusted(A) // carpeta nueva: espera detrás de la re-pregunta de B
    await flush()
    expect(st().isTrusted(B)).toBe(true)
    t.resolveTrust(true) // se responde la de B
    await expect(first).resolves.toBe(true)
    expect(t.isFolderVerified(B)).toBe(true)
    await flush()
    t.resolveTrust(false) // ahora el de A
    await expect(second).resolves.toBe(false)
  })

  it('arranque con DOS re-preguntas (la enfocada y otra): salen una a una, ninguna pierde la confianza sola y el foco no pasa a la que espera', async () => {
    const F = '/work/f'
    trustedWith(F)
    trustedWith(B)
    useCode.setState({ directory: F, openDirectories: [F, B] })
    scan.mockResolvedValue(withNew())
    const pf = t.openProjectTrusted(F, { passive: true })
    const rb = st().restoreOpenProjects()
    await flush()
    await flush()
    expect(st().isTrusted(F)).toBe(true)
    expect(st().isTrusted(B)).toBe(true)
    // Cancelar la de F: se cierra y el foco NO pasa a B (aún sin aceptar).
    t.resolveTrust(false)
    await expect(pf).resolves.toBe(false)
    expect(st().isTrusted(F)).toBe(false)
    expect(st().directory).not.toBe(B)
    await flush()
    t.resolveTrust(true) // ahora la de B
    await rb
    expect(st().isTrusted(B)).toBe(true)
    expect(t.isFolderVerified(B)).toBe(true)
  })

  it('verificar dos veces a la vez la misma carpeta comparte el diálogo (una sola pregunta)', async () => {
    trustedWith(B)
    scan.mockResolvedValue(withNew())
    const one = t.verifyTrustedFolder(B)
    const two = t.verifyTrustedFolder(B)
    await flush()
    t.resolveTrust(true)
    await expect(one).resolves.toBe(true)
    await expect(two).resolves.toBe(true)
  })

  it('«escaneada» no es «aceptada»: verifyTrustedFolder vuelve a verificar una carpeta escaneada pero sin aceptar', async () => {
    trustedWith(B)
    pr.setFolderMcp(B, result([mcp('crm')]))
    scan.mockResolvedValue(result([mcp('crm')]))
    expect(t.isFolderVerified(B)).toBe(false)
    await expect(t.verifyTrustedFolder(B)).resolves.toBe(true)
    expect(scan).toHaveBeenCalledTimes(1)
    expect(t.isFolderVerified(B)).toBe(true)
  })

  it('cancelar la re-pregunta de una carpeta SIN foco la cierra (no se puede cargar después sin preguntar)', async () => {
    trustedWith(B)
    useCode.setState({ directory: A, openDirectories: [A, B] })
    scan.mockResolvedValue(withNew())
    const p = t.verifyTrustedFolder(B)
    await flush()
    t.resolveTrust(false)
    await expect(p).resolves.toBe(false)
    expect(st().openDirectories).toEqual([A])
    expect(st().directory).toBe(A)
  })

  it('focusProject a una carpeta sin confianza NO le da el foco: pasa por el diálogo', async () => {
    useCode.setState({ directory: A, openDirectories: [A, B] })
    scan.mockResolvedValue(result([mcp('crm')]))
    await st().focusProject(B)
    await flush()
    expect(st().directory).toBe(A)
    expect(scan).toHaveBeenCalledWith(B)
    t.resolveTrust(false)
    await flush()
    expect(st().directory).toBe(A)
  })

  it('restoreOpenProjects no carga una carpeta que la persona rechazó mientras el bucle esperaba otra', async () => {
    const C = '/work/c'
    trustedWith(B)
    trustedWith(C)
    useCode.setState({ directory: A, openDirectories: [A, B, C] })
    const loadSessions = vi.fn(() => Promise.resolve())
    useCode.setState({ loadSessions } as never)
    scan.mockResolvedValue(withNew())
    const restore = st().restoreOpenProjects() // empieza por B (re-pregunta abierta)
    await flush()
    await flush()
    // Mientras tanto la persona rechaza C por otra vía: pierde la confianza y se cierra.
    st().untrustFolder(C)
    st().closeOneProject(C)
    t.resolveTrust(true) // acepta B
    await restore
    expect(loadSessions.mock.calls.map((c) => (c as unknown[])[0])).toEqual([B])
  })

  it('verifyTrustedFolder devuelve false para una carpeta sin confianza (no se carga)', async () => {
    await expect(t.verifyTrustedFolder('/work/sin')).resolves.toBe(false)
  })

  it('resync solo recarga las carpetas de confianza ya verificadas', async () => {
    const loadSessions = vi.fn(() => Promise.resolve())
    useCode.setState({ directory: A, openDirectories: [A, B], loadSessions } as never)
    st().trustFolder(B)
    await st().resync()
    expect(loadSessions.mock.calls.map((c) => (c as unknown[])[0])).toEqual([A])
    scan.mockResolvedValue(result([]))
    await t.verifyTrustedFolder(B)
    loadSessions.mockClear()
    await st().resync()
    expect(loadSessions.mock.calls.map((c) => (c as unknown[])[0]).sort()).toEqual([A, B])
  })
})

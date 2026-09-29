/**
 * Terminales integradas sobre `node-pty`.
 *
 * node-pty se carga de forma perezosa con `createRequire` (fuera del análisis del bundler, ya que
 * es un módulo nativo). Si falla la carga, el servicio queda "no disponible" y `create` lanza un
 * error legible en vez de tumbar el proceso principal.
 */
import { existsSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type * as NodePty from 'node-pty'
import { APP_NAME } from '@shared/brand'
import type { PtyAvailability, PtyCreateRequest, PtyInfo } from '@shared/ipc-code'
import { withDisclaim } from '../process/disclaim'

type PtyModule = typeof NodePty

export interface PtyServiceEvents {
  onData(id: string, data: string): void
  onExit(id: string, exitCode: number, signal?: number): void
}

interface Session {
  info: PtyInfo
  pty: NodePty.IPty
  /** Clave del dueño (p.ej. id del webContents) para limpiar al cerrar ventanas. */
  owner: string | number | undefined
  disposers: NodePty.IDisposable[]
}

let cachedModule: PtyModule | null | undefined
let loadError: string | undefined

function loadNodePty(): PtyModule | null {
  if (cachedModule !== undefined) return cachedModule
  const bases = [typeof __filename === 'string' ? __filename : undefined, join(process.cwd(), 'package.json')].filter(
    (b): b is string => !!b
  )
  const errors: string[] = []
  for (const base of bases) {
    try {
      const req = createRequire(base)
      cachedModule = req('node-pty') as PtyModule
      loadError = undefined
      return cachedModule
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err))
    }
  }
  loadError = errors[0] ?? 'node-pty no disponible'
  console.error('[pty] no se pudo cargar node-pty:', loadError)
  cachedModule = null
  return null
}

function defaultShell(): string {
  const env = process.env.SHELL
  if (env && isAbsolute(env) && existsSync(env)) return env
  if (process.platform === 'win32') return process.env.COMSPEC || 'powershell.exe'
  for (const s of ['/bin/zsh', '/bin/bash', '/bin/sh']) if (existsSync(s)) return s
  return '/bin/sh'
}

function clampDim(n: unknown, fallback: number, max: number): number {
  const v = Math.floor(Number(n))
  return Number.isFinite(v) && v > 0 ? Math.min(v, max) : fallback
}

export class PtyService {
  private sessions = new Map<string, Session>()

  constructor(private readonly events: PtyServiceEvents) {}

  availability(): PtyAvailability {
    const mod = loadNodePty()
    return mod ? { available: true } : { available: false, error: loadError }
  }

  create(req: PtyCreateRequest, owner?: string | number): PtyInfo {
    const mod = loadNodePty()
    if (!mod) throw new Error(`La terminal no está disponible (node-pty): ${loadError ?? 'error desconocido'}`)

    let cwd = typeof req.cwd === 'string' && isAbsolute(req.cwd) ? req.cwd : homedir()
    if (!existsSync(cwd) || !statSync(cwd).isDirectory()) cwd = homedir()

    const shell = req.shell && isAbsolute(req.shell) && existsSync(req.shell) ? req.shell : defaultShell()
    const args = process.platform === 'win32' ? [] : ['-l']
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env)) if (typeof v === 'string') env[k] = v
    env.TERM = 'xterm-256color'
    env.COLORTERM = 'truecolor'
    env.TERM_PROGRAM = APP_NAME
    if (!env.LANG) env.LANG = 'en_US.UTF-8'
    // Variables propias de Electron que no deben filtrarse a la shell del usuario (mismo criterio
    // que `child-env.ts`, pero conservando el resto del entorno del usuario tal cual: la terminal
    // es una acción del usuario, no un servidor headless, así que no conviene sobre-restringir).
    delete env.ELECTRON_RUN_AS_NODE
    delete env.ELECTRON_RENDERER_URL
    delete env.NODE_OPTIONS
    for (const k of Object.keys(env)) if (k.startsWith('DYLD_')) delete env[k]

    // Desvinculada de TCC (AUDIT.md: "el PTY de la terminal integrada aún hereda los permisos de
    // OnyxCode"), igual que los `opencode serve` (`process/disclaim.ts`): la shell del usuario no debe
    // heredar Accesibilidad/Grabación de pantalla concedidas a OnyxCode para computer use. Solo cambia
    // el binario que se ejecuta (mismo PID/grupo); el shell sigue siendo interactivo con su entorno
    // normal (login shell, TERM, LANG, PATH, etc).
    const launch = withDisclaim(shell, args)

    const pty = mod.spawn(launch.command, launch.args, {
      name: 'xterm-256color',
      cols: clampDim(req.cols, 80, 1000),
      rows: clampDim(req.rows, 24, 500),
      cwd,
      env
    })

    const id = randomUUID()
    const info: PtyInfo = { id, pid: pty.pid, cwd }
    const session: Session = { info, pty, owner, disposers: [] }
    session.disposers.push(
      pty.onData((data) => this.events.onData(id, data)),
      pty.onExit(({ exitCode, signal }) => {
        this.cleanup(id)
        this.events.onExit(id, exitCode, signal)
      })
    )
    this.sessions.set(id, session)
    return info
  }

  write(id: string, data: string): void {
    if (typeof data !== 'string') return
    this.get(id).pty.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    const s = this.get(id)
    try {
      s.pty.resize(clampDim(cols, 80, 1000), clampDim(rows, 24, 500))
    } catch {
      // el proceso puede haber terminado entre medio
    }
  }

  /** Mata la terminal; el evento `onExit` se emite cuando el proceso termina (o a los 3 s). */
  kill(id: string): void {
    const s = this.sessions.get(id)
    if (!s) return
    try {
      s.pty.kill()
    } catch {
      // ya terminado
    }
    setTimeout(() => {
      if (this.sessions.get(id) !== s) return
      try {
        s.pty.kill('SIGKILL')
      } catch {
        // ignorar
      }
      this.cleanup(id)
      this.events.onExit(id, -1)
    }, 3000).unref()
  }

  list(owner?: string | number): PtyInfo[] {
    return [...this.sessions.values()].filter((s) => owner === undefined || s.owner === owner).map((s) => s.info)
  }

  /** Mata todas las terminales de un dueño (p.ej. al destruirse un webContents). */
  killOwner(owner: string | number): void {
    for (const s of [...this.sessions.values()]) if (s.owner === owner) this.destroy(s.info.id)
  }

  /** Mata todo de forma síncrona y sin emitir eventos (para el cierre de la app). */
  killAll(): void {
    for (const id of [...this.sessions.keys()]) this.destroy(id)
  }

  private destroy(id: string): void {
    const s = this.sessions.get(id)
    if (!s) return
    this.cleanup(id)
    try {
      s.pty.kill(process.platform === 'win32' ? undefined : 'SIGHUP')
    } catch {
      // ignorar
    }
  }

  isOwner(id: string, owner: string | number): boolean {
    return this.sessions.get(id)?.owner === owner
  }

  private get(id: string): Session {
    const s = this.sessions.get(id)
    if (!s) throw new Error(`Terminal no encontrada: ${id}`)
    return s
  }

  private cleanup(id: string): void {
    const s = this.sessions.get(id)
    if (!s) return
    this.sessions.delete(id)
    for (const d of s.disposers) {
      try {
        d.dispose()
      } catch {
        // ignorar
      }
    }
  }
}

/**
 * Registro de PIDs de los `opencode serve` lanzados por la app (`userData/pids.json`).
 *
 * Los servidores se lanzan `detached` (líder de su propio grupo de procesos) para poder matar
 * el GRUPO entero (`process.kill(-pid)`): MCP locales, `computer-mcp.js`, bash en curso…
 * Si la app muere sin `exit` limpio (crash, kill -9), al siguiente arranque
 * `killStaleServers()` mata los grupos que sigan vivos, verificando antes que el PID sea
 * realmente un `opencode serve` (el PID pudo reutilizarse) — AUDIT.md B3.
 */
import { app } from 'electron'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { LEGACY_FULL_ACCESS_PID_KIND, LEGACY_SANDBOX_PID_KIND } from '../migrations/legacy-names'

interface PidEntry {
  pid: number
  kind: string
  startedAt: number
  /** PID del proceso main de la app que lo lanzó (otra instancia viva ⇒ no tocar). */
  owner?: number
}

function alive(pid: number | undefined): boolean {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function file(): string {
  return join(app.getPath('userData'), 'pids.json')
}

/**
 * `kind` que escribía una versión anterior (`cowork`, `cowork-full`) → el actual. Un `pids.json` de
 * una ejecución previa puede traerlos: `killStaleServers` debe seguir reconociendo esos servidores.
 */
export function normalizePidKind(kind: unknown): string {
  if (kind === LEGACY_SANDBOX_PID_KIND) return 'tasks'
  if (kind === LEGACY_FULL_ACCESS_PID_KIND) return 'tasks-full'
  return typeof kind === 'string' ? kind : 'desconocido'
}

function read(): PidEntry[] {
  try {
    const raw = JSON.parse(readFileSync(file(), 'utf8')) as unknown
    if (!Array.isArray(raw)) return []
    return raw
      .filter((e): e is PidEntry => !!e && typeof e === 'object' && Number.isInteger((e as PidEntry).pid) && (e as PidEntry).pid > 1)
      .map((e) => ({ ...e, kind: normalizePidKind(e.kind) }))
  } catch {
    return []
  }
}

function write(list: PidEntry[]): void {
  try {
    const f = file()
    mkdirSync(dirname(f), { recursive: true })
    writeFileSync(`${f}.tmp`, JSON.stringify(list, null, 2), 'utf8')
    renameSync(`${f}.tmp`, f)
  } catch (err) {
    console.error('[pids] no se pudo guardar pids.json:', err)
  }
}

export function trackPid(pid: number | undefined, kind: string): void {
  if (!pid) return
  const list = read().filter((e) => e.pid !== pid)
  list.push({ pid, kind, startedAt: Date.now(), owner: process.pid })
  write(list)
}

export function untrackPid(pid: number | undefined): void {
  if (!pid) return
  const list = read()
  const next = list.filter((e) => e.pid !== pid)
  if (next.length !== list.length) write(next)
}

/** Línea de comandos y grupo de un PID vivo (null si no existe). */
function inspect(pid: number): { pgid: number; command: string } | null {
  try {
    const out = execFileSync('/bin/ps', ['-o', 'pgid=,command=', '-p', String(pid)], {
      encoding: 'utf8',
      timeout: 3000
    }).trim()
    const m = /^(\d+)\s+(.*)$/.exec(out)
    return m ? { pgid: Number(m[1]), command: m[2] } : null
  } catch {
    return null // ps sale con 1 si el PID no existe
  }
}

/** ¿Es un `opencode serve` (directo o vía sandbox-exec)? */
export function isOpencodeServe(command: string): boolean {
  return /(^|\/)opencode(\s|$)/.test(command) && /\sserve(\s|$)/.test(command)
}

/** PIDs descendientes de `root` (snapshot de `ps`; vacío si falla). */
function descendants(root: number): number[] {
  let out: string
  try {
    out = execFileSync('/bin/ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8', timeout: 3000 })
  } catch {
    return []
  }
  const children = new Map<number, number[]>()
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)/.exec(line)
    if (!m) continue
    const pid = Number(m[1])
    const ppid = Number(m[2])
    const list = children.get(ppid) ?? []
    list.push(pid)
    children.set(ppid, list)
  }
  const result: number[] = []
  const stack = [...(children.get(root) ?? [])]
  while (stack.length) {
    const pid = stack.pop() as number
    if (pid === process.pid || result.includes(pid)) continue
    result.push(pid)
    stack.push(...(children.get(pid) ?? []))
  }
  return result
}

function signalSafe(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(pid, signal)
    return true
  } catch {
    return false
  }
}

/**
 * Envía `signal` al árbol de `pid`: su grupo de procesos (si lo encabeza) y además cada
 * descendiente con su propio grupo (OpenCode lanza bash/MCP `detached`, en grupos propios, y
 * sobrevivirían a un `kill(-pid)`). Nunca lanza.
 */
export function killTree(pid: number | undefined, signal: NodeJS.Signals = 'SIGKILL'): void {
  if (!pid) return
  const tree = descendants(pid)
  for (const d of tree) {
    signalSafe(-d, signal) // su grupo, si lo encabeza
    signalSafe(d, signal)
  }
  if (!signalSafe(-pid, signal)) signalSafe(pid, signal)
}

/** Al arrancar: mata servidores huérfanos de una ejecución anterior que terminó mal. */
export function killStaleServers(): number {
  const list = read()
  if (!list.length) return 0
  let killed = 0
  const keep: PidEntry[] = []
  for (const e of list) {
    if (e.pid === process.pid) continue
    if (e.owner && e.owner !== process.pid && alive(e.owner)) {
      keep.push(e) // de otra instancia de la app que sigue viva
      continue
    }
    const info = inspect(e.pid)
    if (!info || !isOpencodeServe(info.command)) continue
    // Solo matar el grupo si el proceso lo encabeza (lanzado detached por la app).
    if (info.pgid === e.pid) killTree(e.pid, 'SIGKILL')
    else {
      try {
        process.kill(e.pid, 'SIGKILL')
      } catch {
        // ignorar
      }
    }
    killed++
    console.log(`[pids] servidor huérfano eliminado pid=${e.pid} (${e.kind})`)
  }
  write(keep)
  return killed
}

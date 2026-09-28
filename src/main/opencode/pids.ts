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

function read(): PidEntry[] {
  try {
    const raw = JSON.parse(readFileSync(file(), 'utf8')) as unknown
    if (!Array.isArray(raw)) return []
    return raw.filter(
      (e): e is PidEntry => !!e && typeof e === 'object' && Number.isInteger((e as PidEntry).pid) && (e as PidEntry).pid > 1
    )
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

/**
 * Envía `signal` al grupo de procesos de `pid` (si es su líder) o, si no, solo al proceso.
 * Nunca lanza.
 */
export function killTree(pid: number | undefined, signal: NodeJS.Signals = 'SIGKILL'): void {
  if (!pid) return
  try {
    process.kill(-pid, signal)
    return
  } catch {
    // no es líder de grupo (o ya murió)
  }
  try {
    process.kill(pid, signal)
  } catch {
    // ya terminó
  }
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

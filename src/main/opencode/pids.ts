/**
 * Registro de PIDs de los `opencode serve` lanzados por la app (`userData/pids.json`).
 *
 * Los servidores se lanzan `detached` (líder de su propio grupo de procesos) para poder matar
 * el GRUPO entero (`process.kill(-pid)`): MCP locales, `computer-mcp.js`, bash en curso…
 * Si la app muere sin `exit` limpio (crash, kill -9), al siguiente arranque
 * `killStaleServers()` mata los grupos que sigan vivos, verificando antes que el PID sea
 * realmente un `opencode serve` (el PID pudo reutilizarse) — AUDIT.md B3.
 *
 * Windows: no hay grupos POSIX ni `/bin/ps`. El árbol se mata con `taskkill /PID n /T /F` y la
 * inspección (línea de comandos y descendientes) usa `Get-CimInstance Win32_Process` vía PowerShell
 * (`wmic` no existe en Windows 11 reciente); solo se consulta si hay `pids.json` con entradas.
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
 * `kind` de tipo antiguo que escribía una versión anterior (sandbox y acceso total) → el actual. Un `pids.json` de
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

const WIN_QUERY_TIMEOUT_MS = 5000
const isWin = (): boolean => process.platform === 'win32'

interface WinProc {
  pid: number
  ppid: number
  command: string
}

/** Interpreta el JSON de `ConvertTo-Json` (objeto suelto o lista) de procesos CIM. */
export function parseWinProcesses(out: string): WinProc[] {
  const text = out.trim()
  if (!text) return []
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return []
  }
  const list = Array.isArray(raw) ? raw : [raw]
  const rows: WinProc[] = []
  for (const r of list as Array<Record<string, unknown>>) {
    const pid = Number(r?.ProcessId)
    if (!Number.isInteger(pid)) continue
    rows.push({ pid, ppid: Number(r.ParentProcessId) || 0, command: typeof r.CommandLine === 'string' ? r.CommandLine : '' })
  }
  return rows
}

/** Consulta CIM (PowerShell, sin perfil, con timeout). `pid` limita a un proceso; sin él, todos. */
function queryWinProcesses(pid?: number): WinProc[] {
  const filter = pid ? ` -Filter 'ProcessId=${Math.trunc(pid)}'` : ''
  const script = `Get-CimInstance Win32_Process${filter} | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress`
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      encoding: 'utf8',
      timeout: WIN_QUERY_TIMEOUT_MS,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore']
    })
    return parseWinProcesses(out)
  } catch {
    return []
  }
}

/** Línea de comandos y grupo de un PID vivo (null si no existe). En Windows no hay grupo: `pgid` = pid. */
function inspect(pid: number): { pgid: number; command: string } | null {
  if (isWin()) {
    const row = queryWinProcesses(pid).find((r) => r.pid === pid)
    return row ? { pgid: pid, command: row.command } : null
  }
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

/** ¿Es un `opencode serve` (directo o vía sandbox-exec; `opencode` o `"…\opencode.exe"` en Windows)? */
export function isOpencodeServe(command: string): boolean {
  return /(^|[\\/"])opencode(\.exe)?"?(\s|$)/i.test(command) && /\sserve(\s|$)/.test(command)
}

/**
 * ¿Es un `cloudflared` del modo viaje de ESTA app? (el binario en su ruta fija `…/bin/cloudflared-<versión>/cloudflared` lanzado
 * con `tunnel … --url http://127.0.0.1:`, o el vigía `/bin/sh -c …` que lo envuelve y lleva esa misma ruta). Un PID reciclado por otro
 * programa, o un `cloudflared` del usuario en otra ruta, no casan.
 */
export function isOurCloudflared(command: string): boolean {
  // macOS: `…/bin/cloudflared-<v>/cloudflared`. Windows (línea de CIM, con comillas y barras invertidas): `"…\bin\cloudflared-<v>\cloudflared.exe"`.
  if (!/[\\/]bin[\\/]cloudflared-[0-9A-Za-z._-]+[\\/]cloudflared(?:\.exe)?"?(\s|$)/i.test(command)) return false
  if (!/\s--url http:\/\/127\.0\.0\.1:\d+(\s|$)/.test(command)) return false
  if (/\s--no-autoupdate(\s|$)/.test(command) === false) return false
  return /(^|\s)tunnel(\s|$)/.test(command)
}

/** Descendientes de `root` en una tabla pid→ppid (sin `root`, sin `self`). */
export function collectDescendants(pairs: Array<[number, number]>, root: number, self = process.pid): number[] {
  const children = new Map<number, number[]>()
  for (const [pid, ppid] of pairs) {
    const list = children.get(ppid) ?? []
    list.push(pid)
    children.set(ppid, list)
  }
  const result: number[] = []
  const stack = [...(children.get(root) ?? [])]
  while (stack.length) {
    const pid = stack.pop() as number
    if (pid === self || result.includes(pid)) continue
    result.push(pid)
    stack.push(...(children.get(pid) ?? []))
  }
  return result
}

/** PIDs descendientes de `root` (snapshot de `ps`; vacío si falla). */
export function descendantsOf(root: number): number[] {
  return descendants(root)
}

function descendants(root: number): number[] {
  let out: string
  try {
    out = execFileSync('/bin/ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8', timeout: 3000 })
  } catch {
    return []
  }
  const pairs: Array<[number, number]> = []
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)/.exec(line)
    if (m) pairs.push([Number(m[1]), Number(m[2])])
  }
  return collectDescendants(pairs, root)
}

/** Procesos vivos de un grupo (snapshot de `ps`; vacío si falla). */
function groupMembers(pgid: number): Array<{ pid: number; command: string }> {
  let out: string
  try {
    out = execFileSync('/bin/ps', ['-A', '-o', 'pid=,pgid=,command='], { encoding: 'utf8', timeout: 3000 })
  } catch {
    return []
  }
  const rows: Array<{ pid: number; command: string }> = []
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)
    if (m && Number(m[2]) === pgid && Number(m[1]) !== process.pid) rows.push({ pid: Number(m[1]), command: m[3] })
  }
  return rows
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
 * sobrevivirían a un `kill(-pid)`). Nunca lanza. Devuelve los PID de los descendientes que vio
 * (vacío en Windows): quien espera a que el líder muera debe volver a matarlos con `killPids`, porque
 * al morir el líder sus hijos pasan a ser de `init` y `killTree` ya no los encuentra por parentesco.
 */
export function killTree(pid: number | undefined, signal: NodeJS.Signals = 'SIGKILL'): number[] {
  if (!pid) return []
  if (isWin()) {
    // Sin grupos POSIX: `taskkill /T` recorre el árbol por PID padre; /F porque no hay SIGTERM.
    try {
      execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { timeout: WIN_QUERY_TIMEOUT_MS, windowsHide: true, stdio: 'ignore' })
    } catch {
      // ya muerto o sin permiso
    }
    return []
  }
  const tree = descendants(pid)
  for (const d of tree) {
    signalSafe(-d, signal) // su grupo, si lo encabeza
    signalSafe(d, signal)
  }
  if (!signalSafe(-pid, signal)) signalSafe(pid, signal)
  return tree
}

/**
 * Remata PID ya conocidos (los que devolvió `killTree` antes de que el líder muriera): su grupo, si lo encabezan, y ellos.
 * Un proceso que ignoró SIGTERM (`trap '' TERM`) o tardó en salir no queda huérfano. Un PID reciclado entre las dos
 * llamadas es improbable en el intervalo de gracia (segundos) y solo recibe la señal si encabeza grupo propio. Nunca lanza.
 */
export function killPids(pids: readonly number[], signal: NodeJS.Signals = 'SIGKILL'): void {
  if (isWin()) return
  for (const p of pids) {
    if (!Number.isInteger(p) || p <= 1 || p === process.pid) continue
    signalSafe(-p, signal)
    signalSafe(p, signal)
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
    if (!info && e.kind === 'cloudflared' && !isWin()) {
      // El vigía murió pero su `cloudflared` pudo quedar vivo en el mismo grupo: se mata solo si es de verdad el nuestro.
      for (const m of groupMembers(e.pid)) {
        if (!isOurCloudflared(m.command)) continue
        signalSafe(m.pid, 'SIGKILL')
        killed++
        console.log(`[pids] cloudflared huérfano eliminado pid=${m.pid}`)
      }
      continue
    }
    if (!info || !(isOpencodeServe(info.command) || (e.kind === 'cloudflared' && isOurCloudflared(info.command)))) continue
    // Solo matar el grupo si el proceso lo encabeza (lanzado detached por la app). En Windows el árbol
    // siempre se mata con taskkill /T.
    if (isWin() || info.pgid === e.pid) killTree(e.pid, 'SIGKILL')
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

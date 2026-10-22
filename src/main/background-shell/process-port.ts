/**
 * Puerto de procesos del manager: lanzar en grupo propio, señalar grupos, identidad de un PID y muestreo de CPU
 * del árbol. Todo inyectable; aquí van las implementaciones reales para POSIX (macOS/Linux) y un mínimo para Windows.
 *
 * Windows (NO probado en este paquete): `taskkill /T /F` termina el árbol; no hay identidad de PID ni muestreo de CPU
 * (devuelven `null`), así que allí la supervisión usa solo la salida y los archivos observados y la limpieza de restos
 * al arrancar no mata nada (falla cerrado: sin identidad, no se toca un PID).
 */
import { spawn, execFile } from 'node:child_process'

export interface SpawnedChild {
  /** `undefined` si el lanzamiento falló antes de tener PID. */
  pid: number | undefined
  onData(cb: (chunk: Buffer) => void): void
  /** El proceso líder terminó (los nietos pueden seguir). */
  onExit(cb: (code: number | null, signal: string | null) => void): void
  /** Se cerraron los pipes de salida. */
  onClose(cb: () => void): void
  onError(cb: (err: Error) => void): void
}

export interface CpuSample {
  /** CPU acumulada (segundos) de todo el árbol vivo. */
  cpuSeconds: number
  /** PIDs del árbol: un cambio de membresía también es actividad. */
  pids: number[]
}

export interface ProcessPort {
  spawn(command: string, opts: { cwd: string; env: Record<string, string> }): SpawnedChild
  /** Envía `signal` al grupo de procesos `pgid`. `false` si el grupo ya no existe. */
  killGroup(pgid: number, signal: 'SIGTERM' | 'SIGKILL'): boolean
  groupAlive(pgid: number): boolean
  /** Marca estable de "este PID es este proceso" (hora de inicio); `null` si no existe o no se puede saber. */
  identity(pid: number): Promise<string | null>
  /** CPU del árbol del trabajo; `null` si no se puede muestrear (sandbox, plataforma). */
  sampleCpu(rootPid: number): Promise<CpuSample | null>
}

/** "9:58.60", "00:01:02", "1-02:03:04" -> segundos. */
export function parsePsTime(s: string): number | null {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(s.trim())
  if (!m) return null
  const [, d, h, mi, sec] = m
  return Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(mi) * 60 + Number(sec)
}

interface PsRow {
  pid: number
  ppid: number
  pgid: number
  cpu: number
}

export function parsePsTable(out: string): PsRow[] {
  const rows: PsRow[] = []
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s*$/.exec(line)
    if (!m) continue
    const cpu = parsePsTime(m[4])
    if (cpu === null) continue
    rows.push({ pid: Number(m[1]), ppid: Number(m[2]), pgid: Number(m[3]), cpu })
  }
  return rows
}

/** Árbol del trabajo: el grupo de `rootPid` más sus descendientes por PPID. */
export function treeOf(rows: PsRow[], rootPid: number): PsRow[] {
  const inTree = new Set<number>([rootPid])
  let grew = true
  while (grew) {
    grew = false
    for (const r of rows) {
      if (!inTree.has(r.pid) && (r.pgid === rootPid || inTree.has(r.ppid))) {
        inTree.add(r.pid)
        grew = true
      }
    }
  }
  return rows.filter((r) => inTree.has(r.pid))
}

function run(file: string, args: string[], timeoutMs = 4000): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      resolve(err ? null : String(stdout))
    })
  })
}

export function createNodeProcessPort(platform: NodeJS.Platform = process.platform): ProcessPort {
  const win = platform === 'win32'
  return {
    spawn(command, { cwd, env }) {
      const child = win
        ? spawn(command, { cwd, env, shell: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
        : spawn('/bin/sh', ['-c', command], { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
      return {
        pid: child.pid,
        onData: (cb) => {
          child.stdout?.on('data', cb)
          child.stderr?.on('data', cb)
        },
        onExit: (cb) => child.on('exit', cb),
        onClose: (cb) => child.on('close', () => cb()),
        onError: (cb) => child.on('error', cb)
      }
    },
    killGroup(pgid, signal) {
      if (win) {
        void run('taskkill', ['/PID', String(pgid), '/T', '/F'])
        return true
      }
      try {
        process.kill(-pgid, signal)
        return true
      } catch {
        return false
      }
    },
    groupAlive(pgid) {
      if (win) return false
      try {
        process.kill(-pgid, 0)
        return true
      } catch (e) {
        // EPERM: existe pero no es nuestro. Para un grupo propio no debería pasar; se trata como vivo por prudencia.
        return (e as NodeJS.ErrnoException).code === 'EPERM'
      }
    },
    async identity(pid) {
      if (win) return null
      const out = await run('ps', ['-o', 'lstart=', '-p', String(pid)])
      const t = out?.trim()
      return t ? t : null
    },
    async sampleCpu(rootPid) {
      if (win) return null
      const out = await run('ps', ['-axo', 'pid=,ppid=,pgid=,time='])
      if (out === null) return null
      const tree = treeOf(parsePsTable(out), rootPid)
      return { cpuSeconds: tree.reduce((a, r) => a + r.cpu, 0), pids: tree.map((r) => r.pid).sort((a, b) => a - b) }
    }
  }
}

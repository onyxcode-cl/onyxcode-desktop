/**
 * Proceso `cloudflared` del modo viaje (túnel rápido, sin cuenta). Garantía de CERO procesos huérfanos en tres capas:
 *  1. parada ordenada (`stop()`: cierra el `stdin` del vigía, `killTree` con SIGTERM, espera, SIGKILL a todo el árbol) y `killNow()`
 *     síncrono (también al salir de la app: `process.on('exit')`);
 *  2. el VIGÍA `/bin/sh` envuelve al binario: si OnyxCode muere (incluso con `kill -9`) su `stdin` se cierra, `cat` termina y el
 *     vigía mata al túnel (verificado en T0: 0,12 s). Además deja SOLO a `cloudflared` con `stderr` abierto, así que el cierre de
 *     `stderr` delata su muerte al instante;
 *  3. `pids.json` (`kind: 'cloudflared'`) + `killStaleServers()` en el siguiente arranque.
 *
 * Lanzado en su propio grupo (`detached`), vía `withDisclaim` (no hereda los permisos TCC de OnyxCode), con entorno mínimo y
 * `HOME` privado (no lee `~/.cloudflared`). SIEMPRE `--no-autoupdate`. NUNCA `--config` (un archivo vacío da `ERR … was empty`).
 * La URL sale de `stderr` (stdout viene vacío) con una regex estricta y solo DESPUÉS del banner «Your quick Tunnel has been created».
 */
import type { ChildProcess, spawn as nodeSpawn } from 'node:child_process'
import { chmodSync, mkdirSync } from 'node:fs'
import { TRAVEL_PROCESS, TUNNEL_URL_SCAN_RE, type TravelError } from '@shared/remote/travel'

export type CfState = 'starting' | 'online' | 'connecting' | 'exited'
export type StartErrorCode =
  Extract<TravelError, 'rate' | 'edge-unreachable' | 'config-conflict' | 'timeout' | 'bad-url'> | `exited:${number}`

export class TunnelStartError extends Error {
  constructor(readonly code: StartErrorCode) {
    super(code)
  }
}

export interface CloudflaredDeps {
  spawn: typeof nodeSpawn
  killTree(pid: number | undefined, signal?: NodeJS.Signals): void
  descendants(pid: number): number[]
  trackPid(pid: number | undefined, kind: string): void
  untrackPid(pid: number | undefined): void
  withDisclaim(command: string, args: string[]): { command: string; args: string[]; disclaimed: boolean }
}

/**
 * Vigía: lanza el binario en segundo plano, deja SOLO a `cloudflared` con `stdout`/`stderr`, y espera a que se cierre `stdin`
 * (la app murió o pidió parar) para matarlo (TERM, 2 s, KILL). `trap … EXIT` cubre una salida del propio vigía.
 */
export const GUARD_SCRIPT =
  'cf="$1"; shift; "$cf" "$@" & p=$!; exec >/dev/null 2>&1; trap "kill -TERM $p 2>/dev/null" EXIT; cat >/dev/null; kill -TERM $p 2>/dev/null; sleep 2; kill -KILL $p 2>/dev/null'

export type CfEvent =
  | { kind: 'url'; url: string }
  | { kind: 'registered' }
  | { kind: 'unregistered' }
  | { kind: 'error'; code: Extract<StartErrorCode, 'rate' | 'edge-unreachable' | 'config-conflict'> }

const LEVEL_RE = /^\S+\s+(INF|WRN|ERR|FTL|DBG)\s/

/**
 * Interpreta UNA línea de `stderr`. Pura. La URL solo casa con `https://<palabras>.trycloudflare.com` (el aviso legal, que nombra
 * `https://www.cloudflare.com/…` y «trycloudflare.com» sin esquema, no casa). Los errores solo se clasifican en líneas `ERR`/`FTL`
 * (una línea `INF` que mencione «config» no es un error).
 */
export function parseCloudflaredLine(line: string): CfEvent | null {
  const m = TUNNEL_URL_SCAN_RE.exec(line)
  if (m) return { kind: 'url', url: `https://${m[1]}.trycloudflare.com` }
  if (/\bUnregistered tunnel connection\b/.test(line) || /\bRetrying connection in\b/.test(line)) return { kind: 'unregistered' }
  if (/\bRegistered tunnel connection\b/.test(line)) return { kind: 'registered' }
  const lv = LEVEL_RE.exec(line)?.[1]
  if (lv === 'ERR' || lv === 'FTL') {
    if (/\b429\b|Too Many Requests/i.test(line)) return { kind: 'error', code: 'rate' }
    if (/\bconfig(uration)?\b/i.test(line)) return { kind: 'error', code: 'config-conflict' }
    if (/failed to request quick Tunnel|no such host|\bdial (tcp|udp)\b|7844|i\/o timeout|network is unreachable/i.test(line))
      return { kind: 'error', code: 'edge-unreachable' }
  }
  return null
}

/** Quita la URL pública de una línea antes de guardarla (el registro no debe llevar el nombre del túnel). */
export function redactLine(line: string): string {
  return line.replace(/https?:\/\/[A-Za-z0-9.-]*trycloudflare\.com\S*/g, 'https://<host>').slice(0, 400)
}

const PROXY_VARS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'no_proxy', 'ALL_PROXY', 'all_proxy']

/** Entorno mínimo del proceso: `HOME` privado, `PATH` del sistema y los proxies si los hay. Nada de variables de OnyxCode ni del motor. */
export function cloudflaredEnv(
  home: string,
  base: NodeJS.ProcessEnv = process.env,
  extra: Record<string, string> = {}
): Record<string, string> {
  const env: Record<string, string> = { HOME: home, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C' }
  for (const k of PROXY_VARS) if (typeof base[k] === 'string' && base[k]) env[k] = base[k] as string
  return { ...env, ...extra }
}

/** Argumentos de `cloudflared` (siempre `--no-autoupdate`, nunca `--config`). */
export function cloudflaredArgs(port: number): string[] {
  return [
    'tunnel',
    '--no-autoupdate',
    '--url',
    `http://127.0.0.1:${port}`,
    '--metrics',
    '127.0.0.1:0',
    '--loglevel',
    'info',
    '--protocol',
    'auto'
  ]
}

export interface CloudflaredOptions {
  /** Ruta del binario ya verificado. */
  binary: string
  /** `HOME` privado (se crea con 0700). */
  homeDir: string
  deps: CloudflaredDeps
  startTimeoutMs?: number
  stopGraceMs?: number
  platform?: NodeJS.Platform
  /** Solo pruebas: variables extra del entorno del proceso y observador de líneas crudas. */
  extraEnv?: Record<string, string>
  onLine?: (line: string) => void
}

export interface TunnelExit {
  /** Por qué murió (`bad-url`, `rate`, `exited:<código>`…). */
  error: StartErrorCode
}

const RING = 200
const MAX_LINE = 4096

export class CloudflaredProcess {
  private child: ChildProcess | null = null
  private st: CfState = 'exited'
  private ring: string[] = []
  private url: string | null = null
  private banner = false
  private registered = false
  private lastError: StartErrorCode | null = null
  private dead = true
  private stopping = false
  private tree: number[] = []
  private pending = ''
  private waiter: { resolve: (v: { url: string; host: string }) => void; reject: (e: TunnelStartError) => void } | null = null
  private startTimer: ReturnType<typeof setTimeout> | null = null
  private deathWaiters: Array<() => void> = []
  private readonly stateCbs = new Set<(s: CfState) => void>()
  private readonly exitCbs = new Set<(e: TunnelExit) => void>()
  private readonly onProcessExit = (): void => this.killNow()

  constructor(private readonly o: CloudflaredOptions) {}

  state(): CfState {
    return this.st
  }
  pid(): number | undefined {
    return this.child?.pid
  }
  /** Últimas 200 líneas de `stderr`, SIN la URL pública. */
  recentLines(): string[] {
    return [...this.ring]
  }
  onState(cb: (s: CfState) => void): () => void {
    this.stateCbs.add(cb)
    return () => this.stateCbs.delete(cb)
  }
  /** El proceso murió SIN que se lo pidiéramos (caída, URL rara, límite…). Con `stop()`/`killNow()` no se llama. */
  onExit(cb: (e: TunnelExit) => void): () => void {
    this.exitCbs.add(cb)
    return () => this.exitCbs.delete(cb)
  }

  private setState(s: CfState): void {
    if (this.st === s) return
    this.st = s
    for (const cb of this.stateCbs) cb(s)
  }

  /** Lanza el túnel contra `127.0.0.1:port` y espera la URL y la conexión registrada (≤ 30 s). */
  start(port: number): Promise<{ url: string; host: string }> {
    if (this.child && !this.dead) return Promise.reject(new Error('already-started'))
    const { deps } = this.o
    const plat = this.o.platform ?? process.platform
    this.url = null
    this.banner = false
    this.registered = false
    this.lastError = null
    this.ring = []
    this.pending = ''
    this.stopping = false
    this.dead = false
    this.tree = []
    mkdirSync(this.o.homeDir, { recursive: true, mode: 0o700 })
    try {
      chmodSync(this.o.homeDir, 0o700)
    } catch {
      /* el umask manda */
    }
    const args = cloudflaredArgs(port)
    const guarded =
      plat === 'win32' ? { command: this.o.binary, args } : deps.withDisclaim('/bin/sh', ['-c', GUARD_SCRIPT, 'sh', this.o.binary, ...args])
    const child = deps.spawn(guarded.command, guarded.args, {
      detached: plat !== 'win32',
      // Carpeta propia del proceso (la de su `HOME` privado): sin ella heredaría la de la app, y el vigía `/bin/sh` sin permisos TCC
      // (disclaim) protesta con «getcwd: cannot access parent directories» si esa carpeta está bajo ~/Documents (instancia de desarrollo).
      cwd: this.o.homeDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: cloudflaredEnv(this.o.homeDir, process.env, this.o.extraEnv)
    })
    this.child = child
    this.setState('starting')
    deps.trackPid(child.pid, 'cloudflared')
    process.once('exit', this.onProcessExit)
    child.stdin?.on('error', () => undefined)
    child.stdout?.on('data', () => undefined) // stdout viene vacío; se vacía por si acaso
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => this.onChunk(chunk))
    child.stderr?.on('close', () => this.onDeath(null))
    child.on('error', () => this.onDeath(1))
    child.on('exit', (code) => this.onDeath(code))
    return new Promise((resolve, reject) => {
      this.waiter = { resolve, reject }
      this.startTimer = setTimeout(() => this.fatal(this.lastError ?? 'timeout'), this.o.startTimeoutMs ?? TRAVEL_PROCESS.startTimeoutMs)
    })
  }

  // ── lectura de stderr ──

  private onChunk(chunk: string): void {
    this.pending += chunk
    let i: number
    while ((i = this.pending.indexOf('\n')) >= 0) {
      const line = this.pending.slice(0, i).replace(/\r$/, '')
      this.pending = this.pending.slice(i + 1)
      this.onLine(line.length > MAX_LINE ? line.slice(0, MAX_LINE) : line)
    }
    if (this.pending.length > MAX_LINE) this.pending = ''
  }

  private onLine(line: string): void {
    if (this.dead) return
    this.o.onLine?.(line)
    this.ring.push(redactLine(line))
    if (this.ring.length > RING) this.ring.shift()
    if (/Your quick Tunnel has been created/.test(line)) this.banner = true
    if (this.banner && /https?:\/\/\S*trycloudflare\.com/i.test(line)) {
      const ev = parseCloudflaredLine(line)
      // Tras el banner, algo con aspecto de URL que no case con el patrón estricto, o una segunda URL distinta: fallo cerrado.
      if (!ev || ev.kind !== 'url' || (this.url !== null && this.url !== ev.url)) return this.fatal('bad-url')
      this.url = ev.url
    } else {
      const ev = parseCloudflaredLine(line)
      if (ev?.kind === 'registered') {
        this.registered = true
        this.lastError = null
        if (this.url) this.setState('online')
      } else if (ev?.kind === 'unregistered') {
        this.registered = false
        if (this.st === 'online') this.setState('connecting')
      } else if (ev?.kind === 'error') this.lastError = ev.code
    }
    if (this.url && this.registered && this.waiter) this.settle(null)
  }

  private settle(err: TunnelStartError | null): void {
    const w = this.waiter
    if (!w) return
    this.waiter = null
    if (this.startTimer) clearTimeout(this.startTimer)
    this.startTimer = null
    if (err) return w.reject(err)
    const url = this.url as string
    w.resolve({ url, host: new URL(url).host })
  }

  /** Fallo cerrado: se mata el proceso; `start()` rechaza (o, si ya estaba en línea, `onExit` avisa). */
  private fatal(code: StartErrorCode): void {
    this.lastError = code
    if (this.waiter) this.settle(new TunnelStartError(code))
    this.terminate()
  }

  // ── muerte y parada ──

  private onDeath(code: number | null): void {
    if (this.dead) return
    this.dead = true
    if (this.startTimer) clearTimeout(this.startTimer)
    this.startTimer = null
    process.off('exit', this.onProcessExit)
    const pid = this.child?.pid
    // Lo que quede del grupo (el vigía espera a `cat`) y los descendientes que escaparon de él.
    this.killRemaining(pid)
    try {
      this.child?.stdin?.end()
    } catch {
      /* ya cerrado */
    }
    this.o.deps.untrackPid(pid)
    this.setState('exited')
    const error: StartErrorCode = this.lastError ?? `exited:${code && code > 0 ? code : 1}`
    if (this.waiter) this.settle(new TunnelStartError(error))
    else if (!this.stopping) for (const cb of this.exitCbs) cb({ error })
    for (const w of this.deathWaiters.splice(0)) w()
  }

  /** Mata el árbol sin esperar (SIGTERM; el vigía remata con KILL a los 2 s). La muerte la confirma `onDeath`. */
  private terminate(): void {
    const pid = this.child?.pid
    if (!pid || this.dead) return
    this.snapshot(pid)
    try {
      this.child?.stdin?.end()
    } catch {
      /* ya cerrado */
    }
    this.o.deps.killTree(pid, 'SIGTERM')
    setTimeout(() => this.killRemaining(pid), 2500).unref()
  }

  private snapshot(pid: number): void {
    try {
      this.tree = Array.from(new Set([...this.tree, ...this.o.deps.descendants(pid)]))
    } catch {
      /* sin ps */
    }
  }

  /** SIGKILL al árbol conocido y al grupo, sin lanzar nunca. */
  private killRemaining(pid: number | undefined): void {
    if (!pid) return
    this.o.deps.killTree(pid, 'SIGKILL')
    for (const t of this.tree) {
      for (const target of [-t, t]) {
        try {
          process.kill(target, 'SIGKILL')
        } catch {
          /* ya muerto */
        }
      }
    }
  }

  /** Parada ordenada: cierra `stdin` (el vigía mata al túnel), SIGTERM al árbol, espera ≤ 3 s y remata con SIGKILL. Idempotente. */
  async stop(): Promise<void> {
    const pid = this.child?.pid
    if (!this.child || !pid) return
    this.stopping = true
    if (!this.dead) {
      this.snapshot(pid)
      try {
        this.child.stdin?.end()
      } catch {
        /* ya cerrado */
      }
      this.o.deps.killTree(pid, 'SIGTERM')
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, this.o.stopGraceMs ?? TRAVEL_PROCESS.stopGraceMs)
        this.deathWaiters.push(() => {
          clearTimeout(t)
          resolve()
        })
      })
    }
    // Pase lo que pase: lo que siga vivo del árbol (un binario que ignora SIGTERM, un nieto en otro grupo) cae ahora.
    this.killRemaining(pid)
    if (!this.dead) {
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 1000)
        this.deathWaiters.push(() => {
          clearTimeout(t)
          resolve()
        })
      })
      if (!this.dead) this.onDeath(137)
    }
    if (this.waiter) this.settle(new TunnelStartError('exited:1'))
  }

  /** Síncrono (salir de la app): SIGKILL directo al árbol. */
  killNow(): void {
    const pid = this.child?.pid
    this.stopping = true
    if (!pid) return
    this.snapshot(pid)
    this.killRemaining(pid)
    try {
      this.child?.stdin?.destroy()
    } catch {
      /* ya cerrado */
    }
    this.o.deps.untrackPid(pid)
    process.off('exit', this.onProcessExit)
    if (this.startTimer) clearTimeout(this.startTimer)
    this.startTimer = null
  }
}

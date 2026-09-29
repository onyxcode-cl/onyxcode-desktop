/**
 * Sidecar de OpenCode: lanza `opencode serve` en 127.0.0.1:<puerto libre> con
 * usuario/clave aleatorios (HTTP Basic vía OPENCODE_SERVER_USERNAME/PASSWORD),
 * espera a `/global/health`, reinicia con backoff si se cae y lo mata al salir.
 */
import { appOpencodeConfigEnv } from '../extras/mcp-config'
import { getOpencodeEnv } from '../cowork/opencode-config'
import { embeddedBrowserMcp } from '../embedded-browser/mcp-server'
import { embeddedBrowser } from '../embedded-browser/service'
import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { accessSync, constants, existsSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:net'
import { randomBytes } from 'node:crypto'
import { delimiter, join } from 'node:path'
import { APP_SLUG } from '@shared/brand'
import type { OpencodeConnection, ServerStatus } from '@shared/types'
import { buildInlineConfig } from './config'
import { killTree, trackPid, untrackPid } from './pids'
import { EXTRA_PATH_DIRS, minimalEnv } from '../process/child-env'
import { withDisclaim } from '../process/disclaim'

const HOST = '127.0.0.1'
const HEALTH_TIMEOUT_MS = 30_000
const HEALTH_INTERVAL_MS = 150
const MAX_RESTARTS = 5
/** Si el proceso vivió más que esto, el contador de reinicios se resetea. */
const STABLE_AFTER_MS = 60_000
const KILL_GRACE_MS = 3_000

export interface OpencodeServerOptions {
  /** cwd del proceso y directorio del modo Chat. */
  chatDirectory: string
  /** Orígenes extra permitidos por CORS (p.ej. el dev server de Vite). */
  corsOrigins?: string[]
}

interface ServerEvents {
  status: [ServerStatus]
  connection: [OpencodeConnection]
}

export class OpencodeServer extends EventEmitter<ServerEvents> {
  private child: ChildProcess | null = null
  private connection: OpencodeConnection | null = null
  private status: ServerStatus = { state: 'stopped', restarts: 0 }
  private stopping = false
  private startPromise: Promise<OpencodeConnection> | null = null
  private restartTimer: NodeJS.Timeout | null = null
  private consecutiveFailures = 0
  private readonly logTail: string[] = []

  constructor(private readonly options: OpencodeServerOptions) {
    super()
  }

  getStatus(): ServerStatus {
    return this.status
  }

  getConnection(): OpencodeConnection | null {
    return this.status.state === 'ready' ? this.connection : null
  }

  /** Arranca (o espera el arranque en curso) y resuelve con la conexión lista. */
  start(): Promise<OpencodeConnection> {
    if (this.status.state === 'ready' && this.connection) return Promise.resolve(this.connection)
    if (this.startPromise) return this.startPromise
    this.stopping = false
    this.startPromise = this.spawnAndWait().finally(() => {
      this.startPromise = null
    })
    return this.startPromise
  }

  async restart(): Promise<OpencodeConnection> {
    await this.stop()
    this.consecutiveFailures = 0
    return this.start()
  }

  /** Detiene el proceso (SIGTERM y SIGKILL tras un período de gracia). */
  async stop(): Promise<void> {
    this.stopping = true
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    const child = this.child
    this.child = null
    this.connection = null
    if (child && child.exitCode === null && child.signalCode === null) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          killTree(child.pid, 'SIGKILL')
          resolve()
        }, KILL_GRACE_MS)
        child.once('exit', () => {
          clearTimeout(timer)
          // El líder terminó: rematar el resto del grupo (MCP, bash…).
          killTree(child.pid, 'SIGKILL')
          resolve()
        })
        killTree(child.pid, 'SIGTERM')
      })
    }
    this.setStatus({ state: 'stopped' })
  }

  /** Kill síncrono para `process.on('exit')`. */
  killSync(): void {
    this.stopping = true
    if (this.child) killTree(this.child.pid, 'SIGKILL')
  }

  private async spawnAndWait(): Promise<OpencodeConnection> {
    this.setStatus({ state: 'starting', error: undefined })
    try {
      const bin = findOpencodeBinary()
      if (!bin) {
        throw new Error(
          'No se encontró el binario `opencode`. Instálalo (curl -fsSL https://opencode.ai/install | bash) o define OPENCODE_BIN.'
        )
      }
      mkdirSync(this.options.chatDirectory, { recursive: true })
      const port = await getFreePort()
      const username = APP_SLUG
      const password = randomBytes(24).toString('base64url')
      const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
      const baseUrl = `http://${HOST}:${port}`

      // Renderer en `onyxcode://app` (producción) o el dev server de Vite; sin el origen `null`.
      const cors = this.options.corsOrigins ?? []
      const serveArgs = ['serve', '--port', String(port), '--hostname', HOST, ...cors.flatMap((o) => ['--cors', o])]
      // Sin heredar los permisos TCC de la app (S6) y con entorno mínimo.
      const launch = withDisclaim(bin, serveArgs)

      // Navegador integrado (Lote D, B.7): si el MCP no arranca, el sidecar arranca igual sin él
      // (`configFor` nunca lanza: devuelve null en ese caso). `setApi` es idempotente (main.ts de
      // D1 no tiene por qué conocer este módulo): cada punto que arranca un servidor de OpenCode
      // se asegura de que el MCP del navegador conoce la implementación real.
      embeddedBrowserMcp.setApi(embeddedBrowser)
      const browserMcp = await embeddedBrowserMcp.configFor({ product: 'code', sandboxed: false, folder: null })

      const child = spawn(launch.command, launch.args, {
        cwd: this.options.chatDirectory,
        env: minimalEnv({
          ...getOpencodeEnv(),
          ...appOpencodeConfigEnv(),
          OPENCODE_SERVER_USERNAME: username,
          OPENCODE_SERVER_PASSWORD: password,
          OPENCODE_CONFIG_CONTENT: JSON.stringify(buildInlineConfig({ browserMcp }))
        }),
        stdio: ['ignore', 'pipe', 'pipe'],
        // Líder de su propio grupo: `killTree` mata también MCP/bash (AUDIT.md B3).
        detached: true
      })
      this.child = child
      trackPid(child.pid, 'main')
      const spawnedAt = Date.now()
      child.stdout?.on('data', (d: Buffer) => this.log(d.toString()))
      child.stderr?.on('data', (d: Buffer) => this.log(d.toString()))
      child.on('error', (err) => this.log(`[spawn error] ${err.message}`))
      child.on('exit', (code, signal) => {
        untrackPid(child.pid)
        this.onExit(child, code, signal, spawnedAt)
      })

      const version = await waitForHealth(baseUrl, authorization, child)
      if (this.child !== child) throw new Error('El servidor se detuvo durante el arranque')

      const connection: OpencodeConnection = {
        baseUrl,
        authorization,
        username,
        chatDirectory: this.options.chatDirectory,
        version
      }
      this.connection = connection
      console.log(
        `[opencode] listo en ${baseUrl} (v${version ?? '?'}) pid=${child.pid}${launch.disclaimed ? ' (TCC desvinculado)' : ''}`
      )
      this.setStatus({ state: 'ready', error: undefined, version })
      this.emit('connection', connection)
      return connection
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const tail = this.logTail.slice(-5).join('').trim()
      const error = tail ? `${message}\n${tail}` : message
      console.error('[opencode] fallo al arrancar:', error)
      const child = this.child
      this.child = null
      if (child) killTree(child.pid, 'SIGKILL')
      this.setStatus({ state: 'error', error })
      throw new Error(error)
    }
  }

  private onExit(child: ChildProcess, code: number | null, signal: NodeJS.Signals | null, spawnedAt: number): void {
    console.log(`[opencode] proceso terminó code=${code} signal=${signal}`)
    if (this.child !== child) return // ya reemplazado o detenido intencionalmente
    this.child = null
    this.connection = null
    if (this.stopping) return
    if (Date.now() - spawnedAt > STABLE_AFTER_MS) this.consecutiveFailures = 0
    this.scheduleRestart(`Se cerró inesperadamente (code=${code})`)
  }

  private scheduleRestart(reason: string): void {
    this.consecutiveFailures++
    if (this.consecutiveFailures > MAX_RESTARTS) {
      this.setStatus({
        state: 'error',
        error: `OpenCode falló ${MAX_RESTARTS} veces seguidas (${reason}). Reinícialo manualmente.`
      })
      return
    }
    const delay = Math.min(1000 * 2 ** (this.consecutiveFailures - 1), 15_000)
    this.setStatus({ state: 'starting', error: `${reason}; reintentando…` })
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      if (this.stopping) return
      this.status = { ...this.status, restarts: this.status.restarts + 1 }
      this.start().catch((err: unknown) => {
        if (!this.stopping) this.scheduleRestart(err instanceof Error ? err.message.split('\n')[0] : String(err))
      })
    }, delay)
  }

  private setStatus(patch: Partial<ServerStatus>): void {
    this.status = { ...this.status, ...patch }
    this.emit('status', this.status)
  }

  private log(chunk: string): void {
    if (process.env.OPENCODE_SIDECAR_LOG) process.stdout.write(`[opencode] ${chunk}`)
    this.logTail.push(chunk)
    if (this.logTail.length > 50) this.logTail.splice(0, this.logTail.length - 50)
  }
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

export function findOpencodeBinary(): string | null {
  const fromEnv = process.env.OPENCODE_BIN
  if (fromEnv && isExecutable(fromEnv)) return fromEnv
  const name = process.platform === 'win32' ? 'opencode.exe' : 'opencode'
  const dirs = [EXTRA_PATH_DIRS[0], ...(process.env.PATH ?? '').split(delimiter), ...EXTRA_PATH_DIRS.slice(1)]
  for (const dir of dirs) {
    if (!dir) continue
    const candidate = join(dir, name)
    if (existsSync(candidate) && isExecutable(candidate)) return candidate
  }
  return null
}

export function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, HOST, () => {
      const addr = srv.address()
      if (addr && typeof addr === 'object') {
        const { port } = addr
        srv.close(() => resolve(port))
      } else {
        srv.close(() => reject(new Error('No se pudo obtener un puerto libre')))
      }
    })
  })
}

async function waitForHealth(baseUrl: string, authorization: string, child: ChildProcess): Promise<string | undefined> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`opencode serve terminó durante el arranque (code=${child.exitCode})`)
    }
    try {
      const res = await fetch(`${baseUrl}/global/health`, {
        headers: { authorization },
        signal: AbortSignal.timeout(2000)
      })
      if (res.ok) {
        const body = (await res.json()) as { healthy?: boolean; version?: string }
        if (body.healthy !== false) return body.version
      }
    } catch {
      // aún no escucha
    }
    await new Promise((r) => setTimeout(r, HEALTH_INTERVAL_MS))
  }
  throw new Error(`opencode serve no respondió en ${HEALTH_TIMEOUT_MS / 1000}s`)
}

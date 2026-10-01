/**
 * Sidecar de OpenCode: lanza `opencode serve` en 127.0.0.1:<puerto libre> con
 * usuario/clave aleatorios (HTTP Basic vía OPENCODE_SERVER_USERNAME/PASSWORD),
 * espera a `/global/health`, reinicia con backoff si se cae y lo mata al salir.
 */
import { t } from '@shared/i18n'
import { appOpencodeConfigEnv } from '../extras/mcp-config'
import { getOpencodeEnv } from '../tasks/opencode-config'
import { embeddedBrowserMcp } from '../embedded-browser/mcp-server'
import { embeddedBrowser } from '../embedded-browser/service'
import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { accessSync, constants, existsSync, mkdirSync } from 'node:fs'
import { app } from 'electron'
import { randomBytes } from 'node:crypto'
import { delimiter, join } from 'node:path'
import { getFreePort, waitForHealth } from '../util/net'
import { APP_SLUG } from '@shared/brand'
import type { OpencodeConnection, ServerStatus } from '@shared/types'
import { buildInlineConfig } from './config'
import { cachedCliVersion, pickOpencode, warmCliVersion, type ResolvedOpencode } from './binary'
import { killTree, trackPid, untrackPid } from './pids'
import { EXTRA_PATH_DIRS, minimalEnv } from '../process/child-env'
import { withDisclaim } from '../process/disclaim'
import { settingsStore } from '../store'
import { LineRing } from '../diagnostics/log-ring'

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
  private readonly logRing = new LineRing()
  /** Contraseña y credencial Basic del sidecar de este arranque: Diagnóstico las oculta de lo que muestra. */
  private secretValues: string[] = []

  constructor(private readonly options: OpencodeServerOptions) {
    super()
  }

  getStatus(): ServerStatus {
    return this.status
  }

  /** Últimas líneas del motor SIN redactar: solo para `diagnostics/service.ts`, que redacta antes de devolverlas. */
  recentLog(max?: number): string[] {
    return this.logRing.lines(max)
  }

  /** Secretos del sidecar (contraseña y `Authorization`) para el redactor de Diagnóstico. */
  secrets(): string[] {
    return [...this.secretValues]
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
      const bin = (await resolveOpencodeAsync())?.path
      if (!bin) {
        throw new Error(t('merr.engine.noBinary'))
      }
      mkdirSync(this.options.chatDirectory, { recursive: true })
      const port = await getFreePort()
      const username = APP_SLUG
      const password = randomBytes(24).toString('base64url')
      const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
      const baseUrl = `http://${HOST}:${port}`
      this.secretValues = [password, authorization, authorization.slice('Basic '.length)]

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

      const version = await waitForHealth(baseUrl, authorization, child, {
        label: 'opencode serve',
        timeoutMs: HEALTH_TIMEOUT_MS,
        intervalMs: HEALTH_INTERVAL_MS
      })
      if (this.child !== child) throw new Error('El servidor se detuvo durante el arranque')

      const connection: OpencodeConnection = {
        baseUrl,
        authorization,
        username,
        chatDirectory: this.options.chatDirectory,
        version
      }
      this.connection = connection
      console.log(`[opencode] listo en ${baseUrl} (v${version ?? '?'}) pid=${child.pid}${launch.disclaimed ? ' (TCC desvinculado)' : ''}`)
      this.setStatus({ state: 'ready', error: undefined, version })
      this.emit('connection', connection)
      return connection
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const tail = this.logRing.tail(5).trim()
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
    this.scheduleRestart(t('merr.engine.closed', { code: String(code) }))
  }

  private scheduleRestart(reason: string): void {
    this.consecutiveFailures++
    if (this.consecutiveFailures > MAX_RESTARTS) {
      this.setStatus({
        state: 'error',
        error: t('merr.engine.failedRepeatedly', { max: MAX_RESTARTS, reason })
      })
      return
    }
    const delay = Math.min(1000 * 2 ** (this.consecutiveFailures - 1), 15_000)
    this.setStatus({ state: 'starting', error: t('merr.engine.retrying', { reason }) })
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
    this.logRing.push(chunk)
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

/** Binario elegido en el asistente (`settings.opencodeBin`); '' si no hay o los ajustes no están disponibles. */
function configuredBinary(): string {
  try {
    return settingsStore.get().opencodeBin
  } catch {
    return ''
  }
}

/** Variable SOLO para tests (se ignora en la app empaquetada): directorio que hace de `Resources/opencode`. */
const TEST_BUNDLED_ENV = 'ONYXCODE_TEST_BUNDLED_DIR'

function appIsPackaged(): boolean {
  try {
    return app.isPackaged === true
  } catch {
    return false
  }
}

export interface BundledOptions {
  isPackaged?: boolean
  resourcesPath?: string
  /** Valor de `ONYXCODE_TEST_BUNDLED_DIR` (por defecto, el de `process.env`). */
  testDir?: string
}

/**
 * OpenCode incluido en la app: `<Resources>/opencode/opencode`, solo si la app está empaquetada y
 * el archivo existe y es ejecutable. En desarrollo es null (el repo vive en ~/Documents y un binario
 * bajo `resources/` fallaría por TCC): allí se usa el CLI del usuario u `OPENCODE_BIN`. Para tests,
 * `ONYXCODE_TEST_BUNDLED_DIR` (honrada ÚNICAMENTE si `!isPackaged`) apunta a un directorio que
 * hace de `Resources/opencode`.
 */
export function bundledOpencodePath(o: BundledOptions = {}): string | null {
  const packaged = o.isPackaged ?? appIsPackaged()
  let candidate: string | null = null
  if (packaged) {
    const res = o.resourcesPath ?? process.resourcesPath
    if (res) candidate = join(res, 'opencode', 'opencode')
  } else {
    const dir = o.testDir ?? process.env[TEST_BUNDLED_ENV]
    if (dir) candidate = join(dir, 'opencode')
  }
  return candidate && existsSync(candidate) && isExecutable(candidate) ? candidate : null
}

/** CLI del usuario: PATH y carpetas habituales. */
function findCliBinary(): string | null {
  const name = process.platform === 'win32' ? 'opencode.exe' : 'opencode'
  const dirs = [EXTRA_PATH_DIRS[0], ...(process.env.PATH ?? '').split(delimiter), ...EXTRA_PATH_DIRS.slice(1)]
  for (const dir of dirs) {
    if (!dir) continue
    const candidate = join(dir, name)
    if (existsSync(candidate) && isExecutable(candidate)) return candidate
  }
  return null
}

/**
 * Resolución SÍNCRONA (solo usa la versión del CLI ya cacheada): `OPENCODE_BIN` → `settings.opencodeBin`
 * → CLI compatible → embebido → CLI incompatible. Sin embebido nunca mide versiones.
 */
export function resolveOpencode(
  configured: string = configuredBinary(),
  bundled: string | null = bundledOpencodePath()
): ResolvedOpencode | null {
  return pickOpencode({
    env: process.env.OPENCODE_BIN,
    configured,
    cli: findCliBinary(),
    bundled,
    isExecutable,
    cliVersion: cachedCliVersion
  })
}

/** Igual que `resolveOpencode`, pero midiendo antes (async, con timeout y cacheado por ruta+mtime) la versión del CLI si hace falta. */
export async function resolveOpencodeAsync(configured: string = configuredBinary()): Promise<ResolvedOpencode | null> {
  const bundled = bundledOpencodePath()
  if (bundled) {
    const env = process.env.OPENCODE_BIN
    const decided = (env && isExecutable(env)) || (configured && isExecutable(configured))
    const cli = decided ? null : findCliBinary()
    if (cli) await warmCliVersion(cli)
  }
  return resolveOpencode(configured, bundled)
}

/** Ruta del binario según `resolveOpencode` (firma histórica; sin medir versiones). */
export function findOpencodeBinary(configured: string = configuredBinary()): string | null {
  return resolveOpencode(configured)?.path ?? null
}

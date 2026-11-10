/**
 * Sidecar de OpenCode: lanza `opencode serve` en 127.0.0.1:<puerto libre> con
 * usuario/clave aleatorios (HTTP Basic vía OPENCODE_SERVER_USERNAME/PASSWORD),
 * espera a `/global/health`, reinicia con backoff si se cae y lo mata al salir.
 */
import { t } from '@shared/i18n'
import { appOpencodeConfigEnv, readAppMcpConfig, readAppPermission } from '../extras/mcp-config'
import { getOpencodeEnv } from '../tasks/opencode-config'
import { bundledRipgrepPathEnv } from '../tasks/ripgrep-runtime'
import { embeddedBrowserMcp } from '../embedded-browser/mcp-server'
import { embeddedBrowser } from '../embedded-browser/service'
import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { recordProblem } from '../diagnostics/problem-log'
import { accessSync, constants, existsSync, mkdirSync } from 'node:fs'
import { app } from 'electron'
import { randomBytes } from 'node:crypto'
import { delimiter, join } from 'node:path'
import { getFreePort, waitForHealth } from '../util/net'
import { APP_SLUG, MOTOR_APP_NAME } from '@shared/brand'
import { installedMotorCurrent, motorHomeDir, motorPaths } from './motor-app'
import type { OpencodeConnection, ServerStatus } from '@shared/types'
import { buildInlineConfig } from './config'
import { modelFallbackKey } from '@shared/model-fallback'
import { bearerOf } from '../util/loopback-mcp'
import { CODE_BINDING_FOLDER, DOCUMENTS_SERVER, documentsConfigPermission } from '@shared/documents-permissions'
import { codeDocsInstructions } from './code-docs-instructions'
import { cachedCliVersion, pickOpencode, warmCliVersion, type ResolvedOpencode } from './binary'
import { killPids, killTree, trackPid, untrackPid } from './pids'
import { EXTRA_PATH_DIRS, minimalEnv } from '../process/child-env'
import { catalogFile, waitForCatalog } from './catalog-wait'
import { withDisclaim } from '../process/disclaim'
import { testLauncher } from './test-launcher'
import { settingsStore } from '../store'
import { engineExperimentsFor, engineFlagEnvForMainSidecar } from '@shared/engine-experiments'
import { engineLimitEnvFor } from '@shared/engine-limits'
import { permissionPersistEnvFor } from '@shared/permission-persist'
import { ensurePermissionDir, permissionDir } from './permission-store'
import { hooksFile } from './user-hooks-store'
import { userHooksEnvFor } from '@shared/user-hooks'
import { engineLastMileEnv } from './engine-lastmile'
import { engineContractEnv } from '@shared/engine-contract-env'
import { engineTrust } from './engine-trust'
import { LineRing } from '../diagnostics/log-ring'
import { CODE_INTERNAL_MCP } from '@shared/mcp-permissions'
import { MCP_ENV_WRAPPER } from '../tasks/mcp-tasks'
import { runtimesService } from '../runtimes/service'
import { SHELL_BG_SERVER, bgshellConfigPermission, prepareShellBgDirs, shellBgMcpConfig, shellBgPaths } from './shell-bg-mcp'
import { bundledShellBgPath } from './shell-bg-bundled'
import { ShellBgWake, createSdkWakeEngine } from './shell-bg-wake'
import {
  buildCodeMcpPermission,
  cleanServerNames,
  fetchEngineMcpServers,
  permissionFingerprint,
  readGlobalOpencodeConfig
} from './code-mcp-permission'

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
  /** La config inline que corresponde ya no es la del proceso (p. ej. un conector nuevo sin regla): hay que relanzar en cuanto se pueda. */
  inlineStale: []
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
  /** Servidores MCP que reportaron los motores de esta sesión de la app (externos incluidos); solo crece. */
  private engineMcpServers: string[] = []
  /** Huella de la parte de la config inline que depende de Ajustes y conectores con la que arrancó el proceso actual. */
  private appliedInline: string | null = null
  /** Despertador de `bgshell` (aviso de fin al modelo) del proceso actual; vive y muere con la conexión (F8-B204). */
  private shellBgWake: ShellBgWake | null = null
  /** Token real de la herramienta `documentos` de este arranque: se revoca al parar, al caerse el proceso o al relanzar. */
  private documentsToken: string | null = null
  /** Servidor de `documentos` con el que se emitió ese token (import perezoso: `../documents` arrastra Electron y el motor de documentos). */
  private documentsApi: { revokeToken(token: string): boolean } | null = null

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

  /**
   * Bloque `permission` de la config inline (F8-B203): conectores en Code preguntan salvo los internos y los marcados «Sin preguntar
   * en Code». Servidores = los de la app ∪ los de la config global del usuario ∪ los que ya reportó el motor. Nunca lanza.
   */
  codeMcpPermission(): Record<string, unknown> {
    let trusted: string[] = []
    try {
      trusted = settingsStore.get().codeTrustedMcp ?? []
    } catch {
      trusted = []
    }
    let appServers: string[] = []
    try {
      appServers = Object.keys(readAppMcpConfig().servers)
    } catch {
      appServers = []
    }
    const global = readGlobalOpencodeConfig()
    return buildCodeMcpPermission({
      servers: cleanServerNames([...appServers, ...global.servers, ...this.engineMcpServers]),
      trusted,
      internal: CODE_INTERNAL_MCP,
      // Lo que el motor fusiona ANTES de la inline: config global y archivo de conectores de la app (en ese orden).
      base: { ...global.permission, ...readAppPermission() },
      // `bgshell` (F8-B204): `bgshell_start` pregunta como `bash`, el resto pasa; el bloque de modo de cada sesión lo ajusta después.
      // `documentos` (Word/Excel/PowerPoint/PDF): `documentos_crear` pregunta (como escribir un archivo) y `documentos_renderizar` pasa; no es
      // «interno» (eso sería `allow` total). El bloque de modo de cada sesión de Code lo ajusta (`documentsSessionRules`).
      fixed: { ...bgshellConfigPermission(), ...documentsConfigPermission() },
      fixedServers: [SHELL_BG_SERVER, DOCUMENTS_SERVER]
    })
  }

  /** Subagentes en el Chat (F8-B206): `task` del agente `chat` abierto solo a `lazunox-chat-helper` si la función está encendida. */
  chatSubagents(): boolean {
    try {
      return engineExperimentsFor(settingsStore.get(), 'chat').backgroundSubagents
    } catch {
      return false
    }
  }

  /** Parte «modelo de respaldo» de la huella de la config inline (cambiarla en Ajustes relanza el motor cuando no hay turnos en curso). */
  private fallbackKey(): string {
    try {
      return modelFallbackKey(settingsStore.get().modelFallback)
    } catch {
      return 'sin-respaldo'
    }
  }

  /** Huella de la parte de la config inline que depende de Ajustes y conectores, tal como corresponde AHORA. */
  wantedInlineKey(): string {
    return inlineKey(this.codeMcpPermission(), this.chatSubagents(), this.fallbackKey())
  }

  /** Huella con la que arrancó el proceso actual (`null` si no arrancó). */
  appliedInlineKey(): string | null {
    return this.appliedInline
  }

  /** ¿El proceso en marcha corre con una config inline vieja? */
  inlineStale(): boolean {
    return this.appliedInline !== null && this.appliedInline !== this.wantedInlineKey()
  }

  /** Pide relanzar cuando se pueda (lo atiende `engine-flags-restart.ts`, que espera a que no haya turnos en curso). */
  requestInlineReload(): void {
    this.emit('inlineStale')
  }

  /**
   * Pregunta al motor qué servidores MCP cargó (incluidos los externos de `~/.config/opencode` y del proyecto del Chat) y los suma a
   * los conocidos. Devuelve si con eso la config inline quedó vieja (hay un servidor sin regla).
   */
  async refreshEngineMcpServers(): Promise<boolean> {
    const conn = this.getConnection()
    if (!conn) return false
    const found = await fetchEngineMcpServers(conn, this.options.chatDirectory)
    if (!found) return false
    this.engineMcpServers = cleanServerNames([...this.engineMcpServers, ...found])
    return this.inlineStale()
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
    this.stopShellBgWake()
    this.revokeDocumentsToken()
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    const child = this.child
    this.child = null
    this.connection = null
    if (child && child.exitCode === null && child.signalCode === null) {
      await new Promise<void>((resolve) => {
        // Descendientes vistos al pedir el cierre: al morir el líder (p. ej. un `sleep` que lanzó un subagente) pasan a
        // ser huérfanos y `killTree` ya no los encuentra por parentesco; hay que rematarlos por PID.
        let seen: number[] = []
        const timer = setTimeout(() => {
          killTree(child.pid, 'SIGKILL')
          killPids(seen, 'SIGKILL')
          resolve()
        }, KILL_GRACE_MS)
        child.once('exit', () => {
          clearTimeout(timer)
          // El líder terminó: rematar el resto del grupo (MCP, bash…) y lo que ya no cuelga de él.
          killTree(child.pid, 'SIGKILL')
          killPids(seen, 'SIGKILL')
          resolve()
        })
        seen = killTree(child.pid, 'SIGTERM') ?? []
      })
    }
    this.setStatus({ state: 'stopped' })
  }

  /** Kill síncrono para `process.on('exit')`. */
  killSync(): void {
    this.stopping = true
    this.stopShellBgWake()
    this.revokeDocumentsToken()
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

      // Renderer en `lazunox://app` (producción) o el dev server de Vite; sin el origen `null`.
      const cors = this.options.corsOrigins ?? []
      const serveArgs = ['serve', '--port', String(port), '--hostname', HOST, ...cors.flatMap((o) => ['--cors', o])]
      // Sin heredar los permisos TCC de la app (S6) y con entorno mínimo.
      const launch = withDisclaim(bin, serveArgs)
      // Solo pruebas: el OpenCode falso `.mjs` se lanza con node en Windows (nunca empaquetado).
      const exec = testLauncher(launch.command, launch.args, { isPackaged: appIsPackaged() })

      // Navegador integrado (Lote D, B.7): si el MCP no arranca, el sidecar arranca igual sin él
      // (`configFor` nunca lanza: devuelve null en ese caso). `setApi` es idempotente (main.ts de
      // D1 no tiene por qué conocer este módulo): cada punto que arranca un servidor de OpenCode
      // se asegura de que el MCP del navegador conoce la implementación real.
      embeddedBrowserMcp.setApi(embeddedBrowser)
      const browserMcp = await embeddedBrowserMcp.configFor({ product: 'code', sandboxed: false, folder: null })
      // Shell en segundo plano (F8-B204): carpetas privadas recién vaciadas (avisos de un proceso anterior no cuentan) y bloque `mcp`.
      // Sin Node incluido o sin el `.cjs`, el motor arranca igual sin `bgshell`.
      this.stopShellBgWake()
      const shellBg = prepareMainShellBg()
      // Herramienta `documentos` en Code: carpeta de salida = un proyecto abierto en Code (validada en cada llamada), nunca elegida por el token.
      // Si el MCP no arranca (`configFor` devuelve null), el motor arranca igual sin ella. Un arranque nuevo trae token nuevo: el viejo deja de valer.
      this.revokeDocumentsToken()
      const documents = await this.documentsBlock()
      // Conectores en Code (F8-B203): reglas por servidor en la config inline. Se anota con qué huella arrancó.
      const permission = this.codeMcpPermission()
      const chatSubagents = this.chatSubagents()
      this.appliedInline = inlineKey(permission, chatSubagents, this.fallbackKey())

      const persistEnv = permissionPersistEnvFor(settingsStore.get(), permissionDir())
      if (persistEnv.LAZUNOX_PERMISSION_DIR) ensurePermissionDir(persistEnv.LAZUNOX_PERMISSION_DIR)
      const childEnv = minimalEnv({
        ...getOpencodeEnv(),
        // `rg` incluido al principio del PATH: el motor lo busca ahí y, si no lo halla, intenta bajarlo de internet (1.8.17).
        ...bundledRipgrepPathEnv(),
        ...appOpencodeConfigEnv(),
        // Funciones experimentales del motor (Modo código, subagentes de fondo): solo las dos variables concretas y solo si
        // los Ajustes las encienden para Chat o Code (comparten este proceso). Cambiarlas exige reiniciar (`engine-flags-restart.ts`).
        ...engineFlagEnvForMainSidecar(settingsStore.get()),
        // Límites de Modo código y shell en segundo plano: solo los que la persona cambió (el motor usa su defecto en el resto).
        ...engineLimitEnvFor(settingsStore.get()),
        // «Recordar mis siempre»: el motor guarda los permisos «siempre» por carpeta en `userData/permisos-siempre` (0700) solo si va encendido.
        ...persistEnv,
        // Ganchos de usuario: solo con «Activar ganchos» (apagado por defecto); el motor lee `userData/hooks/hooks.json` y relee si cambia.
        // Con la huella (`LAZUNOX_HOOKS_SHA256`) del archivo que la persona guardó: si el archivo cambia por otra vía, el motor no ejecuta ningún gancho.
        ...userHooksEnvFor(settingsStore.get(), hooksFile()),
        // Búsqueda web con cualquier IA (D7, apagada), sugerencia en tarjetas (apagada) y política de empresa del motor (solo si existe el archivo del
        // administrador, D12). Solo el sidecar principal: Overdrive no recibe nada de esto (ver `manager.ts`).
        ...engineLastMileEnv(settingsStore.get()),
        // Contratos de lazunox.16 (permisos por capas y confianza obligatoria de carpetas): siempre encendidos, y DESPUÉS de todo lo demás.
        ...engineContractEnv(),
        OPENCODE_SERVER_USERNAME: username,
        OPENCODE_SERVER_PASSWORD: password,
        OPENCODE_CONFIG_CONTENT: JSON.stringify(
          buildInlineConfig({
            browserMcp,
            bgshellMcp: shellBg?.block ?? null,
            documentsMcp: documents,
            permission,
            chatSubagents,
            modelFallback: settingsStore.get().modelFallback,
            instructions: codeDocsInstructions()
          })
        )
      })
      const child = spawn(exec.command, exec.args, {
        cwd: this.options.chatDirectory,
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        // Líder de su propio grupo POSIX: `killTree` mata también MCP/bash (AUDIT.md B3). En Windows
        // `detached` abriría una consola y no hay grupos: se mata el árbol con `taskkill /T`.
        detached: process.platform !== 'win32',
        windowsHide: true
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
      if (this.child !== child) throw new Error(t('merr.engine.stoppedAtStart'))

      // Sin caché del catálogo de modelos el motor lo baja al arrancar; si le piden la lista antes se queda con la de respaldo
      // (sin los modelos gratuitos nuevos). Nadie lo consulta hasta que `ready` se emite, así que se espera aquí (con tope).
      // Con un binario indicado por entorno (OPENCODE_BIN, pruebas con el motor falso) no hay catálogo que esperar.
      if (!process.env.OPENCODE_BIN && !process.env[TEST_BUNDLED_ENV]) {
        const catalog = await waitForCatalog(catalogFile(childEnv))
        if (catalog !== 'present') console.log(`[opencode] catálogo de modelos: ${catalog}`)
      }
      if (this.child !== child) throw new Error(t('merr.engine.stoppedAtStart'))

      // Confianza obligatoria (lazunox.16): la lista de carpetas confiables del motor es de memoria y nace vacía. ANTES de decir «listo» (nadie
      // le pide nada hasta entonces) se vuelven a declarar la carpeta del Chat y las que la app ya tenía como confiables.
      const notDeclared = await engineTrust.declareAll({ baseUrl, authorization }, [this.options.chatDirectory])
      if (notDeclared.length) console.warn(`[opencode] confianza: no se pudo declarar ${notDeclared.length} carpeta(s) al arrancar`)
      if (this.child !== child) throw new Error(t('merr.engine.stoppedAtStart'))

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
      if (shellBg) this.startShellBgWake(shellBg.eventsFile, connection)
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
      this.revokeDocumentsToken()
      this.setStatus({ state: 'error', error })
      throw new Error(error)
    }
  }

  /** Vigila los avisos de `bgshell` de ESTE proceso y despierta a la sesión raíz dueña del trabajo (`shell-bg-wake.ts`). */
  private startShellBgWake(eventsFile: string, conn: OpencodeConnection): void {
    this.stopShellBgWake()
    const wake = new ShellBgWake({
      eventsFile,
      engine: createSdkWakeEngine(conn),
      onError: (err) => console.warn('[opencode] bgshell: aviso de fin no entregado:', err instanceof Error ? err.message : err)
    })
    wake.start()
    this.shellBgWake = wake
  }

  /** Bloque `mcp.documentos` del sidecar (y guarda su token para revocarlo); `null` si no arranca: el motor sigue sin la herramienta. */
  private async documentsBlock(): Promise<Record<string, unknown> | null> {
    try {
      const { documentsMcp } = await import('../documents')
      this.documentsApi = documentsMcp
      const block = await documentsMcp.configFor({ folder: CODE_BINDING_FOLDER, code: { roots: () => openCodeFolders() } })
      this.documentsToken = bearerOf(block)
      return block
    } catch (err) {
      console.warn('[opencode] documentos no disponible:', err instanceof Error ? err.message : err)
      return null
    }
  }

  private revokeDocumentsToken(): void {
    if (this.documentsToken) this.documentsApi?.revokeToken(this.documentsToken)
    this.documentsToken = null
  }

  private stopShellBgWake(): void {
    this.shellBgWake?.stop()
    this.shellBgWake = null
  }

  private onExit(child: ChildProcess, code: number | null, signal: NodeJS.Signals | null, spawnedAt: number): void {
    console.log(`[opencode] proceso terminó code=${code} signal=${signal}`)
    if (this.child !== child) return // ya reemplazado o detenido intencionalmente
    this.stopShellBgWake()
    this.revokeDocumentsToken()
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
    if (patch.state === 'error' && patch.error)
      recordProblem({ source: 'engine', message: patch.error, detail: { reinicios: this.status.restarts } })
    this.status = { ...this.status, ...patch }
    this.emit('status', this.status)
  }

  private log(chunk: string): void {
    if (process.env.OPENCODE_SIDECAR_LOG) process.stdout.write(`[opencode] ${chunk}`)
    this.logRing.push(chunk)
  }
}

/** Proyectos abiertos en Code (`recentFolders`): las únicas carpetas donde `documentos_crear` puede escribir. Nunca lanza. */
function openCodeFolders(): string[] {
  try {
    return [...settingsStore.get().recentFolders]
  } catch {
    return []
  }
}

/** Huella de la parte de la config inline que depende de Ajustes y conectores (permisos de conectores y subagentes del Chat). */
function inlineKey(permission: Record<string, unknown>, chatSubagents: boolean, fallback: string): string {
  return `${chatSubagents ? 'chat-task' : 'no-chat-task'}|${permissionFingerprint(permission)}|${fallback}`
}

/**
 * `bgshell` del sidecar principal (F8-B204): `userData/shell-bg/code` (una carpeta por motor), preparada ANTES de cada arranque (0700,
 * avisos vaciados) y su bloque `mcp`. El MCP se lanza con el Node incluido de la app y, en macOS/Linux, con `MCP_ENV_WRAPPER` (no
 * hereda la contraseña del motor ni la config inline). `null` si no se puede ofrecer o algo falla: el motor arranca igual sin él.
 */
function prepareMainShellBg(): { block: Record<string, unknown>; eventsFile: string } | null {
  try {
    const nodePath = runtimesService().bins().node
    const scriptPath = bundledShellBgPath()
    if (!nodePath || !scriptPath) return null
    const paths = shellBgPaths(join(app.getPath('userData'), 'shell-bg', 'code'))
    prepareShellBgDirs(paths)
    const block = shellBgMcpConfig({
      nodePath,
      scriptPath,
      baseDir: paths.baseDir,
      eventsFile: paths.eventsFile,
      ...(process.platform === 'win32' ? {} : { commandPrefix: MCP_ENV_WRAPPER })
    })
    return block ? { block, eventsFile: paths.eventsFile } : null
  } catch (err) {
    console.warn('[opencode] bgshell no disponible:', err instanceof Error ? err.message : err)
    return null
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
const TEST_BUNDLED_ENV = 'LAZUNOX_TEST_BUNDLED_DIR'

function appDataDir(): string | null {
  try {
    return motorHomeDir(app.getPath('appData'), process.argv, app.getPath('userData'))
  } catch {
    return null
  }
}

function appIsPackaged(): boolean {
  try {
    return app.isPackaged === true
  } catch {
    return false
  }
}

/** Nombre del binario embebido según la plataforma. */
export function bundledBinaryName(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'opencode.exe' : 'opencode'
}

export interface BundledOptions {
  /** Plataforma (solo tests). */
  platform?: NodeJS.Platform
  isPackaged?: boolean
  resourcesPath?: string
  /** Valor de `LAZUNOX_TEST_BUNDLED_DIR` (por defecto, el de `process.env`). */
  testDir?: string
  /** Carpeta que contiene `Lazunox Motor/` (solo macOS): dónde mira la copia externa de «Lazunox Motor.app». Por defecto `motorHomeDir(...)`. */
  appDataPath?: string
}

/**
 * OpenCode incluido en la app: `<Resources>/opencode/Lazunox Motor.app/Contents/MacOS/opencode` en macOS (con respaldo a
 * `<Resources>/opencode/opencode`) y `<Resources>/opencode/opencode.exe` en Windows, solo si la app está empaquetada y
 * el archivo existe y es ejecutable. En desarrollo es null (el repo vive en ~/Documents y un binario
 * bajo `resources/` fallaría por TCC): allí se usa el CLI del usuario u `OPENCODE_BIN`. Para tests,
 * `LAZUNOX_TEST_BUNDLED_DIR` (honrada ÚNICAMENTE si `!isPackaged`) apunta a un directorio que
 * hace de `Resources/opencode`.
 */
export function bundledOpencodePath(o: BundledOptions = {}): string | null {
  const packaged = o.isPackaged ?? appIsPackaged()
  let candidate: string | null = null
  if (packaged) {
    const res = o.resourcesPath ?? process.resourcesPath
    if (res) {
      candidate = join(res, 'opencode', bundledBinaryName(o.platform))
      // macOS: el motor es el ejecutable de la mini-app «Lazunox Motor» (identidad propia ante TCC: el aviso la nombra y se puede
      // restablecer por id). Orden: la copia EXTERNA vigente (única que TCC evalúa como el motor; la deja `installMotorApp` al arrancar),
      // luego la maestra anidada en la app (funciona, pero TCC la evalúa a nombre de Lazunox) y, si falta (paquete viejo o a medias), el
      // binario suelto de siempre.
      if ((o.platform ?? process.platform) === 'darwin') {
        const appData = o.appDataPath ?? appDataDir()
        const paths = appData ? motorPaths(res, appData) : null
        const nested = join(res, 'opencode', MOTOR_APP_NAME, 'Contents', 'MacOS', 'opencode')
        if (paths && installedMotorCurrent(paths)) candidate = paths.exe
        else if (existsSync(nested) && isExecutable(nested)) candidate = nested
      }
    }
  } else {
    const dir = o.testDir ?? process.env[TEST_BUNDLED_ENV]
    if (dir) {
      candidate = join(dir, bundledBinaryName(o.platform))
      // Solo pruebas, solo Windows: el falso es un `.mjs` (se lanza con node: `test-launcher.ts`), no un `.exe`.
      const mjs = join(dir, 'opencode.mjs')
      if ((o.platform ?? process.platform) === 'win32' && !existsSync(candidate) && existsSync(mjs)) candidate = mjs
    }
  }
  return candidate && existsSync(candidate) && isExecutable(candidate) ? candidate : null
}

/** CLI del usuario: PATH y carpetas habituales. */
function findCliBinary(): string | null {
  const name = bundledBinaryName()
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

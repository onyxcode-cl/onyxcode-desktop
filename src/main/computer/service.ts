/**
 * Servicio de "computer use" en el proceso principal:
 * - localiza el helper nativo (`cu-helper`) y el script del MCP (`out/main/computer-mcp.js`);
 * - estado de permisos de macOS (Accesibilidad / Grabación de pantalla) y cómo pedirlos;
 * - kill-switch + atajo global Cmd+Shift+Escape. La fuente de verdad es el estado EN MEMORIA de
 *   este proceso (`stopped`): el MCP lo consulta con `GET <COMPUTER_EVENTS_URL>/state` antes de cada
 *   acción, así que el agente no puede "des-pararse" borrando un archivo. `stop()` además aborta las
 *   sesiones de los servidores de acceso total (`abortSessions`, lo inyecta tasks-handlers) y mata
 *   los `cu-helper` en vuelo. El archivo STOP (en `userData/lazunox-killswitch/`, ruta que
 *   agents/computer.md deniega a bash/edit) solo es el respaldo si el canal lateral no arrancó;
 *   parar NUNCA se deshace solo: hace falta `resume()` (botón "Reanudar control");
 * - canal lateral de acciones: servidor HTTP en 127.0.0.1 al que el MCP hace `POST` de cada
 *   acción (`COMPUTER_EVENTS_URL`), reemitido como evento `computer:action`;
 * - bloque `mcp.computer` para la config de OpenCode del servidor de acceso completo: MCP `remote`
 *   servido por un utilityProcess de main (`mcp-host.ts`), que conserva los permisos TCC de la app
 *   mientras los `opencode serve` corren desvinculados (AUDIT.md S6).
 *
 * Windows (C4, tras las banderas `tasksWin` + `computerWin`): no hay TCC. El consentimiento propio de la app (versionado, revocable,
 * `userData/computer-win-consent.json`) ocupa su lugar: lo consulta el MCP por `GET /consent` antes de CADA herramienta (falla
 * cerrado) y lo gestiona Ajustes por `computer:winConsent`. Bloquear la sesión o suspender el equipo para el control como un Detener,
 * y el final de cada acción queda en `userData/computer-audit.jsonl` (sin el texto tecleado). macOS no cambia.
 *
 * Movimiento visible: el helper anima el cursor (ver helper.swift). `LAZUNOX_COMPUTER_INSTANT=1`
 * lo desactiva y `LAZUNOX_COMPUTER_TYPE_DELAY_MS` ajusta el ritmo de tecleo.
 *
 * Permisos (TCC): el "proceso responsable" de la cadena Electron → utilityProcess del MCP →
 * cu-helper/screencapture es la app que lanzó Electron. Empaquetado = Lazunox.app; en desarrollo
 * (`npm run dev` desde una terminal) es la TERMINAL (Terminal/iTerm/VS Code…), que es a quien
 * hay que conceder Accesibilidad y Grabación de pantalla. Los `opencode serve` (y su bash) NO
 * forman parte de esa cadena: se lanzan con `lazunox-disclaim`.
 */
import { t } from '@shared/i18n'
import { app, globalShortcut, powerMonitor, shell, systemPreferences } from 'electron'
import { execFile, spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import { randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname, join } from 'node:path'
import { unpacked } from '../util/asar'
import { runHelper } from '../util/exec'
import { recordProblem } from '../diagnostics/problem-log'
import { classifyAppLocation, permsStallDetail } from '@shared/mac-permissions'
import {
  maxTier,
  type AppTier,
  type AccessDecision,
  type AccessRequest,
  type AccessRequestApp,
  type ComputerActionEvent,
  type ComputerKillState,
  type ComputerStatus,
  type ComputerWinConsentAction,
  type ComputerWinConsentResult,
  type ComputerWinStatus,
  type ComputerAuditRow,
  type ComputerUseInfo,
  type PlanApprovalState,
  type TeachStep
} from '@shared/ipc-tasks'
import { ComputerGrantsStore } from './grants'
import { ComputerMcpHost } from './mcp-host'
import { ComputerPrefsStore } from './prefs'
import { servicePlatformFor } from './service-platform'
import { stopShortcutFor } from './stop-shortcut'
import { createAuditLog, type AuditInput, type AuditLog } from './policy/audit'
import { auditInputFromEvent } from './policy/audit-event'
import { createConsentController, WIN_CONSENT_VERSION, type ConsentController } from './policy/consent-win'
import { createFileConsentStore, nodeAuditFs, readAuditEntries } from './win-storage'

/** Atajo global de parada: `CommandOrControl+Shift+Escape` en macOS; `Ctrl+Alt+Shift+Escape` en Windows (ver `stop-shortcut.ts`). */
export const STOP_SHORTCUT = stopShortcutFor(process.platform)

const PANE_ACCESSIBILITY = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
const PANE_SCREEN = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
/** Tras esto sin ninguna acción, se para el vigía de Esc (deja de escuchar el teclado). */
const ESC_WATCHER_IDLE_MS = 8_000

/** Duración del movimiento animado del cursor (ms). Debe coincidir con `motionDuration` de helper.swift. */
export function motionDurationMs(dist: number): number {
  if (dist < 3) return 0
  return 250 + 350 * Math.min(1, dist / 1400)
}

interface ServiceEvents {
  action: [ComputerActionEvent]
  stopped: [{ at: number }]
  /** Cualquier cambio del kill-switch (parada, reanudación, atajo global no disponible). */
  killState: [ComputerKillState]
  /** Tarjeta "¿Permitir que el agente use X?" pendiente (herramienta MCP `request_access`). */
  requestAccess: [AccessRequest]
  /** Se resolvió (o se canceló al parar el control) una tarjeta `requestAccess`: id de la tarjeta. */
  requestAccessResolved: [{ id: string }]
  /**
   * El usuario aprobó el plan de una tarea: recién ahora se entra en modo control. `sessionId` es la
   * sesión de OpenCode que pidió la tarjeta (ausente si el plugin no pudo inyectarla: modo legado).
   */
  planApproved: [{ sessionId?: string }]
  /** Cambio en la aprobación del plan de una sesión (aprobado / revocado). */
  planState: [PlanApprovalState]
  /** Apps de una petición `request_access` que están bloqueadas (sin tarjeta): el renderer pinta el aviso con el motivo. */
  blockedApps: [{ sessionId?: string; apps: BlockedApp[] }]
  /** Lote C: Teach mode pide un paso (globo con texto + punto) y espera "Siguiente"/"Salir". */
  teachStep: [TeachStep]
  /** Lote C: fin de Teach mode (teach_end, o se limpia al parar el control). */
  teachClear: []
  /** Lote C: una sesión tomó el control de ratón/teclado (takeover aprobado). */
  foreground: [{ sessionId?: string }]
}

/** Respuesta de una tarjeta `request_access` al MCP (cuerpo del POST `/request-access`). */
export interface AccessResponse {
  /** Nivel EFECTIVO por bundleId (`'deny'` si el usuario la denegó). Solo apps que estaban en la tarjeta. */
  decisions: Record<string, AccessDecision>
  /** El usuario pidió cambios al plan ("Editar"): no se concedió nada. */
  feedback?: string
  /** El usuario canceló (Esc, ✕, "Cancelar", o Detener): no se concedió nada ni se aprobó el plan. */
  cancelled?: boolean
  /** La tarjeta tenía plan y quedó aprobado para la sesión. */
  planApproved?: boolean
  /** Lote C: se concedió sin tarjeta, por el Modo auto ("Solo ver" efímero para esta tarea). */
  auto?: boolean
  /** Apps de la petición que están bloqueadas (no entraron en la tarjeta): el MCP le dice al agente que no las rodee. */
  blocked?: BlockedApp[]
}

/** Por qué una app no se puede pedir: 'fixed' = lista de seguridad de Lazunox; 'user' = «Bloqueadas por ti»; 'session' = «No» solo en esta tarea. */
export type BlockKind = 'fixed' | 'user' | 'session'
export interface BlockedApp {
  bundleId: string
  name: string
  kind: BlockKind
}

/**
 * Lote C: petición al Modo auto (`tasks-handlers` la conecta con `getAutoApprover()`) antes de
 * mostrar la tarjeta `request_access`/`request_full_control`. Se espera como mucho 1,5 s.
 */
export interface AutoAccessQuery {
  sessionId?: string
  apps: AccessRequestApp[]
  plan?: string[]
  kind: 'access' | 'takeover'
  reason?: string
}

export interface AutoAccessVerdict {
  approve: true
  recordId: string
}

/** Opciones de `resolveAccessRequest`. */
export interface ResolveAccessOptions {
  feedback?: string
  /** Aprueba el plan aunque no se conceda ninguna app (plan sin apps). */
  approvePlan?: boolean
  /** Esc / ✕ / "Cancelar": no toca ninguna concesión ni aprueba nada. */
  cancel?: boolean
  /**
   * Alcance de lo que se APRUEBA en la tarjeta: 'session' (por defecto) = solo esta sesión, en memoria,
   * sin tocar el disco; 'always' = permanente (`computer-grants.json`, uso desde Ajustes).
   */
  scope?: 'session' | 'always'
  /** Estricta: «Denegar» además bloquea la app PARA SIEMPRE (`grants.deny`). Sin ella, solo esta sesión. */
  alsoBlock?: boolean
}

const SESSION_RE = /^[A-Za-z0-9_-]{1,200}$/
const TIERS: ReadonlySet<string> = new Set(['view', 'click', 'full'])

/** Resultado de abortar las sesiones de los servidores de acceso total. */
export interface AbortReport {
  aborted: number
  failed: number
}

/** Solo macOS: `location` si la app corre translocada o desde un volumen (ruta del ejecutable). */
function locationField(): { location?: 'translocated' | 'volume' } {
  const loc = classifyAppLocation(process.execPath)
  return loc ? { location: loc } : {}
}

export class ComputerService extends EventEmitter<ServiceEvents> {
  private events: Server | null = null
  private eventsUrl: string | null = null
  private eventsStarting: Promise<string | null> | null = null
  private shortcutRegistered = false
  /** Kill-switch: fuente de verdad (en memoria del proceso principal). */
  private stopped = false
  private stoppedAt: number | null = null
  /**
   * Aborta toda sesión en curso de los servidores de acceso total (inyectado por tasks-handlers;
   * el gestor de Tareas conoce los servidores y sus credenciales).
   */
  abortSessions: (() => Promise<AbortReport>) | null = null
  /** Sin animación del cursor (también lo usa el overlay para no simular el viaje). */
  readonly instant = process.env.LAZUNOX_COMPUTER_INSTANT === '1'
  /**
   * Se espera (≤500 ms) antes de responder al inicio de una captura: permite ocultar el overlay si
   * la protección de contenido no bastara para excluirlo de `screencapture`.
   */
  captureGuard: (() => Promise<void>) | null = null
  /** MCP en utilityProcess (se arranca con el primer servidor de acceso total). */
  private readonly mcpHost = new ComputerMcpHost(
    () => this.mcpScriptPath(),
    () => this.mcpEnv()
  )
  /** Concesión por app (bloque C, ítem 9): `userData/computer-grants.json`. */
  private _grants: ComputerGrantsStore | null = null
  get grants(): ComputerGrantsStore {
    this._grants ??= new ComputerGrantsStore(
      join(app.getPath('userData'), 'computer-grants.json'),
      this.platform.id === 'win32' ? 'win32' : 'darwin'
    )
    return this._grants
  }
  /** Lote C: preferencias de computer use (`userData/computer-prefs.json`): modo y ocultar apps. */
  private _prefs: ComputerPrefsStore | null = null
  get prefs(): ComputerPrefsStore {
    this._prefs ??= new ComputerPrefsStore(join(app.getPath('userData'), 'computer-prefs.json'))
    return this._prefs
  }
  /** Tarjetas `request_access` pendientes de respuesta del usuario (canal lateral del MCP). */
  private readonly pendingAccess = new Map<
    string,
    {
      resolve: (r: AccessResponse) => void
      /** Presente si esta tarjeta es un plan inicial (flujo Plan → Aprobar → Ejecutar). */
      plan?: string[]
      /** Apps de la tarjeta (con `requested`/`current`/`denied`): solo estas se aceptan al responder. */
      apps: AccessRequestApp[]
      /** Sesión (tarea) de OpenCode que pidió la tarjeta (la inyecta el plugin `lazunox-plan-gate`). */
      sessionId?: string
      /** Lote C: `'takeover'` = pide tomar el ratón y el teclado en modo segundo plano. */
      kind?: 'access' | 'takeover'
      /** Huella de la petición (sesión + tipo + plan + apps): una llamada repetida con la MISMA huella se reengancha a esta tarjeta. */
      fingerprint?: string
      /** Quien espera la respuesta: la llamada original y las que se reenganchan (ver `requestAccess`). */
      waiters?: Array<(r: AccessResponse) => void>
    }
  >()
  /**
   * Lote C: el Modo auto (inyectado por `tasks-handlers` desde `getAutoApprover()`) puede
   * conceder una petición sencilla sin mostrar tarjeta. Se espera como mucho 1,5 s antes de seguir
   * con el flujo normal (tarjeta al usuario). `null` = sin Modo auto conectado o no aplica.
   */
  autoAccess: ((q: AutoAccessQuery) => Promise<AutoAccessVerdict | null>) | null = null
  /** Lote C: "Solo ver" efímero por sesión (Modo auto), NUNCA persistido en `computer-grants.json`. */
  private readonly autoView = new Map<string, Set<string>>()
  /** «Permitir para esta sesión»: nivel por app y sesión, SOLO en memoria (nunca a disco, no se hereda). La clave '' = sin sesión. */
  private readonly sessionGrants = new Map<string, Map<string, AppTier>>()
  /** «Denegar» de la tarjeta (sin `alsoBlock`): vale solo para esta sesión, en memoria. */
  private readonly sessionDenied = new Map<string, Set<string>>()
  /**
   * Apps declaradas/aprobadas en el plan de ESTA tarea (F8-B149): a diferencia de `grants` (concesión
   * PERMANENTE, para siempre), esto es solo "qué apps importan para la tarea de ahora" — se usa para
   * decidir qué queda VISIBLE en las capturas en segundo plano. Antes de esto, una app concedida en
   * cualquier tarea anterior (p.ej. Discord, concedida hace semanas) quedaba visible SIEMPRE, aunque
   * la tarea actual no tuviera nada que ver con ella. Se limpia en `revokePlan`: tarea nueva, lista
   * nueva.
   */
  private readonly taskApps = new Map<string, Set<string>>()
  /**
   * Lote C: sesiones (tareas) que tomaron el control del ratón y el teclado en modo segundo plano
   * (`request_full_control` aprobado). Se limpia en `revokePlan`, `stop()` y `dispose()`.
   */
  private readonly foregroundSessions = new Set<string>()
  /** Lote C: pasos de Teach mode pendientes de "Siguiente"/"Salir de la guía". */
  private readonly pendingTeach = new Map<string, { resolve: (a: 'next' | 'exit') => void }>()
  /**
   * Sesiones (tareas de OpenCode) con el plan aprobado → instante de aprobación. El MCP rechaza toda
   * herramienta de acción (`computer_*`, salvo `request_access`) y el plugin `lazunox-plan-gate` toda
   * herramienta que no sea de solo-planificación mientras la sesión no esté aquí (consultado por
   * `GET .../plan-status?session=<id>`). La aprobación dura TODA la tarea (sesión): se pierde con
   * "Revocar" (`revokePlan`), archivar/borrar la tarea, Detener (`stop()`, todas) o al reiniciar la
   * app (solo en memoria). Una tarea nueva = sesión nueva = plan nuevo.
   */
  private readonly approvedPlans = new Map<string, number>()
  /**
   * Respaldo si la inyección de `lazunox_session` falla (tarjeta o consulta sin sesión): aprobación
   * global como antes. Se apaga al terminar la sesión de control (`endLegacyPlan`) o con `stop()`.
   */
  private legacyPlanApproved = false
  /** Vigía nativo de Esc físico (`cu-helper watch-esc`), solo mientras hay control activo. */
  private escWatcher: ChildProcessByStdio<Writable | null, Readable, Readable> | null = null
  private escIdleTimer: NodeJS.Timeout | null = null

  /** Lo que depende del sistema (rutas del helper, parada de respaldo, vigía de Esc, entorno del MCP): `service-platform.ts`. */
  private readonly platform: ReturnType<typeof servicePlatformFor>

  /** `platform` solo lo inyectan las pruebas; en la app es siempre `process.platform`. */
  constructor(opts: { platform?: string } = {}) {
    super()
    this.platform = servicePlatformFor(opts.platform ?? process.platform)
  }

  /** ¿Esta plataforma usa el consentimiento propio de la app en lugar de TCC? (Windows). */
  get ownConsent(): boolean {
    return this.platform.ownConsent
  }

  /** Consentimiento de la app (solo Windows): archivo propio de `main`, no `settings.json` (lo escribe el renderer). */
  private _consent: ConsentController | null = null
  private get consent(): ConsentController {
    this._consent ??= createConsentController(createFileConsentStore(join(app.getPath('userData'), 'computer-win-consent.json')))
    return this._consent
  }
  /** Registro auditable (solo Windows): `userData/computer-audit.jsonl`, rotación 5 MB × 3. */
  private _audit: AuditLog | null = null
  private get audit(): AuditLog {
    this._audit ??= createAuditLog(app.getPath('userData'), nodeAuditFs)
    return this._audit
  }
  /** Escucha de `powerMonitor` (bloqueo de sesión, suspensión): la quita `dispose()`. */
  private powerListener: (() => void) | null = null

  /** Ruta del helper nativo o null si no está compilado. */
  helperPath(): string | null {
    const candidates = this.platform.helperCandidates(
      { resourcesPath: process.resourcesPath ?? '', appPath: app.getAppPath(), cwd: process.cwd() },
      unpacked
    )
    return candidates.find((p) => existsSync(p)) ?? null
  }

  /** Ruta de `computer-mcp.js` (junto a out/main/index.js). */
  mcpScriptPath(): string | null {
    const candidates = [
      unpacked(join(app.getAppPath(), 'out', 'main', 'computer-mcp.js')),
      join(app.getAppPath(), 'out', 'main', 'computer-mcp.js'),
      join(__dirname, 'computer-mcp.js')
    ]
    return candidates.find((p) => existsSync(p)) ?? null
  }

  /**
   * Archivo de parada de RESPALDO (solo si el MCP no puede consultar a este proceso). El nombre de
   * la carpeta coincide con la regla `*lazunox-killswitch*` que agents/computer.md deniega a
   * bash/edit/write (defensa en profundidad: un comando ofuscado podría esquivarla, ver AUDIT S5).
   */
  get stopFile(): string {
    return join(app.getPath('userData'), 'lazunox-killswitch', 'STOP')
  }

  /**
   * Última hora (epoch ms) de un keyDown REAL, anotada por `cu-helper watch-esc` (ver
   * `noteRealKeyDown` en helper.swift). La herramienta `type_text`/`key` del MCP la lee (comando
   * `recent-input`) para pausar si el usuario está escribiendo ahora mismo: no puede usar las APIs
   * de "tiempo desde el último evento" del sistema porque también las actualizan nuestros propios
   * eventos sintéticos en cuanto se postean (verificado).
   */
  private get inputFile(): string {
    return join(app.getPath('temp'), 'lazunox-computer-input')
  }

  isStopped(): boolean {
    return this.stopped
  }

  state(): ComputerKillState {
    return {
      stopped: this.stopped,
      stoppedAt: this.stoppedAt,
      shortcutRegistered: this.shortcutRegistered,
      shortcut: STOP_SHORTCUT
    }
  }

  /** Inicializa: arranca en estado reanudado (limpia un STOP previo) y registra el atajo global. */
  init(): void {
    // Ubicación antigua del archivo de parada.
    rmSync(join(app.getPath('userData'), 'computer-use', 'STOP'), { force: true })
    this.resume()
    this.registerShortcut()
    // Esc físico: solo vigila mientras hay actividad reciente (ver `noteActivity`); un Esc suelto
    // en cualquier otro momento no para nada.
    this.on('action', () => this.noteActivity())
    // Bloquear la sesión (Win+L) o suspender el equipo = Detener, como el atajo; reanudar exige «Reanudar control». Solo Windows.
    if (this.platform.stopOnPowerEvents.length && !this.powerListener) {
      const listener = (): void => void this.stop('session-lock')
      this.powerListener = listener
      for (const ev of this.platform.stopOnPowerEvents) powerMonitor.on(ev as 'lock-screen', listener)
    }
  }

  // ───────────────────────────── Esc físico (parada mientras se controla) ─────────────────────────────

  private noteActivity(): void {
    this.ensureEscWatcher()
    if (this.escIdleTimer) clearTimeout(this.escIdleTimer)
    this.escIdleTimer = setTimeout(() => this.stopEscWatcher(), ESC_WATCHER_IDLE_MS)
  }

  private ensureEscWatcher(): void {
    if (this.escWatcher || !this.platform.hasEscWatcher) return
    const bin = this.helperPath()
    if (!bin) return
    try {
      // stdout y stderr son siempre 'pipe': el tipo de `spawn` no lo infiere con la expresión condicional de stdin.
      const child = spawn(bin, ['watch-esc'], {
        // Windows: stdin ABIERTA y sin escribir (se cierra sola si la app muere y el vigía sale); macOS: sin cambios.
        stdio: [process.platform === 'win32' ? 'pipe' : 'ignore', 'pipe', 'pipe'],
        env: { ...process.env, COMPUTER_INPUT_FILE: this.inputFile }
      }) as ChildProcessByStdio<Writable | null, Readable, Readable>
      this.escWatcher = child
      createInterface({ input: child.stdout }).on('line', (line) => {
        if (line.trim() === 'STOP') void this.stop()
      })
      child.once('exit', () => {
        if (this.escWatcher === child) this.escWatcher = null
      })
      child.once('error', (err) => {
        console.error('[computer] watch-esc:', err)
        if (this.escWatcher === child) this.escWatcher = null
      })
    } catch (err) {
      console.error('[computer] watch-esc:', err)
    }
  }

  private stopEscWatcher(): void {
    if (this.escIdleTimer) {
      clearTimeout(this.escIdleTimer)
      this.escIdleTimer = null
    }
    const w = this.escWatcher
    this.escWatcher = null
    if (w) w.kill('SIGTERM')
  }

  // ───────────────────────────── Concesión por app: `request_access` ─────────────────────────────

  /**
   * Emite la tarjeta y ESPERA la respuesta del usuario sin límite de tiempo: no hay "sin respuesta
   * ⇒ denegado" (antes 5 min; eso mataba tareas si el usuario tardaba o no veía el aviso). La
   * única forma de que quede sin resolver para siempre es que el proceso muera; el único cierre
   * forzado es `stop()` (Detener / kill-switch), que deniega todo lo pendiente como respaldo de
   * seguridad. Mientras espera, la tarea queda en pausa ("Esperando tu permiso"): el agente no
   * puede avanzar porque la llamada MCP no vuelve.
   */
  async requestAccess(
    apps: AccessRequestApp[],
    reason?: string,
    plan?: string[],
    sessionId?: string,
    unresolved?: string[],
    kind: 'access' | 'takeover' = 'access'
  ): Promise<AccessResponse> {
    // Apps BLOQUEADAS (fija de seguridad, «Bloqueadas por ti» guardada, o «No» de ESTA sesión): no abren tarjeta ni se conceden.
    // Se avisa al renderer (aviso en el hilo con el motivo y los pasos) y al agente (texto firme en el MCP).
    const blockedApps: BlockedApp[] = []
    for (const a of apps) {
      const bk = this.blockKind(sessionId, a.bundleId)
      if (bk) blockedApps.push({ bundleId: a.bundleId, name: a.name, kind: bk })
    }
    if (blockedApps.length) {
      this.emit('blockedApps', { sessionId, apps: blockedApps })
      const denyMap: Record<string, AccessDecision> = {}
      for (const b of blockedApps) denyMap[b.bundleId] = 'deny'
      const rest = apps.filter((a) => !denyMap[a.bundleId])
      // Sin nada pendiente y sin plan que aprobar (o petición de takeover): ni tarjeta ni espera.
      if (!rest.length && (!plan?.length || kind === 'takeover')) return { decisions: denyMap, blocked: blockedApps }
      const r = await this.requestAccess(rest, reason, plan, sessionId, unresolved, kind)
      return { ...r, decisions: { ...r.decisions, ...denyMap }, blocked: blockedApps }
    }
    // Main rellena el estado actual de cada app: la tarjeta preselecciona sin bajar lo ya concedido.
    const enriched = apps.map((a) => ({
      ...a,
      current: maxTier(this.grants.tierFor(a.bundleId), this.sessionTier(sessionId, a.bundleId)),
      denied: this.grants.isDenied(a.bundleId) || this.grants.isBlocked(a.bundleId)
    }))
    // Modo auto (Lote C, C3): antes de mostrar la tarjeta, se le da la oportunidad de conceder
    // "Solo ver" efímero sin preguntar (allowlist estricta; nunca para takeover ni planes). Se
    // espera como mucho 1,5 s: si tarda o deniega, sigue el flujo normal (tarjeta al usuario).
    const verdict = await this.tryAutoAccess({ sessionId, apps: enriched, plan, kind, reason })
    if (verdict) {
      const decisions: Record<string, AccessDecision> = {}
      for (const a of enriched) decisions[a.bundleId] = 'view'
      if (sessionId) {
        const bundleIds = enriched.map((a) => a.bundleId)
        this.grantAutoView(sessionId, bundleIds)
        this.markTaskApps(sessionId, bundleIds)
      }
      return { decisions, auto: true }
    }
    // La llamada MCP del agente no puede quedarse esperando más de unos minutos (el cliente la corta): el MCP vuelve a los ~4 min con «sigo
    // esperando» y el agente repite la MISMA petición. Si ya hay una tarjeta abierta con la misma huella se reengancha a ella, sin crear
    // otra ni perder lo que el usuario estaba mirando.
    const fingerprint = JSON.stringify([sessionId ?? '', kind, plan ?? [], enriched.map((a) => `${a.bundleId}:${a.requested}`).sort()])
    for (const entry of this.pendingAccess.values()) {
      if (entry.fingerprint === fingerprint && entry.waiters) {
        return new Promise((resolve) => entry.waiters!.push(resolve))
      }
    }
    const id = randomBytes(8).toString('hex')
    return new Promise((resolve) => {
      const waiters: Array<(r: AccessResponse) => void> = [resolve]
      const resolveAll = (r: AccessResponse): void => {
        for (const w of waiters.splice(0)) w(r)
      }
      this.pendingAccess.set(id, { resolve: resolveAll, plan, apps: enriched, sessionId, kind, fingerprint, waiters })
      this.emit('requestAccess', { id, apps: enriched, reason, plan, sessionId, unresolved, kind })
    })
  }

  private async tryAutoAccess(q: AutoAccessQuery): Promise<AutoAccessVerdict | null> {
    if (!this.autoAccess || !q.apps.length) return null
    const timeout = new Promise<null>((r) => setTimeout(r, 1_500))
    try {
      return await Promise.race([this.autoAccess(q), timeout])
    } catch (err) {
      console.error('[computer] autoAccess:', err)
      return null
    }
  }

  /** Marca estas apps como relevantes para la tarea actual de esa sesión (ver `taskApps`). */
  private markTaskApps(sessionId: string | undefined, bundleIds: string[]): void {
    if (!sessionId || !bundleIds.length) return
    let set = this.taskApps.get(sessionId)
    if (!set) {
      set = new Set()
      this.taskApps.set(sessionId, set)
    }
    for (const b of bundleIds) set.add(b)
  }

  /** Bundle ids relevantes para la tarea ACTUAL de esa sesión (para no ocultarlos en las capturas). */
  sessionTaskApps(sessionId?: string): string[] {
    if (!sessionId) return []
    return [...(this.taskApps.get(sessionId) ?? [])]
  }

  /** "Solo ver" efímero por sesión (Modo auto): NUNCA se persiste en `computer-grants.json`. */
  grantAutoView(sessionId: string, bundleIds: string[]): void {
    let set = this.autoView.get(sessionId)
    if (!set) {
      set = new Set()
      this.autoView.set(sessionId, set)
    }
    for (const b of bundleIds) set.add(b)
  }

  /** Quita el "Solo ver" efímero (una app, o toda la sesión si se omite `bundleId`). */
  revokeAutoView(sessionId: string, bundleId?: string): void {
    const set = this.autoView.get(sessionId)
    if (!set) return
    if (bundleId) {
      set.delete(bundleId)
      if (!set.size) this.autoView.delete(sessionId)
    } else {
      this.autoView.delete(sessionId)
    }
  }

  /** Nivel concedido solo para esta sesión (tarjeta «Permitir para esta sesión»), si lo hay. */
  private sessionTier(sessionId: string | undefined, bundleId: string): AppTier | null {
    if (!sessionId || !SESSION_RE.test(sessionId)) return null
    return this.sessionGrants.get(sessionId)?.get(bundleId) ?? null
  }

  /** Apps con permiso «solo esta sesión» (para no ocultarlas mientras el agente las usa). */
  sessionGrantedApps(sessionId?: string): string[] {
    if (!sessionId || !SESSION_RE.test(sessionId)) return []
    return [...(this.sessionGrants.get(sessionId)?.keys() ?? [])]
  }

  /** Apps con permiso de sesión en CUALQUIER sesión activa (visibilidad global de Mac). */
  allSessionGrantedApps(): string[] {
    const out = new Set<string>()
    for (const m of this.sessionGrants.values()) for (const b of m.keys()) out.add(b)
    return [...out]
  }

  /** Tipo de bloqueo de una app (null = se puede pedir). Prioridad: seguridad fija > guardada por la persona > solo esta sesión. */
  private blockKind(sessionId: string | undefined, bundleId: string): BlockKind | null {
    if (this.grants.isBlocked(bundleId)) return 'fixed'
    if (this.grants.isDenied(bundleId)) return 'user'
    if (this.isSessionDenied(sessionId, bundleId)) return 'session'
    return null
  }

  private isSessionDenied(sessionId: string | undefined, bundleId: string): boolean {
    if (!sessionId || !SESSION_RE.test(sessionId)) return false
    return this.sessionDenied.get(sessionId)?.has(bundleId) === true
  }

  /** Nivel efectivo de una app en una sesión: persistido, de sesión y Modo auto; lo bloqueado/denegado nunca concede. */
  private effectiveTier(sessionId: string | undefined, bundleId: string, name: string): AppTier | null {
    if (this.grants.isBlocked(bundleId) || this.grants.isDenied(bundleId) || this.isSessionDenied(sessionId, bundleId)) return null
    const persisted = this.grants.resolve(bundleId, name)
    return maxTier(maxTier(persisted, this.sessionTier(sessionId, bundleId)), this.autoViewTier(sessionId, bundleId))
  }

  /** Nivel "Solo ver" efímero concedido a esa app por el Modo auto en esa sesión, si lo hay. */
  private autoViewTier(sessionId: string | undefined, bundleId: string): 'view' | null {
    if (!sessionId) return null
    return this.autoView.get(sessionId)?.has(bundleId) ? 'view' : null
  }

  /**
   * ¿La sesión controla el ratón y el teclado ahora mismo? En modo "Control de la pantalla" (no
   * segundo plano) siempre es así; en segundo plano, solo tras un `request_full_control` aprobado
   * para esa sesión (`foregroundSessions`). Sin sesión: si hay ALGUNA sesión con el control.
   */
  isForeground(sessionId?: string): boolean {
    if (this.prefs.get().mode === 'full') return true
    return sessionId ? this.foregroundSessions.has(sessionId) : this.foregroundSessions.size > 0
  }

  /**
   * El renderer responde `computer:respondAccess`. Reglas (seguridad: nada de escalada silenciosa):
   * - `cancel` (Esc, ✕, "Cancelar") y `feedback` ("Editar") NO conceden nada ni tocan ninguna
   *   concesión; si la tarjeta tenía plan, revocan la aprobación de su sesión.
   * - Se ignoran los bundleIds que no estaban en la tarjeta pendiente.
   * - Aprobar NUNCA baja un nivel: nivel efectivo = `maxTier(concedido, decisión)`. Bajar solo se
   *   hace en Ajustes (`computer:setGrant`). "Denegar" por app sí es explícito (`grants.deny`).
   * - El plan se aprueba si la tarjeta tenía plan, no hubo cancel/feedback y (`approvePlan` o alguna
   *   app aprobada). Sin `sessionId` (falló la inyección) cae al modo legado global.
   * Reactiva la app objetivo (best-effort, sin bloquear) para que el agente retome donde lo dejó, y
   * el resultado de `request_access` en el MCP adjunta una captura fresca.
   */
  resolveAccessRequest(
    id: string,
    decisions: Array<{ bundleId: string; name: string; decision: AccessDecision }>,
    opts: ResolveAccessOptions = {}
  ): boolean {
    const pending = this.pendingAccess.get(id)
    if (!pending) return false
    this.pendingAccess.delete(id)
    const { feedback, approvePlan, cancel } = opts
    const scope = opts.scope === 'always' ? 'always' : 'session'
    const alsoBlock = opts.alsoBlock === true
    const map: Record<string, AccessDecision> = {}
    let approvedSomething = false
    let firstApproved: string | null = null
    let planApproved = false
    if (cancel || feedback) {
      if (pending.plan && pending.sessionId) this.revokePlan(pending.sessionId)
    } else {
      const inCard = new Map(pending.apps.map((a) => [a.bundleId, a]))
      for (const d of decisions) {
        const card = inCard.get(d.bundleId)
        if (!card || d.bundleId in map) continue
        if (this.grants.isBlocked(d.bundleId) || this.grants.isDenied(d.bundleId) || this.isSessionDenied(pending.sessionId, d.bundleId)) {
          // Bloqueada (fija), denegada guardada o denegada en la sesión: nunca se concede, diga lo que diga el renderer.
          map[d.bundleId] = 'deny'
          continue
        }
        if (d.decision === 'deny') {
          if (alsoBlock) this.grants.deny(d.bundleId, card.name)
          else this.denyForSession(pending.sessionId, d.bundleId)
          map[d.bundleId] = 'deny'
        } else if (d.decision === 'view' || d.decision === 'click' || d.decision === 'full') {
          // Nunca baja un nivel: cuenta lo persistido y lo ya concedido en la sesión.
          const current = maxTier(this.grants.tierFor(d.bundleId), this.sessionTier(pending.sessionId, d.bundleId))
          const effective = maxTier(current, d.decision) ?? d.decision
          if (scope === 'always') {
            // El nombre lo fija la tarjeta (main), no el renderer.
            this.grants.grant(d.bundleId, card.name || d.name, effective)
          } else {
            this.grantForSession(pending.sessionId, d.bundleId, effective)
          }
          map[d.bundleId] = effective
          approvedSomething = true
          firstApproved ??= d.bundleId
          this.markTaskApps(pending.sessionId, [d.bundleId])
        }
      }
      if (pending.plan && (approvePlan === true || approvedSomething)) {
        planApproved = true
        this.approvePlanFor(pending.sessionId)
        // Una sola aprobación: si el usuario concedió «Ver y clic» o «Control total» a alguna app con el plan, ya aceptó
        // que el agente actúe con el ratón y el teclado reales (la tarjeta lo dice). Antes hacía falta una SEGUNDA tarjeta
        // («¿Tomar el control de la pantalla?») y el agente perdía 4-8 llamadas rebotando contra el modo segundo plano.
        // La tarjeta de takeover sigue existiendo (apps añadidas luego, o planes sin apps que después piden control).
        if (pending.kind === 'access' && pending.sessionId && Object.values(map).some((d) => d === 'click' || d === 'full')) {
          this.foregroundSessions.add(pending.sessionId)
          this.emit('foreground', { sessionId: pending.sessionId })
        }
      }
      // Lote C: tarjeta "¿Tomar el control de la pantalla?" (`request_full_control`) aprobada:
      // la sesión pasa a controlar el ratón y el teclado en modo segundo plano hasta que termine
      // (revokePlan/stop la quitan de `foregroundSessions`).
      if (pending.kind === 'takeover' && approvePlan === true && pending.sessionId) {
        this.foregroundSessions.add(pending.sessionId)
        this.emit('foreground', { sessionId: pending.sessionId })
      }
    }
    if (firstApproved) void this.activateApp(firstApproved)
    pending.resolve({
      decisions: map,
      feedback: feedback || undefined,
      cancelled: cancel === true ? true : undefined,
      planApproved: planApproved || undefined
    })
    this.emit('requestAccessResolved', { id })
    return true
  }

  private grantForSession(sessionId: string | undefined, bundleId: string, tier: AppTier): void {
    // Sin sesión válida la decisión vale solo para esa llamada: no se guarda nada (no mezclar sesiones).
    if (!sessionId || !SESSION_RE.test(sessionId)) return
    const key = sessionId
    let m = this.sessionGrants.get(key)
    if (!m) {
      m = new Map()
      this.sessionGrants.set(key, m)
    }
    m.set(bundleId, maxTier(m.get(bundleId) ?? null, tier) ?? tier)
  }

  private denyForSession(sessionId: string | undefined, bundleId: string): void {
    if (!sessionId || !SESSION_RE.test(sessionId)) return
    const key = sessionId
    let set = this.sessionDenied.get(key)
    if (!set) {
      set = new Set()
      this.sessionDenied.set(key, set)
    }
    set.add(bundleId)
    this.sessionGrants.get(key)?.delete(bundleId)
  }

  /** Aprueba el plan de una sesión (sin `sessionId`: respaldo legado global, con aviso en el log). */
  approvePlanFor(sessionId?: string): void {
    if (sessionId) {
      this.approvedPlans.set(sessionId, Date.now())
      this.emit('planState', { sessionId, approved: true })
    } else {
      console.warn('[computer] plan aprobado sin sessionId (falló la inyección de lazunox_session): modo global')
      this.legacyPlanApproved = true
    }
    this.emit('planApproved', { sessionId })
  }

  /**
   * Revoca la aprobación del plan de una sesión ("Revocar", archivar/borrar la tarea, cancelar el
   * plan). También limpia el control de pantalla en segundo plano (`foregroundSessions`) y el
   * "Solo ver" efímero del Modo auto (`autoView`) de esa sesión: una tarea nueva empieza de cero.
   */
  revokePlan(sessionId: string): void {
    const hadPlan = this.approvedPlans.delete(sessionId)
    this.foregroundSessions.delete(sessionId)
    this.revokeAutoView(sessionId)
    this.sessionGrants.delete(sessionId)
    const hadSessionDenied = this.sessionDenied.delete(sessionId)
    this.taskApps.delete(sessionId)
    // Tarjetas aún abiertas de esa sesión: se cancelan, para que aprobarlas después no vuelva a crear permisos de sesión.
    for (const [id, pending] of [...this.pendingAccess]) {
      if (pending.sessionId !== sessionId) continue
      this.pendingAccess.delete(id)
      pending.resolve({ decisions: {}, cancelled: true })
      this.emit('requestAccessResolved', { id })
    }
    // También sin plan: si había «No» de esta sesión, el renderer debe retirar sus avisos de bloqueo.
    if (hadPlan || hadSessionDenied) this.emit('planState', { sessionId, approved: false })
  }

  /** Ids de las sesiones con el plan aprobado ahora mismo. */
  approvedPlanSessions(): string[] {
    return [...this.approvedPlans.keys()]
  }

  /** Fin de la sesión de control: apaga solo el respaldo legado; las aprobaciones por sesión siguen. */
  endLegacyPlan(): void {
    this.legacyPlanApproved = false
    this.sessionGrants.delete('')
    this.sessionDenied.delete('')
  }

  /**
   * ¿Hay un plan aprobado? (lo consulta el MCP antes de cada acción y el plugin antes de cada
   * herramienta). Con sesión: aprobada ella o el respaldo legado. Sin sesión (no se pudo inyectar):
   * respaldo legado o cualquier sesión aprobada.
   */
  isPlanApproved(sessionId?: string): boolean {
    if (this.legacyPlanApproved) return true
    return sessionId ? this.approvedPlans.has(sessionId) : this.approvedPlans.size > 0
  }

  // ───────────────────────────── Lote C: Teach mode ─────────────────────────────

  /**
   * Pide un paso de Teach mode (globo con texto + punto) y ESPERA la respuesta ("Siguiente" o
   * "Salir de la guía"), sin límite de tiempo (igual que `request_access`); `teachEnd()`/`stop()`
   * resuelven todo lo pendiente con `'exit'` como respaldo.
   */
  teachStep(step: Omit<TeachStep, 'id'>): Promise<'next' | 'exit'> {
    const id = randomBytes(8).toString('hex')
    return new Promise((resolve) => {
      this.pendingTeach.set(id, { resolve })
      this.emit('teachStep', { id, ...step })
    })
  }

  /** Respuesta del usuario (desde la ventana `assist`) a un paso de Teach mode pendiente. */
  resolveTeach(id: string, action: 'next' | 'exit'): void {
    const pending = this.pendingTeach.get(id)
    if (!pending) return
    this.pendingTeach.delete(id)
    pending.resolve(action)
  }

  /** Fin de Teach mode (`teach_end`, Detener, o el usuario pulsó "Salir de la guía"). */
  teachEnd(): void {
    for (const [id, pending] of this.pendingTeach) {
      this.pendingTeach.delete(id)
      pending.resolve('exit')
    }
    this.emit('teachClear')
  }

  /** Reactiva una app (NSRunningApplication.activate / `open -b`) para restaurar el contexto del agente. */
  private async activateApp(bundleId: string): Promise<void> {
    const bin = this.helperPath()
    if (!bin || !bundleId) return
    try {
      await runHelper(bin, ['activate', bundleId], 5_000)
    } catch (err) {
      console.error('[computer] activate:', err)
    }
  }

  registerShortcut(): void {
    if (this.shortcutRegistered) return
    try {
      this.shortcutRegistered = globalShortcut.register(STOP_SHORTCUT, () => void this.stop())
    } catch (err) {
      console.warn('[computer] atajo global:', err)
      this.shortcutRegistered = false
    }
    if (!this.shortcutRegistered) {
      console.warn(`[computer] no se pudo registrar ${STOP_SHORTCUT}`)
      this.emit('killState', this.state())
    }
  }

  /**
   * Kill-switch. Idempotente (pulsarlo otra vez vuelve a abortar y matar). Orden: primero el estado
   * en memoria y el archivo (el MCP rechaza desde ya cualquier acción nueva), luego matar los
   * helpers en vuelo, avisar a la UI y abortar las sesiones (que mata también sus bash).
   */
  async stop(reason?: string): Promise<AbortReport> {
    const at = Date.now()
    if (this.platform.auditLog) this.auditWrite({ at, tool: 'stop', outcome: 'stopped', reason })
    this.stopped = true
    this.stoppedAt ??= at
    try {
      mkdirSync(dirname(this.stopFile), { recursive: true, mode: 0o700 })
      writeFileSync(this.stopFile, String(at), 'utf8')
    } catch (err) {
      console.error('[computer] archivo de parada:', err)
    }
    this.stopEscWatcher()
    // Respaldo de seguridad: la ÚNICA forma de que `request_access` deniegue sin respuesta
    // explícita es que se pare el control (Detener / ⌘⇧Esc / abortar sesión).
    this.denyAllPending()
    // Detener revoca TODAS las aprobaciones de plan (cada tarea necesitará un plan nuevo).
    for (const sessionId of [...this.approvedPlans.keys()]) this.revokePlan(sessionId)
    this.legacyPlanApproved = false
    // Lote C: limpia también el control en segundo plano y el "Solo ver" efímero de CUALQUIER
    // sesión (no solo las que tenían un plan aprobado) y cierra Teach mode si estaba activo.
    this.foregroundSessions.clear()
    this.autoView.clear()
    this.sessionGrants.clear()
    this.sessionDenied.clear()
    this.teachEnd()
    const killed = this.killHelpers()
    this.cleanScreenshots()
    this.emit('stopped', { at })
    this.emit('killState', this.state())
    let report: AbortReport = { aborted: 0, failed: 0 }
    try {
      if (this.abortSessions) report = await this.abortSessions()
    } catch (err) {
      console.error('[computer] abortar sesiones:', err)
    }
    await killed
    console.log(`[computer] kill-switch: ${report.aborted} sesión(es) abortada(s), ${report.failed} con error`)
    return report
  }

  /** Deniega toda tarjeta `request_access` pendiente (solo la llama `stop()`). */
  private denyAllPending(): void {
    for (const [id, pending] of this.pendingAccess) {
      this.pendingAccess.delete(id)
      pending.resolve({ decisions: {}, cancelled: true })
      this.emit('requestAccessResolved', { id })
    }
  }

  /** "Reanudar control" (acción explícita del usuario). */
  resume(): void {
    rmSync(this.stopFile, { force: true })
    const changed = this.stopped
    this.stopped = false
    this.stoppedAt = null
    if (changed) this.emit('killState', this.state())
  }

  /** SIGKILL a todo `cu-helper` en ejecución (acción del MCP a medio hacer: tecleo, arrastre…). */
  private killHelpers(): Promise<void> {
    const bin = this.helperPath()
    if (!bin) return Promise.resolve()
    // macOS: SIGTERM (el helper suelta el botón si estaba arrastrando), 300 ms y SIGKILL. Windows: `taskkill /T` y `release-input`.
    // Los pasos viven en `service-platform.ts`.
    let chain: Promise<void> = Promise.resolve()
    for (const step of this.platform.killHelperSteps(bin)) {
      chain = chain
        .then(
          () =>
            new Promise<void>((resolve) => {
              execFile(step.cmd, step.args, { timeout: 3_000 }, () => resolve())
            })
        )
        .then(() => (step.delayAfterMs ? new Promise<void>((r) => setTimeout(r, step.delayAfterMs)) : undefined))
    }
    return chain
  }

  /** Windows: «Estado en este PC». El consentimiento sale de la app; sesión, elevación, escalado y monitores, del helper. */
  private async winStatus(): Promise<ComputerStatus> {
    const bin = this.helperPath()
    const cv = this.consent.view()
    const win: ComputerWinStatus = {
      consent: cv.consent,
      consentVersion: cv.version,
      consentStale: cv.stale,
      interactive: null,
      elevated: null,
      dpiPercent: null,
      monitors: null
    }
    // accessibility/screenRecording = consentimiento: no hay TCC y lo que solo mira esos campos sigue siendo cierto.
    const base: ComputerStatus = { helperOk: false, accessibility: cv.consent, screenRecording: cv.consent, screens: [], win }
    if (!bin) return base
    try {
      const perms = JSON.parse(await runHelper(bin, ['permissions'])) as {
        interactive?: unknown
        elevated?: unknown
        dpi?: unknown
        monitors?: unknown
      }
      const screens = JSON.parse(await runHelper(bin, ['screens'])) as Array<{ width: number; height: number; scale: number }>
      win.interactive = typeof perms.interactive === 'boolean' ? perms.interactive : null
      win.elevated = typeof perms.elevated === 'boolean' ? perms.elevated : null
      win.dpiPercent = typeof perms.dpi === 'number' && perms.dpi > 0 ? Math.round((perms.dpi / 96) * 100) : null
      win.monitors = typeof perms.monitors === 'number' ? perms.monitors : screens.length
      return {
        ...base,
        helperOk: true,
        screens: screens.map((sc) => ({ width: sc.width, height: sc.height, scale: sc.scale }))
      }
    } catch (err) {
      console.error('[computer] helper:', err)
      return base
    }
  }

  async status(): Promise<ComputerStatus> {
    if (this.platform.ownConsent) return this.winStatus()
    const bin = this.helperPath()
    const base: ComputerStatus = {
      helperOk: false,
      accessibility: process.platform === 'darwin' ? systemPreferences.isTrustedAccessibilityClient(false) : false,
      screenRecording: process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') === 'granted' : false,
      screens: [],
      ...locationField()
    }
    if (!bin) return base
    try {
      const perms = JSON.parse(await runHelper(bin, ['permissions'])) as { accessibility: boolean; screenRecording: boolean }
      const screens = JSON.parse(await runHelper(bin, ['screens'])) as Array<{ width: number; height: number; scale: number }>
      return {
        helperOk: true,
        accessibility: !!perms.accessibility,
        screenRecording: !!perms.screenRecording,
        screens: screens.map((s) => ({ width: s.width, height: s.height, scale: s.scale })),
        ...locationField()
      }
    } catch (err) {
      console.error('[computer] helper:', err)
      return base
    }
  }

  /**
   * La interfaz esperó ~90 s y siguen faltando permisos de macOS: lo deja en el registro de problemas con lo que dice el ayudante
   * (sin rutas ni datos personales) y si la app corre translocada o desde un volumen. No lanza nunca.
   */
  async reportPermsStall(): Promise<void> {
    if (this.platform.ownConsent || process.platform !== 'darwin') return
    try {
      const st = await this.status()
      if (st.helperOk && st.accessibility && st.screenRecording) return
      recordProblem({
        source: 'process',
        level: 'warn',
        // i18n-ignore: registro de diagnóstico, no es texto de la interfaz
        message: 'los permisos de macOS siguen sin activarse tras esperar',
        detail: permsStallDetail(st, st.location ?? null)
      })
    } catch {
      // el registro nunca debe romper nada
    }
  }

  /** Estado resumido para `TasksConnection.computerUse`. */
  async info(): Promise<ComputerUseInfo> {
    const st = await this.status()
    const script = this.mcpScriptPath()
    let available = st.helperOk && !!script
    let reason: string | undefined
    if (this.platform.ownConsent) {
      // Windows: sin TCC; cuenta el consentimiento de la app, la sesión interactiva y que Lazunox no corra como administrador.
      const w = st.win
      if (!st.helperOk) reason = t('merr.computer.noHelper')
      else if (!script) reason = t('merr.computer.noMcp')
      else if (w?.elevated === true) reason = t('merr.computer.elevatedWin')
      else if (w?.interactive === false) reason = t('merr.computer.notInteractiveWin')
      else if (!w?.consent) reason = t('merr.computer.noConsentWin')
      available = available && w?.elevated !== true && w?.interactive !== false
    } else if (process.platform !== 'darwin') reason = t('merr.computer.macOnly')
    else if (!st.helperOk) reason = t('merr.computer.noHelper')
    else if (!script) reason = t('merr.computer.noMcp')
    else if (!st.accessibility && !st.screenRecording) reason = t('merr.computer.noBoth')
    else if (!st.accessibility) reason = t('merr.computer.noAccessibility')
    else if (!st.screenRecording) reason = t('merr.computer.noScreen')
    return { available, accessibility: st.accessibility, screenRecording: st.screenRecording, reason }
  }

  /** Lanza los prompts del sistema y abre el panel de Ajustes del primer permiso que falte. */
  async requestPermissions(): Promise<void> {
    if (this.platform.ownConsent) {
      // Windows: no hay prompts del sistema; se rearma la tarjeta de consentimiento de la app (la UI la muestra).
      this.consent.show()
      return
    }
    if (process.platform !== 'darwin') return
    const bin = this.helperPath()
    let perms = { accessibility: false, screenRecording: false }
    if (bin) {
      try {
        perms = JSON.parse(await runHelper(bin, ['request-permissions'])) as typeof perms
      } catch (err) {
        console.error('[computer] request-permissions:', err)
      }
    } else {
      perms.accessibility = systemPreferences.isTrustedAccessibilityClient(true)
      perms.screenRecording = systemPreferences.getMediaAccessStatus('screen') === 'granted'
    }
    if (!perms.accessibility) await shell.openExternal(PANE_ACCESSIBILITY)
    else if (!perms.screenRecording) await shell.openExternal(PANE_SCREEN)
  }

  /**
   * Tarjeta de consentimiento de Windows (`computer:winConsent`). El armado (casilla + 600 ms) lo exige ESTE controlador: un
   * renderer que mande `confirm` sin haber mostrado la tarjeta o antes de tiempo no concede nada. Revocar detiene el control.
   */
  winConsent(action: ComputerWinConsentAction): ComputerWinConsentResult {
    const c = this.consent
    let granted: boolean | undefined
    switch (action) {
      case 'show':
        c.show()
        break
      case 'check':
        c.setChecked(true)
        break
      case 'uncheck':
        c.setChecked(false)
        break
      case 'confirm':
        granted = c.confirm()
        if (granted) this.auditWrite({ tool: 'consent', outcome: 'ok', reason: 'granted' })
        break
      case 'revoke':
        c.revoke()
        this.auditWrite({ tool: 'consent', outcome: 'ok', reason: 'revoked' })
        // Sin consentimiento no hay control: lo que estuviera en marcha se detiene (reanudar exige «Reanudar control»).
        void this.stop('consent-revoked')
        break
    }
    const v = c.view()
    return { consent: v.consent, version: v.version, stale: v.stale, armed: c.armed(), ...(granted === undefined ? {} : { granted }) }
  }

  /** Respuesta de `GET /consent` (canal lateral): `{consent, version}`. La lectura ya falla cerrado; aquí también ante una excepción. */
  private consentBody(): { consent: boolean; version: number } {
    try {
      const v = this.consent.view()
      return { consent: v.consent, version: v.version }
    } catch {
      return { consent: false, version: WIN_CONSENT_VERSION }
    }
  }

  /** Últimas entradas del registro auditable (Ajustes › «Ver registro»). */
  auditEntries(limit = 200): ComputerAuditRow[] {
    return readAuditEntries(app.getPath('userData'), limit)
  }

  private auditWrite(input: AuditInput): void {
    if (!this.platform.auditLog) return
    this.audit.write(input)
  }

  /** Servidor HTTP local para el canal lateral de acciones. Devuelve la URL (con token). */
  private ensureEventsServer(): Promise<string | null> {
    if (this.eventsUrl) return Promise.resolve(this.eventsUrl)
    if (this.eventsStarting) return this.eventsStarting
    const token = randomBytes(16).toString('hex')
    const path = `/computer-events/${token}`
    this.eventsStarting = new Promise((resolve) => {
      const srv = createServer((req, res) => {
        if (req.method === 'GET' && req.url === `${path}/state`) {
          // Consulta del kill-switch por el MCP antes de cada acción.
          res.statusCode = 200
          res.setHeader('content-type', 'application/json')
          res.setHeader('cache-control', 'no-store')
          res.end(JSON.stringify({ stopped: this.stopped }))
          return
        }
        if (this.platform.ownConsent && req.method === 'GET' && req.url === `${path}/consent`) {
          // Windows: consentimiento propio de la app. El MCP lo consulta antes de CADA herramienta y falla cerrado si no responde.
          res.statusCode = 200
          res.setHeader('content-type', 'application/json')
          res.setHeader('cache-control', 'no-store')
          res.end(JSON.stringify(this.consentBody()))
          return
        }
        if (req.method === 'GET' && (req.url ?? '').startsWith(`${path}/tier?`)) {
          // Nivel concedido a una app (bundleId + name para poder autoasignar el nivel por
          // defecto de su categoría la primera vez que se ve). `session` (Lote C): además del
          // nivel persistido, se combina con el "Solo ver" efímero del Modo auto de esa sesión.
          // null = sin decidir o denegada.
          const q = new URL(req.url ?? '', 'http://localhost').searchParams
          const bundleId = (q.get('bundleId') ?? '').slice(0, 255)
          const name = (q.get('name') ?? bundleId).slice(0, 255)
          const sess = q.get('session') ?? ''
          const session = SESSION_RE.test(sess) ? sess : undefined
          const tier = bundleId ? this.effectiveTier(session, bundleId, name) : null
          res.statusCode = 200
          res.setHeader('content-type', 'application/json')
          res.setHeader('cache-control', 'no-store')
          res.end(JSON.stringify({ tier }))
          return
        }
        if (req.method === 'GET' && (req.url ?? '').startsWith(`${path}/control-mode`)) {
          // Modo de control actual y si esa sesión controla el ratón y el teclado ahora mismo
          // (Lote C: `left_click`/`type_text`/… lo consultan para rechazar en segundo plano).
          const sess = new URL(req.url ?? '', 'http://localhost').searchParams.get('session') ?? ''
          const session = SESSION_RE.test(sess) ? sess : undefined
          res.statusCode = 200
          res.setHeader('content-type', 'application/json')
          res.setHeader('cache-control', 'no-store')
          res.end(JSON.stringify({ mode: this.prefs.get().mode, foreground: this.isForeground(session) }))
          return
        }
        if (req.method === 'GET' && (req.url ?? '').startsWith(`${path}/plan-status`)) {
          // El MCP y el plugin `lazunox-plan-gate` la consultan antes de cada herramienta de acción
          // (flujo Plan → Aprobar → Ejecutar). `session` = sesión (tarea) de OpenCode; sin ella se
          // aplica el respaldo legado (ver `isPlanApproved`).
          const sess = new URL(req.url ?? '', 'http://localhost').searchParams.get('session') ?? ''
          const session = SESSION_RE.test(sess) ? sess : undefined
          res.statusCode = 200
          res.setHeader('content-type', 'application/json')
          res.setHeader('cache-control', 'no-store')
          res.end(JSON.stringify({ approved: this.isPlanApproved(session) }))
          return
        }
        if (req.method === 'GET' && (req.url ?? '').startsWith(`${path}/task-apps`)) {
          // F8-B149: apps relevantes para la tarea ACTUAL de esa sesión (no TODA concesión de
          // siempre) — lo consulta `nonGrantedBundleIds` para decidir qué queda visible en las
          // capturas en segundo plano. Sin sesión: lista vacía (no exime nada de más).
          const sess = new URL(req.url ?? '', 'http://localhost').searchParams.get('session') ?? ''
          const session = SESSION_RE.test(sess) ? sess : undefined
          res.statusCode = 200
          res.setHeader('content-type', 'application/json')
          res.setHeader('cache-control', 'no-store')
          res.end(JSON.stringify({ apps: this.sessionTaskApps(session) }))
          return
        }
        if (req.method === 'POST' && req.url === `${path}/request-access`) {
          let body = ''
          req.setEncoding('utf8')
          req.on('data', (c: string) => {
            body += c
            if (body.length > 16_384) req.destroy()
          })
          req.on('end', () => {
            let apps: AccessRequestApp[] = []
            let reason: string | undefined
            let plan: string[] | undefined
            let session: string | undefined
            let unresolved: string[] | undefined
            let kind: 'access' | 'takeover' = 'access'
            try {
              const o = JSON.parse(body) as {
                apps?: unknown
                reason?: unknown
                plan?: unknown
                session?: unknown
                unresolved?: unknown
                kind?: unknown
              }
              if (Array.isArray(o.apps)) {
                apps = o.apps
                  .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
                  .map((a) => {
                    const app: AccessRequestApp = {
                      bundleId: String(a.bundleId ?? '').slice(0, 255),
                      name: String(a.name ?? a.bundleId ?? '').slice(0, 255)
                    }
                    if (typeof a.requested === 'string' && TIERS.has(a.requested)) {
                      app.requested = a.requested as AccessRequestApp['requested']
                    }
                    if (a.alreadyOpen === true) app.alreadyOpen = true
                    return app
                  })
                  .filter((a) => a.bundleId)
                  .slice(0, 20)
              }
              if (typeof o.reason === 'string') reason = o.reason.slice(0, 500)
              if (Array.isArray(o.plan)) {
                plan = o.plan
                  .filter((s): s is string => typeof s === 'string')
                  .map((s) => s.slice(0, 300))
                  .slice(0, 30)
              }
              if (typeof o.session === 'string' && SESSION_RE.test(o.session)) session = o.session
              if (Array.isArray(o.unresolved)) {
                unresolved = o.unresolved
                  .filter((s): s is string => typeof s === 'string')
                  .map((s) => s.slice(0, 255))
                  .slice(0, 10)
                if (!unresolved.length) unresolved = undefined
              }
              if (o.kind === 'takeover') kind = 'takeover'
            } catch {
              res.statusCode = 400
              // i18n-ignore: canal interno con el MCP, no se muestra al usuario
              res.end(JSON.stringify({ error: 'JSON inválido' }))
              return
            }
            // Sin apps solo vale una tarjeta de plan (plan sin apps: terminal, archivos o web).
            if (!apps.length && !plan?.length) {
              res.statusCode = 400
              // i18n-ignore: canal interno con el MCP, no se muestra al usuario
              res.end(JSON.stringify({ error: 'apps vacío y sin plan' }))
              return
            }
            void this.requestAccess(apps, reason, plan, session, unresolved, kind).then((response) => {
              res.statusCode = 200
              res.setHeader('content-type', 'application/json')
              res.setHeader('cache-control', 'no-store')
              res.end(JSON.stringify(response))
            })
          })
          return
        }
        if (req.method === 'POST' && req.url === `${path}/teach-step`) {
          // Teach mode (Lote C): `{session, text, title?, step?, total?, x?, y?}` → ESPERA la
          // respuesta del usuario ("Siguiente"/"Salir de la guía"), sin límite de tiempo.
          let body = ''
          req.setEncoding('utf8')
          req.on('data', (c: string) => {
            body += c
            if (body.length > 16_384) req.destroy()
          })
          req.on('end', () => {
            let o: Record<string, unknown>
            try {
              o = JSON.parse(body) as Record<string, unknown>
            } catch {
              res.statusCode = 400
              // i18n-ignore: canal interno con el MCP, no se muestra al usuario
              res.end(JSON.stringify({ error: 'JSON inválido' }))
              return
            }
            const text = typeof o.text === 'string' ? o.text.slice(0, 400) : ''
            if (!text) {
              res.statusCode = 400
              // i18n-ignore: canal interno con el MCP, no se muestra al usuario
              res.end(JSON.stringify({ error: 'text vacío' }))
              return
            }
            const sess = typeof o.session === 'string' ? o.session : ''
            const step: Omit<TeachStep, 'id'> = { text, sessionId: SESSION_RE.test(sess) ? sess : undefined }
            if (typeof o.title === 'string') step.title = o.title.slice(0, 200)
            if (typeof o.step === 'number') step.step = o.step
            if (typeof o.total === 'number') step.total = o.total
            if (typeof o.x === 'number') step.x = o.x
            if (typeof o.y === 'number') step.y = o.y
            void this.teachStep(step).then((action) => {
              res.statusCode = 200
              res.setHeader('content-type', 'application/json')
              res.setHeader('cache-control', 'no-store')
              res.end(JSON.stringify({ action }))
            })
          })
          return
        }
        if (req.method === 'POST' && req.url === `${path}/teach-end`) {
          this.teachEnd()
          res.statusCode = 204
          res.end()
          return
        }
        if (req.method !== 'POST' || req.url !== path) {
          res.statusCode = 404
          res.end()
          return
        }
        let body = ''
        req.setEncoding('utf8')
        req.on('data', (c: string) => {
          body += c
          if (body.length > 16_384) req.destroy()
        })
        req.on('end', () => {
          const done = (): void => {
            res.statusCode = 204
            res.end()
          }
          let ev: ComputerActionEvent | null = null
          try {
            const o = JSON.parse(body) as Record<string, unknown>
            if (typeof o.tool === 'string') {
              ev = { tool: o.tool.slice(0, 64), at: typeof o.at === 'number' ? o.at : Date.now() }
              const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
              if (num(o.x)) ev.x = o.x
              if (num(o.y)) ev.y = o.y
              if (num(o.fromX)) ev.fromX = o.fromX
              if (num(o.fromY)) ev.fromY = o.fromY
              if (typeof o.text === 'string') ev.text = o.text.slice(0, 200)
              if (o.phase === 'start' || o.phase === 'end') ev.phase = o.phase
              if (typeof o.ok === 'boolean') ev.ok = o.ok
              if (o.auto === true) ev.auto = true
            }
          } catch {
            // JSON inválido: ignorar
          }
          if (!ev) return done()
          if (this.platform.auditLog) {
            const entry = auditInputFromEvent(ev)
            if (entry) this.auditWrite(entry)
          }
          this.emit('action', ev)
          const guard = this.captureGuard
          if (ev.tool === 'screenshot' && ev.phase === 'start' && guard) {
            const timeout = new Promise<void>((r) => setTimeout(r, 500))
            void Promise.race([guard().catch(() => undefined), timeout]).then(done)
          } else {
            done()
          }
        })
      })
      srv.on('error', (err) => {
        console.error('[computer] servidor de eventos:', err)
        resolve(null)
      })
      srv.listen(0, '127.0.0.1', () => {
        const { port } = srv.address() as AddressInfo
        this.events = srv
        this.eventsUrl = `http://127.0.0.1:${port}${path}`
        resolve(this.eventsUrl)
      })
    })
    return this.eventsStarting
  }

  /**
   * URL (con token) del canal lateral de eventos: la usa tanto el MCP (`mcpEnv`) como el plugin
   * `lazunox-plan-gate` del servidor de OpenCode de acceso total (`tasks/manager.ts` la pasa por
   * entorno como `LAZUNOX_PLAN_GATE_URL`, SOLO a servidores de acceso total; `lazunox-env.js` la oculta
   * a bash — ver `tasks/opencode-config.ts`). El plugin consulta `GET .../plan-status` antes de
   * cada herramienta que no sea de solo-planificación (con `?session=<id>`), con el mismo fail-closed
   * que el MCP.
   */
  async planGateUrl(): Promise<string | null> {
    return this.ensureEventsServer()
  }

  /** Entorno propio del MCP (se suma a `minimalEnv` en el host). */
  private async mcpEnv(): Promise<Record<string, string>> {
    const helper = this.helperPath()
    if (!helper) throw new Error(t('merr.computer.noCuHelper'))
    const eventsUrl = await this.ensureEventsServer()
    const environment: Record<string, string> = {
      CU_HELPER: helper,
      COMPUTER_STOP_FILE: this.stopFile,
      COMPUTER_INPUT_FILE: this.inputFile,
      COMPUTER_SHOT_DIR: join(app.getPath('temp'), 'lazunox-computer')
    }
    if (eventsUrl) environment.COMPUTER_EVENTS_URL = eventsUrl
    if (this.instant) environment.COMPUTER_INSTANT = '1'
    const typeDelay = process.env.LAZUNOX_COMPUTER_TYPE_DELAY_MS
    if (typeDelay && Number.isFinite(Number(typeDelay))) environment.COMPUTER_TYPE_DELAY_MS = typeDelay
    const fake = process.env.COMPUTER_FAKE_SCREENSHOT
    if (!app.isPackaged && fake) environment.COMPUTER_FAKE_SCREENSHOT = fake
    Object.assign(environment, this.platform.mcpEnvExtras({ isPackaged: app.isPackaged, env: process.env }))
    return environment
  }

  /**
   * Bloque de config de OpenCode (`mcp.computer`) o null si no está disponible: MCP `remote` en
   * 127.0.0.1 servido por el utilityProcess (token Bearer por cabecera, sin OAuth).
   */
  async mcpConfig(): Promise<Record<string, unknown> | null> {
    if (!this.helperPath() || !this.mcpScriptPath()) return null
    try {
      const { url, token } = await this.mcpHost.ensure()
      return {
        type: 'remote',
        url,
        headers: { Authorization: `Bearer ${token}` },
        oauth: false,
        enabled: true,
        // OpenCode aplica ESTE único valor a TODA llamada a este MCP — no hay uno aparte por
        // herramienta. `request_access`/`request_full_control`/`teach_step` esperan sin límite a que
        // el dueño responda una tarjeta (ver sus propios comentarios en `mcp-server.ts`) — con 15s acá
        // (el valor de antes), timeaban solas mientras el dueño todavía estaba mirando la tarjeta
        // (bug real, encontrado comparando un intento fallido contra uno de Claude). Las herramientas
        // de acción normal (clic, tipeo, captura) ya tienen SU PROPIO límite más corto adentro
        // (`mcp-platform-darwin.ts`, 30s) y siempre responden bien antes de este número — así que en
        // la práctica esto nunca se activa para ellas, solo es la red de seguridad para las tarjetas.
        timeout: 600_000
      }
    } catch (err) {
      console.error('[computer] no se pudo arrancar el MCP:', err)
      return null
    }
  }

  /** Carpeta temporal de capturas del MCP (`COMPUTER_SHOT_DIR`); el MCP la recrea al capturar. */
  get screenshotsDir(): string {
    return join(app.getPath('temp'), 'lazunox-computer')
  }

  /** Borra las capturas temporales de Control total (retención: no se conservan tras terminar). */
  cleanScreenshots(): void {
    try {
      rmSync(this.screenshotsDir, { recursive: true, force: true })
    } catch (err) {
      console.error('[computer] limpiar capturas:', err)
    }
  }

  dispose(): void {
    if (this.powerListener) {
      for (const ev of this.platform.stopOnPowerEvents) powerMonitor.removeListener(ev as 'lock-screen', this.powerListener)
      this.powerListener = null
    }
    this.cleanScreenshots()
    this.stopEscWatcher()
    this.mcpHost.dispose()
    if (this.shortcutRegistered) {
      globalShortcut.unregister(STOP_SHORTCUT)
      this.shortcutRegistered = false
    }
    this.events?.close()
    this.events = null
    this.eventsUrl = null
    this.eventsStarting = null
  }
}

/**
 * Servicio de "computer use" en el proceso principal:
 * - localiza el helper nativo (`cu-helper`) y el script del MCP (`out/main/computer-mcp.js`);
 * - estado de permisos de macOS (Accesibilidad / Grabación de pantalla) y cómo pedirlos;
 * - kill-switch + atajo global Cmd+Shift+Escape. La fuente de verdad es el estado EN MEMORIA de
 *   este proceso (`stopped`): el MCP lo consulta con `GET <COMPUTER_EVENTS_URL>/state` antes de cada
 *   acción, así que el agente no puede "des-pararse" borrando un archivo. `stop()` además aborta las
 *   sesiones de los servidores de acceso total (`abortSessions`, lo inyecta cowork-handlers) y mata
 *   los `cu-helper` en vuelo. El archivo STOP (en `userData/onyxcode-killswitch/`, ruta que
 *   agents/computer.md deniega a bash/edit) solo es el respaldo si el canal lateral no arrancó;
 *   parar NUNCA se deshace solo: hace falta `resume()` (botón "Reanudar control");
 * - canal lateral de acciones: servidor HTTP en 127.0.0.1 al que el MCP hace `POST` de cada
 *   acción (`COMPUTER_EVENTS_URL`), reemitido como evento `computer:action`;
 * - bloque `mcp.computer` para la config de OpenCode del servidor de acceso completo: MCP `remote`
 *   servido por un utilityProcess de main (`mcp-host.ts`), que conserva los permisos TCC de la app
 *   mientras los `opencode serve` corren desvinculados (AUDIT.md S6).
 *
 * Movimiento visible: el helper anima el cursor (ver helper.swift). `ONYXCODE_COMPUTER_INSTANT=1`
 * lo desactiva y `ONYXCODE_COMPUTER_TYPE_DELAY_MS` ajusta el ritmo de tecleo.
 *
 * Permisos (TCC): el "proceso responsable" de la cadena Electron → utilityProcess del MCP →
 * cu-helper/screencapture es la app que lanzó Electron. Empaquetado = OnyxCode.app; en desarrollo
 * (`npm run dev` desde una terminal) es la TERMINAL (Terminal/iTerm/VS Code…), que es a quien
 * hay que conceder Accesibilidad y Grabación de pantalla. Los `opencode serve` (y su bash) NO
 * forman parte de esa cadena: se lanzan con `onyxcode-disclaim`.
 */
import { app, globalShortcut, shell, systemPreferences } from 'electron'
import { execFile, spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import { randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname, join } from 'node:path'
import { unpacked } from '../util/asar'
import { runHelper } from '../util/exec'
import {
  maxTier,
  type AccessDecision,
  type AccessRequest,
  type AccessRequestApp,
  type ComputerActionEvent,
  type ComputerKillState,
  type ComputerStatus,
  type ComputerUseInfo,
  type PlanApprovalState,
  type TeachStep
} from '@shared/ipc-cowork'
import { ComputerGrantsStore } from './grants'
import { ComputerMcpHost } from './mcp-host'
import { ComputerPrefsStore } from './prefs'

export const STOP_SHORTCUT = 'CommandOrControl+Shift+Escape'

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
}

/**
 * Lote C: petición al Modo auto (`cowork-handlers` la conecta con `getAutoApprover()`) antes de
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
}

const SESSION_RE = /^[A-Za-z0-9_-]{1,200}$/
const TIERS: ReadonlySet<string> = new Set(['view', 'click', 'full'])

/** Resultado de abortar las sesiones de los servidores de acceso total. */
export interface AbortReport {
  aborted: number
  failed: number
}

/** Escapa una cadena para usarla literal en una regex extendida (pkill -f). */
function ereLiteral(s: string): string {
  return s.replace(/[.[\]{}()*+?^$|\\]/g, '\\$&')
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
   * Aborta toda sesión en curso de los servidores de acceso total (inyectado por cowork-handlers;
   * el gestor de Cowork conoce los servidores y sus credenciales).
   */
  abortSessions: (() => Promise<AbortReport>) | null = null
  /** Sin animación del cursor (también lo usa el overlay para no simular el viaje). */
  readonly instant = process.env.ONYXCODE_COMPUTER_INSTANT === '1'
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
    this._grants ??= new ComputerGrantsStore(join(app.getPath('userData'), 'computer-grants.json'))
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
      /** Sesión (tarea) de OpenCode que pidió la tarjeta (la inyecta el plugin `onyxcode-plan-gate`). */
      sessionId?: string
      /** Lote C: `'takeover'` = pide tomar el ratón y el teclado en modo segundo plano. */
      kind?: 'access' | 'takeover'
    }
  >()
  /**
   * Lote C: el Modo auto (inyectado por `cowork-handlers` desde `getAutoApprover()`) puede
   * conceder una petición sencilla sin mostrar tarjeta. Se espera como mucho 1,5 s antes de seguir
   * con el flujo normal (tarjeta al usuario). `null` = sin Modo auto conectado o no aplica.
   */
  autoAccess: ((q: AutoAccessQuery) => Promise<AutoAccessVerdict | null>) | null = null
  /** Lote C: "Solo ver" efímero por sesión (Modo auto), NUNCA persistido en `computer-grants.json`. */
  private readonly autoView = new Map<string, Set<string>>()
  /**
   * Lote C: sesiones (tareas) que tomaron el control del ratón y el teclado en modo segundo plano
   * (`request_full_control` aprobado). Se limpia en `revokePlan`, `stop()` y `dispose()`.
   */
  private readonly foregroundSessions = new Set<string>()
  /** Lote C: pasos de Teach mode pendientes de "Siguiente"/"Salir de la guía". */
  private readonly pendingTeach = new Map<string, { resolve: (a: 'next' | 'exit') => void }>()
  /**
   * Sesiones (tareas de OpenCode) con el plan aprobado → instante de aprobación. El MCP rechaza toda
   * herramienta de acción (`computer_*`, salvo `request_access`) y el plugin `onyxcode-plan-gate` toda
   * herramienta que no sea de solo-planificación mientras la sesión no esté aquí (consultado por
   * `GET .../plan-status?session=<id>`). La aprobación dura TODA la tarea (sesión): se pierde con
   * "Revocar" (`revokePlan`), archivar/borrar la tarea, Detener (`stop()`, todas) o al reiniciar la
   * app (solo en memoria). Una tarea nueva = sesión nueva = plan nuevo.
   */
  private readonly approvedPlans = new Map<string, number>()
  /**
   * Respaldo si la inyección de `onyxcode_session` falla (tarjeta o consulta sin sesión): aprobación
   * global como antes. Se apaga al terminar la sesión de control (`endLegacyPlan`) o con `stop()`.
   */
  private legacyPlanApproved = false
  /** Vigía nativo de Esc físico (`cu-helper watch-esc`), solo mientras hay control activo. */
  private escWatcher: ChildProcessByStdio<null, Readable, Readable> | null = null
  private escIdleTimer: NodeJS.Timeout | null = null

  /** Ruta del helper nativo o null si no está compilado. */
  helperPath(): string | null {
    if (process.platform !== 'darwin') return null
    const candidates = [
      join(process.resourcesPath ?? '', 'computer-use', 'bin', 'cu-helper'),
      unpacked(join(app.getAppPath(), 'resources', 'computer-use', 'bin', 'cu-helper')),
      join(process.cwd(), 'resources', 'computer-use', 'bin', 'cu-helper')
    ]
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
   * la carpeta coincide con la regla `*onyxcode-killswitch*` que agents/computer.md deniega a
   * bash/edit/write (defensa en profundidad: un comando ofuscado podría esquivarla, ver AUDIT S5).
   */
  get stopFile(): string {
    return join(app.getPath('userData'), 'onyxcode-killswitch', 'STOP')
  }

  /**
   * Última hora (epoch ms) de un keyDown REAL, anotada por `cu-helper watch-esc` (ver
   * `noteRealKeyDown` en helper.swift). La herramienta `type_text`/`key` del MCP la lee (comando
   * `recent-input`) para pausar si el usuario está escribiendo ahora mismo: no puede usar las APIs
   * de "tiempo desde el último evento" del sistema porque también las actualizan nuestros propios
   * eventos sintéticos en cuanto se postean (verificado).
   */
  private get inputFile(): string {
    return join(app.getPath('temp'), 'onyxcode-computer-input')
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
  }

  // ───────────────────────────── Esc físico (parada mientras se controla) ─────────────────────────────

  private noteActivity(): void {
    this.ensureEscWatcher()
    if (this.escIdleTimer) clearTimeout(this.escIdleTimer)
    this.escIdleTimer = setTimeout(() => this.stopEscWatcher(), ESC_WATCHER_IDLE_MS)
  }

  private ensureEscWatcher(): void {
    if (this.escWatcher || process.platform !== 'darwin') return
    const bin = this.helperPath()
    if (!bin) return
    try {
      const child = spawn(bin, ['watch-esc'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, COMPUTER_INPUT_FILE: this.inputFile }
      })
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
    // Main rellena el estado actual de cada app: la tarjeta preselecciona sin bajar lo ya concedido.
    const enriched = apps.map((a) => ({
      ...a,
      current: this.grants.tierFor(a.bundleId),
      denied: this.grants.isDenied(a.bundleId)
    }))
    // Modo auto (Lote C, C3): antes de mostrar la tarjeta, se le da la oportunidad de conceder
    // "Solo ver" efímero sin preguntar (allowlist estricta; nunca para takeover ni planes). Se
    // espera como mucho 1,5 s: si tarda o deniega, sigue el flujo normal (tarjeta al usuario).
    const verdict = await this.tryAutoAccess({ sessionId, apps: enriched, plan, kind, reason })
    if (verdict) {
      const decisions: Record<string, AccessDecision> = {}
      for (const a of enriched) decisions[a.bundleId] = 'view'
      if (sessionId)
        this.grantAutoView(
          sessionId,
          enriched.map((a) => a.bundleId)
        )
      return { decisions, auto: true }
    }
    const id = randomBytes(8).toString('hex')
    return new Promise((resolve) => {
      this.pendingAccess.set(id, { resolve, plan, apps: enriched, sessionId, kind })
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
        if (d.decision === 'deny') {
          this.grants.deny(d.bundleId)
          map[d.bundleId] = 'deny'
        } else if (d.decision === 'view' || d.decision === 'click' || d.decision === 'full') {
          const effective = maxTier(this.grants.tierFor(d.bundleId), d.decision) ?? d.decision
          // El nombre lo fija la tarjeta (main), no el renderer.
          this.grants.grant(d.bundleId, card.name || d.name, effective)
          map[d.bundleId] = effective
          approvedSomething = true
          firstApproved ??= d.bundleId
        }
      }
      if (pending.plan && (approvePlan === true || approvedSomething)) {
        planApproved = true
        this.approvePlanFor(pending.sessionId)
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

  /** Aprueba el plan de una sesión (sin `sessionId`: respaldo legado global, con aviso en el log). */
  approvePlanFor(sessionId?: string): void {
    if (sessionId) {
      this.approvedPlans.set(sessionId, Date.now())
      this.emit('planState', { sessionId, approved: true })
    } else {
      console.warn('[computer] plan aprobado sin sessionId (falló la inyección de onyxcode_session): modo global')
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
    if (hadPlan) this.emit('planState', { sessionId, approved: false })
  }

  /** Ids de las sesiones con el plan aprobado ahora mismo. */
  approvedPlanSessions(): string[] {
    return [...this.approvedPlans.keys()]
  }

  /** Fin de la sesión de control: apaga solo el respaldo legado; las aprobaciones por sesión siguen. */
  endLegacyPlan(): void {
    this.legacyPlanApproved = false
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
  async stop(): Promise<AbortReport> {
    const at = Date.now()
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
    // Solo el binario de esta app (ruta completa; también cuando va con flags --instant, etc.).
    // SIGTERM primero: el helper suelta el botón si estaba arrastrando; SIGKILL por si no sale.
    const pattern = `^${ereLiteral(bin)}( |$)`
    const pkill = (sig: string): Promise<void> =>
      new Promise((resolve) => {
        execFile('/usr/bin/pkill', [`-${sig}`, '-f', pattern], { timeout: 3_000 }, () => resolve())
      })
    return pkill('TERM')
      .then(() => new Promise((r) => setTimeout(r, 300)))
      .then(() => pkill('KILL'))
  }

  async status(): Promise<ComputerStatus> {
    const bin = this.helperPath()
    const base: ComputerStatus = {
      helperOk: false,
      accessibility: process.platform === 'darwin' ? systemPreferences.isTrustedAccessibilityClient(false) : false,
      screenRecording: process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') === 'granted' : false,
      screens: []
    }
    if (!bin) return base
    try {
      const perms = JSON.parse(await runHelper(bin, ['permissions'])) as { accessibility: boolean; screenRecording: boolean }
      const screens = JSON.parse(await runHelper(bin, ['screens'])) as Array<{ width: number; height: number; scale: number }>
      return {
        helperOk: true,
        accessibility: !!perms.accessibility,
        screenRecording: !!perms.screenRecording,
        screens: screens.map((s) => ({ width: s.width, height: s.height, scale: s.scale }))
      }
    } catch (err) {
      console.error('[computer] helper:', err)
      return base
    }
  }

  /** Estado resumido para `CoworkConnection.computerUse`. */
  async info(): Promise<ComputerUseInfo> {
    const st = await this.status()
    const script = this.mcpScriptPath()
    const available = st.helperOk && !!script
    let reason: string | undefined
    if (process.platform !== 'darwin') reason = 'El control del computador solo está disponible en macOS.'
    else if (!st.helperOk) reason = 'Falta el helper nativo (ejecuta `npm run build:helper`).'
    else if (!script) reason = 'Falta computer-mcp.js (ejecuta `npm run build`).'
    else if (!st.accessibility && !st.screenRecording) reason = 'Faltan los permisos de Accesibilidad y Grabación de pantalla.'
    else if (!st.accessibility) reason = 'Falta el permiso de Accesibilidad (mover el ratón y teclear).'
    else if (!st.screenRecording) reason = 'Falta el permiso de Grabación de pantalla (capturas).'
    return { available, accessibility: st.accessibility, screenRecording: st.screenRecording, reason }
  }

  /** Lanza los prompts del sistema y abre el panel de Ajustes del primer permiso que falte. */
  async requestPermissions(): Promise<void> {
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
          const persisted = bundleId ? this.grants.resolve(bundleId, name) : null
          const tier = maxTier(persisted, this.autoViewTier(session, bundleId))
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
          // El MCP y el plugin `onyxcode-plan-gate` la consultan antes de cada herramienta de acción
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
              res.end(JSON.stringify({ error: 'JSON inválido' }))
              return
            }
            // Sin apps solo vale una tarjeta de plan (plan sin apps: terminal, archivos o web).
            if (!apps.length && !plan?.length) {
              res.statusCode = 400
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
              res.end(JSON.stringify({ error: 'JSON inválido' }))
              return
            }
            const text = typeof o.text === 'string' ? o.text.slice(0, 400) : ''
            if (!text) {
              res.statusCode = 400
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
   * `onyxcode-plan-gate` del servidor de OpenCode de acceso total (`cowork/manager.ts` la pasa por
   * entorno como `ONYXCODE_PLAN_GATE_URL`, SOLO a servidores de acceso total; `onyxcode-env.js` la oculta
   * a bash — ver `cowork/opencode-config.ts`). El plugin consulta `GET .../plan-status` antes de
   * cada herramienta que no sea de solo-planificación (con `?session=<id>`), con el mismo fail-closed
   * que el MCP.
   */
  async planGateUrl(): Promise<string | null> {
    return this.ensureEventsServer()
  }

  /** Entorno propio del MCP (se suma a `minimalEnv` en el host). */
  private async mcpEnv(): Promise<Record<string, string>> {
    const helper = this.helperPath()
    if (!helper) throw new Error('Falta el helper nativo cu-helper')
    const eventsUrl = await this.ensureEventsServer()
    const environment: Record<string, string> = {
      CU_HELPER: helper,
      COMPUTER_STOP_FILE: this.stopFile,
      COMPUTER_INPUT_FILE: this.inputFile,
      COMPUTER_SHOT_DIR: join(app.getPath('temp'), 'onyxcode-computer')
    }
    if (eventsUrl) environment.COMPUTER_EVENTS_URL = eventsUrl
    if (this.instant) environment.COMPUTER_INSTANT = '1'
    const typeDelay = process.env.ONYXCODE_COMPUTER_TYPE_DELAY_MS
    if (typeDelay && Number.isFinite(Number(typeDelay))) environment.COMPUTER_TYPE_DELAY_MS = typeDelay
    const fake = process.env.COMPUTER_FAKE_SCREENSHOT
    if (!app.isPackaged && fake) environment.COMPUTER_FAKE_SCREENSHOT = fake
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
        timeout: 15_000
      }
    } catch (err) {
      console.error('[computer] no se pudo arrancar el MCP:', err)
      return null
    }
  }

  /** Carpeta temporal de capturas del MCP (`COMPUTER_SHOT_DIR`); el MCP la recrea al capturar. */
  get screenshotsDir(): string {
    return join(app.getPath('temp'), 'onyxcode-computer')
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

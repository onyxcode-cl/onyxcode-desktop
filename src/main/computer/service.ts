/**
 * Servicio de "computer use" en el proceso principal:
 * - localiza el helper nativo (`cu-helper`) y el script del MCP (`out/main/computer-mcp.js`);
 * - estado de permisos de macOS (Accesibilidad / Grabación de pantalla) y cómo pedirlos;
 * - kill-switch + atajo global Cmd+Shift+Escape. La fuente de verdad es el estado EN MEMORIA de
 *   este proceso (`stopped`): el MCP lo consulta con `GET <COMPUTER_EVENTS_URL>/state` antes de cada
 *   acción, así que el agente no puede "des-pararse" borrando un archivo. `stop()` además aborta las
 *   sesiones de los servidores de acceso total (`abortSessions`, lo inyecta cowork-handlers) y mata
 *   los `cu-helper` en vuelo. El archivo STOP (en `userData/lapis-killswitch/`, ruta que
 *   agents/computer.md deniega a bash/edit) solo es el respaldo si el canal lateral no arrancó;
 *   parar NUNCA se deshace solo: hace falta `resume()` (botón "Reanudar control");
 * - canal lateral de acciones: servidor HTTP en 127.0.0.1 al que el MCP hace `POST` de cada
 *   acción (`COMPUTER_EVENTS_URL`), reemitido como evento `computer:action`;
 * - bloque `mcp.computer` para la config de OpenCode del servidor de acceso completo: MCP `remote`
 *   servido por un utilityProcess de main (`mcp-host.ts`), que conserva los permisos TCC de la app
 *   mientras los `opencode serve` corren desvinculados (AUDIT.md S6).
 *
 * Movimiento visible: el helper anima el cursor (ver helper.swift). `OPENDESK_COMPUTER_INSTANT=1`
 * lo desactiva y `OPENDESK_COMPUTER_TYPE_DELAY_MS` ajusta el ritmo de tecleo.
 *
 * Permisos (TCC): el "proceso responsable" de la cadena Electron → utilityProcess del MCP →
 * cu-helper/screencapture es la app que lanzó Electron. Empaquetado = Lapis.app; en desarrollo
 * (`npm run dev` desde una terminal) es la TERMINAL (Terminal/iTerm/VS Code…), que es a quien
 * hay que conceder Accesibilidad y Grabación de pantalla. Los `opencode serve` (y su bash) NO
 * forman parte de esa cadena: se lanzan con `lapis-disclaim`.
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
import type {
  AccessDecision,
  AccessRequest,
  AccessRequestApp,
  ComputerActionEvent,
  ComputerKillState,
  ComputerStatus,
  ComputerUseInfo
} from '@shared/ipc-cowork'
import { ComputerGrantsStore } from './grants'
import { ComputerMcpHost } from './mcp-host'

export const COMPUTER_MCP_NAME = 'computer'
export const COMPUTER_AGENT_ID = 'computer'
export const STOP_SHORTCUT = 'CommandOrControl+Shift+Escape'

const PANE_ACCESSIBILITY = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
const PANE_SCREEN = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
/** Tras esto sin ninguna acción, se para el vigía de Esc (deja de escuchar el teclado). */
const ESC_WATCHER_IDLE_MS = 8_000
/** `request_access` sin respuesta en este tiempo ⇒ se trata como denegado. */
const ACCESS_REQUEST_TIMEOUT_MS = 5 * 60_000

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
}

/** Resultado de abortar las sesiones de los servidores de acceso total. */
export interface AbortReport {
  aborted: number
  failed: number
}

/** Escapa una cadena para usarla literal en una regex extendida (pkill -f). */
function ereLiteral(s: string): string {
  return s.replace(/[.[\]{}()*+?^$|\\]/g, '\\$&')
}

function unpacked(p: string): string {
  return p.replace(/app\.asar([/\\])/, 'app.asar.unpacked$1')
}

function runHelper(bin: string, args: string[], timeout = 10_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).toString().trim()))
      else resolve(stdout.toString())
    })
  })
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
  readonly instant = process.env.OPENDESK_COMPUTER_INSTANT === '1'
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
  /** Tarjetas `request_access` pendientes de respuesta del usuario (canal lateral del MCP). */
  private readonly pendingAccess = new Map<string, { resolve: (d: Record<string, AccessDecision>) => void }>()
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
   * la carpeta coincide con la regla `*lapis-killswitch*` que agents/computer.md deniega a
   * bash/edit/write (defensa en profundidad: un comando ofuscado podría esquivarla, ver AUDIT S5).
   */
  get stopFile(): string {
    return join(app.getPath('userData'), 'lapis-killswitch', 'STOP')
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
      const child = spawn(bin, ['watch-esc'], { stdio: ['ignore', 'pipe', 'pipe'] })
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

  /** Emite la tarjeta y espera la respuesta del usuario (o 5 min → todo denegado). */
  requestAccess(apps: AccessRequestApp[], reason?: string): Promise<Record<string, AccessDecision>> {
    const id = randomBytes(8).toString('hex')
    return new Promise((resolve) => {
      this.pendingAccess.set(id, { resolve })
      this.emit('requestAccess', { id, apps, reason })
      setTimeout(() => {
        const p = this.pendingAccess.get(id)
        if (!p) return
        this.pendingAccess.delete(id)
        p.resolve(Object.fromEntries(apps.map((a) => [a.bundleId, 'deny' as const])))
      }, ACCESS_REQUEST_TIMEOUT_MS).unref()
    })
  }

  /** El renderer responde `computer:respondAccess`: aplica y persiste cada decisión. */
  resolveAccessRequest(id: string, decisions: Array<{ bundleId: string; name: string; decision: AccessDecision }>): boolean {
    const pending = this.pendingAccess.get(id)
    if (!pending) return false
    this.pendingAccess.delete(id)
    const map: Record<string, AccessDecision> = {}
    for (const d of decisions) {
      map[d.bundleId] = d.decision
      if (d.decision === 'deny') this.grants.deny(d.bundleId)
      else this.grants.grant(d.bundleId, d.name, d.decision)
    }
    pending.resolve(map)
    return true
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
    const killed = this.killHelpers()
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
      screenRecording:
        process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') === 'granted' : false,
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
    else if (!st.accessibility && !st.screenRecording)
      reason = 'Faltan los permisos de Accesibilidad y Grabación de pantalla.'
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
          // defecto de su categoría la primera vez que se ve). null = sin decidir o denegada.
          const q = new URL(req.url ?? '', 'http://localhost').searchParams
          const bundleId = (q.get('bundleId') ?? '').slice(0, 255)
          const name = (q.get('name') ?? bundleId).slice(0, 255)
          const tier = bundleId ? this.grants.resolve(bundleId, name) : null
          res.statusCode = 200
          res.setHeader('content-type', 'application/json')
          res.setHeader('cache-control', 'no-store')
          res.end(JSON.stringify({ tier }))
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
            try {
              const o = JSON.parse(body) as { apps?: unknown; reason?: unknown }
              if (Array.isArray(o.apps)) {
                apps = o.apps
                  .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
                  .map((a) => ({
                    bundleId: String(a.bundleId ?? '').slice(0, 255),
                    name: String(a.name ?? a.bundleId ?? '').slice(0, 255)
                  }))
                  .filter((a) => a.bundleId)
                  .slice(0, 20)
              }
              if (typeof o.reason === 'string') reason = o.reason.slice(0, 500)
            } catch {
              res.statusCode = 400
              res.end(JSON.stringify({ error: 'JSON inválido' }))
              return
            }
            if (!apps.length) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: 'apps vacío' }))
              return
            }
            void this.requestAccess(apps, reason).then((decisions) => {
              res.statusCode = 200
              res.setHeader('content-type', 'application/json')
              res.setHeader('cache-control', 'no-store')
              res.end(JSON.stringify({ decisions }))
            })
          })
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

  /** Entorno propio del MCP (se suma a `minimalEnv` en el host). */
  private async mcpEnv(): Promise<Record<string, string>> {
    const helper = this.helperPath()
    if (!helper) throw new Error('Falta el helper nativo cu-helper')
    const eventsUrl = await this.ensureEventsServer()
    const environment: Record<string, string> = {
      CU_HELPER: helper,
      COMPUTER_STOP_FILE: this.stopFile,
      COMPUTER_SHOT_DIR: join(app.getPath('temp'), 'lapis-computer')
    }
    if (eventsUrl) environment.COMPUTER_EVENTS_URL = eventsUrl
    if (this.instant) environment.COMPUTER_INSTANT = '1'
    const typeDelay = process.env.OPENDESK_COMPUTER_TYPE_DELAY_MS
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

  dispose(): void {
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

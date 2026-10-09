/**
 * Servidor MCP de "computer use" para Lazunox (transporte Streamable HTTP en 127.0.0.1).
 *
 * Se empaqueta como entrada aparte (`out/main/computer-mcp.js`) y el proceso principal lo arranca
 * como **utilityProcess** (`computer/mcp-host.ts`): así hereda la responsabilidad TCC de Lazunox
 * (Accesibilidad / Grabación de pantalla, necesarias para `cu-helper` y `screencapture`) mientras
 * que los `opencode serve` se lanzan desvinculados (`process/disclaim.ts`) y NO la tienen. OpenCode
 * lo usa como MCP `remote` con cabecera `Authorization: Bearer <token>`. Ya no depende de
 * `ELECTRON_RUN_AS_NODE` (el fuse RunAsNode está desactivado en el paquete).
 * NO importa `electron` ni módulos de la app: solo builtins de Node.
 *
 * Protocolo: JSON-RPC 2.0 (MCP 2024-11-05 / 2025-03-26 / 2025-06-18) por `POST /mcp`.
 *
 * Variables de entorno:
 *   COMPUTER_MCP_TOKEN      token Bearer que exige cada petición (obligatorio, ≥32 caracteres)
 *   COMPUTER_MCP_PORT       puerto en 127.0.0.1 (0 = cualquiera; se comunica a main por parentPort)
 *   CU_HELPER               ruta al binario nativo `cu-helper` (obligatoria)
 *   COMPUTER_STOP_FILE      kill-switch de RESPALDO: si el archivo existe, toda herramienta falla sin
 *                           actuar. Solo decide cuando no hay COMPUTER_EVENTS_URL.
 *   COMPUTER_EVENTS_URL     canal lateral (URL con token). Kill-switch: antes de cada acción (y cada
 *                           250 ms durante acciones largas) `GET <url>/state` → `{ stopped }`, con
 *                           caché ≤200 ms; la fuente de verdad es la memoria del proceso principal.
 *                           Si el proceso principal no responde se RECHAZA la acción (fail-closed).
 *                           Además cada acción se envía como `POST` con un JSON
 *                           `{ tool, phase, x?, y?, text?, at }` (coordenadas en PUNTOS de pantalla):
 *                           `phase: 'start'` ANTES de mover el ratón y `phase: 'end'` al terminar.
 *                           Fire-and-forget (salvo el inicio de una captura, que espera ≤600 ms
 *                           para que la app pueda ocultar su overlay); si falla se ignora.
 *   COMPUTER_INSTANT        "1" = sin animación del cursor ni ritmo de tecleo (`cu-helper --instant`)
 *   COMPUTER_TYPE_DELAY_MS  retardo base por carácter al escribir (por defecto el del helper, 14 ms)
 *   COMPUTER_AUTO_SCREENSHOT "0" desactiva la captura automática tras cada acción (por defecto 1)
 *   COMPUTER_MAX_LONG_SIDE  lado largo máximo de la captura en px (por defecto 1366)
 *   COMPUTER_SHOT_DIR       carpeta para las capturas (por defecto $TMPDIR/lazunox-computer)
 *   COMPUTER_FAKE_SCREENSHOT (solo pruebas) usa esta imagen en lugar de `screencapture`
 *   COMPUTER_BACKEND        `darwin` | `win32`: backend de plataforma (por defecto, la del proceso). Lo fija `main`.
 *   CU_HELPER_ARGV0         (solo Windows y desarrollo) `node`: lanza el helper FALSO de pruebas como `node <CU_HELPER>`.
 *   COMPUTER_SELF_EXES      (solo Windows) ejecutables exentos de concesión, separados por comas (por defecto Lazunox y el shell).
 *   COMPUTER_HELPER_TIMEOUT_MS (solo Windows; pruebas) tiempo máximo por comando del helper (por defecto 15000).
 *
 * Plataforma: lo que depende del sistema (helper nativo, capturas, apps, kill de procesos, consentimiento y políticas de
 * Windows) está detrás de `PlatformBackend` (`mcp-platform.ts`; `mcp-platform-darwin.ts` / `mcp-platform-win32.ts`).
 *
 * Coordenadas: las herramientas reciben coordenadas EN PÍXELES DE LA ÚLTIMA CAPTURA y las
 * convierten a puntos de la pantalla principal (factor = anchoPuntos / anchoCaptura).
 *
 * Concesión por app (ver `computer/grants.ts`): antes de cada acción con ratón/teclado se
 * comprueba, por `COMPUTER_EVENTS_URL`, el nivel de la app en primer plano (y de la app bajo el
 * punto, en clics/arrastres). Sin nivel suficiente, la acción se rechaza con un mensaje que le
 * dice al modelo que llame a la herramienta `request_access` (que también usa el canal lateral,
 * `POST <url>/request-access`, y espera SIN límite de tiempo la respuesta del usuario: solo Detener la
 * cancela). Las capturas
 * excluyen del compositor las apps sin concesión (ScreenCaptureKit, `cu-helper screenshot-sck`;
 * si no está disponible se enmascaran a mano las ventanas de esas apps sobre la captura de
 * `screencapture`). `type_text`/`key` además rechazan un campo de contraseña con foco
 * (`cu-helper focused-secure`) o tecleo real reciente del usuario (`cu-helper recent-input`).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppRef, AppTier, PlatformBackend, PlatformHost, Screen } from './mcp-platform'
import { createDarwinBackend } from './mcp-platform-darwin'
import { createWin32Backend } from './mcp-platform-win32'

const HELPER = process.env.CU_HELPER ?? ''
const STOP_FILE = process.env.COMPUTER_STOP_FILE ?? ''
const EVENTS_URL = process.env.COMPUTER_EVENTS_URL ?? ''
const AUTO_SHOT = process.env.COMPUTER_AUTO_SCREENSHOT !== '0'
const MAX_LONG = Math.max(400, Number(process.env.COMPUTER_MAX_LONG_SIDE) || 1366)
const SHOT_DIR = process.env.COMPUTER_SHOT_DIR || join(tmpdir(), 'lazunox-computer')
const FAKE_SHOT = process.env.COMPUTER_FAKE_SCREENSHOT ?? ''
const INSTANT = process.env.COMPUTER_INSTANT === '1'
const TYPE_DELAY = process.env.COMPUTER_TYPE_DELAY_MS ?? ''
const SETTLE_MS = 450
const STOPPED_MSG = 'Control detenido por el usuario'
const UNVERIFIED_MSG = 'No se pudo verificar el estado del kill-switch con Lazunox; acción rechazada'
const STATE_CACHE_MS = 200
/** Por debajo de esto sin pulsar el teclado real, se considera "el usuario está escribiendo ahora". */
const TYPING_PAUSE_SECONDS = 1.2

// ───────────────────────────── kill-switch ─────────────────────────────

let stateCache: { at: number; stopped: boolean } | null = null
let stateInflight: Promise<boolean> | null = null

async function queryStopped(): Promise<boolean> {
  const fileStop = !!STOP_FILE && existsSync(STOP_FILE)
  if (!EVENTS_URL) return fileStop
  try {
    const r = await fetch(`${EVENTS_URL}/state`, { signal: AbortSignal.timeout(1500) })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const j = (await r.json()) as { stopped?: unknown }
    if (typeof j.stopped !== 'boolean') throw new Error('respuesta inválida')
    return j.stopped || fileStop
  } catch (err) {
    log('kill-switch no verificable:', err instanceof Error ? err.message : err)
    throw new Error(UNVERIFIED_MSG)
  }
}

/** true si el usuario detuvo el control. Lanza (fail-closed) si no se puede verificar. */
async function isStopped(): Promise<boolean> {
  if (stateCache && Date.now() - stateCache.at <= STATE_CACHE_MS) return stateCache.stopped
  stateInflight ??= queryStopped().finally(() => {
    stateInflight = null
  })
  const stopped = await stateInflight
  stateCache = { at: Date.now(), stopped }
  return stopped
}

// ───────────────────────────── utilidades ─────────────────────────────
//
// Lo que depende del sistema (helper nativo, capturas, resolución de apps, kill de procesos, políticas propias de Windows)
// vive detrás de `PlatformBackend` (`mcp-platform*.ts`); aquí queda lo común.

/** Detiene los helpers en vuelo (Detener a mitad de una acción). */
function killChildren(): void {
  backend.killChildren()
}

const helper = (...args: string[]): Promise<string> => backend.helper(...args)
const helperExit = (...args: string[]): Promise<{ stdout: string; code: number }> => backend.helperExit(...args)

function log(...a: unknown[]): void {
  // stderr: OpenCode lo guarda en sus logs; stdout es exclusivo del protocolo.
  process.stderr.write(`[computer-mcp] ${a.map(String).join(' ')}\n`)
}

// ───────────────────────────── concesión por app ─────────────────────────────
//
// "Acceso total" ya no es todo o nada: cada app tiene un nivel ('view'/'click'/'full') que vive en
// main (`computer/grants.ts`) y se consulta por el canal lateral (`COMPUTER_EVENTS_URL`). Antes de
// CADA acción sobre el ratón/teclado se comprueba la app en primer plano y, si la acción tiene un
// punto, también la app bajo ese punto (pueden diferir: clic a través de una ventana de fondo).

const TIER_RANK: Record<AppTier, number> = { view: 0, click: 1, full: 2 }
const TIER_LABEL: Record<AppTier, string> = { view: 'Solo ver', click: 'Ver y clic', full: 'Control total' }
// Este bundle no importa módulos de la app: estos tipos, constantes y `maxTier` DUPLICAN los de
// `src/shared/ipc-tasks.ts` (`APP_TIER_RANK`, `TIER_LABEL_ES`, `maxTier`). Mantenerlos consistentes.
function maxTier(a: AppTier | null | undefined, b: AppTier | null | undefined): AppTier | null {
  if (!a) return b ?? null
  if (!b) return a
  return TIER_RANK[a] >= TIER_RANK[b] ? a : b
}
function asTier(v: unknown): AppTier | null {
  const t = typeof v === 'string' ? v.trim().toLowerCase() : ''
  return t === 'view' || t === 'click' || t === 'full' ? t : null
}

async function appFrontmost(): Promise<AppRef> {
  return backend.parseApp(JSON.parse(await helper('frontmost')))
}

async function appAtPoint(x: number, y: number): Promise<AppRef> {
  return backend.parseApp(JSON.parse(await helper('app-at', String(x), String(y))))
}

/**
 * Nivel concedido a una app (y autoasignación de categoría en main), o null si hay que pedirlo.
 * `session` (Lote C): se manda en TODAS las consultas de `/tier`, para que main pueda combinar el
 * nivel persistido con el "Solo ver" efímero del Modo auto de esa sesión.
 */
async function tierOf(app: AppRef, session?: string): Promise<AppTier | null> {
  if (!EVENTS_URL || !app.bundleId) return null
  const params = new URLSearchParams({ bundleId: app.bundleId, name: app.name })
  if (session) params.set('session', session)
  const r = await fetch(`${EVENTS_URL}/tier?${params.toString()}`, { signal: AbortSignal.timeout(1500) })
  if (!r.ok) throw new Error(`No se pudo consultar la concesión (HTTP ${r.status})`)
  const j = (await r.json()) as { tier?: AppTier | null }
  return j.tier ?? null
}

/**
 * Lanza con un mensaje que le dice al modelo que llame a `request_access` si a `app` le falta la
 * concesión, o que el nivel actual no alcanza `minTier` si ya está concedida pero es insuficiente.
 */
async function ensureTier(app: AppRef, minTier: AppTier, session?: string): Promise<void> {
  const tier = await tierOf(app, session)
  if (tier === null) {
    throw new Error(
      `«${app.name}» no tiene acceso concedido. Llama a request_access con apps: ["${app.name}"] y ` +
        `levels: ["${minTier}"] (y un motivo), y espera la respuesta del usuario antes de reintentar esta acción.`
    )
  }
  if (TIER_RANK[tier] < TIER_RANK[minTier]) {
    throw new Error(
      `«${app.name}» solo tiene el nivel "${TIER_LABEL[tier]}"; esta acción necesita "${TIER_LABEL[minTier]}". ` +
        `Pide más acceso: llama a request_access con apps: ["${app.name}"] y levels: ["${minTier}"], y espera la respuesta del usuario.`
    )
  }
}

/**
 * `type_text`/`key` no tienen coordenadas que anclen la acción a una app concreta (a diferencia de
 * los clics, que además verifican la app BAJO el punto) — van a lo que tenga el foco en ese momento,
 * así que si el foco cambió sin que el modelo se diera cuenta (el "casi" de WhatsApp: otra ventana
 * pasó al frente justo antes de escribir), el texto se va a la app equivocada sin ningún aviso.
 * `expect_app` (F8-B149, opcional): si se da, compara contra la app en primer plano (nombre o bundle
 * id, sin distinguir mayúsculas, substring) ANTES de escribir nada — mismo criterio defensivo que ya
 * usa `app_press` con `expectRole`/`expectTitle`.
 */
async function checkExpectApp(expectApp: unknown): Promise<void> {
  const expected = typeof expectApp === 'string' ? expectApp.trim() : ''
  if (!expected) return
  const front = await appFrontmost()
  const haystack = `${front.name ?? ''} ${front.bundleId ?? ''}`.toLowerCase()
  if (!haystack.includes(expected.toLowerCase())) {
    throw new Error(
      `Esperabas escribir en «${expected}», pero la app en primer plano es «${front.name ?? front.bundleId ?? 'desconocida'}». ` +
        'No se escribió nada — revisa con una captura antes de reintentar.'
    )
  }
}

/**
 * Comprueba que la app en primer plano (y, si se da un punto, la app bajo ese punto) tenga AL
 * MENOS `minTier`. Usan esto las herramientas de ratón/teclado (sobre la app en primer plano).
 */
async function requireTier(minTier: AppTier, point?: { x: number; y: number }, session?: string): Promise<void> {
  const apps = [await appFrontmost()]
  if (point) {
    const at = await appAtPoint(point.x, point.y)
    if (at.bundleId && at.bundleId !== apps[0]?.bundleId) apps.push(at)
    else if (!at.bundleId && backend.failClosedOnUnknownApp) apps.push(at) // Windows: lo no identificado no se deja pasar
  }
  const known = apps.filter((a) => a.bundleId)
  // Windows falla cerrado: una ventana que no se identifica puede ser una bloqueada o de administrador.
  if (backend.failClosedOnUnknownApp && known.length < apps.length) {
    throw new Error(
      'No se pudo identificar la ventana de destino: por seguridad no se actúa. Pide al usuario que enfoque una app concreta.'
    )
  }
  if (!known.length) return // no se pudo identificar ninguna app (p. ej. el Escritorio): no bloquear
  for (const a of known) await ensureTier(a, minTier, session)
}

/**
 * Igual que `requireTier`, pero sobre una app CONCRETA nombrada por el modelo (herramientas
 * `app_*`, background por AX): no depende de qué app esté en primer plano.
 */
async function requireTierFor(app: AppRef, minTier: AppTier, session?: string): Promise<void> {
  await ensureTier(app, minTier, session)
}

// ───────────────────────────── Lote C: modo segundo plano ─────────────────────────────
//
// Por defecto el agente controla las apps por Accessibility API (sin mover el ratón real). Las
// herramientas que SÍ mueven el ratón o el teclado real (`left_click`, `type_text`…) solo valen
// si el usuario puso el modo en "Control de la pantalla", o si esta sesión pidió y le aprobaron
// `request_full_control` (tarjeta "¿Tomar el control de la pantalla?"). `GET /control-mode`
// (`ComputerService.isForeground`) es la fuente de verdad; sin canal lateral no se puede saber:
// fail-closed, igual que el kill-switch.

const BACKGROUND_REJECT_MSG = 'Modo segundo plano: usa app_find/app_press/app_set_value con la app, o pide control con request_full_control'

async function controlMode(session?: string): Promise<{ mode: 'background' | 'full'; foreground: boolean }> {
  if (!EVENTS_URL) return { mode: 'full', foreground: true } // sin main que consultar (pruebas sueltas): no bloquear
  try {
    const q = session ? `?session=${encodeURIComponent(session)}` : ''
    const r = await fetch(`${EVENTS_URL}/control-mode${q}`, { signal: AbortSignal.timeout(1500) })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const j = (await r.json()) as { mode?: unknown; foreground?: unknown }
    return { mode: j.mode === 'background' ? 'background' : 'full', foreground: j.foreground === true }
  } catch (err) {
    log('control-mode:', err instanceof Error ? err.message : err)
    throw new Error(UNVERIFIED_MSG)
  }
}

/** Rechaza las herramientas de ratón/teclado real si el modo es "segundo plano" sin foreground. */
async function requireForeground(session?: string): Promise<void> {
  const { mode, foreground } = await controlMode(session)
  if (mode === 'background' && !foreground) throw new Error(BACKGROUND_REJECT_MSG)
}

// ───────────────────────────── flujo Plan → Aprobar → Ejecutar ─────────────────────────────
//
// Antes de tocar la pantalla, el agente debe escribir su plan y pedir TODAS las apps que espera
// usar en una sola llamada a `request_access` con `plan`. Hasta que el usuario apruebe esa tarjeta
// ("Aprobar y empezar"), toda herramienta de ACCIÓN (`action: true` en TOOLS) se rechaza aquí: no
// solo por UX, es la comprobación que de verdad impide actuar aunque el modelo se salte el plan.

// La aprobación es POR SESIÓN (tarea de OpenCode): el plugin `lazunox-plan-gate` inyecta `lazunox_session`
// en los args de cada `computer_*` y aquí se pasa como `?session=`. Sin sesión, main aplica su respaldo.

async function isPlanApproved(session?: string): Promise<boolean> {
  if (!EVENTS_URL) return false
  try {
    const q = session ? `?session=${encodeURIComponent(session)}` : ''
    const r = await fetch(`${EVENTS_URL}/plan-status${q}`, { signal: AbortSignal.timeout(1500) })
    if (!r.ok) return false
    const j = (await r.json()) as { approved?: unknown }
    return j.approved === true
  } catch (err) {
    log('plan-status:', err instanceof Error ? err.message : err)
    return false
  }
}

async function requirePlanApproved(session?: string): Promise<void> {
  if (await isPlanApproved(session)) return
  throw new Error(
    'Todavía no hay un plan aprobado para esta tarea (flujo Plan → Aprobar → Ejecutar). Antes de mover el ' +
      'ratón, hacer clic, teclear o capturar la pantalla: escribe tu plan de pasos y llama UNA VEZ a request_access ' +
      'con el argumento "plan" (los pasos, en orden) y la lista completa de apps que vas a necesitar con su nivel ' +
      '("levels"); si no vas a controlar ninguna app, envía "apps": []. Espera a que el usuario pulse ' +
      '"Aprobar y empezar" antes de hacer ninguna otra acción.'
  )
}

/** Campo de contraseña con foco, o el usuario escribiendo ahora mismo: pausa y pide que lo haga él. */
async function requireCanType(): Promise<void> {
  const secure = JSON.parse(await helper('focused-secure')) as { secure?: boolean }
  if (secure.secure) {
    throw new Error(
      'El elemento con foco es un campo de contraseña (u otra entrada segura del sistema). El agente ' +
        'nunca teclea contraseñas ni códigos: pide al usuario que los escriba él mismo.'
    )
  }
  const recent = JSON.parse(await helper('recent-input')) as { keyDownSeconds?: number }
  if (typeof recent.keyDownSeconds === 'number' && recent.keyDownSeconds < TYPING_PAUSE_SECONDS) {
    throw new Error('El usuario está escribiendo ahora mismo: el agente ha pausado para no interferir. Reintenta en un momento.')
  }
}

/**
 * POST al canal lateral y ESPERA (sin límite de tiempo: no hay "sin respuesta ⇒ denegado", ver
 * `service.ts`). La única forma de que esto vuelva antes es que el usuario responda o pulse
 * Detener (main deniega todo lo pendiente como respaldo de seguridad al parar el control).
 */
async function requestAccess(
  apps: Array<AppRef & { requested: AppTier }>,
  reason?: string,
  plan?: string[],
  session?: string,
  unresolved?: string[],
  kind: 'access' | 'takeover' = 'access'
): Promise<AccessReply> {
  if (!EVENTS_URL) throw new Error('Canal lateral no disponible: no se puede pedir acceso a apps.')
  const r = await fetch(`${EVENTS_URL}/request-access`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ apps, reason, plan, session, unresolved, kind })
  })
  if (!r.ok) {
    const body = await r.text().catch(() => '')
    throw new Error(`No se pudo pedir acceso (HTTP ${r.status})${body ? `: ${body}` : ''}`)
  }
  const j = (await r.json()) as Partial<AccessReply>
  return {
    decisions: j.decisions && typeof j.decisions === 'object' ? j.decisions : {},
    feedback: typeof j.feedback === 'string' && j.feedback ? j.feedback : undefined,
    cancelled: j.cancelled === true,
    planApproved: j.planApproved === true,
    auto: j.auto === true
  }
}

/** Respuesta de main a una tarjeta `request_access` (ver `AccessResponse` en `computer/service.ts`). */
interface AccessReply {
  decisions: Record<string, string>
  feedback?: string
  cancelled: boolean
  planApproved: boolean
  /** Lote C: se concedió sin tarjeta, por el Modo auto ("Solo ver" efímero para esta tarea). */
  auto?: boolean
}

/** Minúsculas y sin acentos, para comparar nombres ("Música" ≈ "musica"). */
const fold = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()

const resolveApp = (name: string): Promise<AppRef & { found: boolean }> => backend.resolveApp(name)

/** Resuelve el argumento `app` de las herramientas `app_*`/`request_full_control`, o lanza. */
async function namedApp(nameRaw: unknown): Promise<AppRef> {
  const name = String(nameRaw ?? '').trim()
  if (!name) throw new Error('app vacío')
  const ref = await resolveApp(name)
  if (!ref.found) {
    throw new Error(backend.text.appNotFound(name))
  }
  const app = { bundleId: ref.bundleId, name: ref.name }
  noteTarget(app)
  return app
}

/**
 * Última app que el modelo nombró como objetivo (`open_application`, `app_*`, `find_element`…). La captura
 * (`screenForCapture`) la prefiere sobre la app en primer plano: si Discord vive en otro monitor pero lo que
 * está al frente en ese instante es Finder o Spotlight, el modelo debe ver el monitor de Discord. Caduca para
 * no arrastrar una app vieja a otra tarea.
 */
let targetApp: { ref: AppRef; at: number } | null = null
const TARGET_TTL_MS = 5 * 60_000

function noteTarget(ref: AppRef | null | undefined): void {
  if (ref?.bundleId) targetApp = { ref, at: Date.now() }
}

function currentTarget(): AppRef | null {
  if (!targetApp) return null
  if (Date.now() - targetApp.at > TARGET_TTL_MS) {
    targetApp = null
    return null
  }
  return targetApp.ref
}

interface ActionEvent {
  tool: string
  x?: number
  y?: number
  text?: string
  phase?: 'start' | 'end'
  ok?: boolean
  fromX?: number
  fromY?: number
  auto?: boolean
}

function post(ev: ActionEvent, timeoutMs: number): Promise<void> {
  if (!EVENTS_URL) return Promise.resolve()
  const body = JSON.stringify({ ...ev, at: Date.now() })
  return fetch(EVENTS_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    signal: AbortSignal.timeout(timeoutMs)
  }).then(
    () => undefined,
    () => undefined
  )
}

/** Fire-and-forget. */
function emit(ev: ActionEvent): void {
  void post(ev, 1500)
}

/**
 * Emite `start` (antes de actuar: el overlay marca el destino mientras el cursor viaja), ejecuta
 * la acción y emite `end` (onda del clic) con el resultado.
 */
async function act<T>(ev: ActionEvent, fn: () => Promise<T>): Promise<T> {
  // Última comprobación justo antes de actuar (callTool ya comprobó al empezar).
  if (await isStopped()) throw new Error(STOPPED_MSG)
  emit({ ...ev, phase: 'start' })
  // Vigilancia durante la acción: si se detiene el control a mitad (tecleo largo, `wait`…), se
  // matan los helpers en vuelo y la acción falla. El proceso principal además hace `pkill`.
  let timer: NodeJS.Timeout | undefined
  const watchdog = new Promise<never>((_, reject) => {
    timer = setInterval(() => {
      isStopped().then(
        (stopped) => {
          if (!stopped) return
          killChildren()
          reject(new Error(STOPPED_MSG))
        },
        (err: unknown) => {
          killChildren()
          reject(err instanceof Error ? err : new Error(String(err)))
        }
      )
    }, 250)
  })
  try {
    const r = await Promise.race([fn(), watchdog])
    emit({ ...ev, phase: 'end', ok: true })
    return r
  } catch (err) {
    emit({ ...ev, phase: 'end', ok: false })
    throw err
  } finally {
    clearInterval(timer)
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// ───────────────────────────── pantalla / capturas ─────────────────────────────

let mainScreen: Screen | null = null
let allScreens: Screen[] | null = null
/** puntos por píxel de captura (se actualiza con cada captura). */
let ratio = 0
/** Pantalla de la ÚLTIMA captura de pantalla completa (F8-B150) — no siempre la principal, ver
 * `screenForCapture`. `toPoints`/`ensureRatio` la usan para convertir correctamente cuando la app en
 * primer plano está en un monitor secundario; antes de esto SIEMPRE se asumía la principal. */
let capturedScreen: Screen | null = null
/** Última captura de pantalla COMPLETA (no `app_screenshot`, que es de una sola ventana y tiene su
 * propio espacio de coordenadas) — la usa `zoom` para recortar/agrandar sin tener que volver a
 * capturar. El archivo sigue en disco mientras `cleanupShots()` no lo haya purgado (guarda los 20
 * últimos). */
let lastShot: Shot | null = null

async function getMainScreen(): Promise<Screen> {
  if (mainScreen) return mainScreen
  const list = JSON.parse(await helper('screens')) as Array<Screen & Record<string, unknown>>
  const found = list.find((s) => s.main) ?? list[0]
  if (!found) throw new Error('No se detectó ninguna pantalla')
  mainScreen = backend.normalizeScreen(found)
  return mainScreen
}

/** Todas las pantallas normalizadas (F8-B150) — cacheadas igual que `getMainScreen` (no sigue un
 * cambio de monitores en caliente a mitad de sesión, misma limitación que ya tenía esa función). */
async function getAllScreens(): Promise<Screen[]> {
  if (allScreens) return allScreens
  const list = JSON.parse(await helper('screens')) as Array<Screen & Record<string, unknown>>
  allScreens = list.map((s) => backend.normalizeScreen(s))
  return allScreens
}

/**
 * SOLO macOS (lo llama `captureScreen` ahí — en Windows el "escritorio virtual" ya es un espacio
 * único, no hace falta nada de esto). Qué pantalla capturar (F8-B150) y la app en primer plano,
 * juntas en una sola llamada: antes `takeScreenshot` pedía `frontmost` en paralelo con la captura —
 * dos llamadas, y una carrera real entre ambas (el orden exacto de los comandos al helper dejaba de
 * ser determinista, lo que rompió la prueba de equivalencia la primera vez que se probó esto).
 *
 * `screen`: la que tiene la ventana de la app en primer plano, no siempre la principal — antes,
 * `screenshot` capturaba SIEMPRE la pantalla principal con `-m`, así que si la app activa estaba en un
 * monitor secundario, la captura mostraba lo que hubiera detrás en la principal (el escritorio, u otra
 * app) en vez de la app real — el sistema decía bien cuál era la app en primer plano, pero la imagen
 * no la mostraba. Best-effort: cualquier paso que falle (sin ventana, sin `windows-of`, etc.) cae en
 * la pantalla principal, el comportamiento de siempre.
 */
async function screenForCapture(): Promise<{ screen: Screen; front: AppRef | null }> {
  const main = await getMainScreen()
  const front = await appFrontmost().catch(() => null)
  // Primero la app objetivo (si la hay y tiene ventana), luego la que está al frente, y si no, la principal.
  const target = currentTarget()
  const candidates: AppRef[] = []
  if (target?.bundleId) candidates.push(target)
  if (front?.bundleId && front.bundleId !== target?.bundleId) candidates.push(front)
  for (const app of candidates) {
    const screen = await screenOfApp(app.bundleId)
    if (screen) return { screen, front }
  }
  return { screen: main, front }
}

/** Pantalla que cubre más superficie de la primera ventana de la app, o `null` si no se puede saber. */
async function screenOfApp(bundleId: string): Promise<Screen | null> {
  try {
    const wins = JSON.parse(await helper('windows-of', bundleId)) as Array<{
      x: number
      y: number
      width: number
      height: number
    }>
    const w = wins[0]
    if (!w) return null
    // F8-B155: la pantalla que más superficie real de la ventana cubre (no un único punto): una ventana
    // cerca del borde entre dos monitores, o más ancha que una pantalla, podía tener el centro del lado
    // "equivocado". Es el criterio estándar (Hammerspoon/`hs.window`).
    const screens = await getAllScreens()
    let best: Screen | null = null
    let bestArea = 0
    for (const s of screens) {
      const sx = s.x ?? 0
      const sy = s.y ?? 0
      const overlapW = Math.max(0, Math.min(w.x + w.width, sx + s.width) - Math.max(w.x, sx))
      const overlapH = Math.max(0, Math.min(w.y + w.height, sy + s.height) - Math.max(w.y, sy))
      const area = overlapW * overlapH
      if (area > bestArea) {
        bestArea = area
        best = s
      }
    }
    return best
  } catch {
    return null
  }
}

async function ensureRatio(): Promise<number> {
  if (ratio > 0) return ratio
  const s = capturedScreen ?? (await getMainScreen())
  const long = Math.max(s.width, s.height) * s.scale
  const outLong = Math.min(long, MAX_LONG)
  // ancho en px de la captura final ≈ width*scale*outLong/long
  ratio = s.width / ((s.width * s.scale * outLong) / long)
  return ratio
}

function cleanupShots(): void {
  try {
    const files = readdirSync(SHOT_DIR)
      .filter((f) => f.startsWith('shot-'))
      .map((f) => ({ f, t: statSync(join(SHOT_DIR, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
    for (const { f } of files.slice(20)) rmSync(join(SHOT_DIR, f), { force: true })
  } catch {
    // ignorar
  }
}

interface Shot {
  path: string
  base64: string
  width: number
  height: number
  ratio: number
  /** App en primer plano al momento de la captura (`null` si no se pudo saber) — ver `shotText`: sin
   * esto, el modelo no tenía forma de saber QUÉ estaba viendo, solo lo que la imagen mostraba a ojo. */
  front?: string | null
  /** F8-B150: `false` si se capturó otra pantalla (la app en primer plano estaba en un monitor
   * secundario) — `shotText` lo dice explícito, en vez de decir siempre "pantalla principal". */
  onMainScreen?: boolean
}

async function takeScreenshot(auto = false, session?: string): Promise<Shot> {
  // Espera (≤600 ms) a que la app prepare el overlay para la captura; luego el destello.
  await post({ tool: 'screenshot', phase: 'start', auto }, 600)
  try {
    // `captureScreen` ya resuelve la app en primer plano (ver F8-B150 ahí) — nada que pedir aparte.
    return await captureScreen(session)
  } finally {
    emit({ tool: 'screenshot', phase: 'end', auto })
  }
}

/** Apps de sistema/la propia Lazunox: nunca se excluyen de la captura aunque no tengan concesión. */
const NEVER_EXCLUDE = new Set([
  // Literal = APP_ID de src/shared/brand.ts. NO importarlo: este bundle (`computer-mcp`) debe quedar
  // autónomo y importar brand crea un chunk compartido (`out/main/chunks/`) que el utilityProcess no
  // espera. src/test/brand-consistency.test.ts comprueba que coincide.
  'cl.bentec.lazunox',
  'com.github.Electron', // Lazunox sin empaquetar (`npm run dev`)
  'com.apple.dock',
  'com.apple.systemuiserver',
  'com.apple.Spotlight',
  'com.apple.controlcenter',
  'com.apple.WindowServer',
  'com.apple.loginwindow',
  'com.apple.notificationcenterui',
  'com.apple.finder' // Finder es la app que casi siempre está detrás de todo; no es "contenido" ajeno
])

// ───────────────────────────── backend de plataforma ─────────────────────────────

/** GET JSON al canal lateral con tope de 1,5 s; lanza si no hay canal o no responde (los backends fallan cerrado). */
async function sideGet(path: string): Promise<unknown> {
  if (!EVENTS_URL) throw new Error('Canal lateral no disponible')
  const r = await fetch(`${EVENTS_URL}${path}`, { signal: AbortSignal.timeout(1500) })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

const platformHost: PlatformHost = {
  config: {
    helper: HELPER,
    eventsUrl: EVENTS_URL,
    instant: INSTANT,
    typeDelay: TYPE_DELAY,
    maxLong: MAX_LONG,
    shotDir: SHOT_DIR,
    fakeShot: FAKE_SHOT,
    neverExclude: NEVER_EXCLUDE
  },
  log,
  tierOf,
  mainScreen: getMainScreen,
  sideGet
}

/**
 * Backend de la plataforma. `COMPUTER_BACKEND` (`darwin` | `win32`) lo fija `main` al lanzar el MCP (y las pruebas); sin él
 * vale la plataforma del proceso. Cualquier otra cosa cae en macOS, como siempre.
 */
const backend: PlatformBackend =
  (process.env.COMPUTER_BACKEND ?? process.platform) === 'win32' ? createWin32Backend(platformHost) : createDarwinBackend(platformHost)

/** Herramientas que mueven el ratón o el teclado REALES (Windows las rechaza si la ventana de destino es de administrador). */
const REAL_INPUT_TOOLS = new Set(['left_click', 'right_click', 'double_click', 'mouse_move', 'drag', 'scroll', 'type_text', 'key'])

async function captureScreen(session?: string): Promise<Shot> {
  mkdirSync(SHOT_DIR, { recursive: true })
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const raw = join(SHOT_DIR, `raw-${stamp}.png`)
  const out = join(SHOT_DIR, `shot-${stamp}.jpg`)
  try {
    let screen: Screen
    let front: AppRef | null
    let width: number
    let height: number
    if (backend.id === 'darwin') {
      // F8-B150: qué pantalla mostrar (la de la app en primer plano, no siempre la principal) se
      // decide ANTES de capturar, para poder pedirle esa pantalla al backend — y de paso ya devuelve
      // la app en primer plano, así no hay que pedirla aparte (antes se pedía en paralelo a la
      // captura: dos llamadas, y encima una carrera real entre ambas).
      ;({ screen, front } = await screenForCapture())
      ;({ width, height } = await backend.captureScreen({ raw, out, session, screen }))
    } else {
      // Windows: mismo orden de siempre (varias pruebas lo fijan exacto) — antes `frontmost` corría
      // en paralelo a la captura (ganaba la carrera casi siempre por ser una sola llamada corta
      // contra una cadena larga), así que pedirlo PRIMERO ahora da el mismo resultado observable sin
      // depender de una carrera real. Sin el cálculo de pantalla real de arriba (su "escritorio
      // virtual" ya es un espacio único).
      front = await appFrontmost().catch(() => null)
      ;({ width, height } = await backend.captureScreen({ raw, out, session }))
      screen = await getMainScreen()
    }
    capturedScreen = screen
    ratio = width > 0 ? screen.width / width : await ensureRatio()
    const base64 = readFileSync(out).toString('base64')
    cleanupShots()
    const shot: Shot = { path: out, base64, width, height, ratio, front: front?.name ?? null, onMainScreen: screen.main === true }
    lastShot = shot
    return shot
  } finally {
    rmSync(raw, { force: true })
  }
}

/** px de captura → puntos de pantalla GLOBALES (los que esperan los clics/movimientos reales). */
async function toPoints(x: unknown, y: unknown): Promise<{ x: number; y: number }> {
  const nx = Number(x)
  const ny = Number(y)
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) throw new Error('Coordenadas inválidas: x e y deben ser números')
  const r = await ensureRatio()
  // F8-B150: la pantalla de la ÚLTIMA captura, no siempre la principal (ver `screenForCapture`) — los
  // límites y el origen que se suman abajo son los de ESA pantalla.
  const s = capturedScreen ?? (await getMainScreen())
  const px = Math.round(nx * r * 100) / 100
  const py = Math.round(ny * r * 100) / 100
  if (px < 0 || py < 0 || px > s.width || py > s.height) {
    // F8-B149: la otra confusión real medida (con un monitor secundario de verdad) es mezclar
    // espacios de coordenadas — app_find/app_tree devuelven PUNTOS DE PANTALLA GLOBALES (de
    // accesibilidad, pueden ser negativos si hay un monitor a la izquierda/arriba del principal), no
    // píxeles de la última captura. Pasarle esos puntos directo a esta función nunca va a dar algo
    // válido — el aviso lo dice en vez de solo "fuera de la pantalla".
    throw new Error(
      `Coordenadas fuera de la pantalla: (${nx}, ${ny}) px de captura. Si vienen de app_find/app_tree ` +
        '(accesibilidad), son puntos de pantalla reales, no píxeles de una captura — no se pueden usar en ' +
        'left_click/mouse_move/etc. directamente (y mucho menos si son negativas: puede ser un monitor ' +
        'secundario). Usa app_press/app_action en vez de adivinar un clic.'
    )
  }
  // F8-B150: sumar el origen de la pantalla capturada — en la principal es (0,0), sin cambio alguno
  // respecto a como era antes de esto; en otra pantalla, esto es lo que hace que el clic caiga en el
  // punto real (p.ej. en un monitor a la izquierda, con x negativa de verdad).
  return { x: px + (s.x ?? 0), y: py + (s.y ?? 0) }
}

// ───────────────────────────── herramientas ─────────────────────────────

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }

interface ToolResult {
  content: Content[]
  isError?: boolean
}

/** Resultado de una herramienta: texto simple, o texto + una captura ya tomada (p.ej. `request_access`). */
type ToolRunResult = string | { text: string; shot: Shot }

interface ToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  /** Acción (no lectura): se emite al canal lateral y se adjunta captura automática. */
  action: boolean
  /** Lote C: no adjuntar la captura automática tras la acción (herramientas `app_*` de solo lectura). */
  noAutoShot?: boolean
  /** `session` = sesión de OpenCode que llama (la inyecta `lazunox-plan-gate` como `lazunox_session`). */
  run: (args: Record<string, unknown>, session?: string) => Promise<ToolRunResult>
}

const XY = {
  x: { type: 'number', description: 'X en píxeles de la última captura' },
  y: { type: 'number', description: 'Y en píxeles de la última captura' }
}
/** Acciones que un lote puede encadenar (las que no piden permisos nuevos ni abren tarjetas) y sus topes. */
const BATCH_TOOLS = [
  'left_click',
  'double_click',
  'right_click',
  'mouse_move',
  'drag',
  'scroll',
  'type_text',
  'key',
  'wait',
  'open_application'
]
const BATCH_MAX_STEPS = 8
const BATCH_PAUSE_MS = 250

const ELEMENT_ARG = {
  element: {
    type: 'number',
    description: 'Alternativa a x/y: número [N] de la lista de elementos de la última captura (punto exacto por accesibilidad)'
  }
}
const SHOT_FLAG = {
  screenshot: {
    type: 'boolean',
    description: 'Adjuntar una captura tras la acción (por defecto true)'
  }
}
const EXPECT_APP = {
  expect_app: {
    type: 'string',
    description:
      'Opcional, recomendado: nombre de la app donde esperás escribir (p.ej. "WhatsApp"). Si el foco cambió a otra app, ' +
      'no se escribe nada y se avisa — en vez de que el texto vaya a la app equivocada sin que lo notes.'
  }
}

function obj(props: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return { type: 'object', properties: { ...props }, required, additionalProperties: false }
}

function shotText(s: Shot): string {
  const front = s.front ? ` App en primer plano: ${s.front}.` : ''
  // F8-B150: antes decía siempre "pantalla principal" — ahora puede ser otra (la que tiene la app en
  // primer plano), y es importante que el modelo lo sepa: sigue siendo la única que puede ver.
  const which =
    s.onMainScreen === false ? 'Captura de la pantalla con la app en primer plano (no la principal)' : 'Captura de la pantalla principal'
  return (
    `${which}: ${s.width}x${s.height} px (1 px = ${s.ratio.toFixed(4)} puntos).${front} ` +
    `Usa coordenadas EN PÍXELES DE ESTA IMAGEN en las herramientas. Archivo: ${s.path}`
  )
}

async function clickTool(
  args: Record<string, unknown>,
  button: 'left' | 'right',
  count: number,
  tool: string,
  session?: string
): Promise<string> {
  await requireForeground(session)
  const { p, label } = await pointFromArgs(args)
  await requireTier('click', p, session)
  await act({ tool, x: p.x, y: p.y }, () => helper('click', String(p.x), String(p.y), button, String(count)))
  return `${tool} en ${label} → (${p.x}, ${p.y}) pt`
}

// ───────────────────────────── Lote C: control por Accessibility API (background) ─────────────────────────────
//
// Las herramientas `app_*` controlan una app CONCRETA por su árbol de accesibilidad, sin mover el
// ratón real ni activar la app: sirven en modo "En segundo plano" (por defecto). Los nodos llevan
// una `ref` (`w<ventana>.<hijo>…`) que hay que releer con `app_tree`/`app_find` si la interfaz
// cambió entre medias (código de salida 8 del helper).

/** Nodo del árbol de accesibilidad (forma exacta de `helper.swift`, ver B.1 del plan). */
interface AxNode {
  ref: string
  role: string
  subrole?: string
  title?: string
  description?: string
  value?: string
  secure?: boolean
  enabled: boolean
  focused: boolean
  frame: { x: number; y: number; width: number; height: number }
  actions: string[]
}

/** Acciones AX que `ax-action` acepta (el resto → exit 11 del helper). */
const AX_ACTIONS = new Set(['AXShowMenu', 'AXIncrement', 'AXDecrement', 'AXConfirm', 'AXCancel', 'AXRaise', 'AXPick'])

/** Mensaje legible para los códigos de salida del helper (B.1 del plan Lote C; el texto depende del sistema). */
const axExitMessage = (code: number): string | null => backend.exitMessage(code)

/**
 * Tope de tiempo PROPIO para las llamadas de Accessibility (F8-B149) — mucho más corto que el tope
 * genérico de 30s de `helper()`/`helperExit()` (pensado para `type`/`screenshot-sck`, que sí pueden
 * tardar de verdad). Una consulta AX normal tarda milisegundos; si una app está congelada/no responde,
 * mejor fallar rápido y que el agente lo note y reintente, que esperar 30s por cada intento. El
 * proceso nativo sigue su curso solo (lo reaparece/mata el mismo mecanismo de siempre); esto solo deja
 * de esperarlo del lado de Node.
 */
const AX_TIMEOUT_MS = 8_000

function withAxTimeout<T>(p: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`La consulta de Accessibility no respondió en ${AX_TIMEOUT_MS / 1000}s (¿la app está congelada?)`)),
      AX_TIMEOUT_MS
    )
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

async function axTree(bundleId: string, maxDepth: number, maxNodes: number): Promise<{ nodes: AxNode[]; truncated: boolean }> {
  const { stdout, code } = await withAxTimeout(helperExit('ax-tree', bundleId, String(maxDepth), String(maxNodes)))
  if (code !== 0) throw new Error(axExitMessage(code) ?? `ax-tree falló (código ${code})`)
  return JSON.parse(stdout) as { nodes: AxNode[]; truncated: boolean }
}

async function axFind(bundleId: string, query: Record<string, unknown>): Promise<{ matches: AxNode[] }> {
  const { stdout, code } = await withAxTimeout(helperExit('ax-find', bundleId, JSON.stringify(query)))
  if (code !== 0) throw new Error(axExitMessage(code) ?? `ax-find falló (código ${code})`)
  return JSON.parse(stdout) as { matches: AxNode[] }
}

async function axFrame(bundleId: string, ref: string): Promise<{ frame: { x: number; y: number; width: number; height: number } }> {
  const { stdout, code } = await withAxTimeout(helperExit('ax-frame', bundleId, ref))
  if (code !== 0) throw new Error(axExitMessage(code) ?? `ax-frame falló (código ${code})`)
  return JSON.parse(stdout) as { frame: { x: number; y: number; width: number; height: number } }
}

async function axPress(bundleId: string, ref: string, expectRole?: string, expectTitle?: string): Promise<void> {
  const args = ['ax-press', bundleId, ref]
  if (expectRole) args.push(expectRole)
  if (expectTitle) args.push(expectTitle)
  const { code } = await withAxTimeout(helperExit(...args))
  if (code !== 0) throw new Error(axExitMessage(code) ?? `ax-press falló (código ${code})`)
}

async function axSetValue(bundleId: string, ref: string, value: string): Promise<void> {
  const { code } = await withAxTimeout(helperExit('ax-set-value', bundleId, ref, value))
  if (code !== 0) throw new Error(axExitMessage(code) ?? `ax-set-value falló (código ${code})`)
}

async function axAction(bundleId: string, ref: string, action: string): Promise<void> {
  const { code } = await withAxTimeout(helperExit('ax-action', bundleId, ref, action))
  if (code !== 0) throw new Error(axExitMessage(code) ?? `ax-action falló (código ${code})`)
}

// ───────────────────────────── find_element / list_elements (AX para el ratón REAL) ─────────────────────────────
//
// A diferencia de app_find (que alimenta las herramientas `app_*` de FONDO, con `ref` estables y sin
// límite de tiempo), esto alimenta el modo "Control de la pantalla": el agente pide localizar un
// botón/campo por su texto ANTES de adivinar coordenadas mirando la captura, y usa directamente el
// `screenPoint` que devuelve `find-elements` (el helper nativo, con su propio tope de nodos/tiempo)
// en `left_click`/`type_text`. Implementación propia, inspirada (no copiada) en el enfoque
// "planificar → actuar → reflexionar" de Agent-S3 (github.com/simular-ai/Agent-S, Apache-2.0): aquí
// el "reflexionar" es la etapa de ranking de abajo (exacto > difuso > solo-por-rol) antes de decidir
// si hay algo fiable que ofrecer o si hay que rendirse a la captura de pantalla.

interface FoundElement {
  role: string
  title?: string
  description?: string
  value?: string
  identifier?: string
  enabled: boolean
  x: number
  y: number
  width: number
  height: number
  screenPoint: { x: number; y: number }
}

/** Llama a `find-elements` del helper nativo y devuelve sus coincidencias (ya puede venir vacío). */
async function findElementsHelper(bundleId: string, opts: { roles?: string[]; query?: string }): Promise<FoundElement[]> {
  const args = ['find-elements', '--app', bundleId]
  if (opts.roles?.length) args.push('--role', opts.roles.join(','))
  if (opts.query) args.push('--query', opts.query)
  const { stdout, code } = await withAxTimeout(helperExit(...args))
  if (code !== 0) throw new Error(axExitMessage(code) ?? `find-elements falló (código ${code})`)
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return []
  }
  return Array.isArray(parsed) ? (parsed as FoundElement[]) : []
}

type MatchTier = 'exact' | 'fuzzy' | 'role'
const MATCH_TIER_RANK: Record<MatchTier, number> = { exact: 0, fuzzy: 1, role: 2 }

function elementTextFields(el: FoundElement): string[] {
  return [el.title, el.description, el.value, el.identifier].filter((s): s is string => !!s && s.length > 0)
}

/**
 * Nivel de coincidencia de un elemento YA devuelto por el helper contra la descripción pedida. El
 * helper solo devuelve elementos que ya pasaron SU filtro difuso (substring o subsecuencia acotada,
 * ver `fuzzyContains` en `helper.swift`), así que aquí solo hace falta distinguir el caso fuerte
 * ("exact": contención literal en un sentido u otro) del resto ("fuzzy": pasó el filtro del helper
 * mediante subsecuencia/rol, pero sin contención literal).
 */
function matchTier(el: FoundElement, queryFolded: string): MatchTier {
  const fields = elementTextFields(el).map(fold)
  for (const f of fields) {
    if (f === queryFolded || f.includes(queryFolded) || queryFolded.includes(f)) return 'exact'
  }
  return 'fuzzy'
}

/** Adivina un rol AX plausible a partir de palabras clave (ES/EN) en la descripción pedida, para un último intento "solo por rol" si no hubo ninguna coincidencia de texto exacta. */
const ROLE_KEYWORDS: Array<{ role: string; words: string[] }> = [
  { role: 'button', words: ['boton', 'button', 'pulsa', 'haz clic', 'clic en'] },
  { role: 'textfield', words: ['campo', 'casilla de texto', 'input', 'field', 'buscar', 'search', 'cuadro de texto'] },
  { role: 'checkbox', words: ['casilla', 'checkbox', 'check'] },
  { role: 'link', words: ['enlace', 'link', 'hipervinculo'] },
  { role: 'menuitem', words: ['menu', 'opcion de menu', 'item de menu'] },
  { role: 'tabgroup', words: ['pestana', 'tab'] },
  { role: 'combobox', words: ['desplegable', 'combobox', 'dropdown'] },
  { role: 'slider', words: ['deslizador', 'slider'] }
]

function guessRoleFromDescription(description: string): string | null {
  const d = fold(description)
  for (const { role, words } of ROLE_KEYWORDS) {
    if (words.some((w) => d.includes(fold(w)))) return role
  }
  return null
}

/**
 * Busca candidatos para `description` en `app`: primero por texto (fuzzy, vía el helper), y si
 * ninguno es una coincidencia exacta, añade como último recurso los elementos de un rol adivinado a
 * partir de la propia descripción (nivel "role", el más bajo). Ordena exact > fuzzy > role y
 * devuelve como mucho 5.
 */
async function findElementCandidates(app: AppRef, description: string): Promise<Array<{ el: FoundElement; tier: MatchTier }>> {
  const queryFolded = fold(description)
  const textResults = await findElementsHelper(app.bundleId, { query: description })
  const scored: Array<{ el: FoundElement; tier: MatchTier }> = textResults.map((el) => ({ el, tier: matchTier(el, queryFolded) }))
  if (!scored.some((s) => s.tier === 'exact')) {
    const guessedRole = guessRoleFromDescription(description)
    if (guessedRole) {
      const roleResults = await findElementsHelper(app.bundleId, { roles: [guessedRole] }).catch(() => [])
      const seen = new Set(scored.map((s) => `${s.el.screenPoint.x},${s.el.screenPoint.y}`))
      for (const el of roleResults) {
        const key = `${el.screenPoint.x},${el.screenPoint.y}`
        if (seen.has(key)) continue
        seen.add(key)
        scored.push({ el, tier: 'role' })
      }
    }
  }
  scored.sort((a, b) => MATCH_TIER_RANK[a.tier] - MATCH_TIER_RANK[b.tier])
  return scored.slice(0, 5)
}

/**
 * `el.screenPoint` llega en PUNTOS de pantalla (así los da Accessibility/AX) — pero `left_click` y el
 * resto de las herramientas de acción esperan PÍXELES de la última captura (`toPoints()` los
 * convierte internamente multiplicando por `ratio`). Pasar un punto AX directo a `left_click` lo
 * convertía dos veces (una acá nunca, otra adentro de `toPoints`) y el clic caía desviado — bug real,
 * encontrado comparando un intento fallido de Lazunox contra uno de Claude en la misma tarea. Por eso
 * acá se divide por `ratio` ANTES de mostrarlo: lo que el texto ofrece ya está en las mismas unidades
 * que `left_click`/`mouse_move`/`type_text` esperan, así "pasá estas coordenadas directo" (lo que ya
 * dice el prompt de la herramienta) es correcto sin tener que explicarle al modelo una conversión más.
 */
/** Punto global (puntos de pantalla) → px de la ÚLTIMA captura: resta el origen de la pantalla capturada (monitores a la izquierda/arriba). */
function shotPx(point: { x: number; y: number }, ratio: number): { x: number; y: number } {
  const ox = capturedScreen?.x ?? 0
  const oy = capturedScreen?.y ?? 0
  return ratio > 0 ? { x: (point.x - ox) / ratio, y: (point.y - oy) / ratio } : point
}

function describeElement(el: FoundElement, idx: number, ratio: number): string {
  const label = el.title || el.description || el.identifier || el.value || '(sin texto)'
  const state = el.enabled ? '' : ' [deshabilitado]'
  const px = shotPx(el.screenPoint, ratio)
  const pt = `(${Math.round(px.x)}, ${Math.round(px.y)})`
  return `${idx + 1}. [${el.role}] "${label}" en ${pt} px, tamaño ${Math.round(el.width)}x${Math.round(el.height)}${state}`
}

// ───────────────────────────── lista numerada de elementos en cada captura ─────────────────────────────
//
// Captura + árbol de accesibilidad juntos rinden más que cualquiera de los dos solos (los modelos pequeños fallan
// sobre todo APUNTANDO a un píxel). Cada captura de pantalla completa añade una lista corta y numerada de lo
// pulsable de la app objetivo, y los clics aceptan `element: N` (punto exacto de AX) en vez de x/y. Es un
// complemento: apps con poca accesibilidad (Electron, juegos) devuelven pocas filas o ninguna y se sigue con x/y.

const SHOT_ELEMENT_ROLES = [
  'button',
  'textfield',
  'textarea',
  'checkbox',
  'radiobutton',
  'popupbutton',
  'menubutton',
  'combobox',
  'link',
  'menuitem'
]
const ELEMENT_ROLE_ES: Record<string, string> = {
  AXButton: 'botón',
  AXTextField: 'campo de texto',
  AXTextArea: 'área de texto',
  AXCheckBox: 'casilla',
  AXRadioButton: 'opción',
  AXPopUpButton: 'desplegable',
  AXMenuButton: 'menú',
  AXComboBox: 'combo',
  AXLink: 'enlace',
  AXMenuItem: 'elemento de menú'
}
const ELEMENTS_TTL_MS = 90_000
const ELEMENTS_QUERY_MS = 3_000

interface ElementsSnapshot {
  app: AppRef
  at: number
  items: FoundElement[]
}
let elementsSnapshot: ElementsSnapshot | null = null

const elementLabel = (el: FoundElement): string => (el.title || el.description || el.identifier || '').replace(/\s+/g, ' ').trim()

/**
 * Lista numerada de elementos pulsables de la app objetivo (o la de primer plano) que caen DENTRO de la última
 * captura, ordenados de arriba abajo y de izquierda a derecha. Devuelve '' si no se puede o no hay nada
 * (best-effort: nunca rompe la captura). Guarda la instantánea para `element: N`.
 */
async function elementsBlock(shot: Shot, session: string | undefined, max: number): Promise<string> {
  // Solo macOS: el helper de Windows no tiene find-elements (y sus pruebas fijan el orden exacto de sus llamadas).
  if (backend.id !== 'darwin') return ''
  try {
    const app = currentTarget() ?? (await appFrontmost().catch(() => null))
    if (!app?.bundleId) return ''
    await requireTierFor(app, 'click', session)
    const found = await Promise.race([
      findElementsHelper(app.bundleId, { roles: SHOT_ELEMENT_ROLES }),
      new Promise<FoundElement[]>((r) => setTimeout(() => r([]), ELEMENTS_QUERY_MS))
    ])
    const inside = found
      .filter((el) => el.enabled !== false && el.width > 1 && el.height > 1)
      .map((el) => ({ el, px: shotPx(el.screenPoint, shot.ratio) }))
      .filter(({ px }) => px.x >= 0 && px.y >= 0 && px.x <= shot.width && px.y <= shot.height)
      .filter(({ el }) => elementLabel(el) || el.role === 'AXTextField' || el.role === 'AXTextArea')
      .sort((a, b) => a.px.y - b.px.y || a.px.x - b.px.x)
      .slice(0, max)
    if (!inside.length) {
      elementsSnapshot = null
      return ''
    }
    elementsSnapshot = { app, at: Date.now(), items: inside.map((i) => i.el) }
    const lines = inside.map(({ el, px }, i) => {
      const label = elementLabel(el)
      return `[${i + 1}] ${ELEMENT_ROLE_ES[el.role] ?? el.role}${label ? ` «${label.slice(0, 50)}»` : ''} (${Math.round(px.x)}, ${Math.round(px.y)})`
    })
    return (
      `Elementos pulsables de ${app.name} (accesibilidad). Para pulsar uno usa left_click/double_click/right_click/mouse_move con ` +
      `element: N (más exacto que adivinar x/y); valen hasta la próxima captura o 90 s:\n${lines.join('\n')}`
    )
  } catch {
    return ''
  }
}

/** Punto (puntos globales) al que apunta una acción: `element: N` de la última lista, o x/y en px de la captura. */
async function pointFromArgs(args: Record<string, unknown>): Promise<{ p: { x: number; y: number }; label: string }> {
  const raw = args.element
  if (raw !== undefined && raw !== null && raw !== '') {
    const n = Number(raw)
    if (!Number.isInteger(n) || n < 1) throw new Error('element debe ser el número de la lista de elementos (1, 2, 3…)')
    const snap = elementsSnapshot
    if (!snap || Date.now() - snap.at > ELEMENTS_TTL_MS) {
      throw new Error('La lista de elementos caducó o no existe: toma una captura nueva (screenshot) o usa x/y.')
    }
    const el = snap.items[n - 1]
    if (!el) throw new Error(`No hay elemento ${n}: la lista tiene ${snap.items.length}.`)
    const front = await appFrontmost().catch(() => null)
    const target = currentTarget()
    if (front?.bundleId && front.bundleId !== snap.app.bundleId && target?.bundleId !== snap.app.bundleId) {
      throw new Error(`La app en primer plano ya no es ${snap.app.name}: toma una captura nueva antes de usar element.`)
    }
    return { p: { x: el.screenPoint.x, y: el.screenPoint.y }, label: `elemento ${n} «${elementLabel(el).slice(0, 40)}»` }
  }
  if (args.x === undefined || args.y === undefined) throw new Error('Indica x e y (px de la captura) o element (número de la lista).')
  const p = await toPoints(args.x, args.y)
  return { p, label: `(${args.x}, ${args.y}) px` }
}

/** App en primer plano, o lanza si no se pudo identificar (p. ej. el Escritorio). */
async function appFrontmostOrThrow(): Promise<AppRef> {
  const app = await appFrontmost()
  if (!app.bundleId) throw new Error('No se pudo identificar la app en primer plano. Indica "appHint" con el nombre de la app.')
  return app
}

// ───────────────────────────── Lote C: Teach mode (canal lateral) ─────────────────────────────

interface TeachStepBody {
  text: string
  title?: string
  step?: number
  total?: number
  x?: number
  y?: number
  session?: string
}

/** POST al canal lateral y ESPERA la respuesta ("Siguiente"/"Salir de la guía"), sin límite de tiempo. */
async function postTeachStep(step: TeachStepBody): Promise<'next' | 'exit'> {
  if (!EVENTS_URL) throw new Error('Canal lateral no disponible: no se puede mostrar el modo guía.')
  const r = await fetch(`${EVENTS_URL}/teach-step`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(step)
  })
  if (!r.ok) throw new Error(`No se pudo mostrar el paso del modo guía (HTTP ${r.status})`)
  const j = (await r.json()) as { action?: unknown }
  return j.action === 'exit' ? 'exit' : 'next'
}

function postTeachEnd(): Promise<void> {
  if (!EVENTS_URL) return Promise.resolve()
  return fetch(`${EVENTS_URL}/teach-end`, { method: 'POST' }).then(
    () => undefined,
    () => undefined
  )
}

const TOOLS: ToolDef[] = [
  {
    name: 'screenshot',
    description:
      'Toma una captura de la pantalla. Devuelve la imagen, su tamaño en píxeles y una lista NUMERADA de los elementos ' +
      'pulsables de la app (por accesibilidad) para pulsarlos con element: N en left_click y compañía; ' +
      'x/y usan coordenadas en píxeles de esta captura.',
    inputSchema: obj({ elements: { type: 'boolean', description: 'Incluir la lista numerada de elementos (por defecto true)' } }),
    // Capturar la pantalla también es tomar control: requiere plan aprobado.
    action: true,
    run: async () => '' // gestionado aparte
  },
  {
    name: 'zoom',
    description:
      'Recorta y agranda una región de la ÚLTIMA captura de pantalla completa (screenshot, no app_screenshot) para ver mejor ' +
      'texto chico o una zona densa, sin gastar una acción real sobre la pantalla. x,y,width,height en píxeles de ESA captura ' +
      '(mismo espacio que left_click). El resultado es SOLO para mirar: sus coordenadas no sirven para left_click/mouse_move — ' +
      'usa las de la captura original.',
    inputSchema: obj(
      {
        x: { type: 'number', description: 'X del recorte, px de la última captura' },
        y: { type: 'number', description: 'Y del recorte, px de la última captura' },
        width: { type: 'number', description: 'Ancho del recorte, px' },
        height: { type: 'number', description: 'Alto del recorte, px' },
        scale: { type: 'number', description: 'Cuánto agrandar el recorte (1 a 4; por defecto 2)' }
      },
      ['x', 'y', 'width', 'height']
    ),
    action: true,
    noAutoShot: true,
    run: async (a) => {
      if (!lastShot) throw new Error('Todavía no hay ninguna captura de pantalla completa — pide una con screenshot primero.')
      const shot = lastShot
      const x = Math.round(Number(a.x))
      const y = Math.round(Number(a.y))
      const width = Math.round(Number(a.width))
      const height = Math.round(Number(a.height))
      if (![x, y, width, height].every(Number.isFinite)) throw new Error('x, y, width y height deben ser números')
      if (width <= 0 || height <= 0) throw new Error('width y height deben ser mayores que 0')
      if (x < 0 || y < 0 || x + width > shot.width || y + height > shot.height) {
        throw new Error(`Región fuera de la captura (${shot.width}x${shot.height} px): (${x}, ${y}) ${width}x${height}`)
      }
      const scale = Math.max(1, Math.min(4, Number(a.scale) || 2))
      const outPath = join(SHOT_DIR, `zoom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`)
      const r = await backend.zoomImage({ inPath: shot.path, outPath, x, y, width, height, scale })
      const base64 = readFileSync(outPath).toString('base64')
      return {
        text:
          `Zoom x${scale} de (${x}, ${y}) ${width}x${height} px de la última captura (resultado: ${r.width}x${r.height} px). ` +
          'Esta imagen es SOLO para mirar — sus coordenadas no sirven para left_click/mouse_move, usa las de la captura original.',
        shot: { path: outPath, base64, width: r.width, height: r.height, ratio: shot.ratio }
      }
    }
  },
  {
    name: 'left_click',
    description: 'Clic izquierdo en (x, y) px de la captura, o en el elemento N de la lista de la última captura (element: N, más exacto).',
    inputSchema: obj({ ...XY, ...ELEMENT_ARG, ...SHOT_FLAG }, []),
    action: true,
    run: (a, session) => clickTool(a, 'left', 1, 'left_click', session)
  },
  {
    name: 'right_click',
    description: 'Clic derecho en (x, y) px de la captura, o en el elemento N de la lista (element: N).',
    inputSchema: obj({ ...XY, ...ELEMENT_ARG, ...SHOT_FLAG }, []),
    action: true,
    run: (a, session) => clickTool(a, 'right', 1, 'right_click', session)
  },
  {
    name: 'double_click',
    description: 'Doble clic izquierdo en (x, y) px de la captura, o en el elemento N de la lista (element: N).',
    inputSchema: obj({ ...XY, ...ELEMENT_ARG, ...SHOT_FLAG }, []),
    action: true,
    run: (a, session) => clickTool(a, 'left', 2, 'double_click', session)
  },
  {
    name: 'mouse_move',
    description: 'Mueve el puntero a (x, y) px de la captura, o al elemento N de la lista (element: N), sin hacer clic.',
    inputSchema: obj({ ...XY, ...ELEMENT_ARG, ...SHOT_FLAG }, []),
    action: true,
    run: async (a, session) => {
      await requireForeground(session)
      const { p, label } = await pointFromArgs(a)
      await requireTier('click', p, session)
      await act({ tool: 'mouse_move', x: p.x, y: p.y }, () => helper('move', String(p.x), String(p.y)))
      return `Puntero movido a ${label} → (${p.x}, ${p.y}) pt`
    }
  },
  {
    name: 'batch',
    description:
      'Ejecuta VARIAS acciones seguidas en una sola llamada (máx. 8) y devuelve una sola captura al final; se detiene en el primer ' +
      'error. Úsala cuando ya sabes la secuencia (clic en un campo, escribir, Enter). Las acciones permitidas son left_click, ' +
      'double_click, right_click, mouse_move, drag, scroll, type_text, key, wait y open_application, con los mismos argumentos que ' +
      'sus herramientas. Los números element: N valen para todos los pasos y se refieren a la lista de la última captura; si un paso ' +
      'puede cambiar la pantalla (abre un menú, cambia de ventana), ponlo el último o usa pasos separados.',
    inputSchema: obj(
      {
        actions: {
          type: 'array',
          maxItems: BATCH_MAX_STEPS,
          description:
            'Pasos en orden, p.ej. [{"tool":"left_click","args":{"element":3}},{"tool":"type_text","args":{"text":"hola"}},{"tool":"key","args":{"keys":"return"}}]',
          items: {
            type: 'object',
            properties: {
              tool: { type: 'string', enum: [...BATCH_TOOLS] },
              args: { type: 'object', description: 'Argumentos de esa herramienta (sin "screenshot")' }
            },
            required: ['tool'],
            additionalProperties: false
          }
        },
        ...SHOT_FLAG
      },
      ['actions']
    ),
    action: true,
    run: async (a, session) => {
      const steps = Array.isArray(a.actions) ? (a.actions as Array<Record<string, unknown>>) : []
      if (!steps.length) throw new Error('actions vacío: indica al menos un paso.')
      if (steps.length > BATCH_MAX_STEPS) throw new Error(`Demasiados pasos (${steps.length}): máximo ${BATCH_MAX_STEPS} por lote.`)
      const lines: string[] = []
      for (let i = 0; i < steps.length; i++) {
        const name = String(steps[i]?.tool ?? '')
        const inner = TOOLS.find((t) => t.name === name)
        if (!inner || !BATCH_TOOLS.includes(name)) {
          lines.push(`Paso ${i + 1}: herramienta no permitida en un lote («${name}»). Se detuvo.`)
          return `Lote detenido en el paso ${i + 1} de ${steps.length}.\n${lines.join('\n')}`
        }
        const innerArgs = steps[i]?.args && typeof steps[i].args === 'object' ? (steps[i].args as Record<string, unknown>) : {}
        try {
          if (await isStopped()) throw new Error(STOPPED_MSG)
          const out = await inner.run({ ...innerArgs, screenshot: false }, session)
          const text = (typeof out === 'string' ? out : out.text).split('\n')[0].slice(0, 200)
          lines.push(`Paso ${i + 1} (${name}): ${text}`)
        } catch (err) {
          lines.push(`Paso ${i + 1} (${name}): ERROR — ${err instanceof Error ? err.message : String(err)}`)
          return `Lote detenido en el paso ${i + 1} de ${steps.length} (los anteriores sí se ejecutaron).\n${lines.join('\n')}`
        }
        if (i < steps.length - 1) await sleep(BATCH_PAUSE_MS)
      }
      return `Lote completo (${steps.length} paso${steps.length === 1 ? '' : 's'}).\n${lines.join('\n')}`
    }
  },
  {
    name: 'drag',
    description: 'Arrastra con el botón izquierdo desde (start_x, start_y) hasta (end_x, end_y), en px de la captura.',
    inputSchema: obj(
      {
        start_x: { type: 'number' },
        start_y: { type: 'number' },
        end_x: { type: 'number' },
        end_y: { type: 'number' },
        ...SHOT_FLAG
      },
      ['start_x', 'start_y', 'end_x', 'end_y']
    ),
    action: true,
    run: async (a, session) => {
      await requireForeground(session)
      const s = await toPoints(a.start_x, a.start_y)
      const e = await toPoints(a.end_x, a.end_y)
      // Arrastrar necesita "Control total": mueve/reordena contenido, no es un simple clic.
      await requireTier('full', s, session)
      await requireTier('full', e, session)
      await act({ tool: 'drag', x: e.x, y: e.y, fromX: s.x, fromY: s.y }, () =>
        helper('drag', String(s.x), String(s.y), String(e.x), String(e.y))
      )
      return `Arrastrado de (${a.start_x}, ${a.start_y}) a (${a.end_x}, ${a.end_y}) px`
    }
  },
  {
    name: 'scroll',
    description: 'Desplaza con la rueda en (x, y) px de la captura. direction: up|down|left|right; amount: líneas (1-30, por defecto 5).',
    inputSchema: obj(
      {
        ...XY,
        direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
        amount: { type: 'number', description: 'Líneas (1-30)' },
        ...SHOT_FLAG
      },
      ['x', 'y', 'direction']
    ),
    action: true,
    run: async (a, session) => {
      await requireForeground(session)
      const p = await toPoints(a.x, a.y)
      const n = Math.max(1, Math.min(30, Math.round(Number(a.amount) || 5)))
      const dir = String(a.direction)
      const dx = dir === 'right' ? n : dir === 'left' ? -n : 0
      const dy = dir === 'down' ? n : dir === 'up' ? -n : 0
      if (!dx && !dy) throw new Error('direction debe ser up, down, left o right')
      await requireTier('click', p, session)
      await act({ tool: 'scroll', x: p.x, y: p.y, text: `${dir} ${n}` }, () =>
        helper('scroll', String(p.x), String(p.y), String(dx), String(dy))
      )
      return `Scroll ${dir} ${n} en (${a.x}, ${a.y}) px`
    }
  },
  {
    name: 'type_text',
    description: 'Escribe texto (unicode) en el elemento con foco. "\\n" pulsa Return. Nunca escribas contraseñas ni datos de pago.',
    inputSchema: obj({ text: { type: 'string' }, ...EXPECT_APP, ...SHOT_FLAG }, ['text']),
    action: true,
    run: async (a, session) => {
      await requireForeground(session)
      const text = String(a.text ?? '')
      if (!text) throw new Error('text vacío')
      if (text.length > 5000) throw new Error('Texto demasiado largo (máx. 5000 caracteres)')
      await checkExpectApp(a.expect_app)
      await requireTier('full', undefined, session)
      await requireCanType()
      await act({ tool: 'type_text', text: text.length > 120 ? `${text.slice(0, 117)}…` : text }, () => helper('type', text))
      return `Escrito: ${text.length} caracteres`
    }
  },
  {
    name: 'key',
    description:
      'Pulsa una tecla o combinación, p.ej. "return", "cmd+space", "cmd+shift+t", "escape", "tab", "up", "f5". ' +
      'Varias combinaciones separadas por espacio se pulsan en secuencia.',
    inputSchema: obj({ keys: { type: 'string' }, ...EXPECT_APP, ...SHOT_FLAG }, ['keys']),
    action: true,
    run: async (a, session) => {
      await requireForeground(session)
      await checkExpectApp(a.expect_app)
      const keys = String(a.keys ?? '').trim()
      if (!keys) throw new Error('keys vacío')
      const sendKeys = await backend.checkKeys(keys) // política de combinaciones (Windows); en macOS devuelve `keys` tal cual
      await requireTier('full', undefined, session)
      await requireCanType()
      await act({ tool: 'key', text: keys }, () => helper('key', sendKeys))
      return `Teclas pulsadas: ${keys}`
    }
  },
  {
    name: 'cursor_position',
    description: 'Devuelve la posición actual del puntero en píxeles de la captura.',
    inputSchema: obj({}),
    action: false,
    run: async () => {
      const p = JSON.parse(await helper('cursor')) as { x: number; y: number }
      const r = await ensureRatio()
      return JSON.stringify({ x: Math.round(p.x / r), y: Math.round(p.y / r), points: p })
    }
  },
  {
    name: 'open_application',
    description:
      'Abre o trae al frente una aplicación por nombre (p.ej. "Finder", "Safari", "Notas") o bundle id. Si la ' +
      'app queda sin ninguna ventana visible (minimizada o sin ventanas abiertas), intenta mostrar una.',
    inputSchema: obj({ name: { type: 'string' }, ...SHOT_FLAG }, ['name']),
    action: true,
    run: async (a, session) => {
      const name = String(a.name ?? '').trim()
      if (!name) throw new Error('name vacío')
      // Best-effort: que la captura siguiente muestre el monitor de esta app, no el de lo que esté al frente.
      await resolveApp(name)
        .then((r) => {
          if (r.found) noteTarget({ bundleId: r.bundleId, name: r.name })
        })
        .catch(() => undefined)
      // Lote C: en segundo plano se abre SIN activar (no roba el foco ni mueve nada visible). F8-B154:
      // antes esto miraba SOLO `mode` (la preferencia global) e ignoraba `foreground` (el control real
      // de ESTA sesión, concedido por `request_full_control`) — mismo criterio que ya usa
      // `requireForeground` para el resto de herramientas de ratón/teclado real, pero `open_application`
      // no lo seguía: con el control ya concedido, seguía abriendo SIN activar, la app nunca pasaba a
      // primer plano de verdad, y el agente quedaba mirando lo de siempre (otra app) sin poder ver ni
      // clicar donde hacía falta — confirmado con una tarea real (Discord, control concedido, igual
      // nunca se activó).
      const { mode, foreground } = await controlMode(session)
      if (mode === 'background' && !foreground) {
        const opened = await act({ tool: 'open_application', text: name }, () => helper('open-app-bg', name))
        // Windows no garantiza quedar detrás: si el helper avisa (`behind: false`), se le dice al modelo.
        let behindNote = ''
        try {
          if ((JSON.parse(opened) as { behind?: unknown }).behind === false) {
            behindNote = ' Aviso: la app se abrió delante; no se pudo dejar en segundo plano.'
          }
        } catch {
          // salida no JSON: sin aviso
        }
        return `Abierta ${name} en segundo plano (sin activarla ni traerla al frente).${behindNote}`
      }
      let hasWindow: boolean | undefined
      await act({ tool: 'open_application', text: name }, async () => {
        await helper('open-app', name)
        await sleep(800)
        // `activate` además reintenta desminimizar/reabrir una ventana (≤3 s) si no hay ninguna visible.
        try {
          const r = JSON.parse(await helper('activate', name)) as { hasWindow?: boolean }
          hasWindow = r.hasWindow
        } catch (err) {
          log('activate tras open-app:', err instanceof Error ? err.message : err)
        }
      })
      const front = JSON.parse(await helper('frontmost')) as { name?: string }
      const windowNote = hasWindow === false ? ' Aviso: no se detectó ninguna ventana visible; puede seguir minimizada o cerrada.' : ''
      return `Abierta ${name}. App en primer plano: ${front.name ?? '?'}.${windowNote}`
    }
  },
  {
    name: 'wait',
    description: 'Espera N segundos (máx. 10) para que la interfaz termine de cargar.',
    inputSchema: obj({ seconds: { type: 'number' }, ...SHOT_FLAG }, ['seconds']),
    action: true,
    run: async (a) => {
      const s = Math.max(0, Math.min(10, Number(a.seconds) || 1))
      await act({ tool: 'wait', text: `${s}s` }, () => sleep(s * 1000))
      return `Esperado ${s}s`
    }
  },
  {
    name: 'request_access',
    description:
      'Flujo Plan → Aprobar → Ejecutar: llámala AL PRINCIPIO de cada tarea, ANTES de tocar la pantalla o usar ' +
      'la terminal, los archivos o la web, con "plan" (tus pasos, en orden) y en "apps" la lista COMPLETA de ' +
      'apps que vas a necesitar (no solo una), con su nivel en "levels". Si la tarea NO controla ninguna app ' +
      '(solo terminal, archivos o web), envía el plan con "apps": []. Ninguna otra herramienta de acción (clic, ' +
      'teclear, capturar…) funciona hasta que el usuario apruebe esta tarjeta. También sirve, SIN "plan", a ' +
      'mitad de tarea si necesitas una app extra o un nivel mayor: llámala en cuanto una herramienta falle con ' +
      '"no tiene acceso concedido" o "nivel insuficiente". En todos los casos ESPERA a que el usuario responda ' +
      '(sin límite de tiempo: la tarea queda en pausa, no se cancela sola). Si el usuario pide cambios ' +
      '("Editar") en vez de aprobar, el resultado trae su feedback: replantea el plan y vuelve a llamar a ' +
      'request_access. Si cancela, no actúes y explícaselo.',
    inputSchema: obj(
      {
        apps: {
          type: 'array',
          items: { type: 'string' },
          description: 'Nombres de las apps, p.ej. ["Safari", "Terminal"]. Puede ser [] si envías "plan" y no controlas ninguna app.'
        },
        levels: {
          type: 'array',
          items: { type: 'string', enum: ['view', 'click', 'full'] },
          description:
            "Nivel que necesitas por app, mismo orden que apps: 'full' si vas a teclear, pulsar teclas o arrastrar; " +
            "'click' si solo clic o scroll; 'view' si solo mirar."
        },
        reason: { type: 'string', description: 'Por qué necesitas actuar sobre esas apps (se le muestra al usuario)' },
        plan: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Solo al principio de la tarea: tus pasos en orden (p.ej. ["Abrir Spotlight y buscar Discord", ' +
            '"Abrir el canal #pega", "Escribir un saludo"]). El usuario los ve y aprueba de una vez.'
        }
      },
      []
    ),
    action: false,
    run: async (a, session) => {
      // Acepta `apps: ["Discord"]` (+ `levels` en paralelo) y también `apps: [{ name, level }]`.
      const levels = Array.isArray(a.levels) ? a.levels : []
      const entries: Array<{ input: string; level: AppTier }> = []
      if (Array.isArray(a.apps)) {
        a.apps.slice(0, 10).forEach((raw, i) => {
          if (raw && typeof raw === 'object') {
            const o = raw as Record<string, unknown>
            const input = String(o.name ?? o.app ?? o.bundleId ?? '').trim()
            if (input) entries.push({ input, level: asTier(o.level ?? o.tier ?? levels[i]) ?? 'click' })
          } else {
            const input = String(raw ?? '').trim()
            if (input) entries.push({ input, level: asTier(levels[i]) ?? 'click' })
          }
        })
      }
      const plan = Array.isArray(a.plan)
        ? a.plan
            .map((x) => String(x).trim())
            .filter(Boolean)
            .slice(0, 30)
        : undefined
      const hasPlan = !!plan?.length
      if (!entries.length && !hasPlan) {
        throw new Error(
          'Indica al menos una app en "apps" o, si la tarea no controla ninguna app (solo terminal, archivos o web), ' +
            'un "plan" con "apps": [].'
        )
      }
      const resolved = await Promise.all(entries.map(async (e) => ({ ...e, ...(await resolveApp(e.input)) })))
      // Duplicados por bundleId: se conserva el nivel pedido más alto.
      const byId = new Map<string, AppRef & { requested: AppTier }>()
      for (const r of resolved) {
        if (!r.found) continue
        const prev = byId.get(r.bundleId)
        byId.set(r.bundleId, { bundleId: r.bundleId, name: prev?.name ?? r.name, requested: maxTier(prev?.requested, r.level) ?? r.level })
      }
      const valid = [...byId.values()]
      const missing = resolved.filter((r) => !r.found).map((r) => r.input)
      if (!valid.length && !hasPlan) {
        return backend.text.noAppsFound(missing)
      }
      const { decisions, feedback, cancelled, planApproved, auto } = await requestAccess(
        valid,
        typeof a.reason === 'string' ? a.reason.slice(0, 500) : undefined,
        plan,
        session,
        missing.length ? missing.slice(0, 10) : undefined
      )
      if (cancelled) {
        return 'El usuario canceló: no se concedió nada ni se aprobó el plan. No actúes; explícaselo y detente.'
      }
      if (feedback) {
        return (
          `El usuario pidió AJUSTES al plan (no lo aprobó): "${feedback}"\n` +
          'Replantea el plan y tus pasos según ese comentario, y vuelve a llamar a request_access con el plan actualizado.'
        )
      }
      const label = (d: string): string =>
        d === 'deny'
          ? 'denegado'
          : d === 'view'
            ? 'Solo ver'
            : d === 'click'
              ? 'Ver y clic'
              : d === 'full'
                ? 'Control total'
                : 'sin respuesta'
      const lines = valid.map((r) => {
        const d = decisions[r.bundleId] ?? ''
        const t = asTier(d)
        const short =
          t && TIER_RANK[t] < TIER_RANK[r.requested] ? ` (pediste "${TIER_LABEL[r.requested]}": si lo necesitas, díselo al usuario)` : ''
        return `- ${r.name}: ${label(d)}${short}`
      })
      if (missing.length) lines.push(`- (no identificadas: ${missing.join(', ')})`)
      const approvedApp = valid.some((r) => {
        const d = decisions[r.bundleId]
        return !!d && d !== 'deny'
      })
      let text = auto
        ? `Aprobado automáticamente por el modo auto (solo ver) para esta tarea: ${valid.map((r) => r.name).join(', ')}.`
        : lines.length
          ? `Respuesta del usuario:\n${lines.join('\n')}`
          : 'Respuesta del usuario: (sin apps en esta solicitud)'
      if (hasPlan) {
        text += planApproved
          ? '\n\nPlan aprobado: puedes actuar (terminal, archivos, web y las apps concedidas).'
          : '\n\nEl usuario NO aprobó el plan: no llames a ninguna otra herramienta de acción. Explícaselo y detente.'
      }
      // Contexto fresco tras la espera (que puede haber sido larga): reactiva la primera app
      // aprobada (main ya lo intentó, best-effort) y adjunta una captura para que el agente vea
      // dónde quedó todo antes de seguir.
      if (planApproved || approvedApp) {
        try {
          await sleep(400)
          const s = await takeScreenshot(true, session)
          return { text, shot: s }
        } catch {
          // sin captura: seguir solo con el texto
        }
      }
      return text
    }
  },

  // ───────────────────────────── Lote C: background por Accessibility API ─────────────────────────────

  {
    name: 'app_tree',
    description:
      'Árbol de accesibilidad de una app CONCRETA (por nombre o bundle id), SIN activarla ni mover el ratón: ' +
      'funciona en modo "En segundo plano". Cada nodo trae una "ref" (p.ej. "w0.2.1") que usan app_press, ' +
      'app_set_value y app_action; si la interfaz cambió, vuelve a pedir el árbol.',
    inputSchema: obj({ app: { type: 'string' }, max_depth: { type: 'number' }, max_nodes: { type: 'number' } }, ['app']),
    action: true,
    noAutoShot: true,
    run: async (a, session) => {
      const app = await namedApp(a.app)
      await requireTierFor(app, 'view', session)
      const maxDepth = Math.max(1, Math.min(30, Math.round(Number(a.max_depth) || 12)))
      const maxNodes = Math.max(1, Math.min(2000, Math.round(Number(a.max_nodes) || 500)))
      return JSON.stringify(await axTree(app.bundleId, maxDepth, maxNodes))
    }
  },
  {
    name: 'app_find',
    description:
      'Busca elementos en el árbol de accesibilidad de una app por rol, título o texto, SIN activarla ni mover ' +
      'el ratón. Devuelve como mucho "limit" coincidencias (≤50, por defecto 20).',
    inputSchema: obj(
      {
        app: { type: 'string' },
        role: { type: 'string', description: 'p.ej. "AXButton", "AXTextField"' },
        title: { type: 'string' },
        text: { type: 'string' },
        limit: { type: 'number' }
      },
      ['app']
    ),
    action: true,
    noAutoShot: true,
    run: async (a, session) => {
      const app = await namedApp(a.app)
      await requireTierFor(app, 'view', session)
      const query: Record<string, unknown> = { limit: Math.max(1, Math.min(50, Math.round(Number(a.limit) || 20))) }
      if (typeof a.role === 'string' && a.role) query.role = a.role
      if (typeof a.title === 'string' && a.title) query.title = a.title
      if (typeof a.text === 'string' && a.text) query.text = a.text
      return JSON.stringify(await axFind(app.bundleId, query))
    }
  },
  {
    name: 'app_press',
    description:
      'Pulsa (kAXPressAction) un elemento de una app por su "ref" (de app_tree/app_find), SIN mover el ratón ' +
      'real: funciona en segundo plano. Con expect_role/expect_title, si no coinciden falla en vez de pulsar ' +
      'algo distinto (vuelve a pedir app_tree/app_find y usa la referencia actual).',
    inputSchema: obj(
      { app: { type: 'string' }, ref: { type: 'string' }, expect_role: { type: 'string' }, expect_title: { type: 'string' } },
      ['app', 'ref']
    ),
    action: true,
    run: async (a, session) => {
      const app = await namedApp(a.app)
      await requireTierFor(app, 'click', session)
      const ref = String(a.ref ?? '')
      if (!ref) throw new Error('ref vacío')
      const expectRole = typeof a.expect_role === 'string' && a.expect_role ? a.expect_role : undefined
      const expectTitle = typeof a.expect_title === 'string' && a.expect_title ? a.expect_title : undefined
      await act({ tool: 'app_press', text: `${app.name} ${ref}` }, () => axPress(app.bundleId, ref, expectRole, expectTitle))
      return `Pulsado ${ref} en ${app.name}.`
    }
  },
  {
    name: 'app_set_value',
    description:
      'Escribe el valor (kAXValueAttribute) de un campo de una app por su "ref", SIN mover el ratón real. ' +
      'Rechaza campos de contraseña u otras entradas seguras. Nunca escribas contraseñas ni datos de pago.',
    inputSchema: obj({ app: { type: 'string' }, ref: { type: 'string' }, value: { type: 'string' }, expect_role: { type: 'string' } }, [
      'app',
      'ref',
      'value'
    ]),
    action: true,
    run: async (a, session) => {
      const app = await namedApp(a.app)
      await requireTierFor(app, 'full', session)
      const ref = String(a.ref ?? '')
      const value = String(a.value ?? '')
      if (!ref) throw new Error('ref vacío')
      if (value.length > 5000) throw new Error('value demasiado largo (máx. 5000 caracteres)')
      if (typeof a.expect_role === 'string' && a.expect_role) {
        const found = await axFind(app.bundleId, { role: a.expect_role, limit: 50 })
        if (!found.matches.some((m) => m.ref === ref)) {
          throw new Error(
            'El elemento cambió (el rol esperado no coincide): vuelve a pedir app_tree/app_find y usa la referencia (ref) actual.'
          )
        }
      }
      await act({ tool: 'app_set_value', text: `${app.name} ${ref}` }, () => axSetValue(app.bundleId, ref, value))
      return `Valor escrito en ${ref} de ${app.name} (${value.length} caracteres).`
    }
  },
  {
    name: 'app_insert_text',
    description:
      'AGREGA texto al final de un campo de una app por su "ref", SIN mover el ratón real y SIN tocar lo que ya había ' +
      '(a diferencia de app_set_value, que REEMPLAZA todo el valor) — úsala para añadir algo a una nota/documento que ' +
      'puede tener contenido rico (adjuntos, formato) que app_set_value perdería al reescribir todo como texto plano. ' +
      'Rechaza campos de contraseña u otras entradas seguras. Nunca escribas contraseñas ni datos de pago. Si el campo ' +
      'no soporta inserción por accesibilidad, falla con un mensaje claro — en ese caso, o usa app_set_value (con el ' +
      'valor actual + lo nuevo, si no hay riesgo de perder contenido rico) o pide control real de la pantalla.',
    inputSchema: obj({ app: { type: 'string' }, ref: { type: 'string' }, text: { type: 'string' }, expect_role: { type: 'string' } }, [
      'app',
      'ref',
      'text'
    ]),
    action: true,
    run: async (a, session) => {
      const app = await namedApp(a.app)
      await requireTierFor(app, 'full', session)
      const ref = String(a.ref ?? '')
      const text = String(a.text ?? '')
      if (!ref) throw new Error('ref vacío')
      if (!text) throw new Error('text vacío')
      if (text.length > 5000) throw new Error('text demasiado largo (máx. 5000 caracteres)')
      if (typeof a.expect_role === 'string' && a.expect_role) {
        const found = await axFind(app.bundleId, { role: a.expect_role, limit: 50 })
        if (!found.matches.some((m) => m.ref === ref)) {
          throw new Error(
            'El elemento cambió (el rol esperado no coincide): vuelve a pedir app_tree/app_find y usa la referencia (ref) actual.'
          )
        }
      }
      await act({ tool: 'app_insert_text', text: `${app.name} ${ref}` }, () => withAxTimeout(backend.insertAxText(app.bundleId, ref, text)))
      return `Agregado al final de ${ref} en ${app.name} (${text.length} caracteres).`
    }
  },
  {
    name: 'app_action',
    description: `Ejecuta una acción de accesibilidad sobre un elemento por su "ref": ${[...AX_ACTIONS].join(', ')}.`,
    inputSchema: obj({ app: { type: 'string' }, ref: { type: 'string' }, action: { type: 'string', enum: [...AX_ACTIONS] } }, [
      'app',
      'ref',
      'action'
    ]),
    action: true,
    run: async (a, session) => {
      const app = await namedApp(a.app)
      await requireTierFor(app, 'click', session)
      const ref = String(a.ref ?? '')
      const action = String(a.action ?? '')
      if (!ref) throw new Error('ref vacío')
      if (!AX_ACTIONS.has(action)) throw new Error(`action debe ser una de: ${[...AX_ACTIONS].join(', ')}`)
      await act({ tool: 'app_action', text: `${app.name} ${ref} ${action}` }, () => axAction(app.bundleId, ref, action))
      return `Acción ${action} ejecutada en ${ref} de ${app.name}.`
    }
  },
  {
    name: 'app_screenshot',
    description:
      'Captura solo la ventana de una app (por defecto la principal), SIN activarla ni mover el ratón — SOLO para ' +
      'mirar (confirmar que algo cargó, leer texto, ver si está tapada), NUNCA para sacar coordenadas de clic: no ' +
      'sabe dónde está esa ventana en la pantalla, así que un píxel de esta imagen no se puede convertir a un ' +
      'punto de clic. Para clicar algo, usa screenshot (captura de la pantalla principal) o find_element.',
    inputSchema: obj({ app: { type: 'string' }, window: { type: 'number' } }, ['app']),
    action: true,
    noAutoShot: true,
    run: async (a, session) => {
      const app = await namedApp(a.app)
      await requireTierFor(app, 'view', session)
      const windowIndex = Math.max(0, Math.round(Number(a.window) || 0))
      mkdirSync(SHOT_DIR, { recursive: true })
      const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const raw = join(SHOT_DIR, `raw-app-${stamp}.png`)
      // Prefijo "shot-": `cleanupShots()` la recoge igual que las capturas de pantalla completa.
      const out = join(SHOT_DIR, `shot-app-${stamp}.jpg`)
      try {
        const info = await backend.windowShot(app.bundleId, raw, out, windowIndex)
        const base64 = readFileSync(out).toString('base64')
        cleanupShots()
        return {
          text:
            `Ventana de ${app.name}: ${info.width}x${info.height} px${info.title ? ` («${info.title}»)` : ''}. ` +
            'Solo para mirar: esta imagen NO sirve para sacar coordenadas de clic (no sabe dónde está la ventana ' +
            'en la pantalla). Para clicar algo, usa screenshot o find_element. Archivo: ' +
            out,
          shot: { path: out, base64, width: info.width, height: info.height, ratio: await ensureRatio() }
        }
      } finally {
        rmSync(raw, { force: true })
      }
    }
  },
  {
    name: 'find_element',
    description:
      'Localiza UN elemento clicable por su texto visible (título, etiqueta, valor o identificador) usando ' +
      'Accessibility (AX), sin tocar la pantalla. Úsala ANTES de adivinar coordenadas mirando una captura: si ' +
      'encuentra el elemento, sus coordenadas son exactas y puedes pasarlas directo a left_click/mouse_move/' +
      'type_text. Devuelve hasta 5 candidatos ordenados de más a menos fiable, o dice que no encontró nada ' +
      '(algunas apps con interfaz personalizada, juegos o ciertas apps Electron no exponen bien su árbol AX: en ' +
      'ese caso sigue con la captura de pantalla, es un respaldo normal, no un fallo).',
    inputSchema: obj(
      {
        description: { type: 'string', description: 'Texto visible del elemento, p.ej. "Guardar" o "Buscar en la web"' },
        appHint: { type: 'string', description: 'Nombre o bundle id de la app (opcional; por defecto la app en primer plano)' }
      },
      ['description']
    ),
    action: true,
    noAutoShot: true,
    run: async (a, session) => {
      const description = String(a.description ?? '').trim()
      if (!description) throw new Error('description vacío')
      if (description.length > 200) throw new Error('description demasiado largo (máx. 200 caracteres)')
      const appHint = typeof a.appHint === 'string' ? a.appHint.trim() : ''
      const app = appHint ? await namedApp(appHint) : await appFrontmostOrThrow()
      await requireTierFor(app, 'click', session)
      const candidates = await findElementCandidates(app, description)
      if (!candidates.length) {
        return (
          `No encontrado por AX: ningún elemento de ${app.name} coincide con "${description}". Usa la captura ` +
          '(computer_screenshot) y adivina las coordenadas por visión como de costumbre.'
        )
      }
      const elRatio = await ensureRatio()
      const lines = candidates.map(({ el }, i) => describeElement(el, i, elRatio))
      return (
        `${candidates.length} candidato(s) en ${app.name} (AX) para "${description}", de más a menos fiable:\n` +
        `${lines.join('\n')}\n` +
        'Usa el punto indicado con left_click/mouse_move y verifica con una captura después de actuar.'
      )
    }
  },
  {
    name: 'list_elements',
    description:
      'Lista elementos de accesibilidad (AX) de las ventanas de una app, opcionalmente filtrados por rol ' +
      '(p.ej. "button,textfield,checkbox"), para explorarla sin ir adivinando sobre la captura. Sin filtro de ' +
      'texto: si buscas un elemento concreto por su texto usa find_element.',
    inputSchema: obj(
      {
        appHint: { type: 'string', description: 'Nombre o bundle id de la app (opcional; por defecto la app en primer plano)' },
        role: { type: 'string', description: 'Roles separados por coma, p.ej. "button,textfield" (opcional)' }
      },
      []
    ),
    action: true,
    noAutoShot: true,
    run: async (a, session) => {
      const appHint = typeof a.appHint === 'string' ? a.appHint.trim() : ''
      const app = appHint ? await namedApp(appHint) : await appFrontmostOrThrow()
      await requireTierFor(app, 'click', session)
      const roles =
        typeof a.role === 'string' && a.role.trim()
          ? a.role
              .split(',')
              .map((r) => r.trim())
              .filter(Boolean)
          : undefined
      const elements = await findElementsHelper(app.bundleId, { roles })
      if (!elements.length) return `Sin elementos visibles${roles ? ` de rol ${roles.join(',')}` : ''} en ${app.name} (AX).`
      const capped = elements.slice(0, 60)
      const listRatio = await ensureRatio()
      const lines = capped.map((el, i) => describeElement(el, i, listRatio))
      const suffix = elements.length > capped.length ? `\n… y ${elements.length - capped.length} más (afina con "role").` : ''
      return `${elements.length} elemento(s) en ${app.name}${roles ? ` (rol: ${roles.join(',')})` : ''}:\n${lines.join('\n')}${suffix}`
    }
  },
  {
    name: 'request_full_control',
    description:
      'Pide tomar el ratón y el teclado REALES para <app> (tarjeta "¿Tomar el control de la pantalla?"), solo ' +
      'necesario en modo "En segundo plano" cuando app_press/app_set_value no bastan (arrastrar, atajos de ' +
      'teclado complejos…). En modo "Control de la pantalla" ya los tienes: no hace falta llamarla.',
    inputSchema: obj({ app: { type: 'string' }, reason: { type: 'string' } }, ['app', 'reason']),
    action: true,
    noAutoShot: true,
    run: async (a, session) => {
      const app = await namedApp(a.app)
      const { mode, foreground } = await controlMode(session)
      if (mode === 'full') return 'Ya tienes control de la pantalla (el modo no es "En segundo plano"): no hace falta pedirlo.'
      if (foreground) return `Ya tienes el control del ratón y el teclado en esta tarea para ${app.name}.`
      const reason = typeof a.reason === 'string' ? a.reason.slice(0, 500) : undefined
      const { decisions, cancelled } = await requestAccess(
        [{ ...app, requested: 'full' }],
        reason,
        undefined,
        session,
        undefined,
        'takeover'
      )
      if (cancelled) {
        return (
          'El usuario prefirió seguir en segundo plano: NO tienes el control del ratón ni el teclado. ' +
          'Sigue con app_find/app_press/app_set_value.'
        )
      }
      // "Permitir" en la tarjeta de takeover responde SIN decisiones por app (`decisions: []`): main marca
      // la sesión como foreground, pero `decisions` llega vacío. Fiarse solo de `decisions` le decía al
      // modelo «no concedió» aunque el usuario hubiera aceptado, y el agente se rendía (sesiones reales de
      // Discord). La fuente de verdad es el estado de la sesión en main.
      const got =
        Object.values(decisions).some((d) => !!d && d !== 'deny') ||
        (await controlMode(session)
          .then((m) => m.foreground)
          .catch(() => false))
      return got
        ? `El usuario permitió tomar el control del ratón y el teclado para ${app.name}. Ya puedes usar left_click/type_text/key.`
        : 'El usuario no concedió el control: sigue con app_find/app_press/app_set_value.'
    }
  },
  {
    name: 'teach_step',
    description:
      'Modo guía: muestra un globo junto a un punto o elemento y EXPLICA qué harías, SIN hacer clic ni ' +
      'escribir nada. Usa "app"+"ref" (de app_tree/app_find) para señalar un elemento concreto, o "x"/"y" en px ' +
      'de la última captura. Llama a esta herramienta paso a paso y espera a que el usuario pulse "Siguiente" ' +
      'antes de describir el paso siguiente.',
    inputSchema: obj(
      {
        text: { type: 'string', description: '1 a 400 caracteres' },
        title: { type: 'string' },
        x: { type: 'number' },
        y: { type: 'number' },
        app: { type: 'string' },
        ref: { type: 'string' },
        step: { type: 'number' },
        total: { type: 'number' }
      },
      ['text']
    ),
    action: true,
    noAutoShot: true,
    run: async (a, session) => {
      const text = String(a.text ?? '').trim()
      if (!text || text.length > 400) throw new Error('text debe tener entre 1 y 400 caracteres')
      let x: number | undefined
      let y: number | undefined
      const appArg = typeof a.app === 'string' ? a.app.trim() : ''
      const refArg = typeof a.ref === 'string' ? a.ref.trim() : ''
      if (appArg && refArg) {
        const app = await namedApp(appArg)
        await requireTierFor(app, 'view', session)
        const { frame } = await axFrame(app.bundleId, refArg)
        x = frame.x + frame.width / 2
        y = frame.y + frame.height / 2
      } else if (typeof a.x === 'number' && typeof a.y === 'number') {
        const p = await toPoints(a.x, a.y)
        x = p.x
        y = p.y
      }
      const action = await postTeachStep({
        text,
        title: typeof a.title === 'string' ? a.title.slice(0, 200) : undefined,
        step: typeof a.step === 'number' ? a.step : undefined,
        total: typeof a.total === 'number' ? a.total : undefined,
        x,
        y,
        session
      })
      return action === 'exit'
        ? 'El usuario pulsó "Salir de la guía": no sigas describiendo más pasos.'
        : 'El usuario pulsó "Siguiente": continúa con el paso siguiente.'
    }
  },
  {
    name: 'teach_end',
    description: 'Termina el modo guía (cierra el globo). Llámala al terminar la guía o si el usuario cambia de tema.',
    inputSchema: obj({}),
    action: true,
    noAutoShot: true,
    run: async () => {
      await postTeachEnd()
      return 'Modo guía terminado.'
    }
  }
]

// Serializa TODA llamada a `callTool`, una por vez — nunca dos acciones nativas (clic/tipeo/captura)
// corriendo a la vez. Antes del arreglo del timeout de arriba, un reintento de OpenCode (porque el
// anterior ya había "timeado" del lado de él, aunque el clic/tipeo seguía corriendo de verdad en el
// helper) podía superponerse con la llamada original — dos acciones de teclado/mouse reales peleando
// por la misma sesión al mismo tiempo. Con el timeout ya arreglado esto debería ser rarísimo, pero una
// cola es la red de seguridad correcta para control de mouse/teclado real: nunca vale la pena arriesgar
// una acción doble por ahorrarse una cola.
let toolQueue: Promise<unknown> = Promise.resolve()

async function callTool(name: string, rawArgs: Record<string, unknown>): Promise<ToolResult> {
  const run = (): Promise<ToolResult> => callToolNow(name, rawArgs)
  const result = toolQueue.then(run, run)
  toolQueue = result.then(
    () => undefined,
    () => undefined
  )
  return result
}

async function callToolNow(name: string, rawArgs: Record<string, unknown>): Promise<ToolResult> {
  // `lazunox_session` lo inyecta el plugin `lazunox-plan-gate` (sesión de OpenCode que llama): se separa
  // de los args para que ninguna herramienta lo vea como parámetro propio.
  const { lazunox_session, ...args } = rawArgs
  const session = typeof lazunox_session === 'string' && lazunox_session ? lazunox_session : undefined
  const tool = TOOLS.find((t) => t.name === name)
  if (!tool) return { content: [{ type: 'text', text: `Herramienta desconocida: ${name}` }], isError: true }
  try {
    if (await isStopped()) return { content: [{ type: 'text', text: STOPPED_MSG }], isError: true }
  } catch (err) {
    return { content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }], isError: true }
  }
  try {
    // Puertas propias de la plataforma (Windows: consentimiento de la app, sesión interactiva, ventana elevada); macOS: ninguna.
    await backend.preflight({ tool: name, realInput: REAL_INPUT_TOOLS.has(name) })
    // Flujo Plan → Aprobar → Ejecutar: ninguna herramienta de ACCIÓN (tampoco `screenshot`) corre sin
    // un plan aprobado para esta sesión.
    if (tool.action) await requirePlanApproved(session)
    if (name === 'screenshot') {
      const s = await takeScreenshot(false, session)
      const content: Content[] = [
        { type: 'image', data: s.base64, mimeType: 'image/jpeg' },
        { type: 'text', text: shotText(s) }
      ]
      if (args?.elements !== false) {
        const block = await elementsBlock(s, session, 40)
        if (block) content.push({ type: 'text', text: block })
      }
      return { content }
    }
    const result = await tool.run(args, session)
    const text = typeof result === 'string' ? result : result.text
    const content: Content[] = [{ type: 'text', text }]
    if (typeof result !== 'string') {
      content.unshift({ type: 'image', data: result.shot.base64, mimeType: 'image/jpeg' })
      // `shotText` describe una captura de PANTALLA COMPLETA ("Captura de la pantalla principal…") —
      // `app_screenshot` devuelve una ventana recortada, no la pantalla; agregarle esa frase la
      // etiquetaba mal (y encima contradecía la advertencia de NO clicar con esas coordenadas que ya
      // trae su propio `text`, arriba). El resto de las herramientas que alguna vez devuelvan
      // `{text, shot}` de una captura de pantalla de verdad SÍ la siguen llevando.
      if (name !== 'app_screenshot' && name !== 'zoom') content.push({ type: 'text', text: shotText(result.shot) })
    }
    const wantShot = tool.action && !tool.noAutoShot && AUTO_SHOT && args?.screenshot !== false
    if (wantShot) {
      await sleep(SETTLE_MS)
      if (await isStopped().catch(() => true)) {
        content.push({ type: 'text', text: STOPPED_MSG })
      } else {
        try {
          const s = await takeScreenshot(true, session)
          content.unshift({ type: 'image', data: s.base64, mimeType: 'image/jpeg' })
          content.push({ type: 'text', text: shotText(s) })
          // Tras una acción la interfaz cambió: la lista anterior ya no vale; se ofrece la nueva (más corta que en un screenshot).
          const block = await elementsBlock(s, session, 30)
          if (block) content.push({ type: 'text', text: block })
        } catch (err) {
          content.push({ type: 'text', text: `(sin captura: ${err instanceof Error ? err.message : err})` })
        }
      }
    }
    return { content }
  } catch (err) {
    return { content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }], isError: true }
  }
}

// ───────────────────────────── JSON-RPC ─────────────────────────────

interface RpcRequest {
  jsonrpc: '2.0'
  id?: number | string | null
  method: string
  params?: Record<string, unknown>
}

type RpcResponse =
  | { jsonrpc: '2.0'; id: number | string | null; result: unknown }
  | { jsonrpc: '2.0'; id: number | string | null; error: { code: number; message: string } }

const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05']

/** Atiende un mensaje JSON-RPC. Devuelve la respuesta o null (notificaciones). */
async function dispatch(req: RpcRequest): Promise<RpcResponse | null> {
  const id = req.id ?? null
  const isNotification = req.id === undefined || req.id === null
  const ok = (result: unknown): RpcResponse => ({ jsonrpc: '2.0', id, result })
  const error = (code: number, message: string): RpcResponse | null =>
    isNotification ? null : { jsonrpc: '2.0', id, error: { code, message } }
  try {
    switch (req.method) {
      case 'initialize': {
        const asked = String(req.params?.protocolVersion ?? '')
        return ok({
          protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'lazunox-computer', version: '0.2.0' },
          instructions: backend.text.instructions
        })
      }
      case 'ping':
        return ok({})
      case 'tools/list':
        return ok({
          tools: TOOLS.map((t) => ({
            name: t.name,
            description: backend.text.toolDescriptions[t.name] ?? t.description,
            inputSchema: t.inputSchema
          }))
        })
      case 'tools/call': {
        const name = String(req.params?.name ?? '')
        const args = req.params?.arguments
        const safeArgs = args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {}
        return ok(await callTool(name, safeArgs))
      }
      case 'resources/list':
        return ok({ resources: [] })
      case 'prompts/list':
        return ok({ prompts: [] })
      default:
        return isNotification ? null : error(-32601, `Método no soportado: ${req.method}`)
    }
  } catch (err) {
    log('error', err)
    return error(-32603, String(err))
  }
}

// ───────────────────────── transporte HTTP (streamable) ─────────────────────────
//
// MCP "Streamable HTTP" mínimo en 127.0.0.1: `POST /mcp` con un mensaje (o lote) JSON-RPC →
// respuesta `application/json` (el cliente acepta JSON o SSE; aquí nunca hace falta streaming);
// notificaciones → 202. `GET`/`DELETE` → 405 (sin stream de servidor ni sesiones).
// Autenticación: `Authorization: Bearer <COMPUTER_MCP_TOKEN>` (comparación en tiempo constante).
// Se rechaza cualquier petición con `Origin` (un navegador) o con un `Host` que no sea el nuestro
// (DNS rebinding).

const TOKEN = process.env.COMPUTER_MCP_TOKEN ?? ''
const PORT = Number(process.env.COMPUTER_MCP_PORT ?? '0')
const MAX_BODY = 1024 * 1024

function tokenOk(header: string | undefined): boolean {
  if (!TOKEN || !header?.startsWith('Bearer ')) return false
  const a = Buffer.from(header.slice(7))
  const b = Buffer.from(TOKEN)
  return a.length === b.length && timingSafeEqual(a, b)
}

function reply(res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}): void {
  res.statusCode = status
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
  if (body === undefined) {
    res.end()
    return
  }
  res.setHeader('content-type', 'application/json')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

function handleHttp(req: IncomingMessage, res: ServerResponse, port: number): void {
  const url = req.url ?? ''
  if (url !== '/mcp' && !url.startsWith('/mcp?')) return reply(res, 404)
  if (req.headers.origin) return reply(res, 403, { error: 'origin not allowed' })
  const host = req.headers.host ?? ''
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return reply(res, 403, { error: 'bad host' })
  if (!tokenOk(req.headers.authorization)) return reply(res, 401, { error: 'unauthorized' }, { 'www-authenticate': 'Bearer' })
  if (req.method !== 'POST') return reply(res, 405, undefined, { allow: 'POST' })

  const chunks: Buffer[] = []
  let size = 0
  req.on('data', (c: Buffer) => {
    size += c.length
    if (size > MAX_BODY) {
      reply(res, 413)
      req.destroy()
      return
    }
    chunks.push(c)
  })
  req.on('end', () => {
    if (res.writableEnded) return
    let parsed: unknown
    try {
      parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      return reply(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
    }
    const batch = Array.isArray(parsed)
    const list: unknown[] = Array.isArray(parsed) ? parsed : [parsed]
    const msgs = list.filter((m): m is RpcRequest => !!m && typeof m === 'object' && typeof (m as RpcRequest).method === 'string')
    // Solo respuestas/notificaciones → 202 sin cuerpo.
    void Promise.all(msgs.map(dispatch)).then((out) => {
      const responses = out.filter((r): r is RpcResponse => r !== null)
      if (!responses.length) return reply(res, 202)
      reply(res, 200, batch ? responses : responses[0])
    })
  })
}

interface ParentPort {
  postMessage(message: unknown): void
  on(event: 'message', listener: (e: { data: unknown }) => void): void
}

function main(): void {
  if (!TOKEN || TOKEN.length < 32) {
    log('falta COMPUTER_MCP_TOKEN')
    process.exit(2)
  }
  const server = createServer((req, res) => {
    const port = (server.address() as AddressInfo | null)?.port ?? 0
    try {
      handleHttp(req, res, port)
    } catch (err) {
      log('http', err)
      if (!res.headersSent) reply(res, 500)
    }
  })
  // Acciones largas (tecleo de 5000 caracteres, esperas): sin timeouts de petición del servidor.
  server.requestTimeout = 0
  server.headersTimeout = 30_000
  server.keepAliveTimeout = 60_000
  const parent = (process as unknown as { parentPort?: ParentPort }).parentPort
  server.on('error', (err) => {
    log('no se pudo escuchar:', err)
    parent?.postMessage({ type: 'error', message: String(err) })
    process.exit(1)
  })
  server.listen(PORT, '127.0.0.1', () => {
    const { port } = server.address() as AddressInfo
    log(`listo en 127.0.0.1:${port} (helper=${HELPER || '—'}, events=${EVENTS_URL ? 'sí' : 'no'})`)
    // utilityProcess: avisar a main; ejecución suelta (pruebas con node): imprimir el puerto.
    if (parent) parent.postMessage({ type: 'ready', port })
    else process.stdout.write(JSON.stringify({ type: 'ready', port }) + '\n')
  })
  // Si main nos pide salir (o muere), se cierra limpio.
  parent?.on('message', (e) => {
    if ((e.data as { type?: string } | null)?.type === 'shutdown') {
      killChildren()
      server.close()
      // Cierre ordenado: el backend suelta la entrada si hace falta (Windows: `release-input`), con tope de 1,5 s.
      void Promise.race([backend.shutdown().catch(() => undefined), sleep(1500)]).then(() => setTimeout(() => process.exit(0), 200).unref())
    }
  })
}

main()

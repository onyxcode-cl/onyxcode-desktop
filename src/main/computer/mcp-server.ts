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
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isRemoteClientApp } from '../../shared/remote-clients'
import { pickMenuNode, type MenuNodeLike } from './menu-path'
import {
  isolatedPasteKey,
  type AppRef,
  type AppTier,
  type PlatformBackend,
  type PlatformHost,
  type Rect,
  type Screen
} from './mcp-platform'
import { createDarwinBackend } from './mcp-platform-darwin'
import { checkWinIsolatedCombo, createWin32Backend, isWinIsolatedExempt } from './mcp-platform-win32'
import {
  ActionLog,
  captureIsStale,
  computeVerdict,
  coverageNotice,
  diffSignatures,
  formatVerdict,
  hasChanged,
  noticeAppName,
  pollProbe,
  probeSignature,
  probeTimeoutMs,
  readRegularFile,
  textKey,
  verdictEnabled,
  type ActionKind,
  type ActionTarget,
  type PollResult,
  type ProbeDiff,
  type ProbeSignature,
  type Verdict
} from './window-probe'

const HELPER = process.env.CU_HELPER ?? ''
const STOP_FILE = process.env.COMPUTER_STOP_FILE ?? ''
const EVENTS_URL = process.env.COMPUTER_EVENTS_URL ?? ''
const AUTO_SHOT = process.env.COMPUTER_AUTO_SCREENSHOT !== '0'
const MAX_LONG = Math.max(400, Number(process.env.COMPUTER_MAX_LONG_SIDE) || 1366)
const SHOT_DIR = process.env.COMPUTER_SHOT_DIR || join(tmpdir(), 'lazunox-computer')

/**
 * Borra un archivo temporal sin que un fallo tumbe nada. La carpeta de capturas es escribible por el agente aislado: si cambia un archivo
 * por una carpeta o un enlace, `rmSync` lanza (EISDIR…) y, dentro de un temporizador o de un `finally`, tumbaría el MCP.
 */
function safeRm(path: string | undefined): void {
  if (!path) return
  try {
    rmSync(path, { force: true })
  } catch {
    // ignorar: es un temporal; peor caso, queda un archivo suelto que `cleanupShots` o el sistema limpian
  }
}

/** Lee una imagen que escribió el helper en la carpeta de capturas: archivo regular, sin seguir enlaces y con tope de tamaño. */
const readShotFile = (path: string): Buffer => readRegularFile(path)

/** Nombre impredecible (16 bytes aleatorios) para temporales que el helper abre FUERA del sandbox; nunca se muestra al modelo. */
const secretName = (): string => randomBytes(16).toString('hex')
const FAKE_SHOT = process.env.COMPUTER_FAKE_SCREENSHOT ?? ''
const INSTANT = process.env.COMPUTER_INSTANT === '1'
const TYPE_DELAY = process.env.COMPUTER_TYPE_DELAY_MS ?? ''
const SETTLE_MS = 450
const STOPPED_MSG = 'Control detenido por el usuario'
const UNVERIFIED_MSG = 'No se pudo verificar el estado del kill-switch con Lazunox; acción rechazada'
const STATE_CACHE_MS = 200
/** Por debajo de esto sin pulsar el teclado real, se considera "el usuario está escribiendo ahora". */
const TYPING_PAUSE_SECONDS = 1.2

// ───────────────────────────── modo unificado: origen aislado (puente de apps) ─────────────────────────────
//
// Con `LAZUNOX_UNIFIED_APPS=1` el proxy de main reenvía a este MCP las peticiones del servidor AISLADO («Una carpeta») con dos cabeceras:
// el secreto del puente y la `serverKey` del servidor. Este proceso NO conoce el secreto: se las manda tal cual a main (`POST /bridge-check`),
// que las compara en tiempo constante. Sin cabecera, o con una que main no reconoce, TODO sigue como siempre (plan obligatorio).
// Con origen aislado no hay puerta del plan (la contención de comandos/archivos la hace el sandbox), pero TODA acción exige sesión válida
// de ese servidor y la concesión por app del nivel necesario (incluido `open_application`). Los literales DUPLICAN los de
// `src/shared/unified-bridge.ts` (este bundle no importa módulos de la app); `bridge-consistency.test.ts` comprueba que coinciden.
const BRIDGE_ORIGIN_HEADER = 'x-lazunox-bridge'
const BRIDGE_SERVER_HEADER = 'x-lazunox-server'

interface BridgeHeaders {
  origin: string
  server: string
}

/** Las llamadas se serializan (`toolQueue`): estas variables describen la llamada en curso. */
let isolatedCall = false
let currentToolName = ''
/** Sesión que hizo la última captura de pantalla completa (un origen aislado no puede hacer `zoom` sobre la de otra sesión). */
let lastShotSession: string | undefined

/** Origen aislado: la pantalla completa puede mostrar el escritorio (Finder lo dibuja como capa, no como ventana) y otras apps. */
const ISOLATED_SCREEN_REJECT_MSG =
  'En este modo solo se puede capturar una app concedida: usa app_screenshot (no hay capturas de pantalla completa ni zoom de pantalla).'

const BRIDGE_REJECT_MSG: Record<string, string> = {
  'bad-session': 'Esta petición no trae una sesión válida: no se actúa sobre apps. Reinicia la tarea e inténtalo de nuevo.',
  'foreign-session': 'Esta sesión no corresponde a este servidor: no se actúa sobre apps.',
  'bad-server': 'No se pudo identificar el servidor de origen de la petición: no se actúa sobre apps.'
}

/** Pregunta a main si la petición es de origen aislado y, si lo es, si su sesión vale. Falla cerrado si main no responde. */
async function bridgeCheck(b: BridgeHeaders, session: string | undefined): Promise<{ isolated: boolean; ok: boolean; reason?: string }> {
  if (!EVENTS_URL) throw new Error(UNVERIFIED_MSG)
  try {
    const r = await fetch(`${EVENTS_URL}/bridge-check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ origin: b.origin, server: b.server, session: session ?? '' }),
      signal: AbortSignal.timeout(1500)
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const j = (await r.json()) as { isolated?: unknown; ok?: unknown; reason?: unknown }
    return { isolated: j.isolated === true, ok: j.ok === true, reason: typeof j.reason === 'string' ? j.reason : undefined }
  } catch (err) {
    log('bridge-check:', err instanceof Error ? err.message : err)
    throw new Error(UNVERIFIED_MSG)
  }
}

/** Avisa a main de un rechazo de origen aislado (auditoría); sin esperar y sin lanzar. */
function reportBridgeDenied(reason: string, session: string | undefined): void {
  if (!EVENTS_URL) return
  void fetch(`${EVENTS_URL}/bridge-denied`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tool: currentToolName, session: session ?? '', reason }),
    signal: AbortSignal.timeout(1500)
  }).catch(() => undefined)
}

/**
 * Error de rechazo con código estable. En origen aislado avisa a main (auditoría) y antepone `[rechazo: <código>]` al mensaje, para que el
 * modelo reconozca el motivo sin depender de la frase. Fuera del origen aislado devuelve el mismo error de siempre, sin prefijo ni aviso
 * (los mensajes de `ensureTier`/`requireTier` los comparte Control total y no pueden cambiar).
 */
function reject(code: string, msg: string, session: string | undefined): Error {
  if (!isolatedCall) return new Error(msg)
  reportBridgeDenied(code, session)
  return new Error(`[rechazo: ${code}] ${msg}`)
}

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

/** Última app al frente vista (con su hora): evita un proceso extra solo para saber cuánto esperar antes de la captura automática. */
let lastFront: { app: AppRef; at: number } | null = null
const LAST_FRONT_TTL_MS = 8_000

async function appFrontmost(): Promise<AppRef> {
  const app = backend.parseApp(JSON.parse(await helper('frontmost')))
  lastFront = { app, at: Date.now() }
  return app
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
  // Origen aislado: main solo cuenta la concesión de SESIÓN (sin autoasignación ni concesiones guardadas ni apps exentas del sistema).
  if (isolatedCall) params.set('isolated', '1')
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
  // Origen aislado: la propia Lazunox, Electron, Spotlight, Dock… (exentas del sistema) NUNCA se actúan (ni siquiera con tarjeta).
  if (isolatedCall && app.bundleId && isIsolatedExempt(app.bundleId)) {
    throw reject(
      'exempt-app',
      `«${app.name}» es una app del sistema o la propia Lazunox: en este modo no se puede controlar. No insistas ni pidas acceso a ella; ` +
        'usa otras apps (con request_access) o dile al usuario que lo haga él.',
      session
    )
  }
  const tier = await tierOf(app, session)
  if (tier === null) {
    throw reject(
      'no-grant',
      `«${app.name}» no tiene acceso concedido. Llama a request_access con apps: ["${app.name}"] y ` +
        `levels: ["${minTier}"] (y un motivo), y espera la respuesta del usuario antes de reintentar esta acción.`,
      session
    )
  }
  if (TIER_RANK[tier] < TIER_RANK[minTier]) {
    throw reject(
      'low-tier',
      `«${app.name}» solo tiene el nivel "${TIER_LABEL[tier]}"; esta acción necesita "${TIER_LABEL[minTier]}". ` +
        `Pide más acceso: llama a request_access con apps: ["${app.name}"] y levels: ["${minTier}"], y espera la respuesta del usuario.`,
      session
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
async function requireTier(minTier: AppTier, point?: { x: number; y: number }, session?: string): Promise<AppRef | undefined> {
  const front = await appFrontmost()
  const apps = [front]
  if (point) {
    const at = await appAtPoint(point.x, point.y)
    if (at.bundleId && at.bundleId !== apps[0]?.bundleId) apps.push(at)
    else if (!at.bundleId && (backend.failClosedOnUnknownApp || isolatedCall)) apps.push(at) // Windows: lo no identificado no se deja pasar
  }
  const known = apps.filter((a) => a.bundleId)
  // Windows falla cerrado: una ventana que no se identifica puede ser una bloqueada o de administrador. Origen aislado: igual en macOS.
  if ((backend.failClosedOnUnknownApp || isolatedCall) && known.length < apps.length) {
    throw reject(
      'unknown-app',
      'No se pudo identificar la ventana de destino: por seguridad no se actúa. Pide al usuario que enfoque una app concreta.',
      session
    )
  }
  if (!known.length) {
    // Origen aislado: lo no identificado no se deja pasar (puede ser una app exenta o sin concesión).
    if (isolatedCall) {
      throw reject(
        'unknown-app',
        'No se pudo identificar la app de destino: por seguridad no se actúa. Pide al usuario que enfoque una app concreta.',
        session
      )
    }
    return undefined // no se pudo identificar ninguna app (p. ej. el Escritorio): no bloquear
  }
  // Origen aislado con el control acotado por la tarjeta de una app (sin toma de control): el Finder/Explorador no se manejan con el ratón
  // ni el teclado reales (doble clic en un script, arrastrar a LaunchAgents…): eso exige la tarjeta explícita de `request_full_control`.
  if (isolatedCall && known.some((a) => isFileManagerApp(a.bundleId))) {
    const { scoped } = await controlMode(session)
    if (scoped) {
      throw reject(
        'file-manager',
        'El Finder/Explorador de archivos no se maneja con el ratón y el teclado reales con el permiso de una app: ' +
          'si de verdad hace falta, llama a request_full_control y espera la respuesta del usuario; si no, usa app_find/app_press.',
        session
      )
    }
  }
  for (const a of known) await ensureTier(a, minTier, session)
  return front
}

/** Gestores de archivos (Finder, Explorador de Windows): desde ellos se abren y ejecutan archivos. */
function isFileManagerApp(bundleId: string | undefined): boolean {
  const id = (bundleId ?? '').toLowerCase()
  return id === 'com.apple.finder' || id.includes('explorer.exe')
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

async function controlMode(session?: string): Promise<{ mode: 'background' | 'full'; foreground: boolean; scoped: boolean }> {
  if (!EVENTS_URL) return { mode: 'full', foreground: true, scoped: false } // sin main que consultar (pruebas sueltas): no bloquear
  try {
    // Origen aislado: main ignora la preferencia global «Control de la pantalla»; solo vale un `request_full_control` aprobado de esa sesión.
    const q = session ? `?session=${encodeURIComponent(session)}${isolatedCall ? '&isolated=1' : ''}` : isolatedCall ? '?isolated=1' : ''
    const r = await fetch(`${EVENTS_URL}/control-mode${q}`, { signal: AbortSignal.timeout(1500) })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const j = (await r.json()) as { mode?: unknown; foreground?: unknown; scoped?: unknown }
    return { mode: j.mode === 'background' ? 'background' : 'full', foreground: j.foreground === true, scoped: j.scoped === true }
  } catch (err) {
    log('control-mode:', err instanceof Error ? err.message : err)
    throw new Error(UNVERIFIED_MSG)
  }
}

/** Rechaza las herramientas de ratón/teclado real si el modo es "segundo plano" sin foreground. */
async function requireForeground(session?: string): Promise<void> {
  const { mode, foreground } = await controlMode(session)
  if ((mode === 'background' || isolatedCall) && !foreground) throw new Error(BACKGROUND_REJECT_MSG)
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
  let r: Response
  try {
    r = await fetch(`${EVENTS_URL}/request-access`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ apps, reason, plan, session, unresolved, kind }),
      // El cliente (OpenCode) corta una llamada MCP a los ~5 min con «The operation timed out»: se vuelve ANTES, con `retry`, y el agente repite.
      signal: AbortSignal.timeout(ACCESS_WAIT_MAX_MS)
    })
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      return { decisions: {}, cancelled: false, planApproved: false, retry: true }
    }
    throw err
  }
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
    auto: j.auto === true,
    blocked: Array.isArray(j.blocked)
      ? j.blocked.filter((b): b is BlockedReply => !!b && typeof b.bundleId === 'string' && typeof b.name === 'string')
      : undefined
  }
}

/** App de la petición que main NO dejó pedir (bloqueada): ver `BlockedApp` en `computer/service.ts`. */
interface BlockedReply {
  bundleId: string
  name: string
  kind: 'fixed' | 'user' | 'session'
}

/**
 * Texto FIRME para el agente cuando una app está bloqueada (sin tarjeta). Fijo y sin variantes: el agente no debe pedirla
 * otra vez ni rodear el bloqueo con otra app, comando o vía; solo informar a la persona y seguir sin ella.
 */
function blockedMessage(b: BlockedReply): string {
  const who = b.kind === 'fixed' ? 'por seguridad' : b.kind === 'session' ? 'por la persona SOLO para esta tarea' : 'por la persona'
  return (
    `${b.name} está bloqueada ${who}. No la pidas de nuevo ni intentes usarla por ninguna vía (otra aplicación, script, navegador, comando o atajo) ` +
    'para lograr lo mismo; infórmale que está bloqueada y sigue sin ella.'
  )
}

/** Respuesta de main a una tarjeta `request_access` (ver `AccessResponse` en `computer/service.ts`). */
interface AccessReply {
  decisions: Record<string, string>
  feedback?: string
  cancelled: boolean
  planApproved: boolean
  /** Lote C: se concedió sin tarjeta, por el Modo auto ("Solo ver" efímero para esta tarea). */
  auto?: boolean
  /** Apps de la petición bloqueadas (no entraron en la tarjeta): el agente no debe pedirlas ni rodearlas. */
  blocked?: BlockedReply[]
  /** El usuario aún no respondió y se agotó la espera de esta llamada: la tarjeta SIGUE abierta; el agente debe repetir la petición. */
  retry?: boolean
}

/** Tope de una espera de tarjeta dentro de UNA llamada MCP (< el corte de ~5 min del cliente). */
const ACCESS_WAIT_MAX_MS = 240_000
const ACCESS_RETRY_MSG =
  'Todavía no hay respuesta del usuario: la tarjeta SIGUE abierta en pantalla. Vuelve a llamar a la misma herramienta con los MISMOS ' +
  'argumentos para seguir esperando (no cambies el plan ni pidas otra cosa) y no hagas nada más mientras tanto.'

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

/** Edad desde la que un temporal suelto (`probe-*`, `zin-*`, `raw-app-*`) se considera huérfano. */
const STALE_TEMP_MS = 5 * 60_000

function cleanupShots(): void {
  try {
    const files = readdirSync(SHOT_DIR)
      .filter((f) => f.startsWith('shot-'))
      .map((f) => ({ f, t: statSync(join(SHOT_DIR, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
    for (const { f } of files.slice(20)) safeRm(join(SHOT_DIR, f))
    // Temporales de sondas, zoom y recortes que quedaron huérfanos (el MCP cayó a mitad): fuera los de más de 5 minutos.
    const viejos = Date.now() - STALE_TEMP_MS
    for (const f of readdirSync(SHOT_DIR)) {
      if (!/^(probe-|zin-|raw-app-)/.test(f)) continue
      try {
        if (statSync(join(SHOT_DIR, f)).mtimeMs < viejos) safeRm(join(SHOT_DIR, f))
      } catch {
        // ignorar: pudo desaparecer entre medias
      }
    }
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
  // Origen aislado: nunca pantalla completa (defensa en profundidad: aquí pasan screenshot, capturas automáticas y request_access).
  if (isolatedCall) throw new Error(ISOLATED_SCREEN_REJECT_MSG)
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

/**
 * Origen aislado: apps sobre las que NUNCA se actúa (las exentas del sistema; mismas que `SYSTEM_EXEMPT_BUNDLE_IDS` de `grants.ts`, sin Finder).
 * Se repite en `ComputerService` (`/tier?isolated=1` ⇒ null): aquí da un mensaje claro y evita pedir tarjetas inútiles.
 */
const ISOLATED_NEVER_ACT: ReadonlySet<string> = new Set([...NEVER_EXCLUDE].filter((b) => b !== 'com.apple.finder'))

/**
 * Origen aislado: ventanas de apps exentas que además se TAPAN en las capturas (Lazunox con sus chats de Control total, Spotlight, avisos).
 * Dock, barra de menús, ventana de login y WindowServer no se tapan (son el marco de la pantalla; tampoco se pueden accionar).
 */
const ISOLATED_MASK: ReadonlySet<string> = new Set(
  // Parte de NEVER_EXCLUDE (no de ISOLATED_NEVER_ACT): incluye Finder (carpetas y escritorio del usuario), que solo se ve con concesión de sesión.
  [...NEVER_EXCLUDE].filter(
    (b) => !['com.apple.dock', 'com.apple.systemuiserver', 'com.apple.WindowServer', 'com.apple.loginwindow'].includes(b)
  )
)

/** Origen aislado: ¿app exenta? La lista del sistema/Lazunox Y cualquier ayudante de Lazunox (`cl.bentec.lazunox.motor`, `.disclaim`, `.helper*`…). */
function isIsolatedExempt(bundleId: string): boolean {
  if (backend.id === 'win32') return isWinIsolatedExempt(bundleId) // Windows: claves `exe:…`/`aumid:…`; lista en mcp-platform-win32.ts
  return ISOLATED_NEVER_ACT.has(bundleId) || bundleId.startsWith('cl.bentec.lazunox.')
}

/**
 * Origen aislado: combinaciones que cambian el foco o abren cosas globalmente (conmutador de apps, Spotlight, Mission Control y espacios,
 * ocultar/minimizar/cerrar la app, forzar salida, bloqueo, capturas del sistema, teclas F del sistema). Lista CERRADA: una combinación
 * queda bloqueada si lleva TODOS los modificadores de una entrada y su misma tecla (`cmd+tab` bloquea también `cmd+shift+tab`).
 * `fn` (cualquier uso) se rechaza aparte. Con ellas un `key` podría salir de la app concedida hacia Lazunox (Control total) o abrir apps sin tarjeta.
 */
const ISOLATED_BLOCKED_KEYS: readonly string[] = [
  'cmd+tab',
  'cmd+`',
  'cmd+space',
  'cmd+h',
  'cmd+m',
  'cmd+q',
  'cmd+alt+escape',
  'cmd+alt+d',
  'cmd+shift+3',
  'cmd+shift+4',
  'cmd+shift+5',
  'ctrl+left',
  'ctrl+right',
  'ctrl+up',
  'ctrl+down',
  'ctrl+space',
  'ctrl+cmd+space',
  'ctrl+cmd+q',
  'ctrl+f1',
  'ctrl+f2',
  'ctrl+f3',
  'ctrl+f4',
  'ctrl+f5',
  'ctrl+f6',
  'ctrl+f7',
  'ctrl+f8',
  'cmd+f5',
  'cmd+alt+f5',
  'f3',
  'f4',
  'f9',
  'f10',
  'f11',
  'f12'
]

/** Vocabulario de `key` del helper (`keyCodes`, `modifierFlags` y `aliases` de helper.swift): lo que no esté aquí no se pulsa en origen aislado. */
const KEY_MODIFIER_ALIASES: Record<string, string> = {
  cmd: 'cmd',
  command: 'cmd',
  meta: 'cmd',
  super: 'cmd',
  shift: 'shift',
  alt: 'alt',
  option: 'alt',
  opt: 'alt',
  ctrl: 'ctrl',
  control: 'ctrl',
  fn: 'fn'
}
const KEY_NAME_ALIASES: Record<string, string> = {
  esc: 'escape',
  enter: 'return',
  backspace: 'delete',
  arrowleft: 'left',
  arrowright: 'right',
  arrowup: 'up',
  arrowdown: 'down',
  page_up: 'pageup',
  page_down: 'pagedown',
  del: 'forwarddelete',
  plus: '=',
  minus: '-'
}
const KNOWN_KEY_NAMES: ReadonlySet<string> = new Set([
  ...'abcdefghijklmnopqrstuvwxyz0123456789'.split(''),
  ...['=', '-', ']', '[', "'", ';', '\\', ',', '/', '.', '`'],
  ...['return', 'tab', 'space', 'delete', 'escape', 'forwarddelete', 'home', 'end', 'pageup', 'pagedown', 'left', 'right', 'down', 'up'],
  ...Array.from({ length: 12 }, (_, i) => `f${i + 1}`)
])

interface ParsedCombo {
  mods: Set<string>
  key: string
}

/** Interpreta UNA combinación como lo hace el helper (`pressKey`); null si no se reconoce (⇒ en origen aislado no se pulsa). */
function parseCombo(combo: string): ParsedCombo | null {
  const parts = combo
    .toLowerCase()
    .split('+')
    .map((p) => p.trim())
  const mods = new Set<string>()
  let key: string | null = null
  for (let i = 0; i < parts.length; i++) {
    let p = parts[i]!
    if (p === '' && i === parts.length - 1) p = '='
    p = KEY_NAME_ALIASES[p] ?? p
    const m = KEY_MODIFIER_ALIASES[p]
    if (m) mods.add(m)
    else if (p) {
      if (key) return null // dos «teclas principales» (p. ej. un modificador que no se reconoce): ambiguo, no se pulsa
      key = p
    }
  }
  if (!key || !KNOWN_KEY_NAMES.has(key)) return null
  return { mods, key }
}

const BLOCKED_KEY_RULES: ParsedCombo[] = ISOLATED_BLOCKED_KEYS.map((k) => parseCombo(k)).filter((c): c is ParsedCombo => c !== null)

/**
 * Origen aislado: valida el argumento `keys` de `key`. UNA sola combinación por llamada (el foco puede cambiar entre combinaciones),
 * solo teclas conocidas y ninguna de `ISOLATED_BLOCKED_KEYS`. Devuelve la combinación o lanza.
 */
function checkIsolatedKeys(keys: string, session: string | undefined): string {
  const combos = keys.trim().split(/ +/).filter(Boolean)
  if (combos.length !== 1 || /\s/.test(combos[0]!)) {
    throw reject(
      'key-sequence',
      'En este modo solo se pulsa UNA combinación por llamada (el foco puede cambiar entre combinaciones). Llama a key una vez por combinación.',
      session
    )
  }
  if (backend.id === 'win32') {
    // Windows: vocabulario y lista propios (`checkWinIsolatedCombo`); la política general (`backend.checkKeys`) se aplica después.
    const v = checkWinIsolatedCombo(combos[0]!)
    if (v === 'ok') return combos[0]!
    throw reject(
      v === 'blocked' ? 'key-blocked' : 'key-unknown',
      v === 'blocked'
        ? `La combinación «${combos[0]}» cambia de ventana o abre cosas del sistema: en este modo no se pulsa. Usa open_application para cambiar de app.`
        : `Combinación no reconocida: «${combos[0]}». Usa nombres como "enter", "tab", "ctrl+a", "shift+left", "f5".`,
      session
    )
  }
  const parsed = parseCombo(combos[0]!)
  if (!parsed) {
    throw reject(
      'key-unknown',
      `Combinación no reconocida: «${combos[0]}». Usa nombres como "return", "tab", "cmd+a", "shift+left", "f5".`,
      session
    )
  }
  if (parsed.mods.has('fn') || BLOCKED_KEY_RULES.some((r) => r.key === parsed.key && [...r.mods].every((m) => parsed.mods.has(m)))) {
    throw reject(
      'key-blocked',
      `La combinación «${combos[0]}» cambia de app o abre cosas del sistema: en este modo no se pulsa. Usa open_application para cambiar de app o app_press con los menús.`,
      session
    )
  }
  return combos[0]!
}

/**
 * Origen aislado: justo antes de pulsar/escribir se vuelve a mirar la app en primer plano; si no es la que se comprobó (o ya no se identifica),
 * no se actúa (el foco puede haber cambiado desde la comprobación de concesión). Sin origen aislado no hace nada.
 */
async function recheckFront(checked: AppRef | undefined, session: string | undefined): Promise<void> {
  if (!isolatedCall) return
  const now = await appFrontmost()
  if (!sameFront(checked, now)) {
    throw reject(
      'front-changed',
      'La app en primer plano cambió antes de pulsar: no se hizo nada. Toma una captura y revisa dónde estás antes de reintentar.',
      session
    )
  }
}

/** ¿Sigue al frente la app que se comprobó? (identificable, la misma y no exenta). Es la regla única de `recheckFront` y del troceo de `type_text`. */
function sameFront(checked: AppRef | undefined, now: AppRef): boolean {
  return !!checked?.bundleId && !!now.bundleId && now.bundleId === checked.bundleId && !isIsolatedExempt(now.bundleId)
}

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
    neverExclude: NEVER_EXCLUDE,
    isolatedMask: ISOLATED_MASK
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
      ;({ width, height } = await backend.captureScreen({ raw, out, session, screen, ...(isolatedCall ? { isolated: true } : {}) }))
    } else {
      // Windows: mismo orden de siempre (varias pruebas lo fijan exacto) — antes `frontmost` corría
      // en paralelo a la captura (ganaba la carrera casi siempre por ser una sola llamada corta
      // contra una cadena larga), así que pedirlo PRIMERO ahora da el mismo resultado observable sin
      // depender de una carrera real. Sin el cálculo de pantalla real de arriba (su "escritorio
      // virtual" ya es un espacio único).
      front = await appFrontmost().catch(() => null)
      ;({ width, height } = await backend.captureScreen({ raw, out, session, ...(isolatedCall ? { isolated: true } : {}) }))
      screen = await getMainScreen()
    }
    capturedScreen = screen
    ratio = width > 0 ? screen.width / width : await ensureRatio()
    const base64 = readShotFile(out).toString('base64')
    cleanupShots()
    const shot: Shot = { path: out, base64, width, height, ratio, front: front?.name ?? null, onMainScreen: screen.main === true }
    lastShot = shot
    lastShotSession = session
    return shot
  } finally {
    safeRm(raw)
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

// ───────────────────────────── origen aislado: clic en píxeles de la última app_screenshot ─────────────────────────────
//
// En origen aislado no hay captura de pantalla completa, así que las x/y de los clics NO pueden ser píxeles de la pantalla principal.
// Son píxeles de la última `app_screenshot` DE ESA SESIÓN (la ventana capturada, esté en el monitor que esté). Solo se puede apuntar
// dentro del marco visible de esa ventana y de algún monitor real; justo antes de actuar se vuelve a leer la ventana y la app bajo el
// punto tiene que ser la capturada. Fuera del origen aislado nada de esto corre.

/** Cuánto vale una `app_screenshot` para apuntar (mismo criterio que la lista de elementos). La variable solo permite ACORTARLO (pruebas); nunca pasa de 90 s. */
const WINDOW_CTX_TTL_MS = Math.min(90_000, Math.max(1, Number(process.env.COMPUTER_WINDOW_CTX_TTL_MS) || 90_000))
/** Tolerancia al comparar el marco de la ventana con el de la captura (puntos o píxeles). */
const WINDOW_FRAME_TOLERANCE = 1

/** Un elemento pulsable de la lista numerada de una captura (§2.4): punto GLOBAL, como el de los clics por x/y. */
interface CaptureElement {
  role: string
  label: string
  point: { x: number; y: number }
  width: number
  height: number
}

/** La ventana de la última `app_screenshot` de una sesión: dónde está y cuánto mide la imagen JPEG que vio el modelo. */
interface WindowCtx {
  app: AppRef
  windowIndex: number
  /** Rectángulo global que cubre la IMAGEN (Windows: con los bordes invisibles). */
  rect: Rect
  /** Marco visible de la ventana: límite de cualquier punto. */
  frame: Rect
  imageWidth: number
  imageHeight: number
  at: number
  /** Número de esta captura (global al proceso, nunca se repite): lo que el modelo escribe en `capture` junto con `element`. */
  captureId: number
  /** Rejilla de luminancia de la propia captura (sonda); `null` = no se pudo leer, y entonces no hay lista de elementos. */
  signature: ProbeSignature | null
  /** Lista numerada de ESTA captura (solo de esta sesión); `null` = no hay lista o se invalidó. */
  elements: CaptureElement[] | null
}
const windowCtx = new Map<string, WindowCtx>()
const WINDOW_CTX_MAX = 64
let captureSeq = 0

const ctxKey = (session: string | undefined): string => session ?? ''

const NO_CAPTURE_MSG =
  'Para hacer clic, mover el puntero, arrastrar o desplazar en este modo primero toma app_screenshot de la app: ' +
  'las x/y van en píxeles de esa imagen. No hay captura de pantalla completa ni clics a ciegas.'

const validRect = (r: Rect): boolean => [r.x, r.y, r.width, r.height].every((n) => Number.isFinite(n)) && r.width > 0 && r.height > 0

/** Guarda (o borra, si `loc` es null o inválida) la ventana capturada de esa sesión. */
function setWindowCtx(
  session: string | undefined,
  app: AppRef,
  windowIndex: number,
  loc: { rect: Rect; frame: Rect; imageWidth: number; imageHeight: number } | null
): boolean {
  const key = ctxKey(session)
  windowCtx.delete(key)
  if (!loc || !validRect(loc.rect) || !validRect(loc.frame) || !(loc.imageWidth > 0) || !(loc.imageHeight > 0)) return false
  if (windowCtx.size >= WINDOW_CTX_MAX) {
    const oldest = windowCtx.keys().next().value
    if (oldest !== undefined) windowCtx.delete(oldest)
  }
  windowCtx.set(key, {
    app,
    windowIndex,
    rect: { ...loc.rect },
    frame: { ...loc.frame },
    imageWidth: loc.imageWidth,
    imageHeight: loc.imageHeight,
    at: Date.now(),
    captureId: ++captureSeq,
    signature: null,
    elements: null
  })
  return true
}

/** La captura vigente de esa sesión, o lanza (falla cerrado: sin captura no hay clic con x/y). */
function currentWindowCtx(session: string | undefined): WindowCtx {
  const ctx = windowCtx.get(ctxKey(session))
  if (!ctx) {
    throw reject('no-capture', NO_CAPTURE_MSG, session)
  }
  if (Date.now() - ctx.at > WINDOW_CTX_TTL_MS) {
    windowCtx.delete(ctxKey(session))
    throw reject(
      'capture-expired',
      `La captura de ${ctx.app.name} caducó (valen 90 s): toma app_screenshot otra vez antes de actuar.`,
      session
    )
  }
  return ctx
}

/** Punto dentro de un rectángulo (abierto por la derecha y abajo: el borde de abajo/derecha es del vecino). */
const inRect = (r: Rect, x: number, y: number): boolean => x >= r.x && y >= r.y && x < r.x + r.width && y < r.y + r.height

// ── zoom de la ventana capturada (§2.1): lo que hace falta recordar de la última app_screenshot de cada sesión ──

/** Tope del lado largo del resultado de `zoom` en el modo de apps (400–2000; por defecto igual que la captura). */
const ZOOM_MAX_LONG = Math.min(2000, Math.max(400, Number(process.env.COMPUTER_ZOOM_MAX_LONG) || 1366))

/**
 * Lo que `zoom` necesita de la última `app_screenshot` de una sesión. Vive APARTE de `windowCtx` (el zoom sirve para mirar aunque la ventana
 * no se haya podido ubicar para clics). Solo mira cosas de la app concedida; caduca con la misma regla que las coordenadas (90 s) y cada
 * sesión solo ve la suya.
 */
interface WindowShotEntry {
  app: AppRef
  windowIndex: number
  /** Tamaño del JPEG que vio el modelo (el espacio de x/y/width/height del zoom). */
  imageWidth: number
  imageHeight: number
  /**
   * macOS: PNG grande (el doble de detalle que el JPEG) conservado SOLO EN MEMORIA y su tamaño. Nunca se deja en disco con un nombre que el
   * agente pueda adivinar: el zoom lo escribe justo antes de usarlo con un nombre aleatorio y lo borra después.
   */
  png?: Buffer
  pngWidth?: number
  pngHeight?: number
  /** Windows: rectángulo de origen de la ventana al capturar; el zoom captura de nuevo y exige que siga igual. */
  rect?: Rect
  at: number
  timer?: ReturnType<typeof setTimeout>
}
const windowShots = new Map<string, WindowShotEntry>()

function dropWindowShot(key: string): void {
  const e = windowShots.get(key)
  if (!e) return
  if (e.timer) clearTimeout(e.timer)
  windowShots.delete(key)
}

/** Tope de capturas conservadas a la vez (las más viejas se descartan) y de bytes de PNG en memoria. */
const WINDOW_SHOTS_MAX = 8
const WINDOW_SHOTS_MAX_BYTES = 256 * 1024 * 1024
const windowShotsBytes = (): number => [...windowShots.values()].reduce((n, e) => n + (e.png?.length ?? 0), 0)

function setWindowShot(session: string | undefined, e: Omit<WindowShotEntry, 'at' | 'timer'>): void {
  const key = ctxKey(session)
  dropWindowShot(key)
  const entry: WindowShotEntry = { ...e, at: Date.now() }
  // El PNG conservado no sobrevive a la caducidad: se suelta solo pasado el plazo (más un margen) aunque nadie vuelva a pedir zoom.
  entry.timer = setTimeout(() => {
    try {
      if (windowShots.get(key) === entry) dropWindowShot(key)
    } catch {
      // nunca dejar una excepción sin capturar en un temporizador
    }
  }, WINDOW_CTX_TTL_MS + 1000)
  entry.timer.unref?.()
  windowShots.set(key, entry)
  // Tope de sesiones y de memoria: se descartan las más viejas (el Map conserva el orden de inserción; esta, recién puesta, es la última).
  while (windowShots.size > WINDOW_SHOTS_MAX || (windowShots.size > 1 && windowShotsBytes() > WINDOW_SHOTS_MAX_BYTES)) {
    const oldest = windowShots.keys().next().value
    if (oldest === undefined || oldest === key) break
    dropWindowShot(oldest)
  }
}

/** Tamaño de un JPEG (marcador SOF); `null` si no se entiende. */
function jpegSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null
  let i = 2
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i++
      continue
    }
    const m = buf[i + 1]
    if (m === 0xff) {
      i++
      continue
    }
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      const height = buf.readUInt16BE(i + 5)
      const width = buf.readUInt16BE(i + 7)
      return width > 0 && height > 0 ? { width, height } : null
    }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      i += 2
      continue
    }
    i += 2 + buf.readUInt16BE(i + 2)
  }
  return null
}

/**
 * Captura sin imagen para el modelo (la «sonda»): firma de una ventana de una app YA concedida, AHORA; `null` si no se pudo leer. El archivo
 * tiene nombre aleatorio y se borra siempre; el modelo nunca recibe la imagen, solo porcentajes. Quien llama comprueba antes el nivel de la app.
 */
async function probeOf(bundleId: string, windowIndex: number, remote = false, maxMs?: number): Promise<ProbeSignature | null> {
  const path = join(SHOT_DIR, `probe-${Date.now()}-${secretName()}.png`)
  // Tope propio (1,5 s local / 4 s remoto, o menos si queda poco plazo): una app colgada no retiene el veredicto ni el `wait`. Al vencer
  // la sonda cuenta como fallida (`null` ⇒ unverifiable); el archivo se borra igual y lo que llegue tarde lo recoge `cleanupShots`.
  const limit = Math.max(200, Math.min(probeTimeoutMs(remote), maxMs ?? Infinity))
  try {
    mkdirSync(SHOT_DIR, { recursive: true })
    return await withTimeout(
      backend.probeWindow(bundleId, windowIndex, path).then(() => probeSignature(readShotFile(path))),
      limit,
      null
    )
  } catch (err) {
    log('sonda de ventana:', err instanceof Error ? err.message : err)
    return null
  } finally {
    safeRm(path)
  }
}

const probeNow = (ctx: WindowCtx): Promise<ProbeSignature | null> => probeOf(ctx.app.bundleId, ctx.windowIndex)

/**
 * Origen aislado: puntos globales (de un clic) → comprobaciones geométricas comunes a x/y y a `element`: dentro del marco visible de la
 * ventana capturada y dentro de algún monitor real.
 */
async function checkWindowPoint(ctx: WindowCtx, p: { x: number; y: number }, label: string, session: string | undefined): Promise<void> {
  if (!inRect(ctx.frame, p.x, p.y)) {
    throw reject(
      'outside-window',
      `Ese punto ${label} cae fuera de la ventana de ${ctx.app.name}: no se actúa. Apunta dentro de la ventana.`,
      session
    )
  }
  let screens: Screen[] = []
  try {
    screens = await getAllScreens()
  } catch {
    screens = []
  }
  if (!screens.length || !screens.some((s) => inRect({ x: s.x ?? 0, y: s.y ?? 0, width: s.width, height: s.height }, p.x, p.y))) {
    throw reject('off-screen', 'Ese punto no cae en ninguna pantalla conectada: no se actúa. Toma app_screenshot otra vez.', session)
  }
}

/**
 * Origen aislado: px de la última `app_screenshot` de la sesión → punto global (el que esperan los clics). Rechaza si no hay captura vigente,
 * si los px caen fuera de la imagen, y si el punto resultante cae fuera del marco visible de la ventana o fuera de todos los monitores.
 */
async function toWindowPoints(
  session: string | undefined,
  x: unknown,
  y: unknown
): Promise<{ p: { x: number; y: number }; ctx: WindowCtx }> {
  const bad = (v: unknown): boolean => v === null || v === undefined || (typeof v === 'string' && !v.trim()) || typeof v === 'boolean'
  const nx = bad(x) ? NaN : Number(x)
  const ny = bad(y) ? NaN : Number(y)
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) throw new Error('Coordenadas inválidas: x e y deben ser números')
  const ctx = currentWindowCtx(session)
  if (nx < 0 || ny < 0 || nx > ctx.imageWidth || ny > ctx.imageHeight) {
    throw reject(
      'outside-window',
      `Coordenadas fuera de la imagen de app_screenshot: (${nx}, ${ny}) px; la imagen mide ${ctx.imageWidth}x${ctx.imageHeight} px. ` +
        'Apunta dentro de la ventana capturada.',
      session
    )
  }
  const p = {
    x: Math.round((ctx.rect.x + (nx * ctx.rect.width) / ctx.imageWidth) * 100) / 100,
    y: Math.round((ctx.rect.y + (ny * ctx.rect.height) / ctx.imageHeight) * 100) / 100
  }
  await checkWindowPoint(ctx, p, `(${nx}, ${ny}) px`, session)
  return { p, ctx }
}

/**
 * Origen aislado: `element: N` + `capture: <id>` → punto global del elemento de la lista de ESA captura. Nunca cae en otro control: si el id
 * no es el de la captura vigente de ESTA sesión, si no hay lista, o si la ventana ya no se ve como en la captura (sonda distinta) o no se
 * puede comprobar, se rechaza con `[rechazo: stale]` y NO se hace nada. El punto resultante pasa después por las mismas comprobaciones que
 * x/y (marco visible, monitor, `assertCapturedAppAt`, nivel, `recheckWindow`).
 */
async function toElementPoint(
  session: string | undefined,
  rawElement: unknown,
  rawCapture: unknown
): Promise<{ p: { x: number; y: number }; label: string; ctx: WindowCtx }> {
  const n = Number(rawElement)
  if (!Number.isInteger(n) || n < 1) throw new Error('element debe ser el número de la lista de elementos (1, 2, 3…)')
  const missing =
    rawCapture === undefined ||
    rawCapture === null ||
    typeof rawCapture === 'boolean' ||
    (typeof rawCapture === 'string' && !rawCapture.trim())
  const cap = missing ? NaN : Number(rawCapture)
  if (!Number.isInteger(cap) || cap < 1) {
    throw reject(
      'capture-required',
      'Con element hay que indicar también capture: el número de la captura de la lista ("Captura #N" en el texto de app_screenshot). ' +
        'Sin él no se sabe a qué imagen se refiere el número.',
      session
    )
  }
  const ctx = currentWindowCtx(session)
  const retry = 'Toma app_screenshot otra vez, elige de la lista nueva (con su capture) o usa x/y de la imagen nueva.'
  if (ctx.captureId !== cap) {
    throw reject('stale', `La captura #${cap} ya no es la vigente: la lista de elementos de una captura vieja no vale. ${retry}`, session)
  }
  const list = ctx.elements
  if (!list || !ctx.signature) {
    throw reject('stale', `La captura #${cap} no tiene lista de elementos vigente. ${retry}`, session)
  }
  const el = list[n - 1]
  if (!el) throw new Error(`No hay elemento ${n}: la lista de la captura #${cap} tiene ${list.length}.`)
  // La sonda captura la ventana de esa app: hace falta al menos el nivel del clic que se va a hacer.
  await requireTierFor(ctx.app, 'click', session)
  const now = await probeNow(ctx)
  if (!now || captureIsStale(ctx.signature, now)) {
    ctx.elements = null
    throw reject(
      'stale',
      now
        ? `La ventana de ${ctx.app.name} ya no se ve como en la captura #${cap}: la lista de elementos no vale. ${retry}`
        : `No se pudo comprobar que la ventana de ${ctx.app.name} siga como en la captura #${cap}: por seguridad no se actúa. ${retry}`,
      session
    )
  }
  const p = { x: el.point.x, y: el.point.y }
  await checkWindowPoint(ctx, p, `del elemento ${n}`, session)
  return { p, label: `elemento ${n} «${el.label.slice(0, 40)}» (captura #${cap})`, ctx }
}

/** Origen aislado: la app bajo el punto tiene que ser EXACTAMENTE la capturada (otra ventana, una notificación o el escritorio no valen). */
async function assertCapturedAppAt(ctx: WindowCtx, p: { x: number; y: number }, session: string | undefined): Promise<void> {
  const at = await appAtPoint(p.x, p.y)
  if (!at.bundleId || at.bundleId !== ctx.app.bundleId) {
    const under = at.name ? `«${at.name}»` : 'otra cosa'
    throw reject(
      'covered',
      `Bajo ese punto no está ${ctx.app.name}: hay ${under}. La ventana de ${ctx.app.name} está tapada, minimizada o en otro escritorio o pantalla. ` +
        `NO pidas acceso a ${under} ni a ninguna otra app para sortear esto: pide a la persona que deje la ventana de ${ctx.app.name} a la vista y toma app_screenshot otra vez.`,
      session
    )
  }
}

/** Origen aislado, justo antes de actuar: la ventana tiene que seguir donde y como se capturó (si se movió, cambió de tamaño o se cerró, no se actúa). */
async function recheckWindow(ctx: WindowCtx, session: string | undefined): Promise<void> {
  let frames: Rect[] = []
  try {
    frames = await backend.windowFrames(ctx.app.bundleId)
  } catch {
    frames = []
  }
  const same = (f: Rect): boolean =>
    Math.abs(f.x - ctx.frame.x) <= WINDOW_FRAME_TOLERANCE &&
    Math.abs(f.y - ctx.frame.y) <= WINDOW_FRAME_TOLERANCE &&
    Math.abs(f.width - ctx.frame.width) <= WINDOW_FRAME_TOLERANCE &&
    Math.abs(f.height - ctx.frame.height) <= WINDOW_FRAME_TOLERANCE
  if (!frames.some(same)) {
    windowCtx.delete(ctxKey(session))
    throw reject(
      'window-moved',
      `La ventana de ${ctx.app.name} se movió, cambió de tamaño o se cerró desde la captura: no se actúa. Toma app_screenshot otra vez.`,
      session
    )
  }
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
  x: { type: 'number', description: 'X en píxeles de la última captura (en el modo de apps: de la última app_screenshot)' },
  y: { type: 'number', description: 'Y en píxeles de la última captura (en el modo de apps: de la última app_screenshot)' }
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
/** Tope de segundos de `wait` sumados en un mismo lote (cada `wait` suelto llega a 20 s; en un lote de 8 pasos serían 160 s). */
const BATCH_WAIT_MAX_S = 20

const ELEMENT_ARG = {
  element: {
    type: 'number',
    description:
      'Alternativa a x/y: número [N] de la lista de elementos de la última captura (punto exacto por accesibilidad). ' +
      'En el modo de apps hay que indicar también capture.'
  },
  capture: {
    type: 'number',
    description:
      'Solo en el modo de apps y OBLIGATORIO junto con element: el número de la captura de la lista ("Captura #N" en el texto de ' +
      'app_screenshot). Si la captura ya no es la vigente o la ventana cambió, se rechaza con [rechazo: stale] sin hacer nada.'
  }
}
const SHOT_FLAG = {
  screenshot: {
    type: 'boolean',
    description:
      'Adjuntar una captura tras la acción (por defecto true). En el modo de apps (sin captura de pantalla): true adjunta una captura de la ' +
      'VENTANA de la app concedida (nunca de la pantalla ni de otra app); false desactiva las comprobaciones (sin la línea "efecto: …"); ' +
      'sin indicarlo, solo la línea "efecto: confirmed | unverifiable | suspected_noop", sin imagen.'
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
  const { p, label, ctx } = await pointFromArgs(args, session)
  // Primero se comprueba que bajo el punto esté la app capturada: si no, el mensaje explica que la ventana está tapada o en otro sitio
  // (y no se confunde al modelo con un «sin acceso» a la app equivocada).
  if (ctx) await assertCapturedAppAt(ctx, p, session)
  await requireTier('click', p, session)
  if (ctx) await recheckWindow(ctx, session)
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

function describeElement(el: FoundElement, idx: number, ratio: number, isolatedCtx?: WindowCtx | null): string {
  const label = el.title || el.description || el.identifier || el.value || '(sin texto)'
  const state = el.enabled ? '' : ' [deshabilitado]'
  if (isolatedCall) {
    // Origen aislado: los puntos se dan en px de la última app_screenshot de esa app (un solo espacio de coordenadas); sin ella, sin coordenadas.
    if (!isolatedCtx) return `${idx + 1}. [${el.role}] "${label}" (sin coordenadas: falta app_screenshot de la app)${state}`
    const c = isolatedCtx
    const px = {
      x: ((el.screenPoint.x - c.rect.x) * c.imageWidth) / c.rect.width,
      y: ((el.screenPoint.y - c.rect.y) * c.imageHeight) / c.rect.height
    }
    const outside = inRect(c.frame, el.screenPoint.x, el.screenPoint.y) ? '' : ' [fuera de la ventana capturada: no se puede pulsar]'
    return `${idx + 1}. [${el.role}] "${label}" en (${Math.round(px.x)}, ${Math.round(px.y)}) px, tamaño ${Math.round(el.width)}x${Math.round(el.height)}${state}${outside}`
  }
  const px = shotPx(el.screenPoint, ratio)
  const pt = `(${Math.round(px.x)}, ${Math.round(px.y)})`
  return `${idx + 1}. [${el.role}] "${label}" en ${pt} px, tamaño ${Math.round(el.width)}x${Math.round(el.height)}${state}`
}

/** Origen aislado: la captura vigente de ESA app en esta sesión (para expresar los puntos de AX en sus píxeles), o null. */
function isolatedCtxFor(app: AppRef, session: string | undefined): WindowCtx | null {
  const ctx = windowCtx.get(ctxKey(session))
  if (!ctx || ctx.app.bundleId !== app.bundleId || Date.now() - ctx.at > WINDOW_CTX_TTL_MS) return null
  return ctx
}

const ISOLATED_NEEDS_SHOT_LINE = (app: AppRef): string =>
  `Para hacer clic en algo de ${app.name} toma antes app_screenshot de esa app: las coordenadas se dan en píxeles de esa imagen.`

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

/** ¿La app al frente es un cliente de escritorio remoto? (su imagen llega con retraso y lee teclas físicas) */
function isRemoteApp(app: AppRef): boolean {
  return isRemoteClientApp(app)
}

async function isRemoteClientFront(): Promise<boolean> {
  const front = await appFrontmost().catch(() => null)
  return front ? isRemoteApp(front) : false
}

/** Como `isRemoteClientFront`, pero con el dato ya conocido de esta misma acción (sin llamar otra vez al helper si es reciente). */
function remoteFrontKnown(): boolean {
  return lastFront !== null && Date.now() - lastFront.at < LAST_FRONT_TTL_MS && isRemoteApp(lastFront.app)
}

/** Espera antes de la captura automática: un escritorio remoto tarda en pintar el cambio (se vio hasta varios segundos). */
const REMOTE_SETTLE_MS = 2200

type TypeMode = 'unicode' | 'keys' | 'paste'

/**
 * Cómo escribir: `input` explícito manda. En `auto`, con un cliente remoto al frente: TECLAS FÍSICAS (`cu-keys`); en el resto, Unicode.
 * El portapapeles (`paste`) solo se usa si se pide: los clientes remotos lo sincronizan con retraso y a veces entregan el texto anterior.
 */
async function typeModeFor(input: unknown): Promise<TypeMode> {
  if (input === 'unicode') return 'unicode'
  if (input === 'keys') return backend.typeKeys ? 'keys' : 'unicode'
  if (input === 'paste') return backend.pasteText ? 'paste' : 'unicode'
  if (!backend.typeKeys || !backend.pressKeys) return 'unicode'
  if (!(await isRemoteClientFront())) return 'unicode'
  // El portapapeles de los clientes remotos se sincroniza con retraso y a veces entrega el texto anterior: solo se usa si se pide (`input: "paste"`).
  return 'keys'
}

/** ¿Pulsar combinaciones por teclas físicas? Solo con un cliente remoto al frente. */
async function shouldPressByKeys(): Promise<boolean> {
  if (!backend.typeKeys || !backend.pressKeys) return false
  return isRemoteClientFront()
}

/** Punto (puntos globales) al que apunta una acción: `element: N` de la última lista, o x/y en px de la captura. */
async function pointFromArgs(
  args: Record<string, unknown>,
  session?: string
): Promise<{ p: { x: number; y: number }; label: string; ctx?: WindowCtx }> {
  const raw = args.element
  if (isolatedCall) {
    // Origen aislado: `element: N` exige `capture: <id>` y sale de la lista de ESA app_screenshot (nunca de la lista global de pantalla completa).
    if (raw !== undefined && raw !== null && raw !== '') {
      const { p, label, ctx } = await toElementPoint(session, raw, args.capture)
      return { p, label, ctx }
    }
    if (args.x === undefined || args.y === undefined) throw new Error('Indica x e y (px de la última app_screenshot).')
    const { p, ctx } = await toWindowPoints(session, args.x, args.y)
    return { p, label: `(${args.x}, ${args.y}) px`, ctx }
  }
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

/** Origen aislado, herramienta `zoom`: recorta y agranda la última `app_screenshot` de ESTA sesión (nunca pantalla completa ni otra sesión). */
async function isolatedZoom(a: Record<string, unknown>, session: string | undefined): Promise<{ text: string; shot: Shot }> {
  const key = ctxKey(session)
  const entry = windowShots.get(key)
  if (!entry) {
    throw reject(
      'no-capture',
      'No hay ninguna app_screenshot vigente de esta sesión: toma app_screenshot de la app y haz zoom sobre esa imagen.',
      session
    )
  }
  if (Date.now() - entry.at > WINDOW_CTX_TTL_MS) {
    dropWindowShot(key)
    throw reject(
      'capture-expired',
      `La captura de ${entry.app.name} caducó (valen 90 s): toma app_screenshot otra vez antes de hacer zoom.`,
      session
    )
  }
  // El zoom muestra la ventana de esa app: si la concesión ya no está, no se enseña nada.
  await requireTierFor(entry.app, 'view', session)
  const bad = (v: unknown): boolean => v === null || v === undefined || (typeof v === 'string' && !v.trim()) || typeof v === 'boolean'
  const nums = [a.x, a.y, a.width, a.height].map((v) => (bad(v) ? NaN : Math.round(Number(v))))
  if (!nums.every(Number.isFinite)) throw new Error('x, y, width y height deben ser números')
  const [x, y, width, height] = nums as [number, number, number, number]
  if (width <= 0 || height <= 0) throw new Error('width y height deben ser mayores que 0')
  if (x < 0 || y < 0 || x + width > entry.imageWidth || y + height > entry.imageHeight) {
    throw reject(
      'outside-window',
      `Región fuera de la imagen de app_screenshot (${entry.imageWidth}x${entry.imageHeight} px): (${x}, ${y}) ${width}x${height}`,
      session
    )
  }
  const wantedScale = Math.max(1, Math.min(4, Number(a.scale) || 2))
  // px del JPEG que vio el modelo → px de la imagen de origen (macOS: el PNG conservado; Windows: el rectángulo de origen de la ventana).
  const srcW = entry.png ? entry.pngWidth : entry.rect ? Math.round(entry.rect.width) : undefined
  const srcH = entry.png ? entry.pngHeight : entry.rect ? Math.round(entry.rect.height) : undefined
  if (!srcW || !srcH || !(srcW > 0) || !(srcH > 0)) {
    throw reject(
      'zoom-unavailable',
      'No se puede hacer zoom sobre esta captura (el helper no informó de la ventana): toma app_screenshot otra vez.',
      session
    )
  }
  const fx = srcW / entry.imageWidth
  const fy = srcH / entry.imageHeight
  const rx = Math.max(0, Math.floor(x * fx))
  const ry = Math.max(0, Math.floor(y * fy))
  const region = {
    x: rx,
    y: ry,
    width: Math.max(1, Math.min(srcW, Math.ceil((x + width) * fx)) - rx),
    height: Math.max(1, Math.min(srcH, Math.ceil((y + height) * fy)) - ry)
  }
  // El helper dibuja región×escala antes de reducir: se acota la escala para que ninguna de las dos medidas pase del tope (mínimo 1).
  const scale = Math.max(1, Math.min(wantedScale, ZOOM_MAX_LONG / Math.max(region.width, region.height)))
  mkdirSync(SHOT_DIR, { recursive: true })
  // Nombres impredecibles y que nunca salen en un texto al modelo: el agente aislado puede escribir en esta carpeta y el helper corre fuera.
  const outPath = join(SHOT_DIR, `zoom-app-${Date.now()}-${secretName()}.jpg`)
  const inPath = entry.png ? join(SHOT_DIR, `zin-${secretName()}.png`) : undefined
  try {
    // macOS: los bytes conservados en memoria se escriben justo ahora (flag 'wx': falla si ya existe, p. ej. un enlace puesto de antemano).
    if (inPath && entry.png) writeFileSync(inPath, entry.png, { flag: 'wx', mode: 0o600 })
    const r = await backend.zoomWindow({
      appKey: entry.app.bundleId,
      windowIndex: entry.windowIndex,
      srcPath: inPath,
      outPath,
      region,
      scale,
      maxLong: ZOOM_MAX_LONG
    })
    if (entry.rect) {
      // Windows: el zoom es una captura NUEVA de la ventana; solo vale si sigue donde y como estaba al capturar.
      const t = WINDOW_FRAME_TOLERANCE
      const same =
        !!r.rect &&
        Math.abs(r.rect.x - entry.rect.x) <= t &&
        Math.abs(r.rect.y - entry.rect.y) <= t &&
        Math.abs(r.rect.width - entry.rect.width) <= t &&
        Math.abs(r.rect.height - entry.rect.height) <= t
      if (!same) {
        dropWindowShot(key)
        windowCtx.delete(key)
        throw reject(
          'window-moved',
          `La ventana de ${entry.app.name} se movió o cambió de tamaño desde la captura: no se hace zoom. Toma app_screenshot otra vez.`,
          session
        )
      }
    }
    const base64 = readShotFile(outPath).toString('base64')
    return {
      text:
        `Zoom de (${x}, ${y}) ${width}x${height} px de tu última app_screenshot de ${entry.app.name} (resultado: ${r.width}x${r.height} px). ` +
        'Esta imagen es SOLO para mirar — sus coordenadas no sirven para clics: usa las de app_screenshot.',
      shot: { path: outPath, base64, width: r.width, height: r.height, ratio: 1 }
    }
  } finally {
    safeRm(outPath)
    safeRm(inPath)
  }
}

/** Firma de luminancia de un PNG en disco; `null` si no se puede leer o decodificar. */
function signatureFromFile(path: string): ProbeSignature | null {
  try {
    return probeSignature(readShotFile(path))
  } catch {
    return null
  }
}

const withTimeout = <T>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
  new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms)
    t.unref?.()
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      () => {
        clearTimeout(t)
        resolve(fallback)
      }
    )
  })

/**
 * Origen aislado (§2.4): lista numerada de lo pulsable de la app concedida que cae DENTRO del marco visible de la ventana capturada
 * (máx. 30, tope de 3 s). Solo se ofrece con el nivel «Ver y clic» de esa app. Best-effort: ante cualquier fallo, lista vacía.
 */
async function buildCaptureElements(ctx: WindowCtx, session: string | undefined): Promise<CaptureElement[]> {
  try {
    const tier = await tierOf(ctx.app, session)
    if (!tier || TIER_RANK[tier] < TIER_RANK.click) return []
    const found = await withTimeout(
      findElementsHelper(ctx.app.bundleId, { roles: SHOT_ELEMENT_ROLES }),
      ELEMENTS_QUERY_MS,
      [] as FoundElement[]
    )
    const toPx = (pt: { x: number; y: number }): { x: number; y: number } => ({
      x: ((pt.x - ctx.rect.x) * ctx.imageWidth) / ctx.rect.width,
      y: ((pt.y - ctx.rect.y) * ctx.imageHeight) / ctx.rect.height
    })
    return found
      .filter((el) => el && el.enabled !== false && el.width > 1 && el.height > 1)
      .filter((el) => el.screenPoint && Number.isFinite(el.screenPoint.x) && Number.isFinite(el.screenPoint.y))
      .filter((el) => inRect(ctx.frame, el.screenPoint.x, el.screenPoint.y))
      .filter((el) => elementLabel(el) || el.role === 'AXTextField' || el.role === 'AXTextArea')
      .map((el) => ({ el, px: toPx(el.screenPoint) }))
      .sort((p, q) => p.px.y - q.px.y || p.px.x - q.px.x)
      .slice(0, 30)
      .map(({ el }) => ({
        role: el.role,
        label: elementLabel(el).slice(0, 50),
        point: { x: el.screenPoint.x, y: el.screenPoint.y },
        width: el.width,
        height: el.height
      }))
  } catch (err) {
    log('lista de elementos de la captura:', err instanceof Error ? err.message : err)
    return []
  }
}

/** Texto de la lista numerada de una captura (puntos y tamaños en px de la imagen que vio el modelo). */
function captureElementsText(ctx: WindowCtx, els: readonly CaptureElement[]): string {
  const lines = els.map((e, i) => {
    const px = {
      x: ((e.point.x - ctx.rect.x) * ctx.imageWidth) / ctx.rect.width,
      y: ((e.point.y - ctx.rect.y) * ctx.imageHeight) / ctx.rect.height
    }
    const w = Math.max(1, Math.round((e.width * ctx.imageWidth) / ctx.rect.width))
    const h = Math.max(1, Math.round((e.height * ctx.imageHeight) / ctx.rect.height))
    return `[${i + 1}] ${ELEMENT_ROLE_ES[e.role] ?? e.role}${e.label ? ` «${e.label}»` : ''} (${Math.round(px.x)}, ${Math.round(px.y)}) ${w}×${h}`
  })
  return (
    `Captura #${ctx.captureId} — elementos de ${ctx.app.name} (para pulsar uno: element: N y capture: ${ctx.captureId}; ` +
    `valen hasta la próxima app_screenshot o 90 s, y si la ventana cambia se rechazan con [rechazo: stale]):\n${lines.join('\n')}`
  )
}

/**
 * Captura de la ventana `windowIndex` de una app concedida (cuerpo de `app_screenshot`). También la usa `screenshot: true` de las acciones
 * del modo de apps: siempre con una app y un índice concretos (nunca pantalla completa), y exige el nivel «ver» de esa app.
 */
async function appWindowShot(app: AppRef, windowIndex: number, session: string | undefined): Promise<{ text: string; shot: Shot }> {
  await requireTierFor(app, 'view', session)
  // Origen aislado: una captura nueva reemplaza a la anterior desde que empieza; si falla, no queda vigente la vieja (de otra app o ventana).
  if (isolatedCall) {
    windowCtx.delete(ctxKey(session))
    dropWindowShot(ctxKey(session))
  }
  mkdirSync(SHOT_DIR, { recursive: true })
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  // El PNG crudo lleva nombre aleatorio propio (no derivado del `stamp` que sale en el texto): el helper lo escribe y luego se lee.
  const raw = join(SHOT_DIR, `raw-app-${Date.now()}-${secretName()}.png`)
  // Prefijo "shot-": `cleanupShots()` la recoge igual que las capturas de pantalla completa.
  const out = join(SHOT_DIR, `shot-app-${stamp}.jpg`)
  // Origen aislado: miniatura PNG de la MISMA captura (Windows) para la firma de la lista de elementos; nunca llega al modelo.
  const probe = isolatedCall ? join(SHOT_DIR, `probe-app-${secretName()}.png`) : undefined
  try {
    const info = await backend.windowShot(app.bundleId, raw, out, windowIndex, probe)
    const jpg = readShotFile(out)
    const base64 = jpg.toString('base64')
    cleanupShots()
    if (isolatedCall) {
      // Origen aislado: esta captura fija el espacio de los clics (px de ESTA imagen → puntos de la ventana). Las pantallas se releen
      // en cada captura. Si no se puede asegurar dónde está la ventana, se borra la anterior y esta sirve solo para mirar.
      allScreens = null
      let loc: Awaited<ReturnType<typeof backend.locateWindowShot>> = null
      try {
        await getAllScreens()
        loc = await backend.locateWindowShot(app.bundleId, windowIndex, info, out)
      } catch (err) {
        log('app_screenshot: no se pudo ubicar la ventana:', err instanceof Error ? err.message : err)
        loc = null
      }
      const located = setWindowCtx(session, app, windowIndex, loc)
      const size = located && loc ? `${loc.imageWidth}x${loc.imageHeight}` : `${info.width}x${info.height}`
      const title = info.title ? ` («${info.title}»)` : ''
      const imageWidth = located && loc ? loc.imageWidth : info.width
      const imageHeight = located && loc ? loc.imageHeight : info.height

      // Zoom (§2.1): lo necesario para ampliar ESTA captura. macOS conserva el PNG grande (el doble de detalle que el JPEG);
      // Windows guarda el rectángulo de origen para volver a capturar el trozo. Independiente de que la ventana se haya podido ubicar.
      const pngForSignature: string = backend.id === 'darwin' ? '' : (probe ?? '')
      let darwinPng: Buffer | undefined
      try {
        if (backend.id === 'darwin') {
          const px = jpegSize(jpg)
          const w = located && loc ? loc.imageWidth : (px?.width ?? 0)
          const h = located && loc ? loc.imageHeight : (px?.height ?? 0)
          if (w > 0 && h > 0 && Number.isFinite(info.width) && Number.isFinite(info.height)) {
            // Se leen los bytes (archivo regular, sin enlaces) y el archivo se borra en el `finally`: nada previsible queda en disco.
            darwinPng = readShotFile(raw)
            setWindowShot(session, {
              app,
              windowIndex,
              imageWidth: w,
              imageHeight: h,
              png: darwinPng,
              pngWidth: info.width,
              pngHeight: info.height
            })
          }
        } else if (info.rect && validRect(info.rect) && imageWidth > 0 && imageHeight > 0) {
          setWindowShot(session, { app, windowIndex, imageWidth, imageHeight, rect: { ...info.rect } })
        }
      } catch (err) {
        log('app_screenshot: sin zoom para esta captura:', err instanceof Error ? err.message : err)
      }

      // Lista numerada atada a esta captura (§2.4) y aviso de ventana tapada (§2.2): solo si la ventana quedó ubicada.
      let extra = ''
      const stored = located ? windowCtx.get(ctxKey(session)) : undefined
      if (stored && loc) {
        stored.signature = darwinPng ? probeSignature(darwinPng) : pngForSignature ? signatureFromFile(pngForSignature) : null
        if (stored.signature) {
          const els = await buildCaptureElements(stored, session)
          if (els.length) {
            stored.elements = els
            extra += `\n${captureElementsText(stored, els)}`
          }
        }
        try {
          const own = backend.id === 'darwin' ? await backend.windowFrames(app.bundleId).catch(() => [] as Rect[]) : []
          const res = await withTimeout(backend.occlusion(app.bundleId, loc.frame, own, await getAllScreens()), 6_000, {
            known: false as const
          })
          const notice = coverageNotice(res)
          if (notice) extra += `\n${notice}`
        } catch (err) {
          log('app_screenshot: aviso de ventana tapada:', err instanceof Error ? err.message : err)
        }
      }
      return {
        text: located
          ? `Ventana de ${app.name}: ${size} px${title}. Las x/y de left_click, double_click, right_click, mouse_move, drag, scroll y ` +
            'teach_step van en píxeles de ESTA imagen; valen 90 s o hasta la siguiente app_screenshot. Archivo: ' +
            out +
            extra
          : `Ventana de ${app.name}: ${size} px${title}. No se pudo ubicar la ventana: esta captura sirve para mirar, no para clics. Archivo: ` +
            out,
        shot: {
          path: out,
          base64,
          width: located && loc ? loc.imageWidth : info.width,
          height: located && loc ? loc.imageHeight : info.height,
          ratio: 1
        }
      }
    }
    return {
      text:
        `Ventana de ${app.name}: ${info.width}x${info.height} px${info.title ? ` («${info.title}»)` : ''}. ` +
        'Solo para mirar: esta imagen NO sirve para sacar coordenadas de clic (no sabe dónde está la ventana ' +
        'en la pantalla). Para clicar algo, usa screenshot o find_element. Archivo: ' +
        out,
      shot: { path: out, base64, width: info.width, height: info.height, ratio: await ensureRatio() }
    }
  } finally {
    safeRm(raw)
    safeRm(probe)
  }
}

// ───────────────────────────── veredicto de acción y espera con condición (modo de apps) ─────────────────────────────
//
// docs/PLAN-CONTROL-MEJOR.md §2.3 y §2.5. SOLO con `isolatedCall`: fuera del modo de apps nada de esto corre y las respuestas son las de siempre.
// Las sondas son capturas de la ventana de una app YA concedida que se reducen a porcentajes aquí mismo: ni la imagen ni su ruta llegan al
// modelo, y el archivo se borra siempre (`probeOf`). Si algo de la sonda falla, el veredicto es `unverifiable`: nunca un error.

/** Apagador: `COMPUTER_VERDICT=0` quita sondas y veredicto (ENCENDIDO por defecto: decisión de Ben). */
const VERDICT_ON = verdictEnabled(process.env)

/** Acciones con veredicto. `mouse_move` no lo lleva; `batch` da UNO para todo el lote; `wait` lo arma él mismo. */
const VERDICT_TOOLS: ReadonlySet<string> = new Set([
  'left_click',
  'double_click',
  'right_click',
  'scroll',
  'drag',
  'type_text',
  'key',
  'batch'
])

/** Registro de repeticiones, UNO por sesión (una sesión nunca ve lo de otra), en memoria y con tope de sesiones. */
const ACTION_LOGS_MAX = 64
const actionLogs = new Map<string, ActionLog>()

function actionLogFor(session: string | undefined): ActionLog {
  const key = ctxKey(session)
  let l = actionLogs.get(key)
  if (!l) {
    if (actionLogs.size >= ACTION_LOGS_MAX) {
      const oldest = actionLogs.keys().next().value
      if (oldest !== undefined) actionLogs.delete(oldest)
    }
    l = new ActionLog()
    actionLogs.set(key, l)
  }
  return l
}

/** La captura vigente de la sesión, o `undefined` (sin borrarla ni lanzar: aquí solo se mira). */
function liveWindowCtx(session: string | undefined): WindowCtx | undefined {
  const ctx = windowCtx.get(ctxKey(session))
  return ctx && Date.now() - ctx.at <= WINDOW_CTX_TTL_MS ? ctx : undefined
}

/** Todo lo que se mira ANTES de actuar para poder comparar después. */
interface VerdictPre {
  /** App que se sonda (la del frente, ya concedida); `null` = no se puede sondear y el veredicto será `unverifiable`. */
  app: AppRef | null
  /** Nivel concedido a esa app (la lectura de vuelta de `type_text` exige «full»). */
  tier: AppTier | null
  windowIndex: number
  before: ProbeSignature | null
  windowsBefore: number | null
  frontBefore: string
  remote: boolean
  target?: ActionTarget
  targetKind: 'xy' | 'element'
  /** `type_text`: cuántas veces aparecía el final del texto en los campos antes de escribir (`null` = no se pudo leer). */
  readBefore: number | null
}

const hasArg = (v: unknown): boolean => v !== undefined && v !== null && v !== '' && typeof v !== 'boolean'
const px1 = (v: unknown): number | undefined => (hasArg(v) && Number.isFinite(Number(v)) ? Math.round(Number(v)) : undefined)

/** Objetivo de la acción para el registro de repeticiones: punto en px de la captura, o hash del texto/teclas. Nunca guarda el texto. */
function actionTarget(name: string, args: Record<string, unknown>, app: AppRef, ctx: WindowCtx | undefined): ActionTarget | undefined {
  const base = { app: app.bundleId }
  if (name === 'type_text') return { ...base, text: textKey(String(args.text ?? '')) }
  if (name === 'key')
    return {
      ...base,
      text: textKey(
        String(args.keys ?? '')
          .trim()
          .toLowerCase()
      )
    }
  if (name === 'batch') return undefined
  if (name === 'drag') {
    const x = px1(args.start_x)
    const y = px1(args.start_y)
    return x !== undefined && y !== undefined ? { ...base, x, y } : undefined
  }
  if (hasArg(args.element)) {
    // `element: N` se reduce al punto del elemento en px de SU captura: así el mismo botón cuenta como «el mismo objetivo» aunque cambie de número.
    const n = Number(args.element)
    const el = ctx && ctx.elements && Number.isInteger(n) ? ctx.elements[n - 1] : undefined
    if (!ctx || !el) return undefined
    return {
      ...base,
      x: Math.round(((el.point.x - ctx.rect.x) * ctx.imageWidth) / ctx.rect.width),
      y: Math.round(((el.point.y - ctx.rect.y) * ctx.imageHeight) / ctx.rect.height)
    }
  }
  const x = px1(args.x)
  const y = px1(args.y)
  return x !== undefined && y !== undefined ? { ...base, x, y } : undefined
}

/** Final del texto escrito para la lectura de vuelta: últimos ≤40 caracteres de la última línea no vacía. */
function readbackTail(text: string): string {
  const line =
    text
      .split(/[\r\n]+/)
      .filter((l) => l.trim())
      .pop() ?? ''
  return line.slice(-40).trim()
}

/** Cuántas veces aparece `tail` en los valores de los campos de la app (por accesibilidad); `null` si no se pudo leer a tiempo. */
async function countTail(bundleId: string, tail: string): Promise<number | null> {
  const found = await withTimeout(
    findElementsHelper(bundleId, { query: tail }).catch(() => null),
    2_500,
    null
  )
  if (!found) return null
  const needle = fold(tail)
  let n = 0
  for (const el of found) {
    if (el.role === 'AXSecureTextField' || typeof el.value !== 'string') continue
    n += fold(el.value).split(needle).length - 1
  }
  return n
}

/** Antes de actuar: app al frente, ventanas, sonda y (en `type_text`) lectura previa. Nunca lanza: lo que falle deja el veredicto en `unverifiable`. */
async function beginVerdict(name: string, args: Record<string, unknown>, session: string | undefined): Promise<VerdictPre> {
  const pre: VerdictPre = {
    app: null,
    tier: null,
    windowIndex: 0,
    before: null,
    windowsBefore: null,
    frontBefore: '',
    remote: false,
    targetKind: hasArg(args.element) ? 'element' : 'xy',
    readBefore: null
  }
  try {
    const front = await appFrontmost()
    pre.frontBefore = front.name || front.bundleId || ''
    pre.remote = isRemoteApp(front)
    // Solo se sonda una app concedida, identificable, que no sea exenta ni un gestor de archivos (el veredicto no abre puertas nuevas).
    if (!front.bundleId || isIsolatedExempt(front.bundleId) || isFileManagerApp(front.bundleId)) return pre
    const tier = await tierOf(front, session)
    if (!tier) return pre
    pre.app = front
    pre.tier = tier
    const ctx = liveWindowCtx(session)
    pre.windowIndex = ctx && ctx.app.bundleId === front.bundleId ? ctx.windowIndex : 0
    pre.target = actionTarget(name, args, front, ctx)
    pre.windowsBefore = await backend
      .windowFrames(front.bundleId)
      .then((f) => f.length)
      .catch(() => null)
    pre.before = await probeOf(front.bundleId, pre.windowIndex, pre.remote)
    if (name === 'type_text' && tier === 'full' && !pre.remote) {
      const tail = readbackTail(String(args.text ?? ''))
      if (tail.length >= 3) pre.readBefore = await countTail(front.bundleId, tail)
    }
  } catch (err) {
    log('veredicto (antes):', err instanceof Error ? err.message : err)
  }
  return pre
}

/** `cmd`/`ctrl`/`win`… en la combinación: copiar, pegar y similares pueden no verse en la ventana. */
const hasModifier = (keys: string): boolean => /(^|\+|\s)(cmd|command|ctrl|control|win|windows|super|meta)(\+|$)/i.test(keys.trim())

/**
 * Después de actuar: sondeo con tope (1,5 s local, 4 s con escritorio remoto), ventanas y app al frente, lectura de vuelta de `type_text`,
 * veredicto y registro. `null` solo si el control se detuvo (no se sigue capturando). Nunca lanza.
 */
async function finishVerdict(
  name: string,
  args: Record<string, unknown>,
  pre: VerdictPre,
  session: string | undefined
): Promise<Verdict | null> {
  try {
    if (await isStopped().catch(() => true)) return null
    const app = pre.app
    // La concesión pudo cambiar durante la acción: sin ella no se sigue capturando esa app.
    const stillGranted = app ? !!(await tierOf(app, session).catch(() => null)) : false
    const probe: PollResult =
      app && stillGranted && pre.before
        ? await pollProbe({
            before: pre.before,
            takeProbe: () => probeOf(app.bundleId, pre.windowIndex, pre.remote),
            remote: pre.remote,
            sleep,
            now: Date.now
          })
        : { kind: 'failed' }
    const windowsAfter =
      app && stillGranted
        ? await backend
            .windowFrames(app.bundleId)
            .then((f) => f.length)
            .catch(() => null)
        : null
    const frontAfter = await appFrontmost()
      .then((f) => f.name || f.bundleId || '')
      .catch(() => pre.frontBefore)
    let readback: 'match' | 'nomatch' | 'unavailable' = 'unavailable'
    if (name === 'type_text' && app && stillGranted && pre.tier === 'full' && !pre.remote && pre.readBefore !== null) {
      const tail = readbackTail(String(args.text ?? ''))
      const after = tail.length >= 3 ? await countTail(app.bundleId, tail) : null
      if (after !== null) readback = after > pre.readBefore ? 'match' : 'nomatch'
    }
    const log_ = actionLogFor(session)
    const repeat = pre.target ? log_.history(pre.target, Date.now()) : undefined
    const keys = String(args.keys ?? '')
    const verdict = computeVerdict({
      action: name as ActionKind,
      target: pre.targetKind,
      modifiers: name === 'key' && hasModifier(keys),
      remote: pre.remote,
      probe,
      // Si no se pudo contar antes o después, no se inventa un cambio de ventanas.
      windowsBefore: pre.windowsBefore ?? 0,
      windowsAfter: pre.windowsBefore !== null && windowsAfter !== null ? windowsAfter : (pre.windowsBefore ?? 0),
      frontBefore: pre.frontBefore,
      frontAfter,
      readback,
      repeat
    })
    if (verdict && pre.target) {
      log_.record({
        tool: name,
        app: pre.target.app,
        x: pre.target.x,
        y: pre.target.y,
        text: pre.target.text,
        effect: verdict.effect,
        at: Date.now()
      })
    }
    return verdict
  } catch (err) {
    log('veredicto (después):', err instanceof Error ? err.message : err)
    return {
      effect: 'unverifiable',
      reason: 'se entregó; no se pudo comparar la ventana; confírmalo con app_screenshot si importa'
    }
  }
}

/** Trozos de `type_text` en el modo de apps (§2.5): el foco se vuelve a mirar entre trozo y trozo. */
const TYPE_CHUNK = 200

/**
 * Parte el texto en trozos de ≤`size` caracteres SIN cortar un grafema (un emoji, una letra con acento combinado o «\r\n»): unidos dan
 * exactamente el mismo texto, así que se pulsan las mismas teclas en total.
 */
function splitTypeChunks(text: string, size = TYPE_CHUNK): string[] {
  const out: string[] = []
  let cur = ''
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
    if (cur && cur.length + segment.length > size) {
      out.push(cur)
      cur = ''
    }
    cur += segment
  }
  if (cur) out.push(cur)
  return out
}

/** Nombre de la app que está al frente si ya NO es la comprobada (o `null` si sigue siendo ella o no se pudo mirar). */
async function frontChangedTo(checked: AppRef | undefined): Promise<string | null> {
  try {
    const now = await appFrontmost()
    return sameFront(checked, now) ? null : noticeAppName(now.name || 'otra app')
  } catch {
    return null
  }
}

/** Tras pegar o pulsar una tecla (no se puede deshacer): si la app al frente ya no es la comprobada, un aviso para el modelo. Solo en el modo de apps. */
async function frontAfterNote(checked: AppRef | undefined): Promise<string> {
  if (!isolatedCall) return ''
  try {
    const now = await appFrontmost()
    if (sameFront(checked, now)) return ''
    return (
      ` Aviso: tras actuar, la app al frente es «${noticeAppName(now.name || 'otra')}» y antes era «${noticeAppName(checked?.name ?? '?')}»; ` +
      'no se puede deshacer: revisa ambas apps antes de seguir.'
    )
  } catch {
    return ''
  }
}

/**
 * `wait` con condición en el modo de apps (§2.5): `until_text` (accesibilidad de la app concedida, nivel «ver») y/o `until_change` (sondas de
 * su ventana). Sondea cada 500 ms con tope de `seconds` (≤20); sin pausas fijas largas. Devuelve el veredicto en la primera línea.
 */
async function isolatedWait(a: Record<string, unknown>, session: string | undefined): Promise<string> {
  const secs = Math.max(0, Math.min(20, Number(a.seconds) || 1))
  const wanted = typeof a.until_text === 'string' ? a.until_text.trim() : ''
  if (wanted.length > 200) throw new Error('until_text demasiado largo (máx. 200 caracteres)')
  const change = a.until_change === true
  const ctx = liveWindowCtx(session)
  const named = typeof a.app === 'string' && a.app.trim() ? await namedApp(a.app) : null
  const app = named ?? ctx?.app
  if (!app) {
    throw reject('no-capture', 'Indica la app (app: "…") o toma antes app_screenshot de la app en la que esperas algo.', session)
  }
  // Mirar el árbol de accesibilidad o la ventana de una app exige que esté concedida, aquí como mínimo para ver.
  await requireTierFor(app, 'view', session)
  const windowIndex = ctx && ctx.app.bundleId === app.bundleId ? ctx.windowIndex : 0
  const remote = isRemoteApp(app)
  // Plazo TOTAL: cuenta también lo que gastan las sondas y las lecturas (no solo las pausas entre vueltas).
  const deadline = Date.now() + secs * 1000
  const beforeSig = change ? await probeOf(app.bundleId, windowIndex, remote, deadline - Date.now()) : null
  const res: { hit: FoundElement | null; diff: ProbeDiff | null } = { hit: null, diff: null }
  await act({ tool: 'wait', text: `${secs}s` }, async () => {
    // En CADA vuelta (y otra vez tras cada lectura, antes de quedarse con ella): ¿se detuvo el control o se revocó la app a mitad de la
    // espera? Entonces se sale ya, sin devolver ficha ni texto leído. `requireTierFor` lanza `[rechazo: no-grant]` si ya no hay concesión.
    const sigueVigente = async (): Promise<void> => {
      if (await isStopped().catch(() => true)) throw new Error(STOPPED_MSG)
      await requireTierFor(app, 'view', session)
    }
    for (;;) {
      await sigueVigente()
      if (wanted) {
        const found = await withTimeout(
          findElementsHelper(app.bundleId, { query: wanted }).catch(() => null),
          3_000,
          null
        )
        await sigueVigente()
        const w = fold(wanted)
        res.hit = found?.find((el) => el.role !== 'AXSecureTextField' && elementTextFields(el).some((f) => fold(f).includes(w))) ?? null
        if (res.hit) return
      }
      if (beforeSig) {
        const sig = await probeOf(app.bundleId, windowIndex, remote, deadline - Date.now())
        await sigueVigente()
        const d = sig ? diffSignatures(beforeSig, sig) : null
        if (d && hasChanged(d)) {
          res.diff = d
          return
        }
      }
      if (Date.now() >= deadline) return
      await sleep(Math.min(500, Math.max(0, deadline - Date.now())))
    }
  })
  const secsText = `${Math.round(secs * 10) / 10}`
  if (res.hit) {
    const label = wanted.slice(0, 60)
    // La ficha usa el texto que el propio modelo pidió (no el contenido del campo) y sus px de la captura vigente.
    const ficha = describeElement(
      { ...res.hit, title: label, description: undefined, identifier: undefined, value: undefined },
      0,
      1,
      isolatedCtxFor(app, session)
    )
    return `${formatVerdict({ effect: 'confirmed', reason: `apareció «${label}» en ${app.name}` })}\n${ficha}`
  }
  if (res.diff) {
    const d = res.diff
    const ctxNow = windowCtx.get(ctxKey(session))
    if (ctxNow) ctxNow.elements = null
    return `${formatVerdict({ effect: 'confirmed', reason: `la ventana de ${app.name} cambió ~${d.changedPct < 1 ? '<1' : Math.round(d.changedPct)} %${d.zone ? ` (zona ${d.zone})` : ''}; la lista de elementos anterior ya no vale: toma app_screenshot` })}`
  }
  const what = [wanted ? `«${wanted.slice(0, 60)}»` : '', change ? 'un cambio en la ventana' : ''].filter(Boolean).join(' ni ')
  const note = remote && wanted ? '; los escritorios remotos no exponen texto por accesibilidad: usa until_change y mira con zoom' : ''
  return formatVerdict({ effect: 'unverifiable', reason: `no apareció ${what} en ${secsText} s${note}` })
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
      'usa las de la captura original. En el modo de apps (sin screenshot de pantalla) el zoom es de tu última app_screenshot: ' +
      'x,y,width,height en píxeles de ESA imagen (los mismos de los clics), con más detalle que la imagen que viste; ' +
      'sirve para leer cifras y letra chica, y solo muestra la ventana de esa app.',
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
    run: async (a, session) => {
      if (isolatedCall) return isolatedZoom(a, session)
      if (!lastShot || (isolatedCall && lastShotSession !== session)) {
        throw new Error('Todavía no hay ninguna captura de pantalla completa — pide una con screenshot primero.')
      }
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
      const outPath = join(SHOT_DIR, `zoom-${Date.now()}-${secretName()}.jpg`)
      const r = await backend.zoomImage({ inPath: shot.path, outPath, x, y, width, height, scale })
      const base64 = readShotFile(outPath).toString('base64')
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
    description:
      'Clic izquierdo en (x, y) px de la captura, o en el elemento N de la lista de la última captura (element: N, más exacto; en el modo de apps, con capture: el número de esa captura).',
    inputSchema: obj({ ...XY, ...ELEMENT_ARG, ...SHOT_FLAG }, []),
    action: true,
    run: (a, session) => clickTool(a, 'left', 1, 'left_click', session)
  },
  {
    name: 'right_click',
    description: 'Clic derecho en (x, y) px de la captura, o en el elemento N de la lista (element: N; en el modo de apps, con capture).',
    inputSchema: obj({ ...XY, ...ELEMENT_ARG, ...SHOT_FLAG }, []),
    action: true,
    run: (a, session) => clickTool(a, 'right', 1, 'right_click', session)
  },
  {
    name: 'double_click',
    description:
      'Doble clic izquierdo en (x, y) px de la captura, o en el elemento N de la lista (element: N; en el modo de apps, con capture).',
    inputSchema: obj({ ...XY, ...ELEMENT_ARG, ...SHOT_FLAG }, []),
    action: true,
    run: (a, session) => clickTool(a, 'left', 2, 'double_click', session)
  },
  {
    name: 'mouse_move',
    description:
      'Mueve el puntero a (x, y) px de la captura, o al elemento N de la lista (element: N; en el modo de apps, con capture), sin hacer clic.',
    inputSchema: obj({ ...XY, ...ELEMENT_ARG, ...SHOT_FLAG }, []),
    action: true,
    run: async (a, session) => {
      await requireForeground(session)
      const { p, label, ctx } = await pointFromArgs(a, session)
      if (ctx) await assertCapturedAppAt(ctx, p, session)
      await requireTier('click', p, session)
      if (ctx) await recheckWindow(ctx, session)
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
      let waitedS = 0
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
          if (name === 'wait') {
            waitedS += Math.max(0, Math.min(20, Number(innerArgs.seconds) || 1))
            if (waitedS > BATCH_WAIT_MAX_S) {
              throw reject(
                'batch-wait-limit',
                `Las esperas del lote suman más de ${BATCH_WAIT_MAX_S} s: usa pasos separados para esperar más.`,
                session
              )
            }
          }
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
      // Origen aislado: los dos extremos en px de la MISMA ventana capturada (no se arrastra a otra app ni al escritorio).
      const ws = isolatedCall ? await toWindowPoints(session, a.start_x, a.start_y) : undefined
      const we = isolatedCall ? await toWindowPoints(session, a.end_x, a.end_y) : undefined
      const s = ws ? ws.p : await toPoints(a.start_x, a.start_y)
      const e = we ? we.p : await toPoints(a.end_x, a.end_y)
      // Arrastrar necesita "Control total": mueve/reordena contenido, no es un simple clic.
      if (ws && we) {
        await assertCapturedAppAt(ws.ctx, s, session)
        await assertCapturedAppAt(we.ctx, e, session)
      }
      await requireTier('full', s, session)
      await requireTier('full', e, session)
      if (ws && we) await recheckWindow(ws.ctx, session)
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
      const w = isolatedCall ? await toWindowPoints(session, a.x, a.y) : undefined
      const p = w ? w.p : await toPoints(a.x, a.y)
      const n = Math.max(1, Math.min(30, Math.round(Number(a.amount) || 5)))
      const dir = String(a.direction)
      const dx = dir === 'right' ? n : dir === 'left' ? -n : 0
      const dy = dir === 'down' ? n : dir === 'up' ? -n : 0
      if (!dx && !dy) throw new Error('direction debe ser up, down, left o right')
      if (w) await assertCapturedAppAt(w.ctx, p, session)
      await requireTier('click', p, session)
      if (w) await recheckWindow(w.ctx, session)
      await act({ tool: 'scroll', x: p.x, y: p.y, text: `${dir} ${n}` }, () =>
        helper('scroll', String(p.x), String(p.y), String(dx), String(dy))
      )
      return `Scroll ${dir} ${n} en (${a.x}, ${a.y}) px`
    }
  },
  {
    name: 'type_text',
    description:
      'Escribe texto (unicode) en el elemento con foco. "\\n" pulsa Return. Nunca escribas contraseñas ni datos de pago. ' +
      'En ventanas de escritorio remoto (Windows App, AnyDesk, TeamViewer, RustDesk…) escribe por TECLAS FÍSICAS. En Windows App, si { } [ ] | salen ' +
      'cambiados, pasa su teclado a modo Unicode con key "ctrl+cmd+u" (ctrl+cmd+k = Scancode) y repite. Comprueba SIEMPRE con zoom lo escrito (la imagen ' +
      'remota llega con retraso). `input`: "keys" | "paste" (portapapeles remoto: poco fiable) | "unicode"; "layout": "us" si el equipo remoto tiene teclado inglés.',
    inputSchema: obj(
      {
        text: { type: 'string' },
        input: { type: 'string', enum: ['auto', 'paste', 'keys', 'unicode'] },
        paste_key: { type: 'string' },
        layout: { type: 'string', enum: ['mac', 'us'] },
        ...EXPECT_APP,
        ...SHOT_FLAG
      },
      ['text']
    ),
    action: true,
    run: async (a, session) => {
      await requireForeground(session)
      const text = String(a.text ?? '')
      if (!text) throw new Error('text vacío')
      if (text.length > 5000) throw new Error('Texto demasiado largo (máx. 5000 caracteres)')
      await checkExpectApp(a.expect_app)
      const checkedFront = await requireTier('full', undefined, session)
      await requireCanType()
      const layout = a.layout === 'us' ? 'us' : 'mac'
      const mode = await typeModeFor(a.input)
      // Origen aislado: el atajo de pegar es fijo por plataforma (cmd+v en macOS, ctrl+v en Windows); cualquier `paste_key` se ignora: sería una combinación libre.
      const pasteKey = isolatedCall
        ? isolatedPasteKey(backend.id)
        : typeof a.paste_key === 'string' && a.paste_key.trim()
          ? a.paste_key.trim()
          : 'cmd+v'
      // Modo de apps: cuántos caracteres se escribieron y, si el foco cambió a mitad, a qué app pasó (el texto restante NO se escribe).
      const fx: { typed: number; stolenBy: string | null; endedOn: string | null } = { typed: 0, stolenBy: null, endedOn: null }
      await act({ tool: 'type_text', text: text.length > 120 ? `${text.slice(0, 117)}…` : text }, async () => {
        // Origen aislado: la app en primer plano se vuelve a comprobar JUSTO antes de escribir/pegar.
        await recheckFront(checkedFront, session)
        if (!isolatedCall) {
          return mode === 'paste'
            ? backend.pasteText!(text, pasteKey, isolatedCall ? () => recheckFront(checkedFront, session) : undefined).then(() => '')
            : mode === 'keys'
              ? backend.typeKeys!(text, layout)
              : helper('type', text)
        }
        if (mode === 'paste') {
          await backend.pasteText!(text, pasteKey, isolatedCall ? () => recheckFront(checkedFront, session) : undefined)
          fx.typed = text.length
          fx.endedOn = await frontChangedTo(checkedFront)
          return ''
        }
        // Por trozos de 200 caracteres: entre un trozo y el siguiente se vuelve a mirar quién tiene el foco. Unidos, los trozos son el mismo texto.
        const chunks = splitTypeChunks(text)
        for (let k = 0; k < chunks.length; k++) {
          if (k > 0) {
            const now = await appFrontmost()
            if (!sameFront(checkedFront, now)) {
              fx.stolenBy = noticeAppName(now.name || 'otra app')
              return ''
            }
          }
          await (mode === 'keys' ? backend.typeKeys!(chunks[k], layout) : helper('type', chunks[k]))
          fx.typed += chunks[k].length
        }
        fx.endedOn = await frontChangedTo(checkedFront)
        return ''
      })
      if (fx.stolenBy !== null) {
        windowCtx.delete(ctxKey(session))
        throw reject(
          'focus-stolen',
          `Se escribieron ${fx.typed} de ${text.length} caracteres; luego pasó al frente «${fx.stolenBy}» y se dejó de escribir (el resto NO se escribió). ` +
            'Revisa ambas apps antes de seguir.',
          session
        )
      }
      const how = mode === 'paste' ? ` por portapapeles (${pasteKey})` : mode === 'keys' ? ' por teclas físicas' : ''
      const hint =
        mode === 'keys'
          ? '. Comprueba con zoom (la imagen remota llega con retraso: espera unos segundos). Si los símbolos { } [ ] | salieron cambiados y es Windows App: pasa su teclado a modo Unicode con la tecla ctrl+cmd+u (ctrl+cmd+k vuelve a Scancode) y repite.'
          : mode === 'paste'
            ? '. Comprueba con zoom que apareció bien (si salió el texto anterior, el portapapeles remoto no se sincronizó: usa input "keys").'
            : ''
      const after =
        fx.endedOn !== null
          ? ` Aviso: al terminar, la app al frente es «${fx.endedOn}» y antes era «${noticeAppName(checkedFront?.name ?? '?')}»; no se puede deshacer: revisa ambas apps antes de seguir.`
          : ''
      return `Escrito${how}: ${text.length} caracteres${hint}${after}`
    }
  },
  {
    name: 'key',
    description:
      'Pulsa una tecla o combinación, p.ej. "return", "cmd+space", "cmd+shift+t", "escape", "tab", "up", "f5". ' +
      'Varias combinaciones separadas por espacio se pulsan en secuencia.',
    inputSchema: obj({ keys: { type: 'string' }, layout: { type: 'string', enum: ['mac', 'us'] }, ...EXPECT_APP, ...SHOT_FLAG }, ['keys']),
    action: true,
    run: async (a, session) => {
      await requireForeground(session)
      await checkExpectApp(a.expect_app)
      let keys = String(a.keys ?? '').trim()
      if (!keys) throw new Error('keys vacío')
      // Origen aislado: UNA combinación, de vocabulario conocido y fuera de la lista cerrada de las que cambian de app o abren cosas del sistema.
      if (isolatedCall) keys = checkIsolatedKeys(keys, session)
      const sendKeys = await backend.checkKeys(keys) // política de combinaciones (Windows); en macOS devuelve `keys` tal cual
      const checkedFront = await requireTier('full', undefined, session)
      await requireCanType()
      const viaKeys = await shouldPressByKeys()
      await act({ tool: 'key', text: keys }, async () => {
        // Origen aislado: la app en primer plano se vuelve a comprobar JUSTO antes de pulsar (si cambió o es exenta, no se pulsa).
        await recheckFront(checkedFront, session)
        return viaKeys ? backend.pressKeys!(sendKeys, a.layout === 'us' ? 'us' : 'mac') : helper('key', sendKeys)
      })
      // Modo de apps: tras pulsar se vuelve a mirar el frente (no se puede deshacer); si cambió, un aviso.
      return `Teclas pulsadas: ${keys}${await frontAfterNote(checkedFront)}`
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
      let canActivate = true
      if (isolatedCall) {
        // Origen aislado: abrir una app también exige su concesión (una app bloqueada o sin conceder no se abre).
        const ref = await resolveApp(name)
        if (!ref.found) throw new Error(backend.text.appNotFound(name))
        await ensureTier({ bundleId: ref.bundleId, name: ref.name }, 'view', session)
        // Con el control acotado por la tarjeta de una app (sin toma de control explícita), traerla al frente (y desminimizarla) exige
        // «Control total» de ESA app: con menos se abre en segundo plano, aunque la sesión tenga el ratón y el teclado por otra app.
        // Con una toma de control aprobada (`request_full_control`) sigue como siempre.
        const { scoped } = await controlMode(session)
        if (scoped) canActivate = (await tierOf({ bundleId: ref.bundleId, name: ref.name }, session)) === 'full'
      }
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
      if ((mode === 'background' || isolatedCall) && (!foreground || !canActivate)) {
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
        // Origen aislado con el ratón y el teclado ya concedidos por otra vía: si no se activó fue por el nivel de ESTA app; se le dice al
        // modelo cómo seguir (si no, devolvía el problema a la persona en vez de volver a pedir el nivel).
        const needFull =
          isolatedCall && foreground && !canActivate
            ? ` NO se trajo al frente: hacerlo exige «Control total» de esta app. Si hace falta, llama a request_access con apps: ["${name}"] y levels: ["full"] (con un motivo) y espera la respuesta de la persona; no le pidas que lo haga ella.`
            : ''
        return `Abierta ${name} en segundo plano (sin activarla ni traerla al frente).${behindNote}${needFull}`
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
    description:
      'Espera N segundos (máx. 10) para que la interfaz termine de cargar. Solo en el modo de apps: until_text espera a que aparezca ese ' +
      'texto en la app (por accesibilidad; app opcional, por defecto la de la última app_screenshot) y until_change a que cambie su ventana ' +
      '(útil en escritorios remotos, que no exponen texto); con ellas seconds llega a 20 y se vuelve en cuanto se cumple. Fuera de ese ' +
      'modo until_text, until_change y app se ignoran.',
    inputSchema: obj(
      {
        seconds: { type: 'number' },
        until_text: { type: 'string', description: 'Solo modo de apps: texto que debe aparecer en la app concedida (máx. 200 caracteres)' },
        until_change: { type: 'boolean', description: 'Solo modo de apps: volver en cuanto la ventana de la app cambie' },
        app: { type: 'string', description: 'Solo modo de apps: app donde esperar (por defecto la de la última app_screenshot)' },
        ...SHOT_FLAG
      },
      ['seconds']
    ),
    action: true,
    run: async (a, session) => {
      // Modo de apps con condición: sondeo con tope (exige el nivel de la app); sin condición, la pausa fija de siempre.
      if (isolatedCall && ((typeof a.until_text === 'string' && a.until_text.trim()) || a.until_change === true)) {
        return isolatedWait(a, session)
      }
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
      'request_access. Si cancela, no actúes y explícaselo. Si una app ya estaba abierta con trabajo del usuario, la respuesta ' +
      'te lo avisará: trabaja en una ventana o documento nuevo y no toques lo que ya había.',
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
      // Origen aislado: sin puerta del plan, la tarjeta es la de permiso por app (no se abre tarjeta de plan).
      const plan =
        Array.isArray(a.plan) && !isolatedCall
          ? a.plan
              .map((x) => String(x).trim())
              .filter(Boolean)
              .slice(0, 30)
          : undefined
      const hasPlan = !!plan?.length
      if (!entries.length && !hasPlan) {
        if (isolatedCall) {
          throw new Error('Indica en "apps" las apps que vas a controlar (con su nivel en "levels"). En este modo no hace falta plan.')
        }
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
      // Apps que la persona YA tenía abiertas (puede haber trabajo sin guardar): se marcan en la tarjeta y se le dice al modelo que no escriba sobre ello.
      const openNow = await backend.openAppKeys?.().catch(() => new Set<string>())
      const valid: Array<AppRef & { requested: AppTier; alreadyOpen?: boolean }> = [...byId.values()].map((v) =>
        openNow?.has(v.bundleId) ? { ...v, alreadyOpen: true } : v
      )
      const missing = resolved.filter((r) => !r.found).map((r) => r.input)
      if (!valid.length && !hasPlan) {
        return backend.text.noAppsFound(missing)
      }
      const reply = await requestAccess(
        valid,
        typeof a.reason === 'string' ? a.reason.slice(0, 500) : undefined,
        plan,
        session,
        missing.length ? missing.slice(0, 10) : undefined
      )
      if (reply.retry) return ACCESS_RETRY_MSG
      const { decisions, feedback, cancelled, planApproved, auto } = reply
      const blockedById = new Map((reply.blocked ?? []).map((b) => [b.bundleId, b]))
      // Todo lo pedido está bloqueado y no hay plan que aprobar: main no abrió tarjeta. Respuesta fija, sin ofrecer vías alternativas.
      if (blockedById.size && valid.every((v) => blockedById.has(v.bundleId)) && !hasPlan) {
        return [...blockedById.values()].map(blockedMessage).join('\n')
      }
      if (cancelled) {
        const cancelledText = 'El usuario canceló: no se concedió nada ni se aprobó el plan. No actúes; explícaselo y detente.'
        return blockedById.size
          ? [cancelledText, ...[...blockedById.values()].map((b) => `- ${blockedMessage(b)}`)].join('\n')
          : cancelledText
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
        const blockedApp = blockedById.get(r.bundleId)
        if (blockedApp) return `- ${blockedMessage(blockedApp)}`
        const d = decisions[r.bundleId] ?? ''
        const t = asTier(d)
        const short =
          t && TIER_RANK[t] < TIER_RANK[r.requested] ? ` (pediste "${TIER_LABEL[r.requested]}": si lo necesitas, díselo al usuario)` : ''
        const openNote =
          r.alreadyOpen && t && TIER_RANK[t] >= TIER_RANK.click
            ? ` AVISO: «${r.name}» ya estaba abierta con ventanas de la persona (puede haber trabajo sin guardar). NO escribas, pegues, borres ni ` +
              'cierres nada de lo que ya había: abre una ventana o un documento NUEVO (Ctrl/Cmd+N o el menú Archivo › Nuevo) y trabaja solo ahí. ' +
              'Si la tarea exige editar algo que ya estaba abierto, pídele confirmación explícita al usuario antes de tocarlo.'
            : ''
        return `- ${r.name}: ${label(d)}${short}${openNote}`
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
      // dónde quedó todo antes de seguir. SOLO si se concedió alguna app: un plan sin apps (documentos, archivos, navegador)
      // trabaja en segundo plano y no debe tocar la pantalla ni siquiera para una captura.
      if (approvedApp && !isolatedCall) {
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
    name: 'app_menu',
    description:
      'Elige una opción de la BARRA DE MENÚS de una app por su ruta, p.ej. path ["Archivo", "Exportar como", "PDF"] ' +
      '(o ["Connections", "Keyboard Mode", "Unicode"]), SIN mover el ratón ni abrir los menús: una sola llamada en vez de ' +
      'varios clics. Ignora mayúsculas, acentos y los «…» finales. Si un tramo no existe, devuelve las opciones de ese nivel.',
    inputSchema: obj({ app: { type: 'string' }, path: { type: 'array', items: { type: 'string' } } }, ['app', 'path']),
    action: true,
    run: async (a, session) => {
      const app = await namedApp(a.app)
      await requireTierFor(app, 'click', session)
      const path = Array.isArray(a.path) ? a.path.map((x) => String(x).trim()).filter(Boolean) : []
      if (path.length < 2 || path.length > 6)
        throw new Error('path debe tener entre 2 y 6 tramos: el menú de la barra y la opción (más submenús).')
      // Una sola lectura del árbol (la barra de menús incluida): una búsqueda con tope de 50 coincidencias se quedaría con las opciones del
      // primer menú (Apple). Límite de nodos alto: las ventanas se recorren antes que los menús y pueden ser muy grandes.
      const tree = await axTree(app.bundleId, 30, 8000)
      const menuNodes: MenuNodeLike[] = tree.nodes
        .filter((n) => n.ref === 'm' || n.ref.startsWith('m.'))
        .map((n) => ({ ref: n.ref, role: n.role, title: n.title, enabled: n.enabled }))
      if (!menuNodes.length) {
        throw new Error(
          `No pude leer la barra de menús de ${app.name}` +
            (tree.truncated ? ' (la ventana es enorme y se agotó la lectura)' : '') +
            ': usa el teclado o app_tree.'
        )
      }
      let parent: string | null = null
      const chain: MenuNodeLike[] = []
      for (const [i, seg] of path.entries()) {
        const pick = pickMenuNode(menuNodes, parent, seg)
        if (!pick.node) {
          const where = i === 0 ? 'en la barra de menús' : `dentro de «${path.slice(0, i).join(' › ')}»`
          throw new Error(
            `No encontré «${seg}» ${where} de ${app.name}.` +
              (pick.options.length
                ? ` Opciones de ese nivel: ${pick.options.slice(0, 40).join(' | ')}.`
                : ' Ese menú no tiene opciones legibles.')
          )
        }
        parent = pick.node.ref
        chain.push(pick.node)
      }
      const last = chain[chain.length - 1]
      await act({ tool: 'app_menu', text: `${app.name} ${path.join(' › ')}` }, async () => {
        try {
          await axPress(app.bundleId, last.ref, 'AXMenuItem')
        } catch (firstErr) {
          // Muchas apps (Finder) validan y activan sus opciones solo al ABRIR el menú: se abren los tramos intermedios y se reintenta.
          try {
            for (const step of chain.slice(0, -1)) await axPress(app.bundleId, step.ref)
            await new Promise((r) => setTimeout(r, 250))
            await axPress(app.bundleId, last.ref, 'AXMenuItem')
          } catch {
            throw new Error(
              `No se pudo elegir «${path.join(' › ')}» en ${app.name}` +
                (last.enabled === false ? ' (la opción está desactivada en este momento)' : '') +
                `: ${firstErr instanceof Error ? firstErr.message : String(firstErr)}`
            )
          }
        }
      })
      return `Elegido «${path.join(' › ')}» en ${app.name}.`
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
      'Captura solo la ventana de una app (por defecto la principal), SIN activarla ni mover el ratón. Fuera del modo de ' +
      'apps es SOLO para mirar (confirmar que algo cargó, leer texto, ver si está tapada), NUNCA para sacar coordenadas ' +
      'de clic: no sabe dónde está esa ventana en la pantalla; para clicar usa screenshot (captura de la pantalla ' +
      'principal) o find_element. En el modo de apps (sin screenshot de pantalla) sus píxeles SÍ valen para los clics: ' +
      'las x/y de left_click, double_click, right_click, mouse_move, drag, scroll y teach_step van en píxeles de esta ' +
      'imagen y valen 90 s o hasta la siguiente app_screenshot. En ese modo el texto trae además una lista numerada de ' +
      'elementos (element: N con su capture) y avisa si otra app tapa la ventana; con zoom amplías una región de esta imagen.',
    inputSchema: obj({ app: { type: 'string' }, window: { type: 'number' } }, ['app']),
    action: true,
    noAutoShot: true,
    run: async (a, session) => {
      const app = await namedApp(a.app)
      return appWindowShot(app, Math.max(0, Math.round(Number(a.window) || 0)), session)
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
      const elRatio = isolatedCall ? 1 : await ensureRatio()
      const elCtx = isolatedCall ? isolatedCtxFor(app, session) : null
      const lines = candidates.map(({ el }, i) => describeElement(el, i, elRatio, elCtx))
      if (isolatedCall) {
        return (
          `${candidates.length} candidato(s) en ${app.name} (AX) para "${description}", de más a menos fiable:\n` +
          `${lines.join('\n')}\n` +
          (elCtx
            ? 'Usa el punto indicado (píxeles de tu última app_screenshot) con left_click/mouse_move y verifica con otra app_screenshot después de actuar.'
            : ISOLATED_NEEDS_SHOT_LINE(app))
        )
      }
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
      const listRatio = isolatedCall ? 1 : await ensureRatio()
      const listCtx = isolatedCall ? isolatedCtxFor(app, session) : null
      const lines = capped.map((el, i) => describeElement(el, i, listRatio, listCtx))
      const suffix = elements.length > capped.length ? `\n… y ${elements.length - capped.length} más (afina con "role").` : ''
      const needShot = isolatedCall && !listCtx ? `\n${ISOLATED_NEEDS_SHOT_LINE(app)}` : ''
      return `${elements.length} elemento(s) en ${app.name}${roles ? ` (rol: ${roles.join(',')})` : ''}:\n${lines.join('\n')}${suffix}${needShot}`
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
      // Origen aislado: la preferencia «Control de la pantalla» no le da el ratón (solo una tarjeta aprobada de esta sesión): sigue el flujo normal.
      if (mode === 'full' && !isolatedCall)
        return 'Ya tienes control de la pantalla (el modo no es "En segundo plano"): no hace falta pedirlo.'
      if (foreground) return `Ya tienes el control del ratón y el teclado en esta tarea para ${app.name}.`
      const reason = typeof a.reason === 'string' ? a.reason.slice(0, 500) : undefined
      const takeoverReply = await requestAccess([{ ...app, requested: 'full' }], reason, undefined, session, undefined, 'takeover')
      if (takeoverReply.retry) return ACCESS_RETRY_MSG
      const blockedApp = takeoverReply.blocked?.[0]
      if (blockedApp) return blockedMessage(blockedApp)
      const { decisions, cancelled } = takeoverReply
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
        const p = isolatedCall ? (await toWindowPoints(session, a.x, a.y)).p : await toPoints(a.x, a.y)
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

async function callTool(name: string, rawArgs: Record<string, unknown>, bridge?: BridgeHeaders): Promise<ToolResult> {
  const run = (): Promise<ToolResult> => callToolNow(name, rawArgs, bridge)
  const result = toolQueue.then(run, run)
  toolQueue = result.then(
    () => undefined,
    () => undefined
  )
  return result
}

async function callToolNow(name: string, rawArgs: Record<string, unknown>, bridge?: BridgeHeaders): Promise<ToolResult> {
  isolatedCall = false
  currentToolName = name
  try {
    return await callToolInner(name, rawArgs, bridge)
  } finally {
    isolatedCall = false
    currentToolName = ''
  }
}

async function callToolInner(name: string, rawArgs: Record<string, unknown>, bridge?: BridgeHeaders): Promise<ToolResult> {
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
    // Modo unificado: ¿la petición viene del servidor aislado? (main lo decide; sin cabecera ni bandera no se pregunta).
    if (bridge?.origin) {
      const v = await bridgeCheck(bridge, typeof lazunox_session === 'string' ? lazunox_session : undefined)
      if (v.isolated) {
        if (!v.ok) {
          return { content: [{ type: 'text', text: BRIDGE_REJECT_MSG[v.reason ?? ''] ?? BRIDGE_REJECT_MSG['bad-session'] }], isError: true }
        }
        isolatedCall = true
      }
    }
    // Puertas propias de la plataforma (Windows: consentimiento de la app, sesión interactiva, ventana elevada); macOS: ninguna.
    await backend.preflight({ tool: name, realInput: REAL_INPUT_TOOLS.has(name) })
    // Flujo Plan → Aprobar → Ejecutar: ninguna herramienta de ACCIÓN (tampoco `screenshot`) corre sin
    // un plan aprobado para esta sesión. Origen aislado: sin plan, pero cada acción exige la concesión de su app.
    if (tool.action && !isolatedCall) await requirePlanApproved(session)
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
    // Modo de apps (§2.3): sondas ANTES y DESPUÉS de las acciones con veredicto. `screenshot: false` explícito las apaga (y `COMPUTER_VERDICT=0`).
    const verdictPre =
      isolatedCall && VERDICT_ON && VERDICT_TOOLS.has(name) && args?.screenshot !== false ? await beginVerdict(name, args, session) : null
    // `screenshot: true` explícito: captura de la VENTANA de la app concedida (la de la última app_screenshot; si no hay, la del frente que se sondea).
    const liveCtx = isolatedCall && tool.action && !tool.noAutoShot && args?.screenshot === true ? liveWindowCtx(session) : undefined
    const shotApp: { app: AppRef; windowIndex: number } | null = liveCtx
      ? { app: liveCtx.app, windowIndex: liveCtx.windowIndex }
      : verdictPre?.app
        ? { app: verdictPre.app, windowIndex: verdictPre.windowIndex }
        : null
    const result = await tool.run(args, session)
    let text = typeof result === 'string' ? result : result.text
    // Un lote detenido en el paso N no lleva línea de efecto: el veredicto solo se antepone cuando terminó entero.
    if (verdictPre && !(name === 'batch' && text.startsWith('Lote detenido'))) {
      const verdict = await finishVerdict(name, args, verdictPre, session)
      if (verdict) {
        text = `${formatVerdict(verdict)}\n${text}`
        // Algo cambió (o no se sabe): la lista de elementos de la captura vigente ya no se da por buena; sin cambio, sigue valiendo.
        if (verdict.effect !== 'suspected_noop') {
          const cur = windowCtx.get(ctxKey(session))
          if (cur) cur.elements = null
        }
      }
    }
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
    if (isolatedCall && tool.action && !tool.noAutoShot && args?.screenshot === true) {
      if (!shotApp) {
        content.push({ type: 'text', text: '(sin captura: no hay una ventana concedida vigente; toma app_screenshot de la app)' })
      } else if (await isStopped().catch(() => true)) {
        content.push({ type: 'text', text: STOPPED_MSG })
      } else {
        try {
          const w = await appWindowShot(shotApp.app, shotApp.windowIndex, session)
          content.push({ type: 'image', data: w.shot.base64, mimeType: 'image/jpeg' }, { type: 'text', text: w.text })
        } catch (err) {
          content.push({ type: 'text', text: `(sin captura: ${err instanceof Error ? err.message : err})` })
        }
      }
    }
    const wantShot = tool.action && !tool.noAutoShot && AUTO_SHOT && args?.screenshot !== false && !isolatedCall
    if (wantShot) {
      await sleep(remoteFrontKnown() ? REMOTE_SETTLE_MS : SETTLE_MS)
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
async function dispatch(req: RpcRequest, bridge?: BridgeHeaders): Promise<RpcResponse | null> {
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
        return ok(await callTool(name, safeArgs, bridge))
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
    const oh = req.headers[BRIDGE_ORIGIN_HEADER]
    const sh = req.headers[BRIDGE_SERVER_HEADER]
    // Una cabecera repetida llega como lista (o unida con comas): no vale como secreto, se trata como «no es origen aislado».
    const bridge: BridgeHeaders | undefined =
      typeof oh === 'string' && oh ? { origin: oh, server: typeof sh === 'string' ? sh : '' } : undefined
    void Promise.all(msgs.map((m) => dispatch(m, bridge))).then((out) => {
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

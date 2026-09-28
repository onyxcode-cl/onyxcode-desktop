/**
 * Servidor MCP de "computer use" para Lapis (transporte Streamable HTTP en 127.0.0.1).
 *
 * Se empaqueta como entrada aparte (`out/main/computer-mcp.js`) y el proceso principal lo arranca
 * como **utilityProcess** (`computer/mcp-host.ts`): así hereda la responsabilidad TCC de Lapis
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
 *   COMPUTER_SHOT_DIR       carpeta para las capturas (por defecto $TMPDIR/lapis-computer)
 *   COMPUTER_FAKE_SCREENSHOT (solo pruebas) usa esta imagen en lugar de `screencapture`
 *
 * Coordenadas: las herramientas reciben coordenadas EN PÍXELES DE LA ÚLTIMA CAPTURA y las
 * convierten a puntos de la pantalla principal (factor = anchoPuntos / anchoCaptura).
 *
 * Concesión por app (ver `computer/grants.ts`): antes de cada acción con ratón/teclado se
 * comprueba, por `COMPUTER_EVENTS_URL`, el nivel de la app en primer plano (y de la app bajo el
 * punto, en clics/arrastres). Sin nivel suficiente, la acción se rechaza con un mensaje que le
 * dice al modelo que llame a la herramienta `request_access` (que también usa el canal lateral,
 * `POST <url>/request-access`, y espera hasta 5 min la respuesta del usuario). Las capturas
 * excluyen del compositor las apps sin concesión (ScreenCaptureKit, `cu-helper screenshot-sck`;
 * si no está disponible se enmascaran a mano las ventanas de esas apps sobre la captura de
 * `screencapture`). `type_text`/`key` además rechazan un campo de contraseña con foco
 * (`cu-helper focused-secure`) o tecleo real reciente del usuario (`cu-helper recent-input`).
 */
import { execFile, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HELPER = process.env.CU_HELPER ?? ''
const STOP_FILE = process.env.COMPUTER_STOP_FILE ?? ''
const EVENTS_URL = process.env.COMPUTER_EVENTS_URL ?? ''
const AUTO_SHOT = process.env.COMPUTER_AUTO_SCREENSHOT !== '0'
const MAX_LONG = Math.max(400, Number(process.env.COMPUTER_MAX_LONG_SIDE) || 1366)
const SHOT_DIR = process.env.COMPUTER_SHOT_DIR || join(tmpdir(), 'lapis-computer')
const FAKE_SHOT = process.env.COMPUTER_FAKE_SCREENSHOT ?? ''
const INSTANT = process.env.COMPUTER_INSTANT === '1'
const TYPE_DELAY = process.env.COMPUTER_TYPE_DELAY_MS ?? ''
const SETTLE_MS = 450
const STOPPED_MSG = 'Control detenido por el usuario'
const UNVERIFIED_MSG = 'No se pudo verificar el estado del kill-switch con Lapis; acción rechazada'
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

/** Procesos del helper en vuelo (para matarlos si se pulsa Detener a mitad de una acción). */
const children = new Set<ChildProcess>()

/** SIGTERM (el helper suelta el botón del ratón si lo tenía pulsado) y SIGKILL a los 300 ms. */
function killChildren(): void {
  for (const c of children) {
    c.kill('SIGTERM')
    setTimeout(() => c.exitCode === null && c.signalCode === null && c.kill('SIGKILL'), 300).unref()
  }
}

// ───────────────────────────── utilidades ─────────────────────────────

function run(cmd: string, args: string[], timeout = 15_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      children.delete(child)
      if (err) reject(new Error((stderr || err.message).toString().trim()))
      else resolve(stdout.toString())
    })
    children.add(child)
  })
}

async function helper(...args: string[]): Promise<string> {
  if (!HELPER || !existsSync(HELPER)) throw new Error(`Helper nativo no encontrado (${HELPER || 'CU_HELPER vacío'})`)
  const flags: string[] = []
  if (INSTANT) flags.push('--instant')
  if (TYPE_DELAY && Number.isFinite(Number(TYPE_DELAY))) flags.push('--char-delay', String(Number(TYPE_DELAY)))
  return run(HELPER, [...flags, ...args], 30_000)
}

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

type AppTier = 'view' | 'click' | 'full'
const TIER_RANK: Record<AppTier, number> = { view: 0, click: 1, full: 2 }
const TIER_LABEL: Record<AppTier, string> = { view: 'Solo ver', click: 'Ver y clic', full: 'Control total' }

interface AppRef {
  bundleId: string
  name: string
}

async function appFrontmost(): Promise<AppRef> {
  const j = JSON.parse(await helper('frontmost')) as { name?: string; bundleId?: string }
  return { bundleId: j.bundleId ?? '', name: j.name || j.bundleId || '' }
}

async function appAtPoint(x: number, y: number): Promise<AppRef> {
  const j = JSON.parse(await helper('app-at', String(x), String(y))) as { name?: string; bundleId?: string }
  return { bundleId: j.bundleId ?? '', name: j.name || j.bundleId || '' }
}

/** Nivel concedido a una app (y autoasignación de categoría en main), o null si hay que pedirlo. */
async function tierOf(app: AppRef): Promise<AppTier | null> {
  if (!EVENTS_URL || !app.bundleId) return null
  const url = `${EVENTS_URL}/tier?bundleId=${encodeURIComponent(app.bundleId)}&name=${encodeURIComponent(app.name)}`
  const r = await fetch(url, { signal: AbortSignal.timeout(1500) })
  if (!r.ok) throw new Error(`No se pudo consultar la concesión (HTTP ${r.status})`)
  const j = (await r.json()) as { tier?: AppTier | null }
  return j.tier ?? null
}

/**
 * Comprueba que la app en primer plano (y, si se da un punto, la app bajo ese punto) tenga AL
 * MENOS `minTier`. Lanza con un mensaje que le dice al modelo que llame a `request_access` si
 * falta la concesión, o que el nivel actual no alcanza si ya está concedida pero es insuficiente.
 */
async function requireTier(minTier: AppTier, point?: { x: number; y: number }): Promise<void> {
  const apps = [await appFrontmost()]
  if (point) {
    const at = await appAtPoint(point.x, point.y)
    if (at.bundleId && at.bundleId !== apps[0]?.bundleId) apps.push(at)
  }
  const known = apps.filter((a) => a.bundleId)
  if (!known.length) return // no se pudo identificar ninguna app (p. ej. el Escritorio): no bloquear
  for (const a of known) {
    const tier = await tierOf(a)
    if (tier === null) {
      throw new Error(
        `«${a.name}» no tiene acceso concedido. Llama a la herramienta request_access con apps: ["${a.name}"] ` +
          'y un motivo, y espera la respuesta del usuario antes de reintentar esta acción.'
      )
    }
    if (TIER_RANK[tier] < TIER_RANK[minTier]) {
      throw new Error(
        `«${a.name}» solo tiene el nivel "${TIER_LABEL[tier]}"; esta acción necesita "${TIER_LABEL[minTier]}". ` +
          'Pide más acceso con request_access y espera la respuesta del usuario.'
      )
    }
  }
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

async function requestAccess(apps: AppRef[], reason?: string): Promise<Record<string, string>> {
  if (!EVENTS_URL) throw new Error('Canal lateral no disponible: no se puede pedir acceso a apps.')
  const r = await fetch(`${EVENTS_URL}/request-access`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ apps, reason }),
    signal: AbortSignal.timeout(5 * 60_000 + 5_000)
  })
  if (!r.ok) {
    const body = await r.text().catch(() => '')
    throw new Error(`No se pudo pedir acceso (HTTP ${r.status})${body ? `: ${body}` : ''}`)
  }
  const j = (await r.json()) as { decisions?: Record<string, string> }
  return j.decisions ?? {}
}

async function resolveApp(name: string): Promise<AppRef & { found: boolean }> {
  const j = JSON.parse(await helper('resolve-app', name)) as { name?: string; bundleId?: string; found?: boolean }
  return { bundleId: j.bundleId ?? '', name: j.name || name, found: !!j.found && !!j.bundleId }
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

interface Screen {
  width: number
  height: number
  scale: number
  main?: boolean
}

let mainScreen: Screen | null = null
/** puntos por píxel de captura (se actualiza con cada captura). */
let ratio = 0

async function getMainScreen(): Promise<Screen> {
  if (mainScreen) return mainScreen
  const list = JSON.parse(await helper('screens')) as Screen[]
  mainScreen = list.find((s) => s.main) ?? list[0]
  if (!mainScreen) throw new Error('No se detectó ninguna pantalla')
  return mainScreen
}

async function ensureRatio(): Promise<number> {
  if (ratio > 0) return ratio
  const s = await getMainScreen()
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
}

async function takeScreenshot(auto = false): Promise<Shot> {
  // Espera (≤600 ms) a que la app prepare el overlay para la captura; luego el destello.
  await post({ tool: 'screenshot', phase: 'start', auto }, 600)
  try {
    return await captureScreen()
  } finally {
    emit({ tool: 'screenshot', phase: 'end', auto })
  }
}

/** Apps de sistema/la propia Lapis: nunca se excluyen de la captura aunque no tengan concesión. */
const NEVER_EXCLUDE = new Set([
  'cl.bentec.lapis',
  'com.apple.dock',
  'com.apple.systemuiserver',
  'com.apple.controlcenter',
  'com.apple.WindowServer',
  'com.apple.notificationcenterui',
  'com.apple.finder' // Finder es la app que casi siempre está detrás de todo; no es "contenido" ajeno
])

/**
 * Bundle ids de apps con ventana visible que NO tienen concesión: se excluyen de la captura
 * (ScreenCaptureKit las quita del compositor; el modelo nunca las ve). Best-effort: sin canal
 * lateral o si el helper falla, no excluye nada (mejor que romper la captura).
 */
async function nonGrantedBundleIds(): Promise<string[]> {
  if (!EVENTS_URL) return []
  try {
    const apps = JSON.parse(await helper('running-apps')) as Array<{ bundleId?: string; name?: string }>
    const results = await Promise.all(
      apps
        .filter((a) => a.bundleId && !NEVER_EXCLUDE.has(a.bundleId))
        .map(async (a) => {
          const tier = await tierOf({ bundleId: a.bundleId!, name: a.name || a.bundleId! }).catch(() => null)
          return tier === null ? a.bundleId! : null
        })
    )
    return results.filter((b): b is string => !!b)
  } catch (err) {
    log('nonGrantedBundleIds:', err instanceof Error ? err.message : err)
    return []
  }
}

async function captureScreen(): Promise<Shot> {
  mkdirSync(SHOT_DIR, { recursive: true })
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const raw = join(SHOT_DIR, `raw-${stamp}.png`)
  const out = join(SHOT_DIR, `shot-${stamp}.jpg`)
  try {
    if (FAKE_SHOT) {
      await run('/bin/cp', [FAKE_SHOT, raw])
    } else {
      const exclude = await nonGrantedBundleIds()
      let sckOk = false
      if (exclude.length) {
        try {
          await helper('screenshot-sck', raw, exclude.join(','))
          sckOk = true
        } catch (err) {
          log('ScreenCaptureKit no disponible, uso screencapture + enmascarado:', err instanceof Error ? err.message : err)
        }
      }
      if (!sckOk) {
        // -x sin sonido, -C incluye el cursor, -m solo la pantalla principal
        try {
          await run('/usr/sbin/screencapture', ['-x', '-C', '-m', '-t', 'png', raw])
        } catch (err) {
          throw new Error(
            `No se pudo capturar la pantalla (${err instanceof Error ? err.message : err}). ` +
              'Falta el permiso de Grabación de pantalla para Lapis.'
          )
        }
        if (!existsSync(raw)) throw new Error('No se pudo capturar la pantalla (¿permiso de Grabación de pantalla?)')
        // Fallback sin ScreenCaptureKit (macOS < 14 o SCK falló): enmascarar a mano las ventanas de
        // las apps no concedidas con un rectángulo negro (mejor que enseñarlas).
        if (exclude.length) {
          try {
            const s = await getMainScreen()
            const scale = s.scale || 1
            const windows = JSON.parse(await helper('windows-of', exclude.join(','))) as Array<{
              x: number
              y: number
              width: number
              height: number
            }>
            if (windows.length) {
              const rects = windows.map((w) => `${w.x * scale},${w.y * scale},${w.width * scale},${w.height * scale}`)
              await run(HELPER, ['mask-regions', raw, raw, ...rects])
            }
          } catch (err) {
            log('enmascarado de apps no concedidas:', err instanceof Error ? err.message : err)
          }
        }
      }
    }
    await run('/usr/bin/sips', ['-Z', String(MAX_LONG), '-s', 'format', 'jpeg', '-s', 'formatOptions', '70', raw, '--out', out])
    const dims = await run('/usr/bin/sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', out])
    const width = Number(/pixelWidth:\s*(\d+)/.exec(dims)?.[1] ?? 0)
    const height = Number(/pixelHeight:\s*(\d+)/.exec(dims)?.[1] ?? 0)
    const s = await getMainScreen()
    ratio = width > 0 ? s.width / width : await ensureRatio()
    const base64 = readFileSync(out).toString('base64')
    cleanupShots()
    return { path: out, base64, width, height, ratio }
  } finally {
    rmSync(raw, { force: true })
  }
}

/** px de captura → puntos de pantalla. */
async function toPoints(x: unknown, y: unknown): Promise<{ x: number; y: number }> {
  const nx = Number(x)
  const ny = Number(y)
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) throw new Error('Coordenadas inválidas: x e y deben ser números')
  const r = await ensureRatio()
  const s = await getMainScreen()
  const px = Math.round(nx * r * 100) / 100
  const py = Math.round(ny * r * 100) / 100
  if (px < 0 || py < 0 || px > s.width || py > s.height) {
    throw new Error(`Coordenadas fuera de la pantalla: (${nx}, ${ny}) px de captura`)
  }
  return { x: px, y: py }
}

// ───────────────────────────── herramientas ─────────────────────────────

type Content =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }

interface ToolResult {
  content: Content[]
  isError?: boolean
}

interface ToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  /** Acción (no lectura): se emite al canal lateral y se adjunta captura automática. */
  action: boolean
  run: (args: Record<string, unknown>) => Promise<string>
}

const XY = {
  x: { type: 'number', description: 'X en píxeles de la última captura' },
  y: { type: 'number', description: 'Y en píxeles de la última captura' }
}
const SHOT_FLAG = {
  screenshot: {
    type: 'boolean',
    description: 'Adjuntar una captura tras la acción (por defecto true)'
  }
}

function obj(props: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return { type: 'object', properties: { ...props }, required, additionalProperties: false }
}

function shotText(s: Shot): string {
  return (
    `Captura de la pantalla principal: ${s.width}x${s.height} px (1 px = ${s.ratio.toFixed(4)} puntos). ` +
    `Usa coordenadas EN PÍXELES DE ESTA IMAGEN en las herramientas. Archivo: ${s.path}`
  )
}

async function clickTool(args: Record<string, unknown>, button: 'left' | 'right', count: number, tool: string): Promise<string> {
  const p = await toPoints(args.x, args.y)
  await requireTier('click', p)
  await act({ tool, x: p.x, y: p.y }, () => helper('click', String(p.x), String(p.y), button, String(count)))
  return `${tool} en (${args.x}, ${args.y}) px → (${p.x}, ${p.y}) pt`
}

const TOOLS: ToolDef[] = [
  {
    name: 'screenshot',
    description:
      'Toma una captura de la pantalla principal. Devuelve la imagen y el tamaño en píxeles; ' +
      'todas las demás herramientas usan coordenadas en píxeles de esta captura.',
    inputSchema: obj({}),
    action: false,
    run: async () => '' // gestionado aparte
  },
  {
    name: 'left_click',
    description: 'Clic izquierdo en (x, y) px de la captura.',
    inputSchema: obj({ ...XY, ...SHOT_FLAG }, ['x', 'y']),
    action: true,
    run: (a) => clickTool(a, 'left', 1, 'left_click')
  },
  {
    name: 'right_click',
    description: 'Clic derecho en (x, y) px de la captura.',
    inputSchema: obj({ ...XY, ...SHOT_FLAG }, ['x', 'y']),
    action: true,
    run: (a) => clickTool(a, 'right', 1, 'right_click')
  },
  {
    name: 'double_click',
    description: 'Doble clic izquierdo en (x, y) px de la captura.',
    inputSchema: obj({ ...XY, ...SHOT_FLAG }, ['x', 'y']),
    action: true,
    run: (a) => clickTool(a, 'left', 2, 'double_click')
  },
  {
    name: 'mouse_move',
    description: 'Mueve el puntero a (x, y) px de la captura sin hacer clic.',
    inputSchema: obj({ ...XY, ...SHOT_FLAG }, ['x', 'y']),
    action: true,
    run: async (a) => {
      const p = await toPoints(a.x, a.y)
      await requireTier('click', p)
      await act({ tool: 'mouse_move', x: p.x, y: p.y }, () => helper('move', String(p.x), String(p.y)))
      return `Puntero movido a (${a.x}, ${a.y}) px → (${p.x}, ${p.y}) pt`
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
    run: async (a) => {
      const s = await toPoints(a.start_x, a.start_y)
      const e = await toPoints(a.end_x, a.end_y)
      // Arrastrar necesita "Control total": mueve/reordena contenido, no es un simple clic.
      await requireTier('full', s)
      await requireTier('full', e)
      await act({ tool: 'drag', x: e.x, y: e.y, fromX: s.x, fromY: s.y }, () =>
        helper('drag', String(s.x), String(s.y), String(e.x), String(e.y))
      )
      return `Arrastrado de (${a.start_x}, ${a.start_y}) a (${a.end_x}, ${a.end_y}) px`
    }
  },
  {
    name: 'scroll',
    description:
      'Desplaza con la rueda en (x, y) px de la captura. direction: up|down|left|right; amount: líneas (1-30, por defecto 5).',
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
    run: async (a) => {
      const p = await toPoints(a.x, a.y)
      const n = Math.max(1, Math.min(30, Math.round(Number(a.amount) || 5)))
      const dir = String(a.direction)
      const dx = dir === 'right' ? n : dir === 'left' ? -n : 0
      const dy = dir === 'down' ? n : dir === 'up' ? -n : 0
      if (!dx && !dy) throw new Error('direction debe ser up, down, left o right')
      await requireTier('click', p)
      await act({ tool: 'scroll', x: p.x, y: p.y, text: `${dir} ${n}` }, () =>
        helper('scroll', String(p.x), String(p.y), String(dx), String(dy))
      )
      return `Scroll ${dir} ${n} en (${a.x}, ${a.y}) px`
    }
  },
  {
    name: 'type_text',
    description: 'Escribe texto (unicode) en el elemento con foco. "\\n" pulsa Return. Nunca escribas contraseñas ni datos de pago.',
    inputSchema: obj({ text: { type: 'string' }, ...SHOT_FLAG }, ['text']),
    action: true,
    run: async (a) => {
      const text = String(a.text ?? '')
      if (!text) throw new Error('text vacío')
      if (text.length > 5000) throw new Error('Texto demasiado largo (máx. 5000 caracteres)')
      await requireTier('full')
      await requireCanType()
      await act({ tool: 'type_text', text: text.length > 120 ? `${text.slice(0, 117)}…` : text }, () =>
        helper('type', text)
      )
      return `Escrito: ${text.length} caracteres`
    }
  },
  {
    name: 'key',
    description:
      'Pulsa una tecla o combinación, p.ej. "return", "cmd+space", "cmd+shift+t", "escape", "tab", "up", "f5". ' +
      'Varias combinaciones separadas por espacio se pulsan en secuencia.',
    inputSchema: obj({ keys: { type: 'string' }, ...SHOT_FLAG }, ['keys']),
    action: true,
    run: async (a) => {
      const keys = String(a.keys ?? '').trim()
      if (!keys) throw new Error('keys vacío')
      await requireTier('full')
      await requireCanType()
      await act({ tool: 'key', text: keys }, () => helper('key', keys))
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
    description: 'Abre o trae al frente una aplicación por nombre (p.ej. "Finder", "Safari", "Notas") o bundle id.',
    inputSchema: obj({ name: { type: 'string' }, ...SHOT_FLAG }, ['name']),
    action: true,
    run: async (a) => {
      const name = String(a.name ?? '').trim()
      if (!name) throw new Error('name vacío')
      await act({ tool: 'open_application', text: name }, async () => {
        await helper('open-app', name)
        await sleep(800)
      })
      const front = JSON.parse(await helper('frontmost')) as { name?: string }
      return `Abierta ${name}. App en primer plano: ${front.name ?? '?'}`
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
      'Pide permiso al usuario para actuar sobre una o más apps que todavía no tienen acceso concedido. ' +
      'Úsala en cuanto una herramienta falle con "no tiene acceso concedido", ANTES de reintentar la acción. ' +
      'Muestra una tarjeta en Lapis y ESPERA a que el usuario responda (hasta 5 minutos); si no responde, se trata como denegado.',
    inputSchema: obj(
      {
        apps: { type: 'array', items: { type: 'string' }, description: 'Nombres de las apps, p.ej. ["Safari", "Terminal"]' },
        reason: { type: 'string', description: 'Por qué necesitas actuar sobre esas apps (se le muestra al usuario)' }
      },
      ['apps']
    ),
    action: false,
    run: async (a) => {
      const names = Array.isArray(a.apps) ? a.apps.map(String).slice(0, 10) : []
      if (!names.length) throw new Error('apps vacío')
      const resolved = await Promise.all(names.map((n) => resolveApp(n)))
      const valid = resolved.filter((r) => r.found)
      if (!valid.length) {
        return `No se pudo identificar ninguna app instalada con esos nombres: ${names.join(', ')}. Comprueba el nombre exacto.`
      }
      const decisions = await requestAccess(
        valid.map((r) => ({ bundleId: r.bundleId, name: r.name })),
        typeof a.reason === 'string' ? a.reason.slice(0, 500) : undefined
      )
      const label = (d: string): string =>
        d === 'deny' ? 'denegado' : d === 'view' ? 'Solo ver' : d === 'click' ? 'Ver y clic' : d === 'full' ? 'Control total' : 'sin respuesta'
      const lines = valid.map((r) => `- ${r.name}: ${label(decisions[r.bundleId] ?? '')}`)
      const missing = names.filter((n) => !valid.some((r) => r.name.toLowerCase() === n.toLowerCase()))
      if (missing.length) lines.push(`- (no identificadas: ${missing.join(', ')})`)
      return `Respuesta del usuario:\n${lines.join('\n')}`
    }
  }
]

async function callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const tool = TOOLS.find((t) => t.name === name)
  if (!tool) return { content: [{ type: 'text', text: `Herramienta desconocida: ${name}` }], isError: true }
  try {
    if (await isStopped()) return { content: [{ type: 'text', text: STOPPED_MSG }], isError: true }
  } catch (err) {
    return { content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }], isError: true }
  }
  try {
    if (name === 'screenshot') {
      const s = await takeScreenshot()
      return {
        content: [
          { type: 'image', data: s.base64, mimeType: 'image/jpeg' },
          { type: 'text', text: shotText(s) }
        ]
      }
    }
    const text = await tool.run(args ?? {})
    const content: Content[] = [{ type: 'text', text }]
    const wantShot = tool.action && AUTO_SHOT && args?.screenshot !== false
    if (wantShot) {
      await sleep(SETTLE_MS)
      if (await isStopped().catch(() => true)) {
        content.push({ type: 'text', text: STOPPED_MSG })
      } else {
        try {
          const s = await takeScreenshot(true)
          content.unshift({ type: 'image', data: s.base64, mimeType: 'image/jpeg' })
          content.push({ type: 'text', text: shotText(s) })
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
          serverInfo: { name: 'lapis-computer', version: '0.2.0' },
          instructions:
            'Controla el Mac del usuario. Empieza siempre con screenshot; las coordenadas son píxeles de la última captura.'
        })
      }
      case 'ping':
        return ok({})
      case 'tools/list':
        return ok({ tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) })
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
    const msgs = list.filter(
      (m): m is RpcRequest => !!m && typeof m === 'object' && typeof (m as RpcRequest).method === 'string'
    )
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
      setTimeout(() => process.exit(0), 200).unref()
    }
  })
}

main()

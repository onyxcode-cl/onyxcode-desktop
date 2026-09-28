/**
 * Servidor MCP (stdio) de "computer use" para Lapis.
 *
 * Se empaqueta como entrada aparte (`out/main/computer-mcp.js`) y lo lanza OpenCode como MCP
 * local con el node de Electron: `[process.execPath, computer-mcp.js]` + `ELECTRON_RUN_AS_NODE=1`.
 * NO importa `electron` ni módulos de la app: solo builtins de Node.
 *
 * Protocolo: JSON-RPC 2.0 delimitado por saltos de línea (MCP stdio, 2024-11-05 / 2025-06-18).
 *
 * Variables de entorno:
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
 */
import { execFile, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

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

async function captureScreen(): Promise<Shot> {
  mkdirSync(SHOT_DIR, { recursive: true })
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const raw = join(SHOT_DIR, `raw-${stamp}.png`)
  const out = join(SHOT_DIR, `shot-${stamp}.jpg`)
  try {
    if (FAKE_SHOT) {
      await run('/bin/cp', [FAKE_SHOT, raw])
    } else {
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

// ───────────────────────────── JSON-RPC stdio ─────────────────────────────

interface RpcRequest {
  jsonrpc: '2.0'
  id?: number | string | null
  method: string
  params?: Record<string, unknown>
}

function send(msg: unknown): void {
  process.stdout.write(JSON.stringify(msg) + '\n')
}

const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05']

async function handle(req: RpcRequest): Promise<void> {
  const reply = (result: unknown): void => send({ jsonrpc: '2.0', id: req.id, result })
  const error = (code: number, message: string): void => send({ jsonrpc: '2.0', id: req.id, error: { code, message } })
  const isNotification = req.id === undefined || req.id === null
  switch (req.method) {
    case 'initialize': {
      const asked = String(req.params?.protocolVersion ?? '')
      reply({
        protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'lapis-computer', version: '0.1.0' },
        instructions:
          'Controla el Mac del usuario. Empieza siempre con screenshot; las coordenadas son píxeles de la última captura.'
      })
      return
    }
    case 'ping':
      reply({})
      return
    case 'tools/list':
      reply({
        tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }))
      })
      return
    case 'tools/call': {
      const name = String(req.params?.name ?? '')
      const args = (req.params?.arguments ?? {}) as Record<string, unknown>
      reply(await callTool(name, args))
      return
    }
    case 'resources/list':
      reply({ resources: [] })
      return
    case 'prompts/list':
      reply({ prompts: [] })
      return
    default:
      if (!isNotification) error(-32601, `Método no soportado: ${req.method}`)
  }
}

function main(): void {
  const rl = createInterface({ input: process.stdin })
  rl.on('line', (line) => {
    const trimmed = line.trim()
    if (!trimmed) return
    let msg: RpcRequest
    try {
      msg = JSON.parse(trimmed) as RpcRequest
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
      return
    }
    if (!msg || typeof msg.method !== 'string') return // respuestas / basura
    handle(msg).catch((err) => {
      log('error', err)
      if (msg.id !== undefined && msg.id !== null) {
        send({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: String(err) } })
      }
    })
  })
  rl.on('close', () => process.exit(0))
  log(`listo (helper=${HELPER || '—'}, stop=${STOP_FILE || '—'}, events=${EVENTS_URL ? 'sí' : 'no'})`)
}

main()

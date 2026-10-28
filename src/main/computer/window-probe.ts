/**
 * «Sonda» de ventana: piezas PURAS para saber si una acción de ratón/teclado hizo algo (veredicto), si la captura sigue vigente
 * (elementos numerados) y si otra ventana tapa la que se capturó (aviso de ventana tapada). Ver docs/PLAN-CONTROL-MEJOR.md §2.2–2.4.
 *
 * La sonda es una captura de la ventana concedida que NO va al modelo: se decodifica aquí (PNG con `node:zlib`, sin dependencias), se
 * reduce a una rejilla de luminancia y se descarta. Al modelo solo llegan porcentajes y nombres de app, nunca rectángulos ni píxeles.
 *
 * Solo módulos de Node y sin efectos secundarios al importar: lo usa únicamente el MCP (como los `mcp-platform*.ts`). Aquí no hay
 * llamadas al helper, ni al disco, ni temporizadores salvo `pollProbe`, que recibe `sleep`/`now` inyectados.
 */

import { createHash } from 'node:crypto'
import { inflateSync } from 'node:zlib'

// ───────────────────────────────────────── Apagador ─────────────────────────────────────────

/**
 * ¿Está encendido el veredicto de acción? Va ENCENDIDO por defecto; `COMPUTER_VERDICT=0` (o «false»/«off»/«no») lo apaga.
 * Función pura: recibe el entorno (`process.env`) en vez de leerlo.
 */
export function verdictEnabled(env: Record<string, string | undefined>): boolean {
  const v = (env.COMPUTER_VERDICT ?? '').trim().toLowerCase()
  return !(v === '0' || v === 'false' || v === 'off' || v === 'no')
}

// ───────────────────────────────────────── PNG → luminancia ─────────────────────────────────────────

export interface LumaImage {
  width: number
  height: number
  /** Luminancia 0–255 por píxel, fila a fila. */
  lum: Uint8Array
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
/** Tope de píxeles que se aceptan decodificar (protege contra PNG gigantes o bombas de descompresión). */
const MAX_PIXELS = 64_000_000

/**
 * Decodifica un PNG mínimo: 8 bits por canal, tipos de color 0 (gris), 2 (RGB), 4 (gris+alfa) y 6 (RGBA), sin entrelazado, filtros 0–4.
 * Cualquier otra cosa (paleta, 16 bits, entrelazado, datos truncados o corruptos) devuelve `null`; nunca lanza.
 */
export function decodePngLuma(buf: Buffer | Uint8Array): LumaImage | null {
  try {
    const data = Buffer.isBuffer(buf) ? buf : Buffer.from(buf)
    if (data.length < 8 + 25 || !data.subarray(0, 8).equals(PNG_SIGNATURE)) return null
    let pos = 8
    let width = 0
    let height = 0
    let colorType = -1
    let sawHeader = false
    const idat: Buffer[] = []
    let ended = false
    while (pos + 8 <= data.length) {
      const len = data.readUInt32BE(pos)
      const type = data.toString('latin1', pos + 4, pos + 8)
      const start = pos + 8
      const end = start + len
      if (end + 4 > data.length) return null
      if (type === 'IHDR') {
        if (len !== 13) return null
        width = data.readUInt32BE(start)
        height = data.readUInt32BE(start + 4)
        const depth = data[start + 8]
        colorType = data[start + 9]
        const compression = data[start + 10]
        const filter = data[start + 11]
        const interlace = data[start + 12]
        if (depth !== 8 || compression !== 0 || filter !== 0 || interlace !== 0) return null
        if (colorType !== 0 && colorType !== 2 && colorType !== 4 && colorType !== 6) return null
        sawHeader = true
      } else if (type === 'IDAT') {
        idat.push(data.subarray(start, end))
      } else if (type === 'IEND') {
        ended = true
        break
      }
      pos = end + 4
    }
    if (!sawHeader || !ended || idat.length === 0) return null
    if (width <= 0 || height <= 0 || width * height > MAX_PIXELS) return null
    const bpp = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : 4
    const stride = width * bpp
    const raw = inflateSync(Buffer.concat(idat))
    if (raw.length !== (stride + 1) * height) return null

    const lum = new Uint8Array(width * height)
    let prev = Buffer.alloc(stride)
    let cur = Buffer.alloc(stride)
    for (let y = 0; y < height; y++) {
      const base = y * (stride + 1)
      const ft = raw[base]
      for (let i = 0; i < stride; i++) {
        const x = raw[base + 1 + i]
        const a = i >= bpp ? cur[i - bpp] : 0
        const b = prev[i]
        const c = i >= bpp ? prev[i - bpp] : 0
        let v: number
        switch (ft) {
          case 0:
            v = x
            break
          case 1:
            v = x + a
            break
          case 2:
            v = x + b
            break
          case 3:
            v = x + ((a + b) >> 1)
            break
          case 4: {
            const p = a + b - c
            const pa = Math.abs(p - a)
            const pb = Math.abs(p - b)
            const pc = Math.abs(p - c)
            v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
            break
          }
          default:
            return null
        }
        cur[i] = v & 0xff
      }
      const row = y * width
      for (let px = 0; px < width; px++) {
        const o = px * bpp
        lum[row + px] = bpp <= 2 ? cur[o] : Math.round((299 * cur[o] + 587 * cur[o + 1] + 114 * cur[o + 2]) / 1000)
      }
      const t = prev
      prev = cur
      cur = t
    }
    return { width, height, lum }
  } catch {
    return null
  }
}

// ───────────────────────────────────────── Firma en rejilla ─────────────────────────────────────────

export const GRID_COLS = 32
export const GRID_ROWS = 24

export interface ProbeSignature {
  cols: number
  rows: number
  /** Luminancia media (0–255) de cada celda, fila a fila. */
  cells: Uint8Array
  /** Hash de los bytes del PNG de origen (atajo «idéntico» sin comparar celdas). */
  digest: string
}

/** Reduce una imagen de luminancia a una rejilla de `cols × rows` celdas con la media de cada una. */
export function lumaGrid(img: LumaImage, cols = GRID_COLS, rows = GRID_ROWS): Uint8Array {
  const out = new Uint8Array(cols * rows)
  for (let r = 0; r < rows; r++) {
    const y0 = Math.min(img.height - 1, Math.floor((r * img.height) / rows))
    const y1 = Math.min(img.height, Math.max(y0 + 1, Math.floor(((r + 1) * img.height) / rows)))
    for (let c = 0; c < cols; c++) {
      const x0 = Math.min(img.width - 1, Math.floor((c * img.width) / cols))
      const x1 = Math.min(img.width, Math.max(x0 + 1, Math.floor(((c + 1) * img.width) / cols)))
      let sum = 0
      for (let y = y0; y < y1; y++) {
        const row = y * img.width
        for (let x = x0; x < x1; x++) sum += img.lum[row + x]
      }
      out[r * cols + c] = Math.round(sum / ((y1 - y0) * (x1 - x0)))
    }
  }
  return out
}

/** Firma de una sonda a partir de los bytes del PNG. `null` si el PNG no se puede leer (la sonda «falló»). */
export function probeSignature(png: Buffer | Uint8Array, cols = GRID_COLS, rows = GRID_ROWS): ProbeSignature | null {
  const img = decodePngLuma(png)
  if (!img) return null
  const digest = createHash('sha256').update(png).digest('hex')
  return { cols, rows, cells: lumaGrid(img, cols, rows), digest }
}

/** Hash corto y estable de un texto (para reconocer «el mismo texto» sin guardarlo). */
export function textKey(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

// ───────────────────────────────────────── Diferencia ─────────────────────────────────────────

/** Una celda cuenta como «cambiada» si su luminancia media varía más de esto (0–255). */
export const CELL_DELTA = 6
/** Por debajo de este % de celdas cambiadas la ventana se considera igual (el cursor de texto que parpadea no cuenta). */
export const NOOP_THRESHOLD_PCT = 0.3

export interface ProbeDiff {
  /** % de celdas con cambio (0–100). */
  changedPct: number
  /** Celdas cambiadas. */
  changedCells: number
  /** Zona en palabras («arriba a la izquierda», «centro»…); `''` si nada cambió. */
  zone: string
  /** `true` si los bytes eran idénticos (sin decodificar celdas). */
  identical: boolean
}

/** Palabras para la zona que ocupa un conjunto de celdas (caja que las envuelve, en tercios de la ventana). */
export function zoneWords(cells: ReadonlyArray<{ col: number; row: number }>, cols = GRID_COLS, rows = GRID_ROWS): string {
  if (cells.length === 0) return ''
  let c0 = cols
  let c1 = -1
  let r0 = rows
  let r1 = -1
  for (const c of cells) {
    c0 = Math.min(c0, c.col)
    c1 = Math.max(c1, c.col)
    r0 = Math.min(r0, c.row)
    r1 = Math.max(r1, c.row)
  }
  if ((c1 - c0 + 1) / cols >= 0.6 && (r1 - r0 + 1) / rows >= 0.6) return 'toda la ventana'
  const cx = (c0 + c1 + 1) / 2 / cols
  const cy = (r0 + r1 + 1) / 2 / rows
  const h = cx < 1 / 3 ? 'izq' : cx > 2 / 3 ? 'der' : 'mid'
  const v = cy < 1 / 3 ? 'arr' : cy > 2 / 3 ? 'aba' : 'mid'
  if (v === 'mid' && h === 'mid') return 'centro'
  if (v === 'mid') return h === 'izq' ? 'a la izquierda' : 'a la derecha'
  if (h === 'mid') return v === 'arr' ? 'arriba' : 'abajo'
  return `${v === 'arr' ? 'arriba' : 'abajo'} ${h === 'izq' ? 'a la izquierda' : 'a la derecha'}`
}

/** Compara dos firmas. `null` si no son comparables (distinta rejilla). */
export function diffSignatures(a: ProbeSignature, b: ProbeSignature, delta = CELL_DELTA): ProbeDiff | null {
  if (a.cols !== b.cols || a.rows !== b.rows || a.cells.length !== b.cells.length) return null
  if (a.digest === b.digest) return { changedPct: 0, changedCells: 0, zone: '', identical: true }
  const changed: Array<{ col: number; row: number }> = []
  for (let i = 0; i < a.cells.length; i++) {
    if (Math.abs(a.cells[i] - b.cells[i]) > delta) changed.push({ col: i % a.cols, row: Math.floor(i / a.cols) })
  }
  return {
    changedPct: (changed.length / a.cells.length) * 100,
    changedCells: changed.length,
    zone: zoneWords(changed, a.cols, a.rows),
    identical: false
  }
}

/** Atajo: compara dos PNG; si los bytes son idénticos devuelve «sin cambios» sin decodificar. `null` si alguno no se puede leer. */
export function diffPngs(before: Buffer | Uint8Array, after: Buffer | Uint8Array): ProbeDiff | null {
  if (Buffer.from(before).equals(Buffer.from(after))) return { changedPct: 0, changedCells: 0, zone: '', identical: true }
  const a = probeSignature(before)
  const b = probeSignature(after)
  return a && b ? diffSignatures(a, b) : null
}

/** ¿La diferencia pasa del umbral de «la ventana cambió»? */
export const hasChanged = (d: ProbeDiff, thresholdPct = NOOP_THRESHOLD_PCT): boolean => d.changedPct >= thresholdPct

/**
 * Elementos numerados (§2.4): ¿la ventana de ahora sigue siendo la de la captura? `true` si difiere por encima de `thresholdPct`
 * (por defecto 5 %, el mismo umbral del aviso «la ventana cambió desde tu captura»).
 */
export function captureIsStale(captured: ProbeSignature, now: ProbeSignature, thresholdPct = 5): boolean {
  const d = diffSignatures(captured, now)
  return d === null ? true : d.changedPct > thresholdPct
}

// ───────────────────────────────────────── Sondeo con espera ─────────────────────────────────────────

export const PROBE_INTERVAL_MS = 400
export const PROBE_TIMEOUT_LOCAL_MS = 1500
export const PROBE_TIMEOUT_REMOTE_MS = 4000

/** Cuánto esperar a que algo cambie: 1,5 s en apps locales; 4 s si al frente hay un cliente de escritorio remoto. */
export const probeTimeoutMs = (remote: boolean): number => (remote ? PROBE_TIMEOUT_REMOTE_MS : PROBE_TIMEOUT_LOCAL_MS)

export type PollResult = { kind: 'diff'; diff: ProbeDiff } | { kind: 'failed' }

/**
 * Sondea cada ~400 ms hasta que la ventana cambie o se agote el tiempo. `takeProbe` devuelve la firma actual o `null` si falló;
 * `sleep` y `now` se inyectan (las pruebas no esperan). Si la primera sonda falla, devuelve `failed`.
 */
export async function pollProbe(opts: {
  before: ProbeSignature
  takeProbe: () => Promise<ProbeSignature | null>
  remote: boolean
  sleep: (ms: number) => Promise<void>
  now: () => number
}): Promise<PollResult> {
  const deadline = opts.now() + probeTimeoutMs(opts.remote)
  let last: ProbeDiff | null = null
  for (;;) {
    await opts.sleep(PROBE_INTERVAL_MS)
    const sig = await opts.takeProbe()
    if (!sig) return last ? { kind: 'diff', diff: last } : { kind: 'failed' }
    const d = diffSignatures(opts.before, sig)
    if (!d) return { kind: 'failed' }
    last = d
    if (hasChanged(d) || opts.now() >= deadline) return { kind: 'diff', diff: d }
  }
}

// ───────────────────────────────────────── Veredicto ─────────────────────────────────────────

export type ActionKind =
  'left_click' | 'double_click' | 'right_click' | 'scroll' | 'drag' | 'type_text' | 'key' | 'batch' | 'mouse_move' | 'wait'
export type Effect = 'confirmed' | 'unverifiable' | 'suspected_noop'

export interface VerdictInput {
  action: ActionKind
  /** Cómo se apuntó: coordenadas o `element: N`. Solo afina la escalada. */
  target?: 'xy' | 'element'
  /** `key` con cmd/ctrl (copiar, pegar…) o similar: puede no verse en la ventana. */
  modifiers?: boolean
  /** Al frente hay un cliente de escritorio remoto. */
  remote?: boolean
  /** Diferencia entre la sonda de antes y la de después, o fallo de la sonda. */
  probe: PollResult
  windowsBefore: number
  windowsAfter: number
  frontBefore: string
  frontAfter: string
  /** Lectura de vuelta por accesibilidad (`type_text`): `match` = un campo contiene el texto; `nomatch`; `unavailable` (remoto, sin AX). */
  readback?: 'match' | 'nomatch' | 'unavailable'
  /** `wait` con condición: apareció lo esperado. */
  waitMatched?: boolean
  /** Historial de este mismo objetivo en la sesión (ver `ActionLog.history`). */
  repeat?: { noopCount: number; recentConfirmed: boolean }
}

export interface Verdict {
  effect: Effect
  reason: string
  escalation?: string
  /** Aviso aparte (p. ej. «ya se confirmó; no la repitas»). */
  warning?: string
}

const NO_REPEAT =
  'no repitas: esa superficie no acepta la entrada simulada; usa la vía propia de la app (atajo, menú con app_menu, archivo o línea de comandos)'

const pctText = (p: number): string => (p < 1 ? '<1' : String(Math.round(p)))

/**
 * Veredicto de una acción (§2.3). `null` si la acción no lleva veredicto (`mouse_move`).
 * Reglas: lectura de vuelta o condición cumplida ⇒ `confirmed`; ventana sin cambios, mismo número de ventanas y misma app al frente
 * tras el tiempo completo y acción visible ⇒ `suspected_noop`; el resto ⇒ `unverifiable`.
 */
export function computeVerdict(i: VerdictInput): Verdict | null {
  if (i.action === 'mouse_move') return null
  const warning = i.repeat?.recentConfirmed ? 'ya se confirmó una acción igual hace poco; no la repitas' : undefined
  const done = (v: Verdict): Verdict => (warning ? { ...v, warning } : v)

  if (i.waitMatched === true) return done({ effect: 'confirmed', reason: 'apareció lo esperado' })
  if (i.readback === 'match') return done({ effect: 'confirmed', reason: 'un campo de la app contiene el texto escrito' })

  const notes: string[] = []
  if (i.frontAfter !== i.frontBefore) notes.push(`la app al frente pasó a «${i.frontAfter}»`)
  if (i.windowsAfter > i.windowsBefore)
    notes.push(i.windowsAfter - i.windowsBefore === 1 ? 'apareció una ventana de la app' : 'aparecieron ventanas de la app')
  else if (i.windowsAfter < i.windowsBefore)
    notes.push(i.windowsBefore - i.windowsAfter === 1 ? 'se cerró una ventana de la app' : 'se cerraron ventanas de la app')

  if (i.probe.kind === 'failed') {
    return done({
      effect: 'unverifiable',
      reason: ['se entregó; no se pudo comparar la ventana', ...notes].join('; ') + '; confírmalo con app_screenshot si importa'
    })
  }

  const d = i.probe.diff
  const windowChanged = hasChanged(d)
  const structural = notes.length > 0
  const mayBeInvisible = i.action === 'right_click' || (i.action === 'key' && i.modifiers === true)

  if (windowChanged || structural) {
    const parts = ['se entregó']
    if (windowChanged) parts.push(`la ventana cambió ~${pctText(d.changedPct)} %${d.zone ? ` (zona ${d.zone})` : ''}`)
    parts.push(...notes)
    // Escribir y no encontrar el texto aunque algo cambió: no es una confirmación.
    const tail = i.readback === 'nomatch' ? 'no se encontró el texto en ningún campo; ' : ''
    return done({ effect: 'unverifiable', reason: `${parts.join('; ')}; ${tail}confírmalo con app_screenshot si importa` })
  }

  // Nada cambió tras el tiempo completo.
  if (mayBeInvisible) {
    return done({
      effect: 'unverifiable',
      reason:
        i.action === 'right_click'
          ? 'los menús emergentes son otra ventana y esta no cambió'
          : 'una combinación con cmd/ctrl puede no verse en la ventana'
    })
  }
  if (i.action === 'wait') return done({ effect: 'unverifiable', reason: 'no apareció lo esperado en el tiempo dado' })

  const reason = `la ventana no cambió${i.remote ? ' (escritorio remoto)' : ''} y la acción debería verse`
  let escalation: string | undefined
  if ((i.repeat?.noopCount ?? 0) >= 1) escalation = NO_REPEAT
  else if (i.action === 'type_text' && i.remote) escalation = 'prueba input: "paste" y comprueba con zoom'
  else if (i.target === 'element') escalation = 'prueba app_press o x/y en el centro del elemento'
  else if (i.target === 'xy' && (i.action === 'left_click' || i.action === 'double_click'))
    escalation = 'prueba element: N (de la lista de la captura) o app_press por accesibilidad'
  return done({ effect: 'suspected_noop', reason, ...(escalation ? { escalation } : {}) })
}

/** Primera línea del texto de la herramienta: `efecto: <efecto> — <motivo>[; siguiente: <escalada>][; aviso: …]`. */
export function formatVerdict(v: Verdict): string {
  return `efecto: ${v.effect} — ${v.reason}${v.escalation ? `; siguiente: ${v.escalation}` : ''}${v.warning ? `; aviso: ${v.warning}` : ''}`
}

// ───────────────────────────────────────── Registro de repeticiones ─────────────────────────────────────────

export interface ActionRecord {
  tool: string
  app: string
  /** Punto redondeado (clics, arrastres, scroll). */
  x?: number
  y?: number
  /** Hash del texto (`textKey`) para `type_text`/`key`. */
  text?: string
  effect: Effect
  at: number
}

export interface ActionTarget {
  app: string
  x?: number
  y?: number
  text?: string
}

/** Tolerancia en píxeles para decir «el mismo punto». */
export const SAME_POINT_PX = 8
/** Ventana de tiempo para «ya se confirmó». */
export const RECENT_CONFIRMED_MS = 60_000

/** Registro por sesión de las últimas acciones (tope fijo, en memoria). Una instancia por sesión: nada global. */
export class ActionLog {
  private readonly items: ActionRecord[] = []
  constructor(private readonly cap = 20) {}

  record(r: ActionRecord): void {
    this.items.push(r)
    while (this.items.length > this.cap) this.items.shift()
  }

  get size(): number {
    return this.items.length
  }

  clear(): void {
    this.items.length = 0
  }

  private same(r: ActionRecord, t: ActionTarget): boolean {
    if (r.app !== t.app) return false
    if (t.text !== undefined || r.text !== undefined) return t.text !== undefined && r.text === t.text
    if (t.x === undefined || t.y === undefined || r.x === undefined || r.y === undefined) return false
    return Math.abs(r.x - t.x) <= SAME_POINT_PX && Math.abs(r.y - t.y) <= SAME_POINT_PX
  }

  /**
   * Historial del objetivo: `noopCount` = veces seguidas (hacia atrás) que ese objetivo dio `suspected_noop` sin un `confirmed` entre
   * medias; `recentConfirmed` = hubo un `confirmed` igual en los últimos 60 s.
   */
  history(t: ActionTarget, now: number): { noopCount: number; recentConfirmed: boolean } {
    let noopCount = 0
    let recentConfirmed = false
    let streak = true
    for (let k = this.items.length - 1; k >= 0; k--) {
      const r = this.items[k]
      if (!this.same(r, t)) continue
      if (r.effect === 'confirmed') {
        if (now - r.at <= RECENT_CONFIRMED_MS) recentConfirmed = true
        streak = false
      } else if (r.effect === 'suspected_noop' && streak) noopCount++
      else if (r.effect === 'unverifiable') streak = false
    }
    return { noopCount, recentConfirmed }
  }
}

// ───────────────────────────────────────── Ventana tapada ─────────────────────────────────────────

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface StackWindow {
  rect: Rect
  /** Nombre de la app dueña (solo se usa para nombrar al que tapa). */
  app: string
  /** Es de la propia app capturada (sus ventanas auxiliares no la «tapan»). */
  own?: boolean
}

/**
 * Ubica la ventana capturada en la lista Z (delante → atrás) por su marco (±`tol` px). `null` si no aparece o aparece más de una vez
 * (ambigüedad: entonces no se sabe si está tapada).
 */
export function locateTarget(stack: readonly StackWindow[], frame: Rect, tol = 1): number | null {
  let found: number | null = null
  for (let k = 0; k < stack.length; k++) {
    const r = stack[k].rect
    if (
      Math.abs(r.x - frame.x) <= tol &&
      Math.abs(r.y - frame.y) <= tol &&
      Math.abs(r.w - frame.w) <= tol &&
      Math.abs(r.h - frame.h) <= tol
    ) {
      if (found !== null) return null
      found = k
    }
  }
  return found
}

export interface Coverer {
  app: string
  pct: number
  zone: string
}

export type CoverageResult =
  | { known: false }
  | {
      known: true
      /** % de la ventana tapado por ventanas de otras apps (0–100). */
      coveredPct: number
      /** % de la ventana fuera de todos los monitores. */
      offscreenPct: number
      /** Quién tapa, de más a menos (máx. 3). */
      coveredBy: Coverer[]
    }

const COVER_GRID = 32

const inRect = (px: number, py: number, r: Rect): boolean => px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h

/**
 * Cuánto de la ventana capturada tapan otras ventanas y cuánto cae fuera de pantalla (rejilla 32×32 sobre su marco, sin llamadas).
 * `stack` va de delante hacia atrás; `targetIndex` es la posición de la ventana capturada (de `locateTarget`; `null` ⇒ «no se sabe»).
 * Solo cuentan las ventanas que están ANTES de la capturada y no son `own`. `displays` son los monitores en las mismas coordenadas.
 */
export function computeCoverage(opts: {
  stack: readonly StackWindow[]
  targetIndex: number | null
  frame: Rect
  displays: readonly Rect[]
}): CoverageResult {
  const { stack, targetIndex, frame, displays } = opts
  if (targetIndex === null || targetIndex < 0 || targetIndex >= stack.length || frame.w <= 0 || frame.h <= 0) return { known: false }
  const above = stack.slice(0, targetIndex).filter((w) => !w.own)
  const total = COVER_GRID * COVER_GRID
  let covered = 0
  let offscreen = 0
  const perApp = new Map<string, Array<{ col: number; row: number }>>()
  for (let r = 0; r < COVER_GRID; r++) {
    const py = frame.y + ((r + 0.5) * frame.h) / COVER_GRID
    for (let c = 0; c < COVER_GRID; c++) {
      const px = frame.x + ((c + 0.5) * frame.w) / COVER_GRID
      if (!displays.some((d) => inRect(px, py, d))) {
        offscreen++
        continue
      }
      const top = above.find((w) => inRect(px, py, w.rect))
      if (top) {
        covered++
        const list = perApp.get(top.app) ?? []
        list.push({ col: c, row: r })
        perApp.set(top.app, list)
      }
    }
  }
  const coveredBy = [...perApp.entries()]
    .map(([app, cells]) => ({ app, pct: (cells.length / total) * 100, zone: zoneWords(cells, COVER_GRID, COVER_GRID) }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 3)
  return { known: true, coveredPct: (covered / total) * 100, offscreenPct: (offscreen / total) * 100, coveredBy }
}

/**
 * Línea para el modelo (solo nombres de app y porcentajes). `null` si no hay nada que avisar (menos de `minPct` tapado y fuera de
 * pantalla) y `unknownText` si no se pudo comprobar.
 */
export function coverageNotice(res: CoverageResult, opts: { minPct?: number } = {}): string | null {
  const minPct = opts.minPct ?? 5
  if (!res.known) return 'No se pudo comprobar si esta ventana está tapada por otra.'
  const parts: string[] = []
  if (res.coveredPct >= minPct && res.coveredBy.length > 0) {
    const names = res.coveredBy.map((c) => `«${c.app}» tapa ~${Math.round(c.pct)} %${c.zone ? ` (zona ${c.zone})` : ''}`)
    parts.push(names.join(', '))
  }
  if (res.offscreenPct >= minPct) parts.push(`~${Math.round(res.offscreenPct)} % queda fuera de pantalla`)
  if (parts.length === 0) return null
  return `Ojo: ${parts.join(' y ')} de esta ventana. La imagen muestra la ventana entera, pero los clics en la zona tapada se rechazarán: pide a la persona que la deje a la vista.`
}

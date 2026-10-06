/**
 * Geometría de Control del PC en Windows (plan C §2 «DPI y multimonitor» y §3 «Capturas»). Puro.
 * Tres espacios: píxeles de la captura (lo que ve el modelo), píxeles FÍSICOS del escritorio virtual (lo que usa el
 * helper; el origen del monitor puede ser negativo) y DIP (lo que usa Electron/overlay).
 */

export interface Point {
  x: number
  y: number
}
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}
export interface Monitor {
  main: boolean
  /** Límites en píxeles físicos del escritorio virtual. */
  physical: Rect
  /** Límites en DIP (los de `display.bounds` de Electron). */
  dip: Rect
  /** Escalado (1, 1.5, 1.75…). */
  scale: number
}

/** Monitor sin DIP explícitos: el DIP se deduce de `physical / scale` (válido con un solo monitor o escalados iguales). */
export function monitorFrom(physical: Rect, scale: number, main = false): Monitor {
  return {
    main,
    physical,
    scale,
    dip: { x: physical.x / scale, y: physical.y / scale, width: physical.width / scale, height: physical.height / scale }
  }
}

export const MAX_CAPTURE_LONG_SIDE = 1366

const ok = (n: number): boolean => Number.isFinite(n)

export function contains(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.y >= r.y && p.x < r.x + r.width && p.y < r.y + r.height
}

/** Tamaño de la captura enviada al modelo (lado largo ≤ `maxLong`, sin ampliar) y razón físico/captura. */
export function captureSize(
  physW: number,
  physH: number,
  maxLong = MAX_CAPTURE_LONG_SIDE
): { width: number; height: number; ratio: number } | null {
  if (!ok(physW) || !ok(physH) || physW <= 0 || physH <= 0) return null
  const k = Math.min(1, maxLong / Math.max(physW, physH))
  const width = Math.max(1, Math.round(physW * k))
  const height = Math.max(1, Math.round(physH * k))
  return { width, height, ratio: physW / width }
}

/** Píxel de la captura → físico del escritorio virtual (origen del monitor capturado, posiblemente negativo). */
export function pxToPhysical(p: Point, ratio: number, origin: Point): Point {
  return { x: Math.round(origin.x + p.x * ratio), y: Math.round(origin.y + p.y * ratio) }
}

export function physicalToPx(p: Point, ratio: number, origin: Point): Point {
  return { x: (p.x - origin.x) / ratio, y: (p.y - origin.y) / ratio }
}

export function monitorAtPhysical(monitors: Monitor[], p: Point): Monitor | null {
  return monitors.find((m) => contains(m.physical, p)) ?? null
}
export function monitorAtDip(monitors: Monitor[], p: Point): Monitor | null {
  return monitors.find((m) => contains(m.dip, p)) ?? null
}

/** Físico → DIP (equivale a `screen.screenToDipPoint`). Null si el punto no cae en ningún monitor. */
export function physicalToDip(monitors: Monitor[], p: Point): Point | null {
  const m = monitorAtPhysical(monitors, p)
  if (!m) return null
  return { x: m.dip.x + (p.x - m.physical.x) / m.scale, y: m.dip.y + (p.y - m.physical.y) / m.scale }
}

export function dipToPhysical(monitors: Monitor[], p: Point): Point | null {
  const m = monitorAtDip(monitors, p)
  if (!m) return null
  return { x: Math.round(m.physical.x + (p.x - m.dip.x) * m.scale), y: Math.round(m.physical.y + (p.y - m.dip.y) * m.scale) }
}

/** Rectángulo físico → DIP con el monitor de su esquina superior izquierda. */
export function rectPhysicalToDip(monitors: Monitor[], r: Rect): Rect | null {
  const a = physicalToDip(monitors, { x: r.x, y: r.y })
  const m = monitorAtPhysical(monitors, { x: r.x, y: r.y })
  if (!a || !m) return null
  return { x: a.x, y: a.y, width: r.width / m.scale, height: r.height / m.scale }
}

export type PrimaryCheck = { ok: true; monitor: Monitor } | { ok: false; reason: string }

/** v1 controla solo el monitor principal: un punto físico fuera de él se rechaza con un error claro. */
export function checkOnPrimary(monitors: Monitor[], p: Point): PrimaryCheck {
  const main = monitors.find((m) => m.main)
  if (!main) return { ok: false, reason: 'No se pudo determinar el monitor principal' }
  if (!ok(p.x) || !ok(p.y)) return { ok: false, reason: 'Coordenadas no válidas' }
  if (contains(main.physical, p)) return { ok: true, monitor: main }
  return { ok: false, reason: 'Ese punto está fuera del monitor principal: Control del PC solo actúa en el principal' }
}

// ---- Máscara de la captura con orden Z ----

export interface WinInfo {
  id: string
  /** Rectángulo físico de la ventana visible. */
  rect: Rect
  /** ¿Tiene concesión (o es exenta del sistema)? Cualquier otra cosa cuenta como NO concedida. */
  granted: boolean
}

export function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const r = Math.min(a.x + a.width, b.x + b.width)
  const bt = Math.min(a.y + a.height, b.y + b.height)
  return r > x && bt > y ? { x, y, width: r - x, height: bt - y } : null
}

/** `a` menos `b`: hasta 4 rectángulos que cubren exactamente la parte de `a` no tapada por `b`. */
export function subtractRect(a: Rect, b: Rect): Rect[] {
  const i = intersect(a, b)
  if (!i) return [a]
  const out: Rect[] = []
  if (i.y > a.y) out.push({ x: a.x, y: a.y, width: a.width, height: i.y - a.y })
  if (i.y + i.height < a.y + a.height) out.push({ x: a.x, y: i.y + i.height, width: a.width, height: a.y + a.height - (i.y + i.height) })
  if (i.x > a.x) out.push({ x: a.x, y: i.y, width: i.x - a.x, height: i.height })
  if (i.x + i.width < a.x + a.width) out.push({ x: i.x + i.width, y: i.y, width: a.x + a.width - (i.x + i.width), height: i.height })
  return out
}

const validRect = (r: Rect): boolean => ok(r.x) && ok(r.y) && ok(r.width) && ok(r.height)

export type MaskPlan = { ok: true; masks: Rect[] } | { ok: false; reason: string }

export interface MaskInput {
  /** Ventanas visibles de la ENUMERACIÓN, de delante hacia atrás (orden Z). `null` = la enumeración falló. */
  windows: WinInfo[] | null
  /** Zona capturada (monitor principal, en físicos). */
  bounds: Rect
  /** ¿El helper puede enmascarar? Si no y hay algo que tapar, no hay captura. */
  canMask: boolean
}

/**
 * Qué rectángulos (físicos) hay que pintar de negro. Una ventana NO concedida se tapa salvo donde una ventana
 * concedida situada POR ENCIMA (más al frente) ya la cubre; una concedida encima de una no concedida no se tapa.
 * FALLA CERRADO: enumeración fallida, rectángulos inválidos o imposibilidad de enmascarar → sin captura.
 */
export function planMasks(input: MaskInput): MaskPlan {
  const { windows, bounds, canMask } = input
  if (!windows) return { ok: false, reason: 'No se pudo enumerar las ventanas: sin captura (falla cerrado)' }
  if (!validRect(bounds) || bounds.width <= 0 || bounds.height <= 0) return { ok: false, reason: 'Zona de captura no válida' }
  const masks: Rect[] = []
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i]
    if (w.granted) continue
    if (!validRect(w.rect))
      return { ok: false, reason: 'Una ventana no concedida tiene un rectángulo no válido: sin captura (falla cerrado)' }
    const visible = intersect(w.rect, bounds)
    if (!visible) continue
    let pieces: Rect[] = [visible]
    for (let j = 0; j < i && pieces.length; j++) {
      if (!windows[j].granted || !validRect(windows[j].rect)) continue
      pieces = pieces.flatMap((p) => subtractRect(p, windows[j].rect))
    }
    masks.push(...pieces)
  }
  if (masks.length > 0 && !canMask)
    return { ok: false, reason: 'Hay ventanas sin concesión y no se pueden enmascarar: sin captura (falla cerrado)' }
  return { ok: true, masks }
}

/** La enumeración antes y después de capturar debe coincidir (ids, orden, rectángulos y concesión); si no, se rechaza. */
export function windowsChanged(before: WinInfo[], after: WinInfo[]): boolean {
  if (before.length !== after.length) return true
  return before.some((a, i) => {
    const b = after[i]
    return (
      a.id !== b.id ||
      a.granted !== b.granted ||
      a.rect.x !== b.rect.x ||
      a.rect.y !== b.rect.y ||
      a.rect.width !== b.rect.width ||
      a.rect.height !== b.rect.height
    )
  })
}

/** Máscaras físicas → píxeles de la captura, redondeando HACIA FUERA para no dejar bordes sin cubrir. */
export function masksToCapturePx(masks: Rect[], ratio: number, origin: Point, size: { width: number; height: number }): Rect[] {
  const out: Rect[] = []
  for (const m of masks) {
    const x0 = Math.max(0, Math.floor((m.x - origin.x) / ratio))
    const y0 = Math.max(0, Math.floor((m.y - origin.y) / ratio))
    const x1 = Math.min(size.width, Math.ceil((m.x + m.width - origin.x) / ratio))
    const y1 = Math.min(size.height, Math.ceil((m.y + m.height - origin.y) / ratio))
    if (x1 > x0 && y1 > y0) out.push({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 })
  }
  return out
}

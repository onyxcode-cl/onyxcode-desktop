/**
 * Utilidades para las herramientas de control del Mac (MCP `computer`): etiquetas en español,
 * iconos, resumen de la acción y extracción segura de capturas de pantalla.
 */
import { AppWindow, Camera, Hand, Keyboard, Mouse, MousePointer2, MousePointerClick, Move, ScrollText, Timer, Type } from 'lucide-react'
import type { ComputerActionEvent } from '@shared/ipc-tasks'
import type { FilePart, ToolPart } from '@opencode-ai/sdk/v2/client'

export type ComputerToolKind =
  | 'screenshot'
  | 'click'
  | 'right_click'
  | 'middle_click'
  | 'double_click'
  | 'triple_click'
  | 'type'
  | 'key'
  | 'move'
  | 'drag'
  | 'scroll'
  | 'open_app'
  | 'cursor'
  | 'wait'
  | 'other'

type Icon = typeof Camera

const KIND_INFO: Record<ComputerToolKind, { label: string; icon: Icon }> = {
  screenshot: { label: 'Captura', icon: Camera },
  click: { label: 'Clic', icon: MousePointerClick },
  right_click: { label: 'Clic derecho', icon: MousePointerClick },
  middle_click: { label: 'Clic central', icon: MousePointerClick },
  double_click: { label: 'Doble clic', icon: MousePointerClick },
  triple_click: { label: 'Triple clic', icon: MousePointerClick },
  type: { label: 'Escribir', icon: Type },
  key: { label: 'Tecla', icon: Keyboard },
  move: { label: 'Mover', icon: MousePointer2 },
  drag: { label: 'Arrastrar', icon: Hand },
  scroll: { label: 'Desplazar', icon: ScrollText },
  open_app: { label: 'Abrir app', icon: AppWindow },
  cursor: { label: 'Posición del cursor', icon: Move },
  wait: { label: 'Esperar', icon: Timer },
  other: { label: 'Control del Mac', icon: Mouse }
}

/** Sufijo de la herramienta MCP → tipo de acción. */
const SUFFIX_KIND: Record<string, ComputerToolKind> = {
  screenshot: 'screenshot',
  capture: 'screenshot',
  take_screenshot: 'screenshot',
  click: 'click',
  left_click: 'click',
  right_click: 'right_click',
  middle_click: 'middle_click',
  double_click: 'double_click',
  triple_click: 'triple_click',
  type: 'type',
  type_text: 'type',
  key: 'key',
  press_key: 'key',
  hotkey: 'key',
  mouse_move: 'move',
  move: 'move',
  move_mouse: 'move',
  left_click_drag: 'drag',
  drag: 'drag',
  scroll: 'scroll',
  open_app: 'open_app',
  open_application: 'open_app',
  launch_app: 'open_app',
  cursor_position: 'cursor',
  wait: 'wait'
}

/** Nombres suficientemente específicos como para reconocerlos aunque no lleven prefijo de servidor. */
const UNPREFIXED = new Set([
  'screenshot',
  'left_click',
  'right_click',
  'double_click',
  'triple_click',
  'left_click_drag',
  'mouse_move',
  'open_app',
  'open_application',
  'cursor_position'
])

/**
 * Si `tool` es una herramienta del MCP de control del Mac devuelve su tipo, si no `null`.
 * Reconoce `computer_screenshot`, `computer-use_left_click`, `mac_computer_type`… (prefijo con "computer").
 */
export function computerToolKind(tool: string): ComputerToolKind | null {
  const name = tool.toLowerCase()
  const m = /^(.*computer[a-z0-9-]*)_(.+)$/.exec(name)
  if (m) return SUFFIX_KIND[m[2]] ?? 'other'
  if (UNPREFIXED.has(name)) return SUFFIX_KIND[name] ?? 'other'
  return null
}

export function computerToolInfo(kind: ComputerToolKind): { label: string; icon: Icon } {
  return KIND_INFO[kind]
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : undefined
}

function coords(input: Record<string, unknown>): string | null {
  let x = num(input.x)
  let y = num(input.y)
  const c = input.coordinate ?? input.coordinates ?? input.position
  if ((x === undefined || y === undefined) && Array.isArray(c) && c.length >= 2) {
    x = num(c[0])
    y = num(c[1])
  }
  return x !== undefined && y !== undefined ? `(${x}, ${y})` : null
}

function clip(s: string, n = 40): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

/** Detalle corto de la acción (coordenadas, texto, tecla, app…) a partir del input de la herramienta. */
export function computerToolDetail(kind: ComputerToolKind, input: Record<string, unknown>): string {
  const str = (k: string): string | undefined => (typeof input[k] === 'string' && input[k] ? (input[k] as string) : undefined)
  switch (kind) {
    case 'type': {
      const t = str('text') ?? str('value')
      return t ? `«${clip(t)}»` : ''
    }
    case 'key': {
      const k = str('key') ?? str('keys') ?? str('text') ?? str('combo')
      return k ?? (Array.isArray(input.keys) ? input.keys.join('+') : '')
    }
    case 'open_app':
      return str('app') ?? str('name') ?? str('application') ?? str('bundleId') ?? ''
    case 'scroll': {
      const dir = str('direction')
      const dirEs: Record<string, string> = { up: 'arriba', down: 'abajo', left: 'izquierda', right: 'derecha' }
      const at = coords(input)
      return [dir ? (dirEs[dir] ?? dir) : null, at].filter(Boolean).join(' ')
    }
    case 'drag': {
      const from = coords(input)
      const to = coords({
        x: input.toX ?? input.x2 ?? input.endX,
        y: input.toY ?? input.y2 ?? input.endY,
        coordinate: input.to ?? input.end
      })
      return [from, to].filter(Boolean).join(' → ')
    }
    default:
      return coords(input) ?? ''
  }
}

/** Frase para el banner "Controlando tu Mac" a partir de un evento `computer:action`. */
export function describeAction(ev: ComputerActionEvent): string {
  const kind = computerToolKind(ev.tool.includes('computer') ? ev.tool : `computer_${ev.tool}`) ?? 'other'
  const pos = ev.x !== undefined && ev.y !== undefined ? `(${Math.round(ev.x)}, ${Math.round(ev.y)})` : ''
  const at = pos ? ` en ${pos}` : ''
  switch (kind) {
    case 'screenshot':
      return 'Captura de pantalla'
    case 'type':
      return ev.text ? `Escribiendo «${clip(ev.text)}»` : 'Escribiendo'
    case 'key':
      return ev.text ? `Pulsando ${ev.text}` : 'Pulsando tecla'
    case 'move':
      return `Moviendo el ratón${pos ? ` a ${pos}` : ''}`
    case 'drag':
      return `Arrastrando${at}`
    case 'scroll':
      return `Desplazando${at}`
    case 'open_app':
      return ev.text ? `Abriendo ${ev.text}` : 'Abriendo app'
    case 'wait':
      return 'Esperando'
    case 'cursor':
      return 'Leyendo posición del cursor'
    case 'other':
      return ev.tool
    default:
      return `${KIND_INFO[kind].label}${at}`
  }
}

const SAFE_DATA_IMAGE = /^data:image\/(png|jpe?g|webp|gif);base64,/i

/**
 * URL segura para mostrar una imagen adjunta: solo `data:image/(png|jpeg|webp|gif);base64`
 * o `file://`. Cualquier otra cosa (http, javascript:, svg…) se descarta.
 */
export function safeImageUrl(file: FilePart): string | null {
  const url = file.url
  if (!url) return null
  if (SAFE_DATA_IMAGE.test(url)) return url
  if (url.startsWith('file://') && /^image\/(png|jpe?g|webp|gif)$/i.test(file.mime)) return url
  return null
}

/** Imágenes adjuntas (capturas) del resultado de una herramienta. */
export function toolImages(part: ToolPart): Array<{ id: string; url: string; name: string }> {
  if (part.state.status !== 'completed') return []
  const out: Array<{ id: string; url: string; name: string }> = []
  for (const a of part.state.attachments ?? []) {
    if (!a.mime.startsWith('image/')) continue
    const url = safeImageUrl(a)
    if (url) out.push({ id: a.id, url, name: a.filename ?? 'Captura' })
  }
  return out
}

/**
 * Overlay de control a pantalla completa (transparente y sin clics): borde luminoso animado,
 * marca de destino mientras el cursor viaja, onda en cada clic, etiqueta de la acción junto al
 * cursor y destello tras cada captura. Recibe `computer:overlay` del proceso principal
 * (src/main/computer/overlay.ts). Coordenadas ya en px CSS de esta ventana.
 */
import type { ComputerActionEvent, ComputerOverlayMessage } from '@shared/ipc-cowork'
import { cowork, reducedMotion, shortLabel } from './shared'
import './overlay.css'

const CLICK_TOOLS = new Set(['left_click', 'right_click', 'double_click'])
const TAG_LINGER_MS = 1800

const root = document.getElementById('root') as HTMLDivElement
root.innerHTML = `
  <div class="frame" aria-hidden="true"></div>
  <div class="frame frame-glow" aria-hidden="true"></div>
  <div class="edge-shade" aria-hidden="true"></div>
  <div class="flash" aria-hidden="true"></div>
  <div class="fx" aria-hidden="true"></div>
  <div class="tag" role="status"><span class="tag-dot"></span><span class="tag-text"></span></div>
`
const fx = root.querySelector('.fx') as HTMLDivElement
const flash = root.querySelector('.flash') as HTMLDivElement
const tag = root.querySelector('.tag') as HTMLDivElement
const tagText = root.querySelector('.tag-text') as HTMLSpanElement

let target: HTMLDivElement | null = null
let dragLine: SVGSVGElement | null = null
let tagTimer: number | undefined

function motionOk(): boolean {
  return !reducedMotion.matches
}

// ───────────────────────────── etiqueta ─────────────────────────────

/** Coloca la etiqueta junto al punto (x, y), dándole la vuelta cerca de los bordes. */
function placeTag(x: number, y: number, ms: number): void {
  const flipX = x > window.innerWidth - 240
  const flipY = y > window.innerHeight - 70
  tag.classList.toggle('flip-x', flipX)
  tag.classList.toggle('flip-y', flipY)
  tag.style.transitionDuration = ms > 0 ? `${ms}ms, 160ms, 160ms` : '0ms, 160ms, 160ms'
  tag.style.setProperty('--x', `${Math.round(x)}px`)
  tag.style.setProperty('--y', `${Math.round(y)}px`)
}

function showTag(text: string, variant?: string): void {
  window.clearTimeout(tagTimer)
  tagText.textContent = text
  tag.dataset.variant = variant ?? ''
  tag.classList.add('visible')
}

function lingerTag(ms = TAG_LINGER_MS): void {
  window.clearTimeout(tagTimer)
  tagTimer = window.setTimeout(() => tag.classList.remove('visible'), ms)
}

// ───────────────────────────── efectos ─────────────────────────────

function clearTarget(): void {
  target?.remove()
  target = null
  dragLine?.remove()
  dragLine = null
}

function spawnTarget(x: number, y: number, kind: string): void {
  clearTarget()
  const el = document.createElement('div')
  el.className = `target target-${kind}`
  el.style.left = `${x}px`
  el.style.top = `${y}px`
  fx.appendChild(el)
  target = el
}

function spawnDragLine(x1: number, y1: number, x2: number, y2: number): void {
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('class', 'drag-line')
  svg.setAttribute('width', String(window.innerWidth))
  svg.setAttribute('height', String(window.innerHeight))
  const line = document.createElementNS(ns, 'line')
  line.setAttribute('x1', String(x1))
  line.setAttribute('y1', String(y1))
  line.setAttribute('x2', String(x2))
  line.setAttribute('y2', String(y2))
  svg.appendChild(line)
  fx.appendChild(svg)
  dragLine = svg
}

function ripple(x: number, y: number, kind: string, delay = 0): void {
  const el = document.createElement('div')
  el.className = `ripple ripple-${kind}`
  el.style.left = `${x}px`
  el.style.top = `${y}px`
  if (delay) el.style.setProperty('--d', `${delay}ms`)
  el.innerHTML = '<span></span><span></span><i></i>'
  fx.appendChild(el)
  window.setTimeout(() => el.remove(), 1100 + delay)
}

function doFlash(soft: boolean): void {
  flash.classList.remove('on', 'soft')
  void flash.offsetWidth // reinicia la animación
  flash.classList.add('on')
  if (soft) flash.classList.add('soft')
}

// ───────────────────────────── acciones ─────────────────────────────

function onAction(msg: Extract<ComputerOverlayMessage, { type: 'action' }>): void {
  const ev: ComputerActionEvent = msg.action
  const x = ev.x ?? 0
  const y = ev.y ?? 0
  const phase = ev.phase ?? 'start'

  if (ev.tool === 'screenshot') {
    if (phase === 'start') {
      if (!ev.auto) {
        placeTag(x, y, 0)
        showTag('Captura', 'shot')
      }
    } else {
      doFlash(!!ev.auto)
      if (!ev.auto) lingerTag(700)
    }
    return
  }

  if (phase === 'start') {
    const travel = motionOk() && !msg.atCursor && msg.cursor && (msg.moveMs ?? 0) > 0
    if (travel && msg.cursor) {
      // La etiqueta sale de donde está el cursor y "viaja" con él hasta el destino.
      placeTag(msg.cursor.x, msg.cursor.y, 0)
      void tag.offsetWidth
      placeTag(x, y, msg.moveMs ?? 0)
    } else {
      placeTag(x, y, 0)
    }
    const variant = CLICK_TOOLS.has(ev.tool) ? 'click' : ev.tool === 'type_text' || ev.tool === 'key' ? 'type' : ''
    let text = shortLabel(ev)
    if (ev.tool === 'scroll') {
      const dir = (ev.text ?? '').split(' ')[0]
      text += { up: ' ↑', down: ' ↓', left: ' ←', right: ' →' }[dir] ?? ''
    }
    showTag(text, variant)
    if (!msg.atCursor) {
      if (ev.tool === 'drag' && ev.fromX !== undefined && ev.fromY !== undefined) {
        spawnTarget(x, y, 'drag')
        spawnDragLine(ev.fromX, ev.fromY, x, y)
      } else if (ev.tool !== 'mouse_move') {
        spawnTarget(x, y, ev.tool === 'scroll' ? 'scroll' : 'click')
      }
    }
    return
  }

  // phase === 'end' (o evento legado sin fase: se trata como inicio arriba)
  clearTarget()
  if (ev.ok !== false && !msg.atCursor) {
    if (ev.tool === 'double_click') {
      ripple(x, y, 'click')
      ripple(x, y, 'click', 140)
    } else if (ev.tool === 'right_click') {
      ripple(x, y, 'alt')
    } else if (CLICK_TOOLS.has(ev.tool) || ev.tool === 'drag') {
      ripple(x, y, 'click')
    }
  }
  if (ev.ok === false) showTag('No se pudo', 'error')
  lingerTag()
}

function handle(msg: ComputerOverlayMessage): void {
  switch (msg.type) {
    case 'show':
      document.body.classList.remove('stopped')
      document.body.classList.add('on')
      return
    case 'hide':
      document.body.classList.remove('on')
      tag.classList.remove('visible')
      clearTarget()
      return
    case 'stopped':
      document.body.classList.remove('paused')
      document.body.classList.add('stopped')
      clearTarget()
      showTag('Control detenido', 'error')
      return
    case 'action':
      onAction(msg)
      return
    case 'waiting':
      // Tarea en pausa esperando una respuesta a `request_access` (sin límite de tiempo): el borde
      // cambia a ámbar para que se note de un vistazo que el agente no está actuando.
      document.body.classList.add('paused')
      clearTarget()
      window.clearTimeout(tagTimer)
      placeTag(window.innerWidth / 2, 46, 0)
      showTag('Esperando tu permiso', 'pause')
      return
    case 'waitingCleared':
      document.body.classList.remove('paused')
      lingerTag(200)
      return
  }
}

cowork?.on('computer:overlay', handle)

// Vista previa sin Electron (abrir index.html#demo en un navegador).
if (location.hash === '#demo') {
  document.body.classList.add('on')
  const cx = window.innerWidth / 2
  const cy = window.innerHeight / 2
  handle({ type: 'action', action: { tool: 'left_click', x: cx, y: cy, phase: 'start', at: 0 }, cursor: { x: 80, y: 80 }, moveMs: 450 })
  window.setTimeout(
    () => handle({ type: 'action', action: { tool: 'left_click', x: cx, y: cy, phase: 'end', ok: true, at: 0 } }),
    520
  )
}

// Parser puro de las lineas JSON de lazunox-dictate y maquina de estados (espejo de `Phase` en main.swift).
// Sin dependencias; lo usa la prueba protocol.test.mjs. No toca src/ de la app.
export const MAX_LINE_BYTES = 64 * 1024
export const MAX_TEXT_BYTES = 8 * 1024
const TYPES = new Set(['partial', 'final', 'state', 'error'])

/** Devuelve el evento tipado o null si la linea es basura, demasiado larga o de tipo desconocido. */
export function parseLine(line) {
  if (typeof line !== 'string' || Buffer.byteLength(line) > MAX_LINE_BYTES) return null
  let o
  try {
    o = JSON.parse(line)
  } catch {
    return null
  }
  if (!o || typeof o !== 'object' || Array.isArray(o) || !TYPES.has(o.type)) return null
  if (o.type === 'partial' || o.type === 'final') {
    if (typeof o.text !== 'string') return null
    if (Buffer.byteLength(o.text) > MAX_TEXT_BYTES) return null
  }
  if (o.type === 'state' && typeof o.state !== 'string') return null
  if (o.type === 'error' && typeof o.code !== 'string') return null
  return o
}

const NEXT = {
  idle: ['starting'],
  starting: ['listening', 'finishing', 'stopped'],
  listening: ['finishing', 'stopped'],
  finishing: ['stopped'],
  stopped: []
}
export function canGo(from, to) {
  return (NEXT[from] ?? []).includes(to)
}

/** Reduce una secuencia de eventos a { phase, partial, finals, errors, violations }. */
export function replay(events) {
  const r = { phase: 'idle', partial: '', finals: [], errors: [], violations: 0 }
  for (const e of events) {
    if (e.type === 'state' && e.state in NEXT) {
      if (canGo(r.phase, e.state)) r.phase = e.state
      else r.violations++
    } else if (e.type === 'partial') {
      if (r.phase !== 'listening' && r.phase !== 'finishing') r.violations++
      r.partial = e.text
    } else if (e.type === 'final') {
      if (r.phase !== 'listening' && r.phase !== 'finishing') r.violations++
      r.partial = ''
      r.finals.push(e.text)
    } else if (e.type === 'error') r.errors.push(e.code)
  }
  return r
}

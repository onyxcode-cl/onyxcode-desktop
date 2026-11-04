/**
 * Avisos que deja el motor en los metadatos de las partes, dichos en lenguaje llano para la persona (P6 de la 1.8.9).
 *
 *  - Comandos en segundo plano (motor publicado): `metadata.running === true` + `metadata.shellId` en la parte `bash`.
 *  - Reintentos anotados y cambio de modelo (motor aún sin publicar, `lazunox_reintento` / `lazunox_cambio_modelo`): hoy no llegan;
 *    cuando lleguen ya se pintan. Todo lo que viene del motor es dato no confiable: se valida la forma y se recortan los textos.
 *
 * Puro (sin React) para poder probarlo con partes de ejemplo.
 */
import { t, type MsgKey } from './i18n'

type Meta = Record<string, unknown>

const asMeta = (v: unknown): Meta => (v && typeof v === 'object' ? (v as Meta) : {})

/** ¿Esta parte es un comando lanzado en segundo plano que sigue funcionando? */
export function isBackgroundShell(part: { tool?: string; state?: { status?: string; metadata?: unknown } }): boolean {
  if (part.tool !== 'bash' && part.tool !== 'shell') return false
  const meta = asMeta(part.state?.metadata)
  return meta.running === true && typeof meta.shellId === 'string' && meta.shellId.length > 0
}

/** Cuántos comandos siguen en segundo plano en estos mensajes (cada `shellId` cuenta una vez, aunque se haya consultado varias veces). */
export function liveShellCount(messages: ReadonlyArray<{ parts: ReadonlyArray<unknown> }> | undefined): number {
  if (!messages) return 0
  const live = new Set<string>()
  const ended = new Set<string>()
  for (const m of messages)
    for (const raw of m.parts) {
      const p = raw as { type?: string; tool?: string; state?: { status?: string; metadata?: unknown } }
      if (p.type !== 'tool') continue
      const meta = asMeta(p.state?.metadata)
      const id = typeof meta.shellId === 'string' ? meta.shellId : ''
      if (!id) continue
      // `shell_wait` y el propio `bash` repiten el `shellId`: la última lectura manda.
      if (meta.running === true) {
        live.add(id)
        ended.delete(id)
      } else {
        ended.add(id)
        live.delete(id)
      }
    }
  return live.size
}

const CAUSE: Record<string, MsgKey> = {
  cuota: 'engine.retry.cause.cuota',
  limite: 'engine.retry.cause.limite',
  sobrecarga: 'engine.retry.cause.sobrecarga',
  red: 'engine.retry.cause.red'
}

function modelName(ref: unknown): string {
  const o = asMeta(ref)
  const id = typeof o.modelID === 'string' ? o.modelID : ''
  return id.replace(/\s+/g, ' ').trim().slice(0, 60)
}

/** Texto llano de una parte-anotación del motor (reintento o cambio de modelo), o `null` si la parte no es una. */
export function engineNote(part: { type: string; metadata?: unknown }): string | null {
  if (part.type !== 'text') return null
  const meta = asMeta(part.metadata)

  const rawRetry = meta.lazunox_reintento
  if (rawRetry !== undefined) {
    let o: Meta = {}
    try {
      o = asMeta(typeof rawRetry === 'string' ? JSON.parse(rawRetry) : rawRetry)
    } catch {
      return null
    }
    if (typeof o.attempt !== 'number') return null
    const cause = t(CAUSE[typeof o.cause === 'string' ? o.cause : ''] ?? 'engine.retry.cause.otro')
    const seconds = typeof o.waitMs === 'number' && o.waitMs > 0 ? Math.max(1, Math.round(o.waitMs / 1000)) : 0
    return t(seconds ? 'engine.retry.wait' : 'engine.retry.nowait', {
      attempt: o.attempt,
      max: typeof o.max === 'number' ? o.max : o.attempt,
      cause,
      seconds
    })
  }

  const change = meta.lazunox_cambio_modelo
  if (change !== undefined) {
    const o = asMeta(change)
    const from = modelName(o.anterior)
    const to = modelName(o.nuevo)
    if (!from || !to) return null
    const why = o.motivo === 'compactacion-fallida' ? 'engine.model.why.compact' : 'engine.model.why.other'
    return t('engine.model.notApplied', { to, from, why: t(why) })
  }
  return null
}

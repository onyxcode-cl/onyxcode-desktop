/**
 * Textos de la pantalla «Preparando Lazunox»: qué mensaje corresponde a cada componente y motivo, y cómo se escribe un tamaño.
 * Lógica sin React (se prueba con `preflight-run.test.ts`).
 */
import { localeTag, type MsgKey } from '@shared/i18n'
import type { PreflightComponent, PreflightId, RowState } from '@shared/preflight'
import { officeErrorKey } from '../settings/impl/component-install'
import { SETUP_ERRORS } from '../tasks/impl/sandbox-view'
import { runtimesErrorKey } from '../settings/impl/runtimes-view'

export const LABELS: Record<PreflightId, MsgKey> = {
  storage: 'preflight.c.storage',
  disk: 'preflight.c.disk',
  engine: 'preflight.c.engine',
  craft: 'preflight.c.craft',
  runtimes: 'preflight.c.runtimes',
  sandbox: 'preflight.c.sandbox',
  helper: 'preflight.c.helper',
  perms: 'preflight.c.perms',
  files: 'preflight.c.files',
  location: 'preflight.c.location'
}

export const STATE_LABELS: Record<RowState, MsgKey> = {
  ready: 'preflight.state.ready',
  missing: 'preflight.state.missing',
  downloading: 'preflight.state.downloading',
  failed: 'preflight.state.failed',
  pending: 'preflight.state.pending'
}

/** Mensaje de cada (componente, motivo) cuando NO está listo. Un motivo desconocido cae en el genérico del componente. */
const HINTS: Partial<Record<PreflightId, Record<string, MsgKey>>> = {
  engine: { 'not-found': 'preflight.hint.engine.not-found', 'not-responding': 'preflight.hint.engine.not-responding' },
  craft: { missing: 'preflight.hint.craft.missing', incomplete: 'preflight.hint.craft.incomplete' },
  runtimes: { missing: 'preflight.hint.runtimes.missing', broken: 'preflight.hint.runtimes.broken' },
  sandbox: { needsSetup: 'preflight.hint.sandbox.needsSetup', broken: 'preflight.hint.sandbox.broken' },
  helper: { 'not-found': 'preflight.hint.helper.not-found' },
  perms: {
    both: 'preflight.hint.perms.both',
    accessibility: 'preflight.hint.perms.accessibility',
    restart: 'preflight.hint.perms.restart',
    unknown: 'preflight.hint.perms.unknown'
  },
  files: { denied: 'preflight.hint.files.denied', unknown: 'preflight.hint.files.unknown' },
  location: {
    translocated: 'preflight.hint.location.translocated',
    volume: 'preflight.hint.location.volume',
    elsewhere: 'preflight.hint.location.elsewhere'
  },
  disk: { 'low-space': 'preflight.hint.disk.low-space' },
  storage: { 'not-writable': 'preflight.hint.storage.not-writable' }
}
const FALLBACK: Partial<Record<PreflightId, MsgKey>> = {
  sandbox: 'preflight.hint.sandbox.other',
  perms: 'preflight.hint.perms.both',
  files: 'preflight.hint.files.denied'
}

/** Clave del texto que explica por qué un componente no está listo, o `null` si está listo. */
export function hintKey(c: PreflightComponent): MsgKey | null {
  if (c.ok) return null
  const byReason = c.reason ? HINTS[c.id]?.[c.reason] : undefined
  if (byReason) return byReason
  return FALLBACK[c.id] ?? (c.essential ? 'preflight.hint.generic.essential' : 'preflight.hint.generic.optional')
}

/**
 * Clave del motivo REAL de un fallo de instalación: los códigos de ArtCraft (`disk`, `hash`, `signature`, `download`…), los del entorno
 * aislado (`offline`, `no-space`…) o el genérico. Nunca devuelve «falló» sin explicación.
 */
export function failureKey(id: PreflightId, code: string | undefined): MsgKey {
  if (id === 'sandbox') return (code && SETUP_ERRORS[code]) || 'tasks.sandbox.error.generic'
  if (id === 'engine') return 'preflight.error.engine'
  if (id === 'runtimes') return runtimesErrorKey(code)
  return officeErrorKey(code)
}

/** Tamaño aproximado: megabytes (1 MB = 1e6 bytes) por debajo de 1 GB y gigabytes con un decimal por encima. */
export function sizeParts(bytes: number, locale: string = localeTag()): { key: 'preflight.size.mb' | 'preflight.size.gb'; n: string } {
  if (bytes >= 1e9) {
    const fmt = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    return { key: 'preflight.size.gb', n: fmt.format(Math.round(bytes / 1e8) / 10) }
  }
  return { key: 'preflight.size.mb', n: String(Math.max(1, Math.round(bytes / 1e6))) }
}

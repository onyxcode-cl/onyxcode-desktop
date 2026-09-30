/**
 * Lógica pura: ¿hay alguna IA conectada?, ¿qué modelo se usa «de verdad» y se puede enviar?
 * Sin React, sin IPC y sin el SDK (tipos mínimos): se prueba con `ai-availability.test.ts`.
 */
import type { ModelRef } from './types'

/** Proveedor reducido a lo que hace falta aquí (compatible con el `Provider` del SDK). */
export interface ProviderLike {
  id: string
  source: string
  models: Record<string, unknown>
}

/** Proveedor gratuito preinstalado en el servidor de OpenCode. */
export const FREE_PROVIDER_ID = 'opencode'
/** Proveedor preferido (mismo criterio que `sortProviders`). */
export const PREFERRED_PROVIDER_ID = 'opencode-go'

/**
 * ¿Cuenta como proveedor configurado por el usuario? Un servidor recién instalado ya «conecta» el
 * proveedor gratuito `opencode` (origen `custom`, sin clave): eso no cuenta, o el asistente no
 * aparecería nunca a un usuario nuevo.
 */
export function isConfiguredProvider(p: { id: string; source: string }): boolean {
  return !(p.id === FREE_PROVIDER_ID && p.source === 'custom')
}

/** `unknown` = aún sin cargar; `none` = ningún proveedor; `free-only` = solo el gratuito; `ready` = hay alguna IA configurada. */
export type AiAvailability = 'unknown' | 'none' | 'free-only' | 'ready'

export function aiAvailability(providers: ProviderLike[] | null): AiAvailability {
  if (providers === null) return 'unknown'
  if (providers.some(isConfiguredProvider)) return 'ready'
  return providers.length > 0 ? 'free-only' : 'none'
}

function hasModel(providers: ProviderLike[], ref: ModelRef): boolean {
  const p = providers.find((x) => x.id === ref.providerID)
  return !!p && Object.prototype.hasOwnProperty.call(p.models, ref.modelID)
}

/** Modelo predeterminado de un proveedor: el que indica `defaults` si existe; si no, el primero. */
function defaultOf(p: ProviderLike, defaults: Record<string, string>): ModelRef | null {
  const d = defaults[p.id]
  if (d && Object.prototype.hasOwnProperty.call(p.models, d)) return { providerID: p.id, modelID: d }
  const first = Object.keys(p.models)[0]
  return first ? { providerID: p.id, modelID: first } : null
}

/**
 * Modelo «efectivo»: el pedido si existe entre los proveedores cargados; si no, el predeterminado del
 * primer proveedor configurado (OpenCode Go primero); si no hay ninguno, `null`. Mientras los proveedores
 * no han cargado (`null`) se devuelve el pedido tal cual. No persiste nada.
 */
export function resolveModel(wanted: ModelRef, providers: ProviderLike[] | null, defaults: Record<string, string>): ModelRef | null {
  if (providers === null) return wanted
  if (hasModel(providers, wanted)) return wanted
  const configured = providers
    .filter(isConfiguredProvider)
    .sort((a, b) => (a.id === PREFERRED_PROVIDER_ID ? -1 : b.id === PREFERRED_PROVIDER_ID ? 1 : a.id.localeCompare(b.id)))
  for (const p of configured) {
    const m = defaultOf(p, defaults)
    if (m) return m
  }
  return null
}

/** Primer modelo del proveedor gratuito (el que ofrece «Probar un modelo gratuito»), o `null`. */
export function firstFreeModel(providers: ProviderLike[] | null): ModelRef | null {
  const p = providers?.find((x) => x.id === FREE_PROVIDER_ID)
  const id = p ? Object.keys(p.models)[0] : undefined
  return id ? { providerID: FREE_PROVIDER_ID, modelID: id } : null
}

export interface SendGate {
  blocked: boolean
  reason: 'no-ai' | null
  /** Se envía con un modelo gratuito porque no hay ninguna IA conectada: mostrar la nota suave. */
  freeNote: boolean
}

/** Decide si se puede enviar. Con `unknown` nunca bloquea (se envía el modelo pedido tal cual). */
export function sendGate(avail: AiAvailability, effective: ModelRef | null): SendGate {
  if (avail === 'unknown') return { blocked: false, reason: null, freeNote: false }
  if (effective === null) return { blocked: true, reason: 'no-ai', freeNote: false }
  return { blocked: false, reason: null, freeNote: avail === 'free-only' }
}

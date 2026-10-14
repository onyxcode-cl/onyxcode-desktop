/**
 * Lógica pura: ¿hay alguna IA conectada?, ¿qué modelo se usa «de verdad» y se puede enviar?
 * Sin React, sin IPC y sin el SDK (tipos mínimos): se prueba con `ai-availability.test.ts`.
 */
import { DEFAULT_MODEL, type ModelRef } from './types'

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

export function hasModel(providers: ProviderLike[], ref: ModelRef): boolean {
  const p = providers.find((x) => x.id === ref.providerID)
  return !!p && Object.prototype.hasOwnProperty.call(p.models, ref.modelID)
}

/**
 * ¿La elección explícita del usuario falta en la lista ya cargada? Solo cuenta con alguna IA configurada y para un modelo que el
 * usuario eligió: el predeterminado de fábrica (nunca tocado) sí puede sustituirse por el de la IA que sí tiene (`resolveModel`).
 */
export function isChoiceUnavailable(wanted: ModelRef, providers: ProviderLike[] | null): boolean {
  if (providers === null || aiAvailability(providers) !== 'ready') return false
  if (wanted.providerID === DEFAULT_MODEL.providerID && wanted.modelID === DEFAULT_MODEL.modelID) return false
  return !hasModel(providers, wanted)
}

/** ¿El catálogo marca este modelo como obsoleto? (el servidor lo rechaza: «Model … has been deprecated»). */
const isDeprecated = (m: unknown): boolean => typeof m === 'object' && m !== null && (m as { status?: unknown }).status === 'deprecated'

/** Ids de los modelos vigentes de un proveedor (sin los obsoletos), en el orden del catálogo. */
function liveModelIds(p: ProviderLike): string[] {
  return Object.keys(p.models).filter((id) => !isDeprecated(p.models[id]))
}

/** Modelo predeterminado de un proveedor: el que indica `defaults` si existe y está vigente; si no, el primero vigente. */
function defaultOf(p: ProviderLike, defaults: Record<string, string>): ModelRef | null {
  const d = defaults[p.id]
  if (d && Object.prototype.hasOwnProperty.call(p.models, d) && !isDeprecated(p.models[d])) return { providerID: p.id, modelID: d }
  const first = liveModelIds(p)[0]
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

/**
 * Modelos gratuitos de OpenCode que se prefieren, en orden (los que respondieron en las pruebas de primer uso). El catálogo gratuito
 * cambia y a veces un modelo cae («Model is unavailable»): elegir solo «el primero» dejaba al usuario nuevo esperando en «Pensando…».
 */
export const FREE_MODEL_PREFERENCE: readonly string[] = [
  'ling-3.1-flash-free',
  'mimo-v2.6-flash-free',
  'big-pickle',
  'nemotron-3.5-lightning-free'
]

/** Modelo del proveedor gratuito que ofrece «Probar un modelo gratuito»: el preferido que exista; si no, el primero; o `null`. */
export function firstFreeModel(providers: ProviderLike[] | null): ModelRef | null {
  const p = providers?.find((x) => x.id === FREE_PROVIDER_ID)
  if (!p) return null
  const ids = liveModelIds(p)
  const id = FREE_MODEL_PREFERENCE.find((m) => ids.includes(m)) ?? ids[0]
  return id ? { providerID: FREE_PROVIDER_ID, modelID: id } : null
}

export interface SendGate {
  blocked: boolean
  reason: 'no-ai' | 'model-unavailable' | null
  /** Se envía con un modelo gratuito porque no hay ninguna IA conectada: mostrar la nota suave. */
  freeNote: boolean
}

/** Decide si se puede enviar (`unavailable` = la elección explícita falta, ver `isChoiceUnavailable`). Con `unknown` nunca bloquea (se envía el modelo pedido tal cual). */
export function sendGate(avail: AiAvailability, effective: ModelRef | null, unavailable = false): SendGate {
  // El modelo elegido no está: no se envía con otro a escondidas; hay que elegir uno disponible.
  if (unavailable) return { blocked: true, reason: 'model-unavailable', freeNote: false }
  if (avail === 'unknown') return { blocked: false, reason: null, freeNote: false }
  if (effective === null) return { blocked: true, reason: 'no-ai', freeNote: false }
  return { blocked: false, reason: null, freeNote: avail === 'free-only' }
}

// ───────────── Reconciliar las elecciones guardadas al cambiar de proveedor ─────────────

/** Modos con modelo propio (`modelsByMode`); mismo conjunto que `ModelMode` de `ipc-extras`. */
export type ChoiceMode = 'chat' | 'code' | 'tasks'

/** Elecciones explícitas del usuario: el predeterminado global (settings.json) y el de cada modo (extras.json). */
export interface ModelChoices {
  defaultModel: ModelRef
  modelsByMode: Partial<Record<ChoiceMode, ModelRef>>
}

export interface ReconcileOutcome {
  /** Elecciones ya reconciliadas (las mismas de entrada si `changed` es false). */
  choices: ModelChoices
  /** Las de entrada, para «Deshacer». */
  previous: ModelChoices
  changed: boolean
  /** Modelo al que se pasó (para el aviso «Ahora usas …»), o `null` si el predeterminado no cambió. */
  switchedTo: ModelRef | null
}

const copyChoices = (c: ModelChoices): ModelChoices => {
  const modelsByMode: ModelChoices['modelsByMode'] = {}
  for (const mode of Object.keys(c.modelsByMode) as ChoiceMode[]) {
    const ref = c.modelsByMode[mode]
    if (ref) modelsByMode[mode] = { providerID: ref.providerID, modelID: ref.modelID }
  }
  return { defaultModel: { providerID: c.defaultModel.providerID, modelID: c.defaultModel.modelID }, modelsByMode }
}

/**
 * Reconcilia las elecciones explícitas con los proveedores que hay AHORA (tras conectar o desconectar uno). Pura: no persiste.
 *
 * - Si OpenCode Go acaba de pasar a conectado (no estaba en `previousIds`) y alguna elección apunta a otro proveedor, vuelve a
 *   `DEFAULT_MODEL` (o al predeterminado de Go si ese modelo ya no existe) y se limpia el override del modo afectado.
 * - Una elección cuyo modelo ya no existe (proveedor desconectado) se sustituye (`resolveModel`: Go primero) y el override del modo se limpia.
 * - Sin ninguna IA configurada, o con la lista aún sin cargar, no se toca nada.
 */
export function reconcileChoices(
  choices: ModelChoices,
  providers: ProviderLike[] | null,
  defaults: Record<string, string>,
  previousIds: readonly string[] | null
): ReconcileOutcome {
  const previous = copyChoices(choices)
  const unchanged: ReconcileOutcome = { choices, previous, changed: false, switchedTo: null }
  if (providers === null || aiAvailability(providers) !== 'ready') return unchanged

  const go = providers.find((p) => p.id === PREFERRED_PROVIDER_ID)
  const goJustConnected = !!go && !(previousIds ?? []).includes(PREFERRED_PROVIDER_ID)
  const goTarget: ModelRef | null = !go ? null : hasModel(providers, DEFAULT_MODEL) ? { ...DEFAULT_MODEL } : defaultOf(go, defaults)

  const next = copyChoices(choices)
  let changed = false
  let switchedTo: ModelRef | null = null

  // Predeterminado global.
  if (goJustConnected && goTarget && choices.defaultModel.providerID !== PREFERRED_PROVIDER_ID) {
    next.defaultModel = goTarget
    changed = true
    switchedTo = goTarget
  } else if (isChoiceUnavailable(choices.defaultModel, providers)) {
    const alt = resolveModel(choices.defaultModel, providers, defaults)
    if (alt) {
      next.defaultModel = alt
      changed = true
      switchedTo = alt
    }
  }

  // Modelo propio de cada modo: se borra (vuelve a valer el predeterminado ya reconciliado).
  for (const mode of Object.keys(choices.modelsByMode) as ChoiceMode[]) {
    const ref = choices.modelsByMode[mode]
    if (!ref) continue
    const wrongAccount = goJustConnected && !!goTarget && ref.providerID !== PREFERRED_PROVIDER_ID
    if (wrongAccount || !hasModel(providers, ref)) {
      delete next.modelsByMode[mode]
      changed = true
      switchedTo ??= wrongAccount ? goTarget : resolveModel(next.defaultModel, providers, defaults)
    }
  }

  if (!changed) return unchanged
  return { choices: next, previous, changed: true, switchedTo }
}

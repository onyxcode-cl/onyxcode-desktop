/**
 * Consentimiento propio de la app para Control del PC en Windows (plan C §3 «El equivalente de TCC lo pone la propia app»).
 * Puro: sin Electron ni disco. Windows no tiene TCC; este consentimiento es de equipo, VERSIONADO (subir `WIN_CONSENT_VERSION`
 * al cambiar lo que se promete en el texto invalida los anteriores) y REVOCABLE. Se guarda como `{version, at}` en
 * `userData/computer-win-consent.json` (`win-storage.ts`; C4 lo prefirió a `settings.json`, que el renderer puede escribir). El MCP lo consulta por `GET /consent` → `{consent, version}` antes de cada herramienta.
 *
 * El flujo de la tarjeta de Ajustes (C5) es: se muestra la lista de lo que puede y no puede hacer; casilla «Entiendo»; botón
 * armado a los 600 ms tras mostrarse (como `perm-guard`); al confirmar se guarda. `createConsentController` es ese contrato sin UI:
 * la tarjeta real solo traduce clics a estas llamadas, y las pruebas lo ejercitan con una interfaz simulada.
 */

export const WIN_CONSENT_VERSION = 1
/** El botón de confirmar no se activa hasta pasado este tiempo desde que se muestra la tarjeta. */
export const CONSENT_ARM_MS = 600

export interface WinConsent {
  version: number
  /** Marca de tiempo (ms) de cuando se concedió. */
  at: number
}

/** Lo que `main` guarda: `null` = sin consentimiento. */
export interface ConsentStore {
  read: () => unknown
  write: (value: WinConsent | null) => void
}

/** Valida lo leído del disco: cualquier cosa rara es «sin consentimiento» (falla cerrado). */
export function normalizeConsent(raw: unknown): WinConsent | null {
  if (!raw || typeof raw !== 'object') return null
  const { version, at } = raw as { version?: unknown; at?: unknown }
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return null
  if (typeof at !== 'number' || !Number.isFinite(at) || at <= 0) return null
  return { version, at }
}

/** Vale solo si es de la versión VIGENTE: una versión anterior (o posterior, p. ej. tras bajar de versión la app) no cuenta. */
export function isConsentValid(c: WinConsent | null, current: number = WIN_CONSENT_VERSION): boolean {
  return c !== null && c.version === current
}

export interface ConsentView {
  consent: boolean
  version: number
  /** Hay un consentimiento guardado pero de otra versión: la UI debe pedirlo de nuevo explicando por qué. */
  stale: boolean
}

/** Respuesta de `GET /consent` y estado para Ajustes. */
export function consentView(raw: unknown, current: number = WIN_CONSENT_VERSION): ConsentView {
  const c = normalizeConsent(raw)
  return { consent: isConsentValid(c, current), version: current, stale: c !== null && c.version !== current }
}

export interface ConsentController {
  /** La tarjeta se muestra: arranca el temporizador de armado y desmarca la casilla. */
  show: () => void
  setChecked: (checked: boolean) => void
  /** ¿Puede pulsarse «Activar»? Casilla marcada y pasado el tiempo de armado. */
  armed: () => boolean
  /** Pulsar «Activar»: guarda el consentimiento solo si está armado. Devuelve si se concedió. */
  confirm: () => boolean
  /** Revocar (Ajustes): borra el consentimiento; el siguiente `GET /consent` ya devuelve `consent: false`. */
  revoke: () => void
  view: () => ConsentView
}

export function createConsentController(
  store: ConsentStore,
  now: () => number = Date.now,
  current: number = WIN_CONSENT_VERSION
): ConsentController {
  let shownAt: number | null = null
  let checked = false
  const armed = (): boolean => checked && shownAt !== null && now() - shownAt >= CONSENT_ARM_MS
  return {
    show: () => {
      shownAt = now()
      checked = false
    },
    setChecked: (c) => {
      checked = c
    },
    armed,
    confirm: () => {
      if (!armed()) return false
      store.write({ version: current, at: now() })
      shownAt = null
      checked = false
      return true
    },
    revoke: () => store.write(null),
    view: () => consentView(store.read(), current)
  }
}

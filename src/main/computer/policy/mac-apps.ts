/**
 * Apps de macOS BLOQUEADAS por defecto para las concesiones por app (equivalente de `win-apps.ts`).
 * Puro: sin Electron ni disco.
 *
 * Criterio: una app bloqueada nunca es concedible (ni por tarjeta `request_access`, ni desde Ajustes) y
 * nunca se controla. Entran gestores de contraseñas (guardan credenciales de todo) y carteras/bróker de
 * cripto e inversión (mover dinero). Solo se incluyen bundle ids que se conocen con seguridad; los dudosos
 * se listan en `PENDING_TO_CONFIRM` (comentados, NO bloquean) hasta confirmarlos en un Mac real con
 * `mdls -name kMDItemCFBundleIdentifier /Applications/<App>.app`.
 *
 * Coincidencia: insensible a mayúsculas. Exacta contra `MAC_BLOCKED_BUNDLE_IDS`, o por prefijo contra
 * `MAC_BLOCKED_BUNDLE_PREFIXES` solo cuando el prefijo pertenece en exclusiva a un proveedor.
 *
 * Ampliable: añade el bundle id a la lista (o un prefijo inequívoco) y cubre el caso en `mac-apps.test.ts`.
 */

export const MAC_BLOCKED_BUNDLE_IDS: readonly string[] = [
  // Gestores de contraseñas
  'com.apple.Passwords',
  'com.lastpass.LastPass'
]

/** Prefijos de proveedor exclusivo (gestores de contraseñas). Se comparan en minúsculas. */
export const MAC_BLOCKED_BUNDLE_PREFIXES: readonly string[] = ['com.1password.', 'com.agilebits.', 'com.bitwarden.', 'org.keepassxc.']

/**
 * Pendientes de confirmar (NO se bloquean todavía): wallets/cripto (Ledger Live, Coinbase, Binance,
 * Trezor Suite, Exodus) y bróker (Interactive Brokers, thinkorswim). No se han verificado sus bundle ids.
 */
export const PENDING_TO_CONFIRM: readonly string[] = [
  'com.ledger.live (Ledger Live)',
  'Coinbase Wallet / Coinbase (sin confirmar)',
  'Binance (sin confirmar)',
  'Trezor Suite (sin confirmar)',
  'com.exodus.exodus (Exodus)',
  'Interactive Brokers (sin confirmar)',
  'thinkorswim (sin confirmar)'
]

/** ¿Bundle id bloqueado en macOS? Insensible a mayúsculas. Una cadena vacía no coincide con nada (y ya es "desconocida"). */
export function isMacBlocked(bundleId: string): boolean {
  const id = bundleId.trim().toLowerCase()
  if (MAC_BLOCKED_BUNDLE_IDS.some((x) => x.toLowerCase() === id)) return true
  return MAC_BLOCKED_BUNDLE_PREFIXES.some((p) => id.startsWith(p))
}

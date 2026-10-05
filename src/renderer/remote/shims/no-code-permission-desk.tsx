/**
 * Tarjeta de permiso de Code en ESCRITORIO: el celular usa `MobilePermissionCard` (PermissionCard.tsx bifurca por
 * `isRemoteSurface()`). Este shim evita que `PermissionCardDesk` y su shell (`PermissionShell`, `lib/perm-guard`)
 * entren en el arranque de la PWA (solo pesan y usan utilidades de escritorio).
 */
export function PermissionCardDesk(): null {
  return null
}

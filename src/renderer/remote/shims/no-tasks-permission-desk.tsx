/**
 * Tarjeta de permiso de Tareas en ESCRITORIO: el celular usa `GenericPermissionCard` (PermissionPrompt.tsx bifurca
 * por `isRemoteSurface()`). Este shim evita que `PermissionCardDesk`/`ApprovalBarDesk` y su shell (`PermissionShell`,
 * `lib/perm-guard`) entren en el arranque de la PWA (solo pesan y usan utilidades de escritorio).
 */
export function PermissionCardDesk(): null {
  return null
}

export function ApprovalBarDesk(): null {
  return null
}

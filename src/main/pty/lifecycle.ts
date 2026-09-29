/** Decisión pura (sin `electron`) de cuándo una navegación del webContents deja huérfanos a sus ptys. */
export interface NavigationLike {
  isMainFrame: boolean
  isSameDocument?: boolean
}

/**
 * Recargar o navegar el frame principal destruye el renderer y sus terminales xterm, pero el
 * webContents sigue vivo (no hay `destroyed`): hay que matar los ptys. Subframes (iframes) y
 * navegaciones dentro del mismo documento (hash / pushState) no cuentan.
 */
export function shouldKillOnNavigation(d: NavigationLike): boolean {
  return d.isMainFrame && d.isSameDocument !== true
}

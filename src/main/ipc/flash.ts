/** Parpadeo del botón de la barra de tareas de Windows (equivalente al rebote del Dock de macOS). Puro. */
export function shouldFlashFrame(platform: string, win: { isFocused: boolean; isDestroyed: boolean } | null, pending = true): boolean {
  return platform === 'win32' && pending && !!win && !win.isDestroyed && !win.isFocused
}

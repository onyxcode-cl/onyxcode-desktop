/**
 * Llamar la atención del dueño cuando el celular pide una confirmación y la ventana no está al frente. macOS: rebote del Dock
 * (`critical`: insiste hasta que la app se activa). Windows: parpadeo del botón de la barra de tareas (`flashFrame`, se detiene al
 * enfocar la ventana). No hay equivalente en otras plataformas. Puro: las acciones se inyectan.
 */
export interface AttentionDeps {
  platform: string
  /** `app.dock?.bounce('critical')` (solo existe en macOS). */
  dockBounce?: () => void
  /** `ventana.flashFrame(true)` de la ventana principal, si existe. */
  flash?: () => void
}

export function requestAttention(d: AttentionDeps): void {
  if (d.platform === 'darwin') d.dockBounce?.()
  else if (d.platform === 'win32') d.flash?.()
}

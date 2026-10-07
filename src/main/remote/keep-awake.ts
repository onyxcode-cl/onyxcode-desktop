/**
 * «Mantener despierto» del control remoto en Windows. Mientras el remoto esté ACTIVO (modo distinto de `off`) y la bandera `remoteWin`
 * esté encendida, se pide a Electron `powerSaveBlocker.start('prevent-app-suspension')` (en Windows usa `SetThreadExecutionState`: el
 * equipo no se suspende, pero la pantalla SÍ puede apagarse; nunca se usa `prevent-display-sleep`). Se libera al apagar el remoto, al
 * cerrar la sesión («Cortar todo») y al salir de la app. Solo Windows: en macOS no hace nada. Un solo bloqueador a la vez (idempotente).
 * Electron entra por inyección (`PowerBlocker`) para probarlo sin Electron real.
 */
export interface PowerBlocker {
  start(type: 'prevent-app-suspension'): number
  stop(id: number): void
  isStarted(id: number): boolean
}

export interface KeepAwakeDeps {
  platform: string
  /** ¿Está encendida la bandera efectiva `remoteWin`? Se consulta en cada cambio. */
  enabled: () => boolean
  blocker: PowerBlocker
}

export interface KeepAwake {
  /** Llamar con el modo actual del remoto (`off` libera; cualquier otro bloquea la suspensión). */
  update(mode: string): void
  /** Libera el bloqueador (salida de la app). */
  release(): void
  /** ¿Hay un bloqueador pedido por nosotros? (para pruebas y diagnóstico) */
  readonly held: boolean
}

export function createKeepAwake(d: KeepAwakeDeps): KeepAwake {
  let id: number | null = null
  const drop = (): void => {
    if (id === null) return
    const old = id
    id = null
    try {
      if (d.blocker.isStarted(old)) d.blocker.stop(old)
    } catch {
      /* ya liberado por el sistema: no hay nada que soltar */
    }
  }
  return {
    update(mode) {
      const want = d.platform === 'win32' && mode !== 'off' && d.enabled()
      if (!want) return drop()
      try {
        if (id !== null && d.blocker.isStarted(id)) return
      } catch {
        /* se pide uno nuevo abajo */
      }
      id = null
      try {
        id = d.blocker.start('prevent-app-suspension')
      } catch {
        id = null
      }
    },
    release: drop,
    get held() {
      return id !== null
    }
  }
}

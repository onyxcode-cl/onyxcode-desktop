/**
 * Sincroniza el historial del navegador con la pila de la pestaña ACTIVA: siempre hay exactamente `profundidad - 1` entradas
 * propias (más una si el panel lateral está abierto: el panel cuenta como una entrada), de modo que el botón/gesto «atrás» del sistema desapila la pantalla de arriba y, desde la lista, sale de la app.
 * Al cambiar de pestaña (o vaciar la pila) las entradas sobrantes se retiran con `history.go(-n)` —ese salto dispara un
 * `popstate` que se ignora— y al volver a una pestaña apilada se vuelven a añadir. Sin DOM: lo prueba un test unitario.
 */
export interface HistoryPort {
  push: () => void
  go: (delta: number) => void
}

export interface HistorySync {
  /** Iguala las entradas con el objetivo (llamar tras cada cambio de la pila o de la pestaña). */
  reconcile: () => void
  /** Procesa un `popstate`: `user` si lo provocó el usuario (hay que desapilar), `own` si fue un ajuste nuestro. */
  popstate: () => 'user' | 'own'
  /** Si el navegador no llegó a emitir el `popstate` esperado, libera la espera. */
  settle: () => void
  entries: () => number
}

/** Entradas propias que debe haber: `profundidad - 1`, más una con el panel lateral abierto. */
export function historyTarget(depth: number, drawerOpen: boolean): number {
  return Math.max(0, depth - 1) + (drawerOpen ? 1 : 0)
}

/** Qué hace un «atrás» del usuario: con el panel abierto lo cierra (sin desapilar); si no, desapila la pantalla de arriba. */
export function userBackAction(drawerOpen: boolean): 'close-drawer' | 'pop' {
  return drawerOpen ? 'close-drawer' : 'pop'
}

export function createHistorySync(port: HistoryPort, target: () => number): HistorySync {
  let entries = 0
  let pending = false
  const reconcile = (): void => {
    if (pending) return
    const want = Math.max(0, target())
    if (want > entries) {
      for (let i = entries; i < want; i++) port.push()
      entries = want
    } else if (want < entries) {
      const delta = want - entries
      pending = true
      entries = want
      port.go(delta)
    }
  }
  return {
    reconcile,
    popstate: () => {
      if (pending) {
        pending = false
        reconcile()
        return 'own'
      }
      if (entries > 0) entries--
      return 'user'
    },
    settle: () => {
      if (!pending) return
      pending = false
      reconcile()
    },
    entries: () => entries
  }
}

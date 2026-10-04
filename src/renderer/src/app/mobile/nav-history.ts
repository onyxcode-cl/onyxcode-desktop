/**
 * Sincroniza el historial del navegador con la pila de la pestaña ACTIVA: siempre hay exactamente `profundidad - 1` entradas
 * propias, de modo que el botón/gesto «atrás» del sistema desapila la pantalla de arriba y, desde la lista, sale de la app.
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

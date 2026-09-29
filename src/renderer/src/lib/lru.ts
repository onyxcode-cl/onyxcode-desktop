/** Tope de sesiones con contenido no fijadas (LRU de `messages`). `localStorage['onyx.lru.max']` (entero ≥ 1) lo sobrescribe. */
export function lruMax(def: number): number {
  try {
    const n = Number.parseInt(localStorage.getItem('onyx.lru.max') ?? '', 10)
    if (Number.isFinite(n) && n >= 1) return n
  } catch {
    // sin storage
  }
  return def
}

/**
 * Plazos de la vista web de ArtCraft. Sin ellos, si el motor wasm nunca arranca (o la página no termina de cargar) el panel del Chat
 * se quedaba en «generando» para siempre. Con el plazo, la apertura FALLA (se registra) y quien llama cae al visor de siempre.
 */

/** Plazo total de `openWebDoc` (cargar la página + que el motor reciba el archivo). */
export const WEB_OPEN_TIMEOUT_MS = 20_000

export class WebTimeoutError extends Error {
  constructor(what: string, ms: number) {
    super(`La vista web de ArtCraft no respondió a tiempo (${what}, ${Math.round(ms / 1000)} s)`)
    this.name = 'WebTimeoutError'
  }
}

/** Rechaza con `WebTimeoutError` si `p` no termina en `ms`. No cancela `p` (solo deja de esperarla). */
export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new WebTimeoutError(what, ms)), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e: unknown) => {
        clearTimeout(timer)
        reject(e)
      }
    )
  })
}

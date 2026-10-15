/**
 * `git diff` de TODO el repo compartido entre la barra sobre la caja de entrada (+/− totales) y el panel Cambios (+/− por
 * archivo): los dos lo piden a la vez para la misma carpeta y la misma versión del disco (`fsVersion`), así que se hace
 * una sola llamada. No guarda el texto más allá de un momento (puede pesar varios MB): solo junta pedidos simultáneos.
 */

/** Tras resolverse, el resultado se reutiliza este tiempo (lo justo para que el otro consumidor lo recoja). */
export const FULL_DIFF_SHARE_MS = 1_500

const shared = new Map<string, { version: number; promise: Promise<string> }>()

export function sharedFullDiff(directory: string, version: number, load: () => Promise<string>): Promise<string> {
  const hit = shared.get(directory)
  if (hit && hit.version === version) return hit.promise
  const promise = load()
  const entry = { version, promise }
  shared.set(directory, entry)
  const drop = (): void => {
    setTimeout(() => {
      if (shared.get(directory) === entry) shared.delete(directory)
    }, FULL_DIFF_SHARE_MS)
  }
  promise.then(drop, () => {
    // Un fallo no se comparte con pedidos posteriores.
    if (shared.get(directory) === entry) shared.delete(directory)
  })
  return promise
}

/** Solo pruebas. */
export function resetSharedFullDiff(): void {
  shared.clear()
}

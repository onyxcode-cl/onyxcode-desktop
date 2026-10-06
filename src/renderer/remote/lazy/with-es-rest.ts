import { loadEsRest } from 'virtual:lazunox-es-rest'

/** Espera a la pantalla perezosa Y al resto del diccionario español (las claves que el arranque no necesita), en paralelo. */
export function withEsRest<T>(screen: Promise<T>): Promise<T> {
  return Promise.all([screen, loadEsRest()]).then(([m]) => m)
}

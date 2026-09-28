/**
 * Puente mínimo entre el panel "Contexto" (o "Actividad") y la conversación: al hacer clic en
 * una entrada, `requestScrollToPart` pide a `TaskConversation` que abra el bloque que contiene
 * esa parte y haga scroll hasta ahí.
 */
const EVENT = 'cowork:scroll-to-part'

export function requestScrollToPart(partId: string): void {
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: partId }))
}

export function onScrollToPart(listener: (partId: string) => void): () => void {
  const handler = (e: Event): void => listener((e as CustomEvent<string>).detail)
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}

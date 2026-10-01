import { useLang } from '../lib/i18n'

/**
 * Suscribe todo el árbol al idioma: al cambiarlo, este componente vuelve a llamar a `render()` (elementos
 * nuevos) y todos los descendientes se vuelven a pintar, también los que calculan etiquetas fuera de
 * React con `t()`, sin remontar nada ni perder estado.
 */
export function LangRoot({ render }: { render: () => React.ReactNode }): React.JSX.Element {
  useLang((s) => s.lang)
  return <>{render()}</>
}

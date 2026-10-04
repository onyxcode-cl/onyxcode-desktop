import { useDeferredValue } from 'react'
import { isRemoteSurface } from '../../lib/platform'
import { Markdown } from '../Markdown'

/**
 * `Markdown` con el texto diferido mientras llega por streaming en el celular: React prioriza el scroll y los toques
 * sobre re-analizar el texto en cada token. El hook se llama siempre; fuera del celular (o ya terminado) se usa el texto
 * tal cual, así que el resultado del escritorio es idéntico.
 */
export function DeferredMarkdown({
  text,
  streaming,
  highlight
}: {
  text: string
  streaming?: boolean
  highlight?: boolean
}): React.JSX.Element {
  const deferred = useDeferredValue(text)
  const shown = isRemoteSurface() && streaming ? deferred : text
  return highlight === undefined ? (
    <Markdown text={shown} streaming={streaming} />
  ) : (
    <Markdown text={shown} streaming={streaming} highlight={highlight} />
  )
}

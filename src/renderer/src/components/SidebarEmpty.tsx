import type { ReactNode } from 'react'
import { useT } from '../lib/i18n'
import { hintText, useEffectiveBindings } from '../keybindings/bindings'

/**
 * Estado vacío de la barra lateral de escritorio (1b): sin recuadro ni icono, texto de 14 px y una pista en `caption`.
 * `hint={true}` usa la pista estándar «Abre una carpeta con + o empieza con ⌘N.»; un texto la sustituye.
 */
export function SidebarEmpty({ text, hint }: { icon?: ReactNode; text: string; hint?: string | boolean }): React.JSX.Element {
  const t = useT()
  const bindings = useEffectiveBindings()
  const key = hintText(bindings['conversation.new'])
  const hintLine =
    hint === true ? (key ? t('app.sidebar.emptyHint.generic', { hint: key }) : t('app.sidebar.emptyHint.genericNoKey')) : hint || undefined
  return (
    <div className="flex flex-col gap-1 px-2 py-2">
      <p className="text-sm text-fg">{text}</p>
      {hintLine && <p className="text-meta text-subtle">{hintLine}</p>}
    </div>
  )
}

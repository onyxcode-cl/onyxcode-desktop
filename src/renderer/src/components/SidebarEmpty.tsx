import type { ReactNode } from 'react'
import { useT } from '../lib/i18n'

/** Pista de cada modo: dice qué hacer en ESE modo (Chat escribe abajo, Code abre una carpeta con +, Overdrive describe una tarea). */
export type SidebarEmptyHint = 'chat' | 'code' | 'tasks'

/**
 * Estado vacío de la barra lateral de escritorio (1b): sin recuadro ni icono, texto de 14 px y una pista en `caption`.
 * `hint` elige la pista del modo correcto; un texto la sustituye.
 */
export function SidebarEmpty({
  text,
  hint
}: {
  icon?: ReactNode
  text: string
  hint?: SidebarEmptyHint | string | false
}): React.JSX.Element {
  const t = useT()
  const hintLine =
    hint === 'chat'
      ? t('app.sidebar.emptyHint.chat')
      : hint === 'code'
        ? t('app.sidebar.emptyHint.code')
        : hint === 'tasks'
          ? t('app.sidebar.emptyHint.tasks')
          : hint || undefined
  return (
    <div className="flex flex-col gap-1 px-2 py-2">
      <p className="text-sm text-fg">{text}</p>
      {hintLine && <p className="text-meta text-subtle">{hintLine}</p>}
    </div>
  )
}

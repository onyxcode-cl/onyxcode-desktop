/**
 * Aviso NO destructivo «Sin actividad desde hace N min» bajo la conversación de una tarea en curso. Lo decide
 * el monitor de main (`quietSince` en la instantánea de actividad); aquí solo se muestra. No ofrece acciones
 * que detengan nada: el usuario decide si espera o pulsa Detener.
 */
import { useEffect, useState } from 'react'
import { Hourglass } from 'lucide-react'
import { useT } from '../../../lib/i18n'
import { useTasks } from './store'

export function StallNotice({ taskId }: { taskId: string }): React.JSX.Element | null {
  const t = useT()
  const quietSince = useTasks((s) => s.activity?.tasks.find((x) => x.sessionId === taskId)?.quietSince)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (quietSince === undefined) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(id)
  }, [quietSince])
  if (quietSince === undefined) return null
  const minutes = Math.max(1, Math.floor((now - quietSince) / 60_000))
  return (
    <div role="status" className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
      <Hourglass size={14} className="mt-0.5 shrink-0 text-warning" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{t('tasks.stall.title', { count: minutes })}</p>
        <p className="mt-0.5 text-muted">{t('tasks.stall.body')}</p>
      </div>
    </div>
  )
}

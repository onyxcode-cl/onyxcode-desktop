/**
 * Aviso «Esta tarea se interrumpió» con el botón «Continuar» (F8-B32, H6). La marca la pone `scanInterrupted` al
 * conectar (último mensaje del asistente sin `time.completed` y la tarea ya no está ocupada). Continuar envía un
 * mensaje de seguimiento en el idioma de la interfaz; al volver a trabajar la marca se quita sola.
 */
import { RotateCcw } from 'lucide-react'
import { Button } from '../../../components/Button'
import { useT } from '../../../lib/i18n'
import { errorMessage } from '../../../lib/opencode'
import { sendToTask } from './actions'
import { clearInterrupted, currentTasksModel, useTasks } from './store'

export function InterruptedNotice({ taskId }: { taskId: string }): React.JSX.Element | null {
  const t = useT()
  const marked = useTasks((s) => !!s.interrupted[taskId])
  if (!marked) return null
  const resume = (): void => {
    clearInterrupted(taskId)
    void sendToTask(t('tasks.interrupted.prompt'), currentTasksModel()).catch((e: unknown) => {
      useTasks.setState((s) => ({ interrupted: { ...s.interrupted, [taskId]: true }, error: errorMessage(e) }))
    })
  }
  return (
    <div role="status" className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
      <RotateCcw size={14} className="mt-0.5 shrink-0 text-warning" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{t('tasks.interrupted.title')}</p>
        <p className="mt-0.5 text-muted">{t('tasks.interrupted.body')}</p>
      </div>
      <Button variant="ghost" onClick={resume}>
        {t('tasks.interrupted.continue')}
      </Button>
    </div>
  )
}

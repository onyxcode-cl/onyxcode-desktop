/**
 * Badge combinado del Dock: suma las sesiones/tareas de Code y Tareas que esperan al usuario
 * (permiso o pregunta pendiente) o que terminaron sin verse, y lo publica a main (`app:setAttention`)
 * cada vez que cualquiera de los dos stores cambia.
 */
import { selectCodeAttentionCount, useCode } from '../features/code/impl/store'
import { selectTasksAttentionCount, useTasks } from '../features/tasks/impl/store'
import { setAttentionCount } from './notify'

function publish(): void {
  const count = selectCodeAttentionCount(useCode.getState()) + selectTasksAttentionCount(useTasks.getState())
  setAttentionCount(count)
}

/** Se llama una vez al montar la app; devuelve la función de limpieza. */
export function initAttentionBadge(): () => void {
  publish()
  const offCode = useCode.subscribe(publish)
  const offTasks = useTasks.subscribe(publish)
  return () => {
    offCode()
    offTasks()
  }
}

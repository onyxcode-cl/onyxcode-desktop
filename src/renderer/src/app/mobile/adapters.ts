/**
 * Qué significa «conversación abierta» en cada modo para la navegación móvil. El shell NO conoce las vistas: solo estos
 * ganchos de lectura y la acción de soltar la selección (al volver a la lista).
 */
import type { ModeId } from '@shared/types'
import { t } from '@shared/i18n'
import { newChat } from '../../features/chat/actions'
import { useChat } from '../../features/chat/store'
import { useCode } from '../../features/code/impl/store'
import { baseName } from '../../features/code/impl/ProjectPicker'
import { newTask } from '../../features/tasks/impl/actions'
import { useTasks } from '../../features/tasks/impl/store'
import { useSessions } from '../../stores/sessions'

export type ListMode = 'chat' | 'code' | 'tasks'
export const LIST_MODES: readonly ListMode[] = ['chat', 'code', 'tasks']
export const isListMode = (m: ModeId | 'more'): m is ListMode => m === 'chat' || m === 'code' || m === 'tasks'

/** Id de la conversación/sesión/tarea abierta en cada modo (`null` = ninguna: lista, o «nueva»). */
export function useActiveIds(): Record<ListMode, string | null> {
  const chat = useChat((s) => s.activeSessionId)
  const code = useCode((s) => s.activeSessionID)
  const tasks = useTasks((s) => s.activeTaskId)
  return { chat, code, tasks }
}

/** Título de la pantalla de detalle. */
export function useDetailTitle(mode: ListMode): string {
  const chatId = useChat((s) => s.activeSessionId)
  const taskId = useTasks((s) => s.activeTaskId)
  const chatTitle = useSessions((s) => (chatId ? s.sessions[chatId]?.title : undefined))
  const taskTitle = useSessions((s) => (taskId ? s.sessions[taskId]?.title : undefined))
  const codeTitle = useCode((s) => (s.activeSessionID ? s.sessions[s.activeSessionID]?.title : undefined))
  const directory = useCode((s) => s.directory)
  if (mode === 'chat') return chatTitle || t('chat.newConversation')
  if (mode === 'tasks') return taskTitle || t('tasks.ws.untitled')
  return codeTitle || (directory ? baseName(directory) : t('code.sessions.untitled'))
}

/** Suelta la selección del modo (al volver a su lista). No borra nada: la conversación sigue en el servidor. */
export function clearActive(mode: ListMode): void {
  if (mode === 'chat') newChat()
  else if (mode === 'tasks') newTask()
  else void useCode.getState().selectSession(null)
}

/** Estado visible de una tarea (el mismo para la lista de la barra lateral y para el inicio), como función lista para usar en un componente. */
import type { Session } from '@opencode-ai/sdk/v2/client'
import { useSessions } from '../../../stores/sessions'
import { backgroundBusyRoots, effectiveRun } from '../../code/impl/child-sessions'
import { isPlanPending, isUsingComputer, useTasks } from './store'
import { evictedStatusOf, isArchivedSession, permissionBelongsTo, sessionBelongsTo, taskStatus, type TaskStatus } from './util'

/**
 * Devuelve `statusOf(tarea)` y suscribe el componente a todo lo que cambia el estado (permisos, preguntas, ejecución,
 * errores, mensajes, interrupciones, «usando el equipo» y «plan listo»). Solo hay una definición del cálculo.
 */
export function useTaskStatusOf(): (t: Session) => TaskStatus {
  const permissions = useTasks((s) => s.permissions)
  const questions = useTasks((s) => s.questions)
  const interrupted = useTasks((s) => s.interrupted)
  // Solo para repintar el estado «usando el equipo» / «plan listo».
  useTasks((s) => s.lastAction)
  useTasks((s) => s.accessRequest)
  const sessions = useSessions((s) => s.sessions)
  const status = useSessions((s) => s.status)
  const errors = useSessions((s) => s.errors)
  const messages = useSessions((s) => s.messages)
  // Una tarea con ayudantes trabajando en segundo plano figura «trabajando» aunque su propia sesión esté en reposo.
  const bgBusy = backgroundBusyRoots({ sessions, status, messages, errors })
  const perms = Object.values(permissions)
  const qs = Object.values(questions)
  return (t: Session): TaskStatus =>
    taskStatus({
      run: effectiveRun(status[t.id], t.id, bgBusy),
      waiting: perms.some((p) => permissionBelongsTo(p, t.id, sessions)),
      hasQuestion: qs.some((x) => sessionBelongsTo(x.sessionID, t.id, sessions)),
      error: errors[t.id],
      entries: messages[t.id],
      evicted: evictedStatusOf(t.id),
      usingComputer: isUsingComputer(t.id),
      planPending: isPlanPending(t.id),
      interrupted: !!interrupted[t.id],
      archived: isArchivedSession(t)
    })
}

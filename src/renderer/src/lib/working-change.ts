import { t } from '@shared/i18n'
import { choiceDialog } from '../components/ConfirmDialog'

export interface WorkingChangeContext {
  busy: () => boolean
  current: () => boolean
  stop: () => Promise<void>
  subscribe: (listener: () => void) => () => void
  onError: (message: string) => void
}

// Mientras el diálogo o la parada están abiertos se bloquean los atajos repetidos.
// Tras elegir Esperar, una nueva elección sustituye la anterior y cancela su suscripción.
interface PendingChange {
  phase: 'dialog' | 'stopping' | 'waiting'
  cancelWait?: () => void
}
let pending: PendingChange | null = null

/** Devuelve true si aplaza (o bloquea) el cambio; con false el llamador puede aplicarlo directamente. */
export function deferWorkingChange(context: WorkingChangeContext, apply: () => void | Promise<void>, unchanged = false): boolean {
  // Reenviar el valor vigente no necesita diálogo, salvo que sustituya una elección pendiente.
  if (unchanged && !pending) return false
  if (pending && pending.phase !== 'waiting') return true
  pending?.cancelWait?.()
  pending = null
  if (!context.busy()) return false
  const request: PendingChange = { phase: 'dialog' }
  pending = request
  void (async () => {
    try {
      const change = await choiceDialog({
        title: t('common.workingChange.title'),
        message: t('common.workingChange.message'),
        confirmLabel: t('common.workingChange.stop'),
        cancelLabel: null,
        altLabel: t('common.workingChange.wait'),
        focusAlt: true,
        showClose: true
      })
      if (change === 'cancel' || !context.current()) return
      if (context.busy()) {
        if (change === 'alt') {
          request.phase = 'waiting'
          do {
            if (!(await waitUntilIdle(context, request))) return
          } while (pending === request && context.current() && context.busy())
        } else {
          request.phase = 'stopping'
          // La respuesta a abort no basta: esperamos también el estado que retira el botón Detener.
          await stopAndWait(context)
        }
      }
      if (pending !== request || !context.current() || context.busy()) return
      pending = null
      await apply()
    } catch {
      if (context.current()) context.onError(t('common.workingChange.failed'))
    } finally {
      if (pending === request) pending = null
    }
  })()
  return true
}

function waitUntilIdle(context: WorkingChangeContext, request: PendingChange): Promise<boolean> {
  return new Promise((resolve) => {
    let unsubscribe = (): void => undefined
    const finish = (idle: boolean): void => {
      unsubscribe()
      resolve(idle)
    }
    const check = (): void => {
      if (!context.current()) finish(false)
      else if (!context.busy()) finish(true)
    }
    request.cancelWait = () => finish(false)
    unsubscribe = context.subscribe(check)
    // Revalidar después de suscribirse para no perder un fin de trabajo entre ambas operaciones.
    check()
  })
}

function stopAndWait(context: WorkingChangeContext): Promise<void> {
  return new Promise((resolve, reject) => {
    let stopped = false
    let finished = false
    const finish = (error?: unknown): void => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      unsubscribe()
      if (error) reject(error)
      else resolve()
    }
    const check = (): void => {
      if (!context.current() || (stopped && !context.busy())) finish()
    }
    // El límite cubre tanto la petición de Detener como la espera del evento idle.
    const timer = setTimeout(() => finish(new Error('stop timeout')), 10_000)
    const unsubscribe = context.subscribe(check)
    Promise.resolve()
      .then(() => (context.current() ? context.stop() : undefined))
      .then(
        () => {
          stopped = true
          check()
        },
        (error: unknown) => finish(error)
      )
  })
}

import { t } from '@shared/i18n'
import { confirmDialog } from '../components/ConfirmDialog'

export interface WorkingChangeContext {
  busy: () => boolean
  current: () => boolean
  stop: () => Promise<void>
  subscribe: (listener: () => void) => () => void
  onError: (message: string) => void
}

// Un solo cambio pendiente: los atajos repetidos no sustituyen el diálogo ni la elección original.
let pending: symbol | null = null

/** Devuelve true si aplaza (o bloquea) el cambio; con false el llamador puede aplicarlo directamente. */
export function deferWorkingChange(context: WorkingChangeContext, apply: () => void | Promise<void>): boolean {
  if (pending) return true
  if (!context.busy()) return false
  const request = Symbol('working change')
  pending = request
  void (async () => {
    try {
      const change = await confirmDialog({
        title: t('common.workingChange.title'),
        message: t('common.workingChange.message'),
        confirmLabel: t('common.workingChange.stop'),
        cancelLabel: t('common.workingChange.wait'),
        focusCancel: true
      })
      if (!change || !context.current()) return
      // La respuesta a abort no basta: esperamos también el estado que retira el botón Detener.
      if (context.busy()) await stopAndWait(context)
      if (!context.current() || context.busy()) return
      if (pending === request) pending = null
      await apply()
    } catch {
      if (context.current()) context.onError(t('common.workingChange.failed'))
    } finally {
      if (pending === request) pending = null
    }
  })()
  return true
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

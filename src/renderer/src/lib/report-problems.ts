import { call } from './api'

/** Errores de la ventana que no aportan nada y no se anotan. */
const IGNORED = [/ResizeObserver loop/i]

function send(message: string, stack?: string): void {
  if (!message || IGNORED.some((r) => r.test(message))) return
  // Si el aviso falla (p. ej. la app se está cerrando) no se hace nada: nunca puede generar otro error.
  void call('diag:problem', { message: message.slice(0, 2000), stack: stack?.slice(0, 4000) }).catch(() => undefined)
}

/** Anota un error de la ventana (lo usa también el ErrorBoundary). */
export function reportProblem(error: unknown, extra?: string): void {
  const e = error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Error desconocido')
  send(e.message || e.name, [e.stack, extra].filter(Boolean).join('\n'))
}

/** Engancha los errores no capturados de la ventana al registro de problemas (una vez, al arrancar). */
export function installProblemReporting(): void {
  window.addEventListener('error', (ev) => reportProblem(ev.error ?? ev.message))
  window.addEventListener('unhandledrejection', (ev) => reportProblem(ev.reason))
}

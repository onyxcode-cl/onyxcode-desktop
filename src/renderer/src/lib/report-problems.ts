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

/** Texto del aviso para el registro de problemas (el MISMO desde el mensaje y desde el panel, para que se deduplique). */
export function docProblemMessage(kind: string, reason: 'json' | 'schema' | 'cut'): string {
  const why = reason === 'json' ? 'JSON inválido' : reason === 'schema' ? 'forma del documento inválida' : 'la valla quedó sin cerrar'
  return `documento de Chat (${kind}) no se pudo usar: ${why}`
}

const reportedDocProblems = new Set<string>()

/**
 * Anota en el registro de problemas (origen «documento») un documento de Chat que no se pudo leer o abrir: JSON roto, forma incorrecta,
 * valla sin cerrar. Cada documento (`key` = su texto) se anota UNA vez por motivo, aunque el mensaje se vuelva a pintar.
 * `message` es un texto corto propio de la app; nunca se manda el contenido del documento.
 */
export function reportDocProblem(key: string, message: string): void {
  const text = key.trim()
  const id = `${message}|${text.length}|${text.slice(0, 80)}|${text.slice(-80)}`
  if (reportedDocProblems.has(id)) return
  if (reportedDocProblems.size > 200) reportedDocProblems.clear()
  reportedDocProblems.add(id)
  void call('diag:problem', { message: message.slice(0, 2000), origin: 'chat-doc' }).catch(() => undefined)
}

/** Engancha los errores no capturados de la ventana al registro de problemas (una vez, al arrancar). */
export function installProblemReporting(): void {
  window.addEventListener('error', (ev) => reportProblem(ev.error ?? ev.message))
  window.addEventListener('unhandledrejection', (ev) => reportProblem(ev.reason))
}

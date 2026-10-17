/**
 * Lógica pura de la pantalla de bienvenida del primer uso: qué estado tiene cada componente que la app prepara y cuándo se puede
 * decir «todo listo». Sin React ni IPC (se prueba con `welcome-plan.test.ts`).
 */
export type WelcomeItemId = 'engine' | 'craft' | 'sandbox'
export type WelcomeItemState = 'checking' | 'ready' | 'pending' | 'downloading' | 'failed'

export type WelcomeItems = Partial<Record<WelcomeItemId, WelcomeItemState>>

/** Orden en que se muestran y se instalan. */
export const WELCOME_ORDER: readonly WelcomeItemId[] = ['engine', 'craft', 'sandbox']


export type WelcomeOverall = 'working' | 'ready' | 'failed'

/** `working` mientras algo se revisa, espera o descarga; `failed` si ya nada trabaja y algo falló; `ready` si todo está listo. */
export function welcomeOverall(items: WelcomeItems): WelcomeOverall {
  const states = WELCOME_ORDER.map((id) => items[id]).filter((s): s is WelcomeItemState => s !== undefined)
  if (states.some((s) => s === 'checking' || s === 'pending' || s === 'downloading')) return 'working'
  if (states.some((s) => s === 'failed')) return 'failed'
  return 'ready'
}

/** Componentes que hay que descargar o preparar (los que esperan su turno). */
export function toInstall(items: WelcomeItems): WelcomeItemId[] {
  return WELCOME_ORDER.filter((id) => id !== 'engine' && items[id] === 'pending')
}

/** ¿Hay que reintentar algo? Solo lo descargable: el motor ausente se resuelve en el paso siguiente. */
export function canRetry(items: WelcomeItems): boolean {
  return WELCOME_ORDER.some((id) => id !== 'engine' && items[id] === 'failed')
}

/**
 * Qué muestra la primera pantalla: `checking` mientras se revisa el equipo (saludo con «Revisando…»), `greeting` si todo está bien
 * (saludo de una frase y «Empezar») y `attention` si algo requiere atención (falta el motor, hay algo por descargar o algo falló).
 * Los permisos de macOS ya no se piden aquí: se piden cuando la persona usa «Control total».
 */
export type WelcomeView = 'checking' | 'greeting' | 'attention'

export function welcomeView(items: WelcomeItems, scanned: boolean): WelcomeView {
  const states = WELCOME_ORDER.map((id) => items[id]).filter((s): s is WelcomeItemState => s !== undefined)
  if (states.some((s) => s === 'pending' || s === 'downloading' || s === 'failed')) return 'attention'
  if (!scanned || states.some((s) => s === 'checking')) return 'checking'
  return 'greeting'
}

/** El motor de agentes: `null` = todavía no se sabe. */
export function engineState(found: boolean | null): WelcomeItemState {
  return found === null ? 'checking' : found ? 'ready' : 'failed'
}

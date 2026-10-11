/**
 * Lógica pura de la pantalla de bienvenida del primer uso: qué estado tiene cada componente que la app prepara y cuándo se puede
 * decir «todo listo». Sin React ni IPC (se prueba con `welcome-plan.test.ts`).
 */
export type WelcomeItemId = 'engine' | 'office' | 'sandbox' | 'perms'
export type WelcomeItemState = 'checking' | 'ready' | 'pending' | 'downloading' | 'failed'

export type WelcomeItems = Partial<Record<WelcomeItemId, WelcomeItemState>>

/** Orden en que se muestran y se instalan. */
export const WELCOME_ORDER: readonly WelcomeItemId[] = ['engine', 'office', 'sandbox', 'perms']

/** Cuenta atrás antes de empezar a descargar solo (la persona ve la lista y puede omitir o empezar ya). */
export const WELCOME_COUNTDOWN_S = 6

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

/** El motor de agentes: `null` = todavía no se sabe. */
export function engineState(found: boolean | null): WelcomeItemState {
  return found === null ? 'checking' : found ? 'ready' : 'failed'
}

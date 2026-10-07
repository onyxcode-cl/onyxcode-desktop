/**
 * Bandera efectiva `tasksWin` (Tareas en Windows con WSL2). PURA: las dependencias se inyectan (sin Electron).
 *
 *   tasksWin = win32 && TASKS_WIN_BUILD && !policy.disableWslTasks
 *
 * Decisión del dueño, 2026-10-07: se quita la puerta de consentimiento beta («no quiero nada beta»). Con la bandera de
 * compilación encendida, Tareas en Windows queda activa de entrada (mismo trato que macOS), sujeta solo a la puerta de
 * integridad de `win-provider.ts` (`gate()`: no elevado, paquete íntegro, estado coherente) y a la política de la
 * organización. El antiguo consentimiento (`tasks-win-beta-consent.ts`, canal `tasks:winBeta`) ya no existe.
 *
 *  - `TASKS_WIN_BUILD`: constante de compilación (`@shared/feature-flags`).
 *  - `disableWslTasks`: política de la organización; cualquier valor distinto de `false` ya llega como `true`
 *    desde `parseManagedPolicy` (fail-closed). Aquí solo `true` estricto bloquea, pero un `null` (sin política) no.
 * Todo lo que no sea exactamente `true` cuenta como apagado.
 */
import { TASKS_WIN_BUILD } from '@shared/feature-flags'

export interface TasksWinDeps {
  platform: string
  /** Puerta de compilación. Por defecto la constante real; las pruebas la inyectan. */
  build?: boolean
  policy: { disableWslTasks?: boolean } | null | undefined
}

export function resolveTasksWin(deps: TasksWinDeps): boolean {
  if (deps.platform !== 'win32') return false
  const build: boolean = deps.build ?? TASKS_WIN_BUILD
  if (build !== true) return false
  return deps.policy?.disableWslTasks !== true
}

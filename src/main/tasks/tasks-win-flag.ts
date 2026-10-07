/**
 * Bandera efectiva `tasksWin` (Tareas en Windows con WSL2). PURA: las dependencias se inyectan (sin Electron).
 *
 *   tasksWin = win32 && TASKS_WIN_BUILD && (optIn || devEnv) && !policy.disableWslTasks
 *
 *  - `TASKS_WIN_BUILD`: constante de compilación (`@shared/feature-flags`), apagada en el repositorio.
 *  - `optIn`: consentimiento beta VIGENTE leído por `main` de su archivo propio (`tasks-win-beta-consent.ts`:
 *    `userData/tasks-win-beta-consent.json`, versionado, escrito solo por `main` tras casilla + armado). `settings.tasksWinBeta`
 *    (que el renderer sí puede escribir) es LEGADO y se ignora. Solo booleano estricto.
 *  - `devEnv`: `LAZUNOX_TASKS_WIN=1` y SOLO si la app NO está empaquetada (mismo patrón que `LAZUNOX_MANAGED_POLICY`).
 *  - `disableWslTasks`: política de la organización; cualquier valor distinto de `false` ya llega como `true`
 *    desde `parseManagedPolicy` (fail-closed). Aquí solo `true` estricto bloquea, pero un `null` (sin política) no.
 * Todo lo que no sea exactamente `true` cuenta como apagado.
 */
import { TASKS_WIN_BUILD } from '@shared/feature-flags'

export interface TasksWinDeps {
  platform: string
  /** Puerta de compilación. Por defecto la constante real; las pruebas la inyectan. */
  build?: boolean
  /** Consentimiento beta vigente (`readTasksWinBetaConsent`); NUNCA `settings.tasksWinBeta`. */
  optIn: unknown
  env: Record<string, string | undefined>
  /** `app.isPackaged`. Ausente se trata como empaquetada (cierra el atajo de desarrollo). */
  isPackaged?: boolean
  policy: { disableWslTasks?: boolean } | null | undefined
}

/** ¿`LAZUNOX_TASKS_WIN=1` vale? Solo en desarrollo (`!app.isPackaged`). */
export function tasksWinDevEnv(env: Record<string, string | undefined>, isPackaged: boolean | undefined): boolean {
  return env.LAZUNOX_TASKS_WIN === '1' && isPackaged === false
}

export function resolveTasksWin(deps: TasksWinDeps): boolean {
  if (deps.platform !== 'win32') return false
  const build: boolean = deps.build ?? TASKS_WIN_BUILD
  if (build !== true) return false
  if (deps.policy?.disableWslTasks === true) return false
  return deps.optIn === true || tasksWinDevEnv(deps.env, deps.isPackaged)
}

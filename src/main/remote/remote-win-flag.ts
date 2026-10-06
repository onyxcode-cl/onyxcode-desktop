/**
 * Bandera efectiva `remoteWin` (control remoto desde el celular en Windows). PURA: las dependencias se inyectan (sin Electron).
 *
 *   remoteWin = win32 && !policy.blocked && (REMOTE_WIN_BUILD || devEnv)
 *
 *  - `REMOTE_WIN_BUILD`: puerta de compilación. Va `false` como LITERAL en el repositorio y solo pasa a `true` en un commit aparte,
 *    con la decisión del dueño, cuando haya probado el remoto en el PC (docs/REMOTO-WINDOWS.md §5). Una guardia de pruebas lee el
 *    literal. Vive aquí y NO en `src/shared/feature-flags.ts` (zona intocable de AGENTS.md §7).
 *  - `devEnv`: `LAZUNOX_REMOTE_WIN=1` y SOLO si la app NO está empaquetada (`npm run dev` en el PC de pruebas; mismo patrón que
 *    `LAZUNOX_TASKS_WIN`). Una instalación empaquetada ignora la variable.
 *  - `policyBlocked`: la política de la organización ya bloquea el remoto entero (`remote.blocked`); aquí solo `true` estricto cierra.
 * Todo lo que no sea exactamente `true`/`'1'` cuenta como apagado. No cambia ninguna garantía de seguridad: solo decide si la
 * superficie existe en Windows; cifrado, emparejamiento, límites, listas de denegación y auditoría son los mismos que en macOS.
 */
export const REMOTE_WIN_BUILD = false

export interface RemoteWinDeps {
  platform: string
  /** Puerta de compilación. Por defecto la constante real; las pruebas la inyectan. */
  build?: boolean
  env: Record<string, string | undefined>
  /** `app.isPackaged`. Ausente se trata como empaquetada (cierra el atajo de desarrollo). */
  isPackaged?: boolean
  policyBlocked?: boolean
}

export function remoteWinDevEnv(env: Record<string, string | undefined>, isPackaged: boolean | undefined): boolean {
  return env.LAZUNOX_REMOTE_WIN === '1' && isPackaged === false
}

export function resolveRemoteWin(deps: RemoteWinDeps): boolean {
  if (deps.platform !== 'win32') return false
  if (deps.policyBlocked === true) return false
  const build: boolean = deps.build ?? REMOTE_WIN_BUILD
  return build === true || remoteWinDevEnv(deps.env, deps.isPackaged)
}

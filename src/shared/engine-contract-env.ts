/**
 * Banderas de los dos contratos nuevos del motor `lazunox.16` (Lazunox 1.8.13). Módulo puro, sin Electron.
 *
 *  - `LAZUNOX_PERMISOS_CAPAS=1` (B1): política única de permisos. Con ella, `permissionMode: "replace"` en `POST` y `PATCH` de la sesión
 *    SUSTITUYE el bloque del modo en vez de acumularlo, y las sesiones hijas (ayudantes) heredan solo lo vigente del padre.
 *  - `LAZUNOX_TRUST_REQUIRED=1` (B2): el motor no carga una carpeta (complementos, conectores, `.opencode`) si la app no le dijo antes, con
 *    `POST /lazunox/trust`, que es de confianza. Una ruta con carpeta no confiada responde `403 folder_not_trusted`, salvo las lecturas de
 *    historial. La lista vive solo en memoria del motor: la app la vuelve a declarar en cada arranque (`opencode/engine-trust.ts`).
 *
 * Un motor anterior (lazunox.15 o el oficial) ignora las dos variables: no pasa nada. Las llevan TODOS los motores que lanza la app: el
 * principal (Chat y Code), los de Tareas/Overdrive (también el que corre dentro de WSL en Windows) y los de Rutinas que usan esos mismos.
 */
export const ENV_ENGINE_PERMISSION_LAYERS = 'LAZUNOX_PERMISOS_CAPAS'
export const ENV_ENGINE_TRUST_REQUIRED = 'LAZUNOX_TRUST_REQUIRED'

export function engineContractEnv(): Record<string, string> {
  return { [ENV_ENGINE_PERMISSION_LAYERS]: '1', [ENV_ENGINE_TRUST_REQUIRED]: '1' }
}

/** Ruta de las tres operaciones de confianza del motor (globales, sin `?directory=`). */
export const ENGINE_TRUST_PATH = '/lazunox/trust'

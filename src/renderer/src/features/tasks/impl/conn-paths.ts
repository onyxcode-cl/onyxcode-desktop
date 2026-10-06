/**
 * Rutas de la conexión actual de Tareas (envoltorios del estado sobre `path-map.ts`). Viven aparte del store para que
 * los componentes los importen sin depender de todo el store. En macOS todo es identidad.
 */
import { hostFolderOf, sdkDirOf, showPathOf } from './path-map'
import { useTasks } from './store'

/** `directory:` de las llamadas al SDK para una carpeta (macOS: la propia carpeta; Windows: la ruta del sandbox). */
export function sdkDir(folder: string): string {
  return sdkDirOf(useTasks.getState().conn, folder)
}

/** Ruta del sandbox (`session.directory`) → carpeta del anfitrión. */
export function hostFolder(dir: string): string {
  return hostFolderOf(useTasks.getState().conn, dir)
}

/** Ruta para MOSTRAR al usuario (`C:\\…` en Windows). Nunca autoriza nada. */
export function showPath(p: string): string {
  return showPathOf(useTasks.getState().conn, p)
}

/** Hook: como `showPath`, reactivo a la conexión. */
export function useShowPath(): (p: string) => string {
  const conn = useTasks((s) => s.conn)
  return (p) => showPathOf(conn, p)
}

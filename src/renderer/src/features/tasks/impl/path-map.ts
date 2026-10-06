/**
 * Rutas de Tareas en la interfaz (PURO, sin store). La interfaz guarda como identidad la carpeta del anfitrión
 * (`folder`, `C:\…` en Windows); OpenCode y sus sesiones hablan con la ruta del sandbox (`conn.directory`,
 * `/win/c/…`). En macOS ambas coinciden (`directory === folder`, mapa identidad) y todo aquí devuelve la ruta tal cual.
 * TRADUCIR NO ES AUTORIZAR: aquí solo se traduce para hablar con el SDK y para MOSTRAR; la autorización
 * (`assertInsideApproved`) sigue en `main`.
 */
import type { TasksConnection } from '@shared/ipc-tasks'
import { displayPath, toHost } from '@shared/tasks-path-map'

export type ConnPaths = Pick<TasksConnection, 'folder' | 'directory' | 'pathMap'> | null | undefined

/** Ruta que va en `directory:` de las llamadas al SDK (y con la que se comparan `session.directory` y los eventos). */
export function sdkDirOf(conn: ConnPaths, folder: string): string {
  return conn && conn.folder === folder ? (conn.directory ?? folder) : folder
}

/** Ruta del sandbox (p. ej. `session.directory`) → carpeta del anfitrión; si no se puede traducir, tal cual. */
export function hostFolderOf(conn: ConnPaths, dir: string): string {
  if (!conn?.pathMap) return dir
  return toHost(conn.pathMap, dir) ?? dir
}

/** Ruta para MOSTRAR al usuario (`C:\…` en Windows). Sin mapa, la ruta tal cual. */
export function showPathOf(conn: ConnPaths, p: string): string {
  return conn?.pathMap ? displayPath(conn.pathMap, p) : p
}

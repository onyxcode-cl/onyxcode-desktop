/**
 * Almacenamiento de Tareas: cuánto ocupan los directorios privados del sandbox
 * (`userData/tasks-sandbox/<clave>`, con su `cache/` y `tmp/`) y las capturas temporales de
 * Control total, y cómo limpiarlos. Mide con `/usr/bin/du -sk` (execFile, sin shell). Sin
 * dependencias de Electron: las rutas y `sandboxKey` los inyecta quien lo llama.
 */
import { execFile } from 'node:child_process'
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import type { TasksStorageEntry, TasksStorageReport } from '@shared/ipc-tasks'

export interface StorageEnv {
  /** `app.getPath('userData')`. */
  userData: string
  /** Carpeta de capturas temporales de Control total (`temp/onyxcode-computer`). */
  screenshotsDir: string
  /** Clave del directorio privado de una carpeta (`sandboxKey` de sandbox-profile). */
  sandboxKey: (folder: string) => string
  /** Tamaño en bytes de una ruta (por defecto `du -sk`). Inyectable para pruebas. */
  du?: (path: string) => Promise<number>
}

/** Servidor vivo (solo importa el sandbox: Control total no usa el directorio privado). */
export interface StorageLiveServer {
  folder: string
  fullAccess: boolean
}

const DU = '/usr/bin/du'
const KEY_RE = /^[A-Za-z0-9_-]{4,64}$/

function sandboxRoot(env: StorageEnv): string {
  return join(env.userData, 'tasks-sandbox')
}

/** Bytes que ocupa una ruta según `du -sk` (0 si no existe o falla). */
export function duBytes(path: string): Promise<number> {
  if (!existsSync(path)) return Promise.resolve(0)
  return new Promise((res) => {
    execFile(DU, ['-sk', path], { timeout: 60_000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      // `du` sale con código 1 si algún archivo no se pudo leer, pero igual imprime el total.
      const kb = Number.parseInt(
        String(stdout ?? '')
          .trim()
          .split(/\s+/)[0] ?? '',
        10
      )
      if (Number.isFinite(kb) && kb >= 0) return res(kb * 1024)
      if (err) console.error('[tasks] du:', err.message)
      res(0)
    })
  })
}

async function inBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))))
  }
  return out
}

/** Informe de uso. `folders` = carpetas de Tareas conocidas (para el mapeo clave → carpeta). */
export async function storageReport(env: StorageEnv, folders: string[], live: StorageLiveServer[]): Promise<TasksStorageReport> {
  const du = env.du ?? duBytes
  const root = sandboxRoot(env)
  const byKey = new Map<string, string>()
  for (const f of folders) {
    try {
      byKey.set(env.sandboxKey(f), f)
    } catch {
      // carpeta inválida: se ignora
    }
  }
  const runningKeys = new Set<string>()
  for (const s of live) {
    if (s.fullAccess) continue
    try {
      runningKeys.add(env.sandboxKey(s.folder))
    } catch {
      // ignorar
    }
  }
  let keys: string[] = []
  try {
    keys = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && KEY_RE.test(d.name))
      .map((d) => d.name)
  } catch {
    // el directorio aún no existe
  }
  const entries = await inBatches(keys, 4, async (key): Promise<TasksStorageEntry> => {
    const dir = join(root, key)
    const [bytes, cache, tmp] = await Promise.all([du(dir), du(join(dir, 'cache')), du(join(dir, 'tmp'))])
    return {
      key,
      folder: byKey.get(key) ?? null,
      bytes,
      cacheBytes: cache + tmp,
      running: runningKeys.has(key)
    }
  })
  entries.sort((a, b) => b.bytes - a.bytes)
  const screenshotsBytes = await du(env.screenshotsDir)
  const totalBytes = entries.reduce((n, e) => n + e.bytes, 0) + screenshotsBytes
  return { entries, screenshotsBytes, totalBytes, at: Date.now() }
}

/**
 * Limpia el directorio privado de una carpeta parada. `cache` borra `cache/` y `tmp/`; `all`
 * borra todo el directorio, INCLUIDO el historial de tareas del sandbox (la interfaz lo avisa).
 * Rechaza si el servidor de esa carpeta está vivo o si la clave no es válida.
 */
export async function storageClean(
  env: StorageEnv,
  folders: string[],
  live: StorageLiveServer[],
  key: string,
  scope: 'cache' | 'all'
): Promise<TasksStorageReport> {
  if (!KEY_RE.test(key)) throw new Error('Clave de almacenamiento no válida')
  for (const s of live) {
    if (s.fullAccess) continue
    let k: string | null = null
    try {
      k = env.sandboxKey(s.folder)
    } catch {
      k = null
    }
    if (k === key) throw new Error('No se puede limpiar: el servidor de esa carpeta está en marcha. Detenlo primero.')
  }
  const root = resolve(sandboxRoot(env))
  const dir = resolve(root, key)
  if (!dir.startsWith(root + sep)) throw new Error('Clave de almacenamiento no válida')
  if (scope === 'all') {
    rmSync(dir, { recursive: true, force: true })
  } else {
    rmSync(join(dir, 'cache'), { recursive: true, force: true })
    rmSync(join(dir, 'tmp'), { recursive: true, force: true })
  }
  return storageReport(env, folders, live)
}

/**
 * Migración de localStorage del renderer (claves `cowork.*` -> `tasks.*`, valores `'cowork'` -> `'tasks'`).
 *
 * Debe ser el PRIMER import de `main.tsx`: los stores leen localStorage al cargar su módulo. Se ejecuta una sola vez
 * (marcador `onyx.lsSchema`). Es conservadora: copia (no borra las claves viejas) y solo si la clave nueva no existe.
 * Este fichero es, junto con `legacy-names`, uno de los pocos sitios donde puede aparecer el nombre anterior del modo.
 */
import { LEGACY_LOCALSTORAGE_PREFIX, LEGACY_MODE, NEW_MODE } from '../../../main/migrations/legacy-names'

export const LS_SCHEMA_KEY = 'onyx.lsSchema'
export const LS_SCHEMA_VERSION = 1
/** Prefijo nuevo de las claves de localStorage del modo Tareas. */
export const NEW_LOCALSTORAGE_PREFIX = 'tasks.'
/** Claves cuyo VALOR guarda un id de modo/sección. */
export const MODE_VALUED_KEYS = ['ui.mode', 'settings.section'] as const

/** Subconjunto de `Storage` que usa la migración (permite simularlo en tests). */
export interface StorageLike {
  readonly length: number
  key(index: number): string | null
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface LocalStorageMigrationResult {
  /** `true` si ya estaba migrado (marcador presente) y no se hizo nada. */
  skipped: boolean
  /** Claves nuevas creadas a partir de las viejas. */
  copied: string[]
  /** Claves cuyo valor se cambió de `'cowork'` a `'tasks'`. */
  converted: string[]
}

export function migrateLocalStorage(storage: StorageLike): LocalStorageMigrationResult {
  const result: LocalStorageMigrationResult = { skipped: false, copied: [], converted: [] }
  const marker = Number(storage.getItem(LS_SCHEMA_KEY))
  if (Number.isFinite(marker) && marker >= LS_SCHEMA_VERSION) return { ...result, skipped: true }

  const keys: string[] = []
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i)
    if (k !== null) keys.push(k)
  }
  for (const oldKey of keys) {
    if (!oldKey.startsWith(LEGACY_LOCALSTORAGE_PREFIX)) continue
    const newKey = NEW_LOCALSTORAGE_PREFIX + oldKey.slice(LEGACY_LOCALSTORAGE_PREFIX.length)
    if (storage.getItem(newKey) !== null) continue
    const value = storage.getItem(oldKey)
    if (value === null) continue
    storage.setItem(newKey, value)
    result.copied.push(newKey)
  }
  for (const key of MODE_VALUED_KEYS) {
    if (storage.getItem(key) === LEGACY_MODE) {
      storage.setItem(key, NEW_MODE)
      result.converted.push(key)
    }
  }
  storage.setItem(LS_SCHEMA_KEY, String(LS_SCHEMA_VERSION))
  return result
}

/** Ejecución al importar el módulo: nunca lanza (sin storage, cuota, modo privado…). */
export function runLocalStorageMigration(): void {
  try {
    if (typeof localStorage === 'undefined') return
    migrateLocalStorage(localStorage)
  } catch {
    // sin localStorage: los stores usan sus valores por defecto
  }
}

runLocalStorageMigration()

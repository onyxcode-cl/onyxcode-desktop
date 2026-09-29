/**
 * Migraciones de datos de userData. `runMigrations(userData)` es idempotente: lo aplicado queda en
 * `userData/migrations.json` (`{schema:1, applied:[{id,at,appVersion}]}`), que se escribe SOLO si todos los pasos de la
 * migración terminaron bien; si alguno falla se reintenta en el siguiente arranque. Nunca lanza: la app arranca igual.
 */
import { readFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomic, exists } from './json-util'
import { M001_ID, runM001, type M001Report } from './m001-tasks-rename'

export { migrateFolderScratch, type FolderScratchResult } from './migrate-folder-scratch'
export { migrateLegacyUserData } from './legacy-app-names'
export { rollbackM001 } from './rollback'
export { M001_ID } from './m001-tasks-rename'

export interface AppliedMigration {
  id: string
  at: string
  appVersion: string
}
export interface MigrationsRegistry {
  schema: 1
  applied: AppliedMigration[]
}
export interface RunMigrationsOptions {
  appVersion?: string
  now?: () => Date
  log?: (msg: string, err?: unknown) => void
}
export interface MigrationOutcome {
  id: string
  status: 'skipped' | 'applied' | 'partial'
  report?: M001Report
}

export function registryFile(userData: string): string {
  return join(userData, 'migrations.json')
}

export function readRegistry(userData: string, log: (msg: string, err?: unknown) => void = () => undefined): MigrationsRegistry {
  const file = registryFile(userData)
  if (!exists(file)) return { schema: 1, applied: [] }
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<MigrationsRegistry>
    if (raw && Array.isArray(raw.applied)) {
      return { schema: 1, applied: raw.applied.filter((a): a is AppliedMigration => !!a && typeof a.id === 'string') }
    }
  } catch (err) {
    log('migrations.json inválido; se aparta y se reconstruye (los pasos son idempotentes)', err)
  }
  try {
    renameSync(file, `${file}.corrupt-${Date.now()}`)
  } catch {
    /* se sobrescribirá al terminar */
  }
  return { schema: 1, applied: [] }
}

export function runMigrations(userData: string, options: RunMigrationsOptions = {}): MigrationOutcome[] {
  const log = options.log ?? ((msg, err) => (err ? console.error(`[migrations] ${msg}`, err) : console.log(`[migrations] ${msg}`)))
  const now = options.now ?? (() => new Date())
  const outcomes: MigrationOutcome[] = []
  try {
    const registry = readRegistry(userData, log)
    if (registry.applied.some((a) => a.id === M001_ID)) return [{ id: M001_ID, status: 'skipped' }]
    const report = runM001(userData, { appVersion: options.appVersion, now, log })
    if (report.failed === 0) {
      registry.applied.push({ id: M001_ID, at: now().toISOString(), appVersion: options.appVersion ?? '' })
      writeFileAtomic(registryFile(userData), JSON.stringify(registry, null, 2))
      outcomes.push({ id: M001_ID, status: 'applied', report })
    } else {
      log(`${M001_ID}: ${report.failed} paso(s) fallaron; se reintentará en el próximo arranque`)
      outcomes.push({ id: M001_ID, status: 'partial', report })
    }
  } catch (err) {
    log(`${M001_ID}: error inesperado`, err)
    outcomes.push({ id: M001_ID, status: 'partial' })
  }
  return outcomes
}

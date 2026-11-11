import { app } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { migrateBackgroundSubagentsDefault, normalizeEngineExperiments } from '@shared/engine-experiments'
import { normalizeEngineLimits } from '@shared/engine-limits'
import { normalizeModelFallback } from '@shared/model-fallback'
import { normalizeCodeTrustedMcp } from '@shared/mcp-permissions'
import { isLangPref, migrateLanguage } from '@shared/i18n'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types'
import { HOOKS_DIR_NAME, HOOKS_FILE_NAME, HOOKS_MAX_FILE_BYTES, normalizeHooksSha256 } from '@shared/user-hooks'

const MAX_RECENT = 10

/**
 * Migración de la 1.8.12 (decisión D11 = a): un `settings.json` anterior con los ganchos YA ACTIVOS y sin la clave `userHooksSha256` no tiene
 * huella, y sin huella el motor no recibe ni el archivo. Se confía en el archivo de ese día UNA sola vez: su huella se guarda y `userHooksReview`
 * se enciende para que Ajustes diga «Revisa tus ganchos». Devuelve `null` (sin huella) si el archivo no existe, no es un archivo normal (un enlace
 * simbólico no se sigue), queda fuera de `userData/hooks/` una vez resueltos los enlaces o pesa más que el tope del motor: en esos casos los
 * ganchos no corren hasta que la persona guarde desde la pantalla.
 */
export function hooksTrustFromDisk(userData: string): string | null {
  try {
    const file = join(userData, HOOKS_DIR_NAME, HOOKS_FILE_NAME)
    const st = lstatSync(file)
    if (!st.isFile() || st.size > HOOKS_MAX_FILE_BYTES) return null
    if (realpathSync(file) !== join(realpathSync(userData), HOOKS_DIR_NAME, HOOKS_FILE_NAME)) return null
    const bytes = readFileSync(file)
    if (bytes.length > HOOKS_MAX_FILE_BYTES) return null
    return createHash('sha256').update(bytes).digest('hex')
  } catch {
    return null
  }
}

type Listener = (settings: Settings) => void

/** Settings persistidos en `userData/settings.json` (lectura síncrona, escritura atómica). */
class SettingsStore {
  private cache: Settings | null = null
  private listeners = new Set<Listener>()

  get file(): string {
    return join(app.getPath('userData'), 'settings.json')
  }

  get(): Settings {
    if (this.cache) return this.cache
    let loaded: Partial<Settings> = {}
    try {
      if (existsSync(this.file)) loaded = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Settings>
    } catch (err) {
      console.error('[store] settings.json inválido, usando valores por defecto:', err)
    }
    const bg = migrateBackgroundSubagentsDefault(loaded.engineExperiments, loaded.engineBgMigrated)
    // Ganchos ya activos y sin huella (settings.json anterior a la 1.8.12): se confía en el archivo de hoy, una sola vez (D11).
    const hooksMigration = loaded.userHooksEnabled === true && loaded.userHooksSha256 === undefined && existsSync(this.file)
    const hooksSha = hooksMigration ? hooksTrustFromDisk(dirname(this.file)) : null
    this.cache = normalize({
      ...DEFAULT_SETTINGS,
      ...loaded,
      ...(hooksMigration ? { userHooksSha256: hooksSha, userHooksReview: hooksSha !== null } : {}),
      engineExperiments: bg.value,
      engineBgMigrated: bg.migrated,
      language: migrateLanguage(loaded)
    })
    // Esta migración SÍ se guarda ya: si no, cada arranque volvería a confiar en el archivo de ese momento. Solo ocurre cuando `settings.json`
    // existía (la migración de nombres antiguos, que solo copia uno si no existe, no se ve afectada).
    if (hooksMigration) {
      try {
        // Se guarda el JSON crudo MÁS las dos claves nuevas (no el objeto normalizado): así no se pierde ninguna clave que las migraciones de
        // nombres antiguos (`runMigrations`) todavía necesiten leer de este archivo.
        this.write({ ...loaded, userHooksSha256: hooksSha, userHooksReview: hooksSha !== null })
      } catch (err) {
        console.error('[store] no se pudo guardar la huella de los ganchos:', (err as NodeJS.ErrnoException)?.code ?? 'desconocido')
        // Sin poder fijarla en disco, la huella queda en `null` también en memoria: los ganchos no corren en vez de volver a confiar en el archivo
        // del siguiente arranque.
        this.cache = { ...this.cache, userHooksSha256: null, userHooksReview: false }
      }
    }
    // NO se escribe al leer: este `get()` puede correr antes de las migraciones de datos viejos (`runMigrations`), que necesitan el
    // archivo tal como está en disco. El marcador `engineBgMigrated` se guarda con la siguiente escritura normal (`set`); mientras
    // tanto la migración es idempotente (da lo mismo en cada arranque).
    return this.cache
  }

  set(patch: Partial<Settings>): Settings {
    const next = normalize({ ...this.get(), ...patch })
    this.cache = next
    this.write(next)
    for (const l of this.listeners) l(next)
    return next
  }

  addRecentFolder(path: string): Settings {
    const recent = [path, ...this.get().recentFolders.filter((p) => p !== path)].slice(0, MAX_RECENT)
    return this.set({ recentFolders: recent })
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private write(settings: object): void {
    const file = this.file
    mkdirSync(dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf8')
    renameSync(tmp, file)
  }
}

function normalize(s: Settings): Settings {
  const theme = s.theme === 'light' || s.theme === 'dark' ? s.theme : 'system'
  const sidebarGlass = s.sidebarGlass === 'solid' || s.sidebarGlass === 'soft' ? s.sidebarGlass : 'glass'
  const dm = s.defaultModel
  const defaultModel = dm && typeof dm.providerID === 'string' && typeof dm.modelID === 'string' ? dm : DEFAULT_SETTINGS.defaultModel
  const recentFolders = Array.isArray(s.recentFolders)
    ? s.recentFolders.filter((p): p is string => typeof p === 'string').slice(0, MAX_RECENT)
    : []
  const tasksGlobalInstructions = typeof s.tasksGlobalInstructions === 'string' ? s.tasksGlobalInstructions.slice(0, 20_000) : ''
  const userInstructions = typeof s.userInstructions === 'string' ? s.userInstructions.slice(0, 4000) : ''
  const onboarded = s.onboarded === true
  const routinesTermsAcknowledged = s.routinesTermsAcknowledged === true
  // Solo rutas absolutas sin bytes nulos; el resto se descarta (vuelve la detección automática).
  const opencodeBin =
    typeof s.opencodeBin === 'string' && s.opencodeBin.length <= 4096 && isAbsolute(s.opencodeBin) && !s.opencodeBin.includes('\0')
      ? s.opencodeBin
      : ''
  return {
    defaultModel,
    theme,
    sidebarGlass,
    recentFolders,
    tasksGlobalInstructions,
    userInstructions,
    onboarded,
    routinesTermsAcknowledged,
    language: isLangPref(s.language) ? s.language : 'system',
    opencodeBin,
    checkUpdates: s.checkUpdates !== false,
    learningEnabled: s.learningEnabled !== false,
    engineExperiments: normalizeEngineExperiments(s.engineExperiments),
    engineLimits: normalizeEngineLimits(s.engineLimits),
    // Solo `false` exacto lo apaga: ausente o basura = encendido (defecto).
    rememberAlways: s.rememberAlways !== false,
    gitHooksEnabled: s.gitHooksEnabled === true,
    // Solo `true` exacto lo enciende: ausente o basura = apagado (ejecuta comandos de la persona).
    userHooksEnabled: s.userHooksEnabled === true,
    // Huella con forma exacta (64 hex) o `null`; basura = `null` (los ganchos no corren hasta guardar de nuevo desde la pantalla).
    userHooksSha256: normalizeHooksSha256(s.userHooksSha256),
    userHooksReview: s.userHooksReview === true && normalizeHooksSha256(s.userHooksSha256) !== null,
    // Solo `true` exacto: ausente o basura = apagado (las búsquedas salen a un tercero; la sugerencia tarda y puede costar).
    webSearchAnyProvider: s.webSearchAnyProvider === true,
    permissionSuggestions: s.permissionSuggestions === true,
    modelFallback: normalizeModelFallback(s.modelFallback),
    engineBgMigrated: s.engineBgMigrated === true,
    codeTrustedMcp: normalizeCodeTrustedMcp(s.codeTrustedMcp),
    // Solo `true` exacto lo enciende (bandera experimental del modo plan): ausente o basura = apagado.
    modoPlan: s.modoPlan === true
  }
}

export const settingsStore = new SettingsStore()

import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types'

const MAX_RECENT = 10

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
    this.cache = normalize({ ...DEFAULT_SETTINGS, ...loaded })
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

  private write(settings: Settings): void {
    const file = this.file
    mkdirSync(dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf8')
    renameSync(tmp, file)
  }
}

function normalize(s: Settings): Settings {
  const theme = s.theme === 'light' || s.theme === 'dark' ? s.theme : 'system'
  const dm = s.defaultModel
  const defaultModel = dm && typeof dm.providerID === 'string' && typeof dm.modelID === 'string' ? dm : DEFAULT_SETTINGS.defaultModel
  const recentFolders = Array.isArray(s.recentFolders)
    ? s.recentFolders.filter((p): p is string => typeof p === 'string').slice(0, MAX_RECENT)
    : []
  const coworkGlobalInstructions = typeof s.coworkGlobalInstructions === 'string' ? s.coworkGlobalInstructions.slice(0, 20_000) : ''
  const onboarded = s.onboarded === true
  // Solo rutas absolutas sin bytes nulos; el resto se descarta (vuelve la detección automática).
  const opencodeBin =
    typeof s.opencodeBin === 'string' && s.opencodeBin.length <= 4096 && isAbsolute(s.opencodeBin) && !s.opencodeBin.includes('\0')
      ? s.opencodeBin
      : ''
  return { defaultModel, theme, recentFolders, coworkGlobalInstructions, onboarded, opencodeBin }
}

export const settingsStore = new SettingsStore()

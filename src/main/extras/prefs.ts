import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DEFAULT_EXTRAS_PREFS, defaultQuickEntryShortcut, type ExtrasPrefs, type ModelMode } from '@shared/ipc-extras'
import type { ModelRef } from '@shared/types'
import { kbPlatformOf, sanitizeOverrides } from '@shared/keybindings'

type Listener = (prefs: ExtrasPrefs) => void

/** Valores por defecto de esta plataforma (el atajo de Quick Entry cambia en Windows). */
function platformDefaults(): ExtrasPrefs {
  return { ...DEFAULT_EXTRAS_PREFS, quickEntryShortcut: defaultQuickEntryShortcut(process.platform) }
}

const MODES: readonly ModelMode[] = ['chat', 'code', 'tasks']

function isModelRef(v: unknown): v is ModelRef {
  return !!v && typeof v === 'object' && typeof (v as ModelRef).providerID === 'string' && typeof (v as ModelRef).modelID === 'string'
}

function normalize(input: Partial<ExtrasPrefs>): ExtrasPrefs {
  const shortcut = typeof input.quickEntryShortcut === 'string' ? input.quickEntryShortcut.trim() : platformDefaults().quickEntryShortcut
  const modelsByMode: ExtrasPrefs['modelsByMode'] = {}
  const raw = input.modelsByMode
  if (raw && typeof raw === 'object') {
    for (const m of MODES) {
      const v = (raw as Record<string, unknown>)[m]
      if (isModelRef(v)) modelsByMode[m] = { providerID: v.providerID, modelID: v.modelID }
    }
  }
  const showTray = typeof input.showTray === 'boolean' ? input.showTray : DEFAULT_EXTRAS_PREFS.showTray
  const notificationsEnabled =
    typeof input.notificationsEnabled === 'boolean' ? input.notificationsEnabled : DEFAULT_EXTRAS_PREFS.notificationsEnabled
  const soundEnabled = typeof input.soundEnabled === 'boolean' ? input.soundEnabled : DEFAULT_EXTRAS_PREFS.soundEnabled
  const keybindings = sanitizeOverrides(input.keybindings, kbPlatformOf(process.platform))
  return { quickEntryShortcut: shortcut, modelsByMode, showTray, notificationsEnabled, soundEnabled, keybindings }
}

/** Preferencias de extras en `userData/extras.json` (separadas de settings.json). */
class ExtrasPrefsStore {
  private cache: ExtrasPrefs | null = null
  private listeners = new Set<Listener>()

  get file(): string {
    return join(app.getPath('userData'), 'extras.json')
  }

  get(): ExtrasPrefs {
    if (this.cache) return this.cache
    let loaded: Partial<ExtrasPrefs> = {}
    try {
      if (existsSync(this.file)) loaded = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<ExtrasPrefs>
    } catch (err) {
      console.error('[extras] extras.json inválido, usando valores por defecto:', err)
    }
    this.cache = normalize({ ...platformDefaults(), ...loaded })
    return this.cache
  }

  set(patch: Partial<ExtrasPrefs>): ExtrasPrefs {
    const current = this.get()
    const next = normalize({
      ...current,
      ...patch,
      modelsByMode: patch.modelsByMode !== undefined ? patch.modelsByMode : current.modelsByMode
    })
    this.cache = next
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8')
    renameSync(tmp, this.file)
    for (const l of this.listeners) l(next)
    return next
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

export const extrasPrefs = new ExtrasPrefsStore()

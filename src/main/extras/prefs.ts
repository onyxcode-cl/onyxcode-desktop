import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DEFAULT_EXTRAS_PREFS, type ExtrasPrefs, type ModelMode } from '@shared/ipc-extras'
import type { ModelRef } from '@shared/types'

type Listener = (prefs: ExtrasPrefs) => void

const MODES: readonly ModelMode[] = ['chat', 'code', 'cowork']

function isModelRef(v: unknown): v is ModelRef {
  return (
    !!v &&
    typeof v === 'object' &&
    typeof (v as ModelRef).providerID === 'string' &&
    typeof (v as ModelRef).modelID === 'string'
  )
}

function normalize(input: Partial<ExtrasPrefs>): ExtrasPrefs {
  const shortcut =
    typeof input.quickEntryShortcut === 'string' ? input.quickEntryShortcut.trim() : DEFAULT_EXTRAS_PREFS.quickEntryShortcut
  const modelsByMode: ExtrasPrefs['modelsByMode'] = {}
  const raw = input.modelsByMode
  if (raw && typeof raw === 'object') {
    for (const m of MODES) {
      const v = (raw as Record<string, unknown>)[m]
      if (isModelRef(v)) modelsByMode[m] = { providerID: v.providerID, modelID: v.modelID }
    }
  }
  const showTray = typeof input.showTray === 'boolean' ? input.showTray : DEFAULT_EXTRAS_PREFS.showTray
  return { quickEntryShortcut: shortcut, modelsByMode, showTray }
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
    this.cache = normalize({ ...DEFAULT_EXTRAS_PREFS, ...loaded })
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

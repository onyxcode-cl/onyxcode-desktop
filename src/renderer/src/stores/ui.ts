import { create } from 'zustand'
import type { ModeId } from '@shared/types'
import { LEGACY_MODE } from '../../../main/migrations/legacy-names'

interface UiState {
  mode: ModeId
  settingsOpen: boolean
  sidebarCollapsed: boolean
  paletteOpen: boolean
  /** Elemento al que debe desplazarse la sección de Ajustes al abrirse (p. ej. `providers`); lo consume la sección. */
  settingsFocus: 'providers' | null
  setMode: (mode: ModeId) => void
  openSettings: (open: boolean) => void
  /** Abre Ajustes directamente en una sección (y, si se indica, desplazada a un punto de ella). */
  openSettingsAt: (section: string, focus?: 'providers') => void
  clearSettingsFocus: () => void
  toggleSidebar: () => void
  setPaletteOpen: (open: boolean) => void
}

const MODE_KEY = 'ui.mode'

function initialMode(): ModeId {
  try {
    const m = localStorage.getItem(MODE_KEY)
    if (m === 'chat' || m === 'code' || m === 'tasks' || m === 'routines') return m
    if (m === LEGACY_MODE) return 'tasks'
  } catch {
    // sin storage
  }
  return 'chat'
}

export const useUi = create<UiState>((set) => ({
  mode: initialMode(),
  settingsOpen: false,
  sidebarCollapsed: false,
  paletteOpen: false,
  settingsFocus: null,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setMode: (mode) => {
    try {
      localStorage.setItem(MODE_KEY, mode)
    } catch {
      // ignorar
    }
    set({ mode, settingsOpen: false })
  },
  openSettings: (settingsOpen) => set({ settingsOpen }),
  openSettingsAt: (section, focus) => {
    try {
      localStorage.setItem('settings.section', section)
    } catch {
      // sin storage: se abre en la sección que estuviera
    }
    set({ settingsOpen: true, settingsFocus: focus ?? null })
  },
  clearSettingsFocus: () => set({ settingsFocus: null }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed }))
}))

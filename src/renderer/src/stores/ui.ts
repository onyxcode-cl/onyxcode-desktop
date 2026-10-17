import { create } from 'zustand'
import type { ModeId } from '@shared/types'
import { usableMode } from '@shared/platform-caps'
import { currentFlags, currentPlatform } from '../lib/platform'
import { LEGACY_MODE } from '../../../main/migrations/legacy-names'

interface UiState {
  mode: ModeId
  settingsOpen: boolean
  sidebarCollapsed: boolean
  paletteOpen: boolean
  /** Ventana angosta (< NARROW_WINDOW_PX): la lista de la barra lateral se pliega sola a riel; el botón de la barra la abre encima. */
  narrow: boolean
  /** Solo en ventana angosta: la lista está abierta (superpuesta al contenido). */
  narrowOpen: boolean
  /** Filtro de la lista de sesiones de Code (píldoras de la barra lateral). */
  sessionFilter: 'all' | 'active' | 'review'
  setNarrow: (narrow: boolean) => void
  setSessionFilter: (f: 'all' | 'active' | 'review') => void
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
    if (m === 'chat' || m === 'code' || m === 'tasks' || m === 'routines' || m === 'gallery')
      return usableMode(m, currentPlatform(), currentFlags())
    if (m === LEGACY_MODE) return usableMode('tasks', currentPlatform(), currentFlags())
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
  narrow: false,
  narrowOpen: false,
  sessionFilter: 'all',
  setNarrow: (narrow) => set((s) => (s.narrow === narrow ? s : { narrow, narrowOpen: false })),
  setSessionFilter: (sessionFilter) => set({ sessionFilter }),
  settingsFocus: null,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setMode: (requested) => {
    // Tareas no existe en Windows: cualquier intento (paleta, notificación, estado guardado) cae a Chat.
    const mode = usableMode(requested, currentPlatform(), currentFlags())
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
  toggleSidebar: () => set((s) => (s.narrow ? { narrowOpen: !s.narrowOpen } : { sidebarCollapsed: !s.sidebarCollapsed }))
}))

/** Ancho de ventana bajo el cual la lista se pliega sola: riel 56 + lista 236 + ~568 px mínimos para la conversación. */
export const NARROW_WINDOW_PX = 860

/** ¿La lista está oculta (solo riel)? Plegada a mano, o sola en ventana angosta mientras no se abra encima. */
export const selectListCollapsed = (s: Pick<UiState, 'narrow' | 'narrowOpen' | 'sidebarCollapsed' | 'settingsOpen'>): boolean =>
  // Ajustes abierto: la lista de conversaciones no aporta y roba ancho (sobre todo a 1000x700); queda solo el riel y se restaura al salir.
  s.settingsOpen || (s.narrow ? !s.narrowOpen : s.sidebarCollapsed)

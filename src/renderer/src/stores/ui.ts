import { create } from 'zustand'
import type { ModeId } from '@shared/types'

interface UiState {
  mode: ModeId
  settingsOpen: boolean
  sidebarCollapsed: boolean
  setMode: (mode: ModeId) => void
  openSettings: (open: boolean) => void
  toggleSidebar: () => void
}

const MODE_KEY = 'ui.mode'

function initialMode(): ModeId {
  try {
    const m = localStorage.getItem(MODE_KEY)
    if (m === 'chat' || m === 'code' || m === 'cowork' || m === 'routines') return m
  } catch {
    // sin storage
  }
  return 'chat'
}

export const useUi = create<UiState>((set) => ({
  mode: initialMode(),
  settingsOpen: false,
  sidebarCollapsed: false,
  setMode: (mode) => {
    try {
      localStorage.setItem(MODE_KEY, mode)
    } catch {
      // ignorar
    }
    set({ mode, settingsOpen: false })
  },
  openSettings: (settingsOpen) => set({ settingsOpen }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed }))
}))

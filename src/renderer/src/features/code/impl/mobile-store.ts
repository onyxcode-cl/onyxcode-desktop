/** Estado de la pantalla de Code en el celular (superficie `remote`): qué pantalla se ve y qué hoja está abierta. */
import { create } from 'zustand'

export type MobileSheetId = 'changes' | 'files' | 'browser' | 'actions'

interface CodeMobileState {
  screen: 'list' | 'chat'
  sheet: MobileSheetId | null
  setScreen: (s: 'list' | 'chat') => void
  openSheet: (s: MobileSheetId) => void
  closeSheet: () => void
}

/** Es del celular: no toca el `panel` persistido del store de Code (que es de escritorio). */
export const useCodeMobile = create<CodeMobileState>((set) => ({
  screen: 'list',
  sheet: null,
  setScreen: (screen) => set({ screen }),
  openSheet: (sheet) => set({ sheet }),
  closeSheet: () => set({ sheet: null })
}))

/** Abre la conversación (tras elegir o crear una sesión). */
export const showCodeChat = (): void => useCodeMobile.getState().setScreen('chat')

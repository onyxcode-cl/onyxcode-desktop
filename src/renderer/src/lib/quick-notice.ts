/**
 * Aviso visible cuando Quick Entry no pudo enviar el mensaje y no hay conversación donde mostrar el error (R3-A).
 * El texto ya quedó en el borrador de Chat; esto solo explica por qué no se envió.
 */
import { create } from 'zustand'
import { friendlyError, type FriendlyError } from '@shared/ai-errors'

interface QuickNoticeState {
  notice: FriendlyError | null
  show: (err: unknown) => void
  dismiss: () => void
}

export const useQuickNotice = create<QuickNoticeState>((set) => ({
  notice: null,
  show: (err) => set({ notice: friendlyError(err) }),
  dismiss: () => set({ notice: null })
}))

import { create } from 'zustand'

interface ChatState {
  activeSessionId: string | null
  listLoading: boolean
  listError: string | null
  setActive: (id: string | null) => void
  setListState: (s: { listLoading?: boolean; listError?: string | null }) => void
}

export const useChat = create<ChatState>((set) => ({
  activeSessionId: null,
  listLoading: false,
  listError: null,
  setActive: (activeSessionId) => set({ activeSessionId }),
  setListState: (s) => set(s)
}))

/** Cierres locales de tarjetas rechazadas. No se envían al motor ni se confunden con mensajes del modelo. */
import { create } from 'zustand'

export interface RejectionNotice {
  mode: 'code' | 'tasks'
  directory: string
  sessionID: string
  requestID: string
  kind: 'permission' | 'question'
  detail: string
}

const keyOf = (n: RejectionNotice): string => JSON.stringify([n.mode, n.directory, n.sessionID, n.kind, n.requestID])

export const useRejectionNotices = create<{
  notices: RejectionNotice[]
  add: (notice: RejectionNotice) => void
  dismiss: (notice: RejectionNotice) => void
}>((set) => ({
  notices: [],
  add: (notice) =>
    set((s) => ({
      notices: [...s.notices.filter((n) => keyOf(n) !== keyOf(notice)), { ...notice, detail: notice.detail.slice(0, 2000) }].slice(-100)
    })),
  dismiss: (notice) => set((s) => ({ notices: s.notices.filter((n) => keyOf(n) !== keyOf(notice)) }))
}))

export function rejectedPermissionDetail(request: { metadata: Record<string, unknown>; patterns: string[]; permission: string }): string {
  const m = request.metadata
  return (
    [m.command, m.filepath, m.filePath, m.path, m.url, m.query].find((v): v is string => typeof v === 'string' && !!v) ||
    request.patterns.join('\n') ||
    request.permission
  )
}

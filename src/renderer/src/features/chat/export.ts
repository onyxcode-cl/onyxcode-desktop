import type { Session } from '@opencode-ai/sdk/v2/client'
import { t } from '@shared/i18n'
import { runExportAction, type ExportAction } from '../../components/ExportConversation'
import { entriesToExportDoc } from '../../lib/conversation/export'
import { useServer } from '../../stores/server'
import { useSessions } from '../../stores/sessions'

/** Copiar o guardar (Markdown/PDF) una conversación del Chat, aunque no sea la abierta (se carga si hace falta). */
export function exportChatConversation(session: Pick<Session, 'id' | 'title' | 'time'>, action: ExportAction): Promise<void> {
  return runExportAction(action, async () => {
    const st = useSessions.getState()
    if (!st.loaded[session.id]) {
      const { client, connection } = useServer.getState()
      if (client && connection) await st.loadMessages(client, session.id, connection.chatDirectory)
    }
    const entries = useSessions.getState().messages[session.id] ?? []
    return entriesToExportDoc(entries, { title: session.title || t('conv.export.untitled'), createdAt: session.time.created })
  })
}

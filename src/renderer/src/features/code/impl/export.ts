import type { Session } from '@opencode-ai/sdk/v2/client'
import { t } from '@shared/i18n'
import { runExportAction, type ExportAction } from '../../../components/ExportConversation'
import { entriesToExportDoc } from '../../../lib/conversation/export'
import { getClient, sdkData } from './client'
import { useCode } from './store'

/** Copiar o guardar (Markdown/PDF) una sesión de Code. Si no está cargada se lee del motor sin tocar la sesión activa. */
export function exportCodeConversation(session: Pick<Session, 'id' | 'title'>, action: ExportAction): Promise<void> {
  return runExportAction(action, async () => {
    const st = useCode.getState()
    let entries = st.messages[session.id]
    if (!entries) {
      const client = getClient()
      const dir = st.sessionProject[session.id] ?? st.directory
      if (client && dir) {
        const data = sdkData(await client.session.messages({ sessionID: session.id, directory: dir }))
        entries = data.map((m) => ({ info: m.info, parts: m.parts })).sort((a, b) => (a.info.id < b.info.id ? -1 : 1))
      }
    }
    return entriesToExportDoc(entries ?? [], {
      title: session.title || t('conv.export.untitled'),
      createdAt: st.sessions[session.id]?.time.created ?? Date.now()
    })
  })
}
